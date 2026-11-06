/** Prozedurale Soundeffekte. Jeder Effekt variiert minimal, damit Wiederholungen nicht mechanisch klingen. */
import { range, type Rng } from './rng.ts';
import { VOICES, noiseBurst, ping, osc } from './voices.ts';

export const SFX_NAMES = [
  'muenzen',
  'kauf',
  'verkauf',
  'stempel',
  'ablegen',
  'anlegen',
  'glocke',
  'klick',
  'fehler',
  'erfolg',
  'papier',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

export interface SfxContext {
  ctx: BaseAudioContext;
  out: AudioNode;
  time: number;
  rng: Rng;
  /** 0..1 */
  vol: number;
}

/** Ein Münzklimpern: kurze, unharmonische Metallteiltöne */
function clink(s: SfxContext, t: number, base: number, vel: number): void {
  const ratios: [number, number, number][] = [
    [1, 1, 0.16],
    [1.47, 0.6, 0.12],
    [2.09, 0.45, 0.09],
    [2.56, 0.3, 0.07],
    [3.9, 0.15, 0.05],
  ];
  for (const [r, a, d] of ratios) ping(s.ctx, s.out, t, base * r, 0.11 * a * vel * s.vol, d * range(s.rng, 0.8, 1.2));
  noiseBurst(s.ctx, s.out, t, 'highpass', 7000, 0.7, 0.08 * vel * s.vol, 0.008);
}

function coins(s: SfxContext, count: number, start = 0): number {
  let t = s.time + start;
  for (let i = 0; i < count; i++) {
    clink(s, t, range(s.rng, 2300, 3600), 1 - (i / count) * 0.5);
    t += range(s.rng, 0.035, 0.085);
  }
  return t - s.time;
}

function chime(s: SfxContext, t: number, midis: number[], gap: number, vel = 0.9): void {
  midis.forEach((m, i) => VOICES.glocke({ ctx: s.ctx, out: s.out, time: t + i * gap, dur: 0.5, midi: m, vel: vel * s.vol }));
}

function thud(s: SfxContext, t: number, from: number, to: number, peak: number, decay: number): void {
  ping(s.ctx, s.out, t, from, peak * s.vol, decay, { toFreq: to, glide: decay * 0.6 });
}

function splash(s: SfxContext, t: number, size: number): void {
  noiseBurst(s.ctx, s.out, t, 'lowpass', 2600, 0.5, 0.16 * size * s.vol, 0.18 * size, { attack: 0.01 });
  noiseBurst(s.ctx, s.out, t, 'bandpass', 700, 1, 0.1 * size * s.vol, 0.3 * size, { attack: 0.03, toFreq: 300 });
  for (let i = 0; i < 3; i++) bubble(s, t + 0.05 + s.rng() * 0.25 * size, range(s.rng, 500, 900), 0.05 * size);
}

function bubble(s: SfxContext, t: number, f: number, peak: number): void {
  ping(s.ctx, s.out, t, f, peak * s.vol, 0.05, { toFreq: f * 2.2, glide: 0.04 });
}

/** Knarzen von Holz/Tau: schnelle Reibimpulse durch ein schmales Filter */
function creak(s: SfxContext, t: number, dur: number, peak: number): void {
  const { ctx, out } = s;
  const o = osc(ctx, 'sawtooth', range(s.rng, 28, 36));
  o.frequency.setValueAtTime(o.frequency.value, t);
  o.frequency.linearRampToValueAtTime(range(s.rng, 45, 70), t + dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = range(s.rng, 700, 1100);
  bp.Q.value = 6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak * s.vol, t + dur * 0.3);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(bp).connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
  o.onended = () => [o, bp, g].forEach((n) => n.disconnect());
}

const RECIPES: Record<SfxName, (s: SfxContext) => void> = {
  muenzen(s) {
    coins(s, 5 + Math.floor(s.rng() * 3));
  },
  kauf(s) {
    // Münzen gehen raus, der Sack landet im Laderaum
    const d = coins(s, 3);
    thud(s, s.time + d + 0.05, 140, 55, 0.35, 0.16);
    noiseBurst(s.ctx, s.out, s.time + d + 0.05, 'bandpass', 380, 0.8, 0.12 * s.vol, 0.12);
  },
  verkauf(s) {
    // Münzen kommen rein, dazu ein heller Zweiklang aufwärts
    const d = coins(s, 6);
    chime(s, s.time + Math.min(d, 0.2), [79, 84], 0.09, 0.8);
  },
  stempel(s) {
    const t = s.time;
    thud(s, t, 160, 45, 0.4, 0.11);
    noiseBurst(s.ctx, s.out, t, 'bandpass', 1300, 0.8, 0.2 * s.vol, 0.035);
    noiseBurst(s.ctx, s.out, t + 0.004, 'highpass', 2500, 0.7, 0.12 * s.vol, 0.02);
  },
  ablegen(s) {
    // Tau knarzt, Ruder taucht ein, Wasser rauscht am Rumpf
    const t = s.time;
    creak(s, t, 0.45, 0.22);
    noiseBurst(s.ctx, s.out, t + 0.15, 'bandpass', 300, 0.9, 0.32 * s.vol, 0.5, { attack: 0.25, toFreq: 1200, sweep: 0.6 });
    splash(s, t + 0.5, 1.3);
  },
  anlegen(s) {
    // Rumpf stößt an den Steg, Tau fällt auf Holz, Wasser schwappt
    const t = s.time;
    thud(s, t, 85, 45, 0.36, 0.28);
    noiseBurst(s.ctx, s.out, t, 'bandpass', 340, 2, 0.25 * s.vol, 0.14);
    noiseBurst(s.ctx, s.out, t + 0.005, 'bandpass', 950, 3, 0.08 * s.vol, 0.08);
    creak(s, t + 0.12, 0.3, 0.08);
    thud(s, t + 0.38, 220, 120, 0.15, 0.06);
    noiseBurst(s.ctx, s.out, t + 0.38, 'bandpass', 1800, 1, 0.07 * s.vol, 0.04);
    noiseBurst(s.ctx, s.out, t + 0.2, 'bandpass', 500, 0.8, 0.1 * s.vol, 0.5, { attack: 0.3 });
  },
  glocke(s) {
    // Hafenglocke: tiefe Glocke mit Unterton, Terz, Quinte, Nominal
    const base = range(s.rng, 380, 400);
    const partials: [number, number, number][] = [
      [0.5, 0.5, 4.5],
      [1, 0.8, 3.5],
      [1.19, 0.45, 2.4],
      [1.5, 0.3, 2.0],
      [2, 0.45, 1.8],
      [2.51, 0.2, 1.1],
      [2.66, 0.15, 0.9],
      [3.01, 0.12, 0.7],
      [4.16, 0.06, 0.45],
    ];
    for (const [r, a, d] of partials) ping(s.ctx, s.out, s.time, base * r, 0.1 * a * s.vol, d);
    noiseBurst(s.ctx, s.out, s.time, 'bandpass', 2500, 1.5, 0.05 * s.vol, 0.02);
  },
  klick(s) {
    noiseBurst(s.ctx, s.out, s.time, 'bandpass', range(s.rng, 2600, 3200), 1.5, 0.32 * s.vol, 0.012);
    ping(s.ctx, s.out, s.time, range(s.rng, 1700, 1900), 0.06 * s.vol, 0.02);
  },
  fehler(s) {
    // Zwei weiche, fallende Töne
    for (const [i, m] of [62, 59].entries()) {
      VOICES.harmonium({ ctx: s.ctx, out: s.out, time: s.time + i * 0.14, dur: 0.12, midi: m, vel: 1.5 * s.vol });
    }
  },
  erfolg(s) {
    // Kleine Fanfare: Harfenlauf und Glocke
    [72, 76, 79, 84].forEach((m, i) =>
      VOICES.harfe({ ctx: s.ctx, out: s.out, time: s.time + i * 0.075, dur: 0.6, midi: m, vel: 0.9 * s.vol }),
    );
    chime(s, s.time + 0.3, [84, 88, 91], 0.12, 0.7);
  },
  papier(s) {
    for (let i = 0; i < 6; i++) {
      noiseBurst(s.ctx, s.out, s.time + i * range(s.rng, 0.02, 0.045), 'bandpass', range(s.rng, 2500, 5000), 0.9, 0.22 * s.vol, 0.03);
    }
  },
};

export function playRecipe(name: SfxName, s: SfxContext): void {
  RECIPES[name](s);
}
