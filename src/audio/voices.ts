/**
 * Klangerzeuger auf WebAudio-Basis. Alle Funktionen arbeiten mit BaseAudioContext,
 * also live (AudioContext) wie offline (OfflineAudioContext, für Hörproben).
 */
import type { Instrument } from './compositions.ts';
import { mulberry32 } from './rng.ts';
import { midiToFreq } from './theory.ts';

export interface VoiceOpts {
  ctx: BaseAudioContext;
  out: AudioNode;
  time: number;
  /** Klingdauer in Sekunden (ohne Ausklang) */
  dur: number;
  midi: number;
  vel: number;
}

// ---------- Puffer ----------

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const brownCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const pluckCache = new WeakMap<BaseAudioContext, Map<string, { buffer: AudioBuffer; rate: number }>>();

/** Weißes Rauschen, 2 s, deterministisch */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    const rng = mulberry32(1234);
    for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** Braunes Rauschen (tiefes Rauschen), 4 s, nahtlos loopbar */
export function brownBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = brownCache.get(ctx);
  if (!b) {
    const len = Math.floor(ctx.sampleRate * 4);
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    const rng = mulberry32(99);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    // Übergang am Loop-Punkt glätten
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const w = i / fade;
      d[len - fade + i] = d[len - fade + i] * (1 - w) + d[i] * w;
    }
    brownCache.set(ctx, b);
  }
  return b;
}

/**
 * Gezupfte Saite nach Karplus-Strong. Die Verzögerungslänge ist ganzzahlig, die exakte
 * Tonhöhe kommt über playbackRate.
 */
function pluckBuffer(ctx: BaseAudioContext, midi: number, bright: number): { buffer: AudioBuffer; rate: number } {
  let cache = pluckCache.get(ctx);
  if (!cache) pluckCache.set(ctx, (cache = new Map()));
  const key = `${midi}:${bright}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const sr = ctx.sampleRate;
  const f = midiToFreq(midi);
  const n = Math.max(2, Math.floor(sr / f - 0.5));
  const seconds = midi < 55 ? 2.4 : 1.8;
  const len = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(1, len, sr);
  const y = buffer.getChannelData(0);
  const rng = mulberry32(midi * 31 + bright);
  // Anregung: gefiltertes Rauschen, weicher bei geringer Helligkeit
  const a = bright ? 0.35 : 0.7;
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    lp = lp * a + (rng() * 2 - 1) * (1 - a);
    y[i] = lp;
    mean += lp;
  }
  mean /= n;
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    y[i] -= mean;
    peak = Math.max(peak, Math.abs(y[i]));
  }
  for (let i = 0; i < n; i++) y[i] /= peak;
  // Abklingen: ~ -60 dB nach t60 Sekunden
  const t60 = midi < 55 ? 2.2 : 1.5;
  const g = Math.pow(0.001, 1 / (t60 * (sr / (n + 0.5))));
  for (let i = n; i < len; i++) {
    y[i] = g * 0.5 * (y[i - n] + (i - n - 1 >= 0 ? y[i - n - 1] : 0));
  }
  const res = { buffer, rate: f / (sr / (n + 0.5)) };
  cache.set(key, res);
  return res;
}

// ---------- Helfer ----------

function gainNode(ctx: BaseAudioContext, value = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Hüllkurve: Anstieg, Halten auf `sustain`, Ausklang nach `end`. */
export function envelope(
  p: AudioParam,
  t: number,
  peak: number,
  attack: number,
  decay: number,
  sustain: number,
  end: number,
  release: number,
): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  if (decay > 0) p.setTargetAtTime(peak * sustain, t + attack, decay / 3);
  p.setTargetAtTime(0, Math.max(end, t + attack), release / 3);
}

/** Kurzer Schlag: sofortiger Anstieg, exponentielles Abklingen */
export function hit(p: AudioParam, t: number, peak: number, decay: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + 0.003);
  p.setTargetAtTime(0, t + 0.003, decay / 3);
}

function cleanup(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  src.onended = () => nodes.forEach((n) => n.disconnect());
}

export function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
}

export function noiseSource(ctx: BaseAudioContext, loop = false): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = loop;
  return s;
}

/** Sinus/Teilton mit Schlag-Hüllkurve, optional mit Tonhöhenverlauf */
export function ping(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  freq: number,
  peak: number,
  decay: number,
  opts: { type?: OscillatorType; toFreq?: number; glide?: number } = {},
): void {
  const o = osc(ctx, opts.type ?? 'sine', freq);
  if (opts.toFreq) {
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(opts.toFreq, t + (opts.glide ?? decay));
  }
  const g = gainNode(ctx);
  hit(g.gain, t, peak, decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + decay * 2.5 + 0.05);
  cleanup(o, [o, g]);
}

/** Gefiltertes Rauschen als kurzer Stoß */
export function noiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  type: BiquadFilterType,
  freq: number,
  q: number,
  peak: number,
  decay: number,
  opts: { attack?: number; toFreq?: number; sweep?: number } = {},
): void {
  const s = noiseSource(ctx, true);
  const f = filter(ctx, type, freq, q);
  if (opts.toFreq) {
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(opts.toFreq, t + (opts.sweep ?? decay));
  }
  const g = gainNode(ctx);
  if (opts.attack) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + opts.attack);
    g.gain.setTargetAtTime(0, t + opts.attack, decay / 3);
  } else hit(g.gain, t, peak, decay);
  s.connect(f).connect(g).connect(out);
  const start = Math.random() * 1.5;
  s.start(t, start);
  s.stop(t + (opts.attack ?? 0) + decay * 2.5 + 0.05);
  cleanup(s, [s, f, g]);
}

// ---------- Instrumente ----------

function pluck(o: VoiceOpts, bright: number, level: number, cutoff: number): void {
  const { ctx, out, time, dur, midi, vel } = o;
  const { buffer, rate } = pluckBuffer(ctx, midi, bright);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const f = filter(ctx, 'lowpass', cutoff * (0.6 + 0.6 * vel), 0.5);
  const g = gainNode(ctx);
  g.gain.setValueAtTime(level * vel, time);
  // Abdämpfen nach der Notenlänge, aber nie abrupt
  g.gain.setTargetAtTime(0, time + Math.max(dur, 0.25) + 0.3, 0.12);
  src.connect(f).connect(g).connect(out);
  src.start(time);
  src.stop(time + Math.min(buffer.duration / rate, dur + 1.2));
  cleanup(src, [src, f, g]);
}

let fluteWave: { ctx: BaseAudioContext; wave: PeriodicWave } | null = null;

function floete(o: VoiceOpts): void {
  const { ctx, out, time, dur, midi, vel } = o;
  const f = midiToFreq(midi);
  if (!fluteWave || fluteWave.ctx !== ctx) {
    const real = new Float32Array([0, 0, 0, 0, 0, 0]);
    const imag = new Float32Array([0, 1, 0.22, 0.1, 0.04, 0.02]);
    fluteWave = { ctx, wave: ctx.createPeriodicWave(real, imag) };
  }
  const v = ctx.createOscillator();
  v.setPeriodicWave(fluteWave.wave);
  // Leichtes Anblasen von unten
  v.frequency.setValueAtTime(f * 0.985, time);
  v.frequency.exponentialRampToValueAtTime(f, time + 0.06);
  const lfo = osc(ctx, 'sine', 5.2);
  const depth = gainNode(ctx);
  depth.gain.setValueAtTime(0, time);
  if (dur > 0.4) {
    depth.gain.setValueAtTime(0, time + 0.25);
    depth.gain.linearRampToValueAtTime(f * 0.005, time + Math.min(dur, 0.8));
  }
  lfo.connect(depth).connect(v.frequency);
  const lp = filter(ctx, 'lowpass', 2600 + 1500 * vel, 0.5);
  const g = gainNode(ctx);
  const end = time + dur * 0.95;
  envelope(g.gain, time, 0.13 * vel, 0.05, 0.3, 0.8, end, 0.12);
  v.connect(lp).connect(g).connect(out);
  // Atemgeräusch
  const n = noiseSource(ctx, true);
  const bp = filter(ctx, 'bandpass', Math.min(f * 2, 6000), 1.2);
  const ng = gainNode(ctx);
  envelope(ng.gain, time, 0.03 * vel, 0.03, 0.15, 0.4, end, 0.1);
  n.connect(bp).connect(ng).connect(out);
  const stop = end + 0.5;
  v.start(time);
  lfo.start(time);
  n.start(time, Math.random());
  v.stop(stop);
  lfo.stop(stop);
  n.stop(stop);
  cleanup(v, [v, lfo, depth, lp, g, n, bp, ng]);
}

function bordun(o: VoiceOpts): void {
  const { ctx, out, time, dur, midi, vel } = o;
  const f = midiToFreq(midi);
  const a = osc(ctx, 'sawtooth', f);
  const b = osc(ctx, 'sawtooth', f * 1.004);
  const lp = filter(ctx, 'lowpass', 650, 0.8);
  // Radgeräusch der Drehleier: langsames Atmen im Filter
  const lfo = osc(ctx, 'sine', 0.35);
  const lfoDepth = gainNode(ctx, 140);
  lfo.connect(lfoDepth).connect(lp.frequency);
  const g = gainNode(ctx);
  const end = time + dur;
  envelope(g.gain, time, 0.045 * vel, 0.9, 0, 1, end, 1.0);
  a.connect(lp);
  b.connect(lp);
  lp.connect(g).connect(out);
  const stop = end + 1.6;
  for (const s of [a, b, lfo]) {
    s.start(time);
    s.stop(stop);
  }
  cleanup(a, [a, b, lfo, lfoDepth, lp, g]);
}

function harmonium(o: VoiceOpts): void {
  const { ctx, out, time, dur, midi, vel } = o;
  const f = midiToFreq(midi);
  const a = osc(ctx, 'sawtooth', f * 0.998);
  const b = osc(ctx, 'square', f * 1.003);
  const bg = gainNode(ctx, 0.35);
  const lp = filter(ctx, 'lowpass', 1300 + 900 * vel, 0.6);
  // Balg: leichtes Tremolo (Musette)
  const trem = osc(ctx, 'sine', 4.6);
  const tremDepth = gainNode(ctx, 0.12);
  const amp = gainNode(ctx, 1);
  trem.connect(tremDepth).connect(amp.gain);
  const g = gainNode(ctx);
  const end = time + dur * 0.92;
  envelope(g.gain, time, 0.075 * vel, 0.06, 0.4, 0.85, end, 0.15);
  a.connect(lp);
  b.connect(bg).connect(lp);
  lp.connect(amp).connect(g).connect(out);
  const stop = end + 0.6;
  for (const s of [a, b, trem]) {
    s.start(time);
    s.stop(stop);
  }
  cleanup(a, [a, b, bg, lp, trem, tremDepth, amp, g]);
}

function flaeche(o: VoiceOpts): void {
  const { ctx, out, time, dur, midi, vel } = o;
  const f = midiToFreq(midi);
  const lp = filter(ctx, 'lowpass', 900, 0.5);
  const g = gainNode(ctx);
  const end = time + dur;
  envelope(g.gain, time, 0.035 * vel, Math.min(1.4, dur * 0.5), 0, 1, end, 1.6);
  const oscs = [-7, 0, 7].map((cents) => osc(ctx, 'triangle', f * 2 ** (cents / 1200)));
  oscs.forEach((s) => s.connect(lp));
  lp.connect(g).connect(out);
  const stop = end + 2.5;
  oscs.forEach((s) => {
    s.start(time);
    s.stop(stop);
  });
  cleanup(oscs[0], [...oscs, lp, g]);
}

function glocke(o: VoiceOpts): void {
  const { ctx, out, time, midi, vel } = o;
  const f = midiToFreq(midi);
  // Glockenspiel-artig: Grundton und unharmonische Obertöne
  const partials: [number, number, number][] = [
    [1, 1, 1.8],
    [2.76, 0.25, 0.5],
    [5.4, 0.08, 0.25],
    [2, 0.15, 0.9],
  ];
  for (const [ratio, amp, decay] of partials) {
    if (f * ratio > 12000) continue;
    ping(ctx, out, time, f * ratio, 0.09 * vel * amp, decay);
  }
}

function bass(o: VoiceOpts): void {
  const { ctx, out, time, dur, midi, vel } = o;
  const f = midiToFreq(midi);
  const a = osc(ctx, 'triangle', f);
  const b = osc(ctx, 'sine', f);
  const lp = filter(ctx, 'lowpass', 420 + 300 * vel, 0.7);
  const g = gainNode(ctx);
  const end = time + dur * 0.9;
  envelope(g.gain, time, 0.22 * vel, 0.012, 0.35, 0.45, end, 0.12);
  a.connect(lp);
  b.connect(lp);
  lp.connect(g).connect(out);
  const stop = end + 0.5;
  for (const s of [a, b]) {
    s.start(time);
    s.stop(stop);
  }
  cleanup(a, [a, b, lp, g]);
}

function trommel(o: VoiceOpts): void {
  const { ctx, out, time, vel } = o;
  // Rahmentrommel: tiefer Ton mit Tonhöhenabfall plus Fellrauschen
  ping(ctx, out, time, 115, 0.32 * vel, 0.22, { toFreq: 62, glide: 0.12 });
  noiseBurst(ctx, out, time, 'lowpass', 900, 0.5, 0.08 * vel, 0.05);
  noiseBurst(ctx, out, time, 'bandpass', 220, 2, 0.06 * vel, 0.12);
}

function schellen(o: VoiceOpts): void {
  const { ctx, out, time, vel } = o;
  noiseBurst(ctx, out, time, 'highpass', 6500, 0.7, 0.05 * vel, 0.06, { attack: 0.008 });
  noiseBurst(ctx, out, time + 0.012, 'bandpass', 9000, 3, 0.025 * vel, 0.08);
}

function holz(o: VoiceOpts): void {
  const { ctx, out, time, vel } = o;
  ping(ctx, out, time, 880, 0.12 * vel, 0.05);
  ping(ctx, out, time, 1430, 0.05 * vel, 0.03);
}

export const VOICES: Record<Instrument, (o: VoiceOpts) => void> = {
  laute: (o) => pluck(o, 0, 0.32, 2200),
  harfe: (o) => pluck(o, 1, 0.26, 4200),
  floete,
  bordun,
  harmonium,
  flaeche,
  glocke,
  bass,
  trommel,
  schellen,
  holz,
};
