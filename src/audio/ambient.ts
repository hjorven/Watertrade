/**
 * Flussgeräusch: tiefes Rauschen, plätschernde Mittellage, Wind, dazu zufällige Ereignisse
 * (Blubbern, Wellen am Ufer, Vogelrufe). Die Dichte folgt den Parametern.
 */
import { mulberry32, range, type Rng } from './rng.ts';
import { brownBuffer, noiseBurst, noiseSource, osc, ping } from './voices.ts';

export interface AmbientOptions {
  /** Strömung / Wassermenge 0..1 */
  flow?: number;
  /** Wind 0..1 */
  wind?: number;
  /** Vögel 0..1 */
  birds?: number;
}

export type AmbientInput = number | AmbientOptions | null | undefined;

const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

/** Normalisiert die Eingabe von ambient(): Zahl = Strömung, null = aus */
export function normalizeAmbient(input: AmbientInput): Required<AmbientOptions> {
  if (input === null || input === undefined) return { flow: 0, wind: 0, birds: 0 };
  if (typeof input === 'number') return { flow: clamp01(input, 0), wind: 0.3, birds: 0.5 };
  return { flow: clamp01(input.flow, 0.5), wind: clamp01(input.wind, 0.3), birds: clamp01(input.birds, 0.5) };
}

export class RiverAmbience {
  private readonly ctx: BaseAudioContext;
  private readonly out: GainNode;
  private readonly rng: Rng;
  private params = { flow: 0, wind: 0, birds: 0 };
  private layers: { stop(): void; rumble: GainNode; babble: GainNode; wind: GainNode } | null = null;
  private nextBubble = 0;
  private nextBird = 0;
  private nextLap = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: BaseAudioContext, dest: AudioNode, seed = 7) {
    this.ctx = ctx;
    this.rng = mulberry32(seed);
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(dest);
  }

  get active(): boolean {
    return this.params.flow + this.params.wind + this.params.birds > 0;
  }

  set(input: AmbientInput, at = this.ctx.currentTime): void {
    const p = normalizeAmbient(input);
    this.params = p;
    if (this.active && !this.layers) this.startLayers(at);
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    const l = this.layers;
    if (!l) return;
    const tc = 1.2;
    l.rumble.gain.setTargetAtTime(p.flow > 0 ? 0.05 + 0.16 * p.flow : 0, at, tc);
    l.babble.gain.setTargetAtTime(p.flow > 0 ? 0.05 + 0.1 * p.flow : 0, at, tc);
    l.wind.gain.setTargetAtTime(0.09 * p.wind, at, tc);
    if (!this.active && typeof setTimeout !== 'undefined') {
      // Quellen nach dem Ausblenden anhalten, spart Rechenzeit
      this.stopTimer = setTimeout(() => {
        if (!this.active) {
          this.layers?.stop();
          this.layers = null;
        }
      }, 6000);
    }
  }

  private startLayers(t: number): void {
    const ctx = this.ctx;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    const add = <N extends AudioNode>(n: N) => (nodes.push(n), n);
    const src = <N extends AudioScheduledSourceNode>(n: N) => (sources.push(n), add(n));

    // Tiefes Rauschen der Strömung
    const brown = src(ctx.createBufferSource());
    brown.buffer = brownBuffer(ctx);
    brown.loop = true;
    const lpLow = add(ctx.createBiquadFilter());
    lpLow.type = 'lowpass';
    lpLow.frequency.value = 380;
    const rumble = add(ctx.createGain());
    rumble.gain.value = 0;
    brown.connect(lpLow).connect(rumble).connect(this.out);

    // Plätschern: mehrere schmale Bänder, deren Mitten schnell und unregelmäßig wandern
    const babble = add(ctx.createGain());
    babble.gain.value = 0;
    babble.connect(this.out);
    const white = src(noiseSource(ctx, true));
    const base = add(ctx.createBiquadFilter());
    base.type = 'bandpass';
    base.frequency.value = 800;
    base.Q.value = 0.6;
    const baseGain = add(ctx.createGain());
    baseGain.gain.value = 0.35;
    white.connect(base).connect(baseGain).connect(babble);
    for (const [center, rates] of [
      [520, [1.7, 3.3]],
      [940, [2.9, 5.1]],
      [1550, [0.7, 4.3]],
    ] as const) {
      const bp = add(ctx.createBiquadFilter());
      bp.type = 'bandpass';
      bp.frequency.value = center;
      bp.Q.value = 4;
      for (const r of rates) {
        const lfo = src(osc(ctx, 'sine', r * range(this.rng, 0.85, 1.15)));
        const d = add(ctx.createGain());
        d.gain.value = center * 0.22;
        lfo.connect(d).connect(bp.frequency);
      }
      const g = add(ctx.createGain());
      g.gain.value = 1.4;
      white.connect(bp).connect(g).connect(babble);
    }

    // Wind: breites, langsam schwellendes Rauschen
    const white2 = src(noiseSource(ctx, true));
    const wbp = add(ctx.createBiquadFilter());
    wbp.type = 'bandpass';
    wbp.frequency.value = 520;
    wbp.Q.value = 0.5;
    const wlfo = src(osc(ctx, 'sine', 0.06));
    const wd = add(ctx.createGain());
    wd.gain.value = 260;
    wlfo.connect(wd).connect(wbp.frequency);
    const swell = add(ctx.createGain());
    swell.gain.value = 0.7;
    const slfo = src(osc(ctx, 'sine', 0.09));
    const sd = add(ctx.createGain());
    sd.gain.value = 0.3;
    slfo.connect(sd).connect(swell.gain);
    const wind = add(ctx.createGain());
    wind.gain.value = 0;
    white2.connect(wbp).connect(swell).connect(wind).connect(this.out);

    sources.forEach((s, i) => (s instanceof AudioBufferSourceNode ? s.start(t, i * 0.37) : s.start(t)));
    this.nextBubble = this.nextBird = this.nextLap = t + 0.5;
    this.layers = {
      rumble,
      babble,
      wind,
      stop: () => {
        sources.forEach((s) => s.stop());
        nodes.forEach((n) => n.disconnect());
      },
    };
  }

  /** Plant zufällige Ereignisse bis zum Zeitpunkt `until` (Sekunden im Kontext). */
  tick(until: number): void {
    if (!this.layers) return;
    const now = this.ctx.currentTime;
    const { flow, birds } = this.params;
    const skip = (t: number) => Math.max(t, now);
    if (flow > 0) {
      for (this.nextBubble = skip(this.nextBubble); this.nextBubble < until; ) {
        this.bubble(this.nextBubble);
        this.nextBubble += range(this.rng, 0.08, 0.7) / (0.3 + flow);
      }
      for (this.nextLap = skip(this.nextLap); this.nextLap < until; ) {
        this.lap(this.nextLap, flow);
        this.nextLap += range(this.rng, 2.5, 6);
      }
    }
    if (birds > 0) {
      for (this.nextBird = skip(this.nextBird); this.nextBird < until; ) {
        this.bird(this.nextBird, birds);
        this.nextBird += range(this.rng, 4, 14) / (0.3 + birds);
      }
    }
  }

  private bubble(t: number): void {
    const f = range(this.rng, 350, 1100);
    ping(this.ctx, this.out, t, f, range(this.rng, 0.015, 0.05), 0.04, { toFreq: f * range(this.rng, 1.8, 2.8), glide: 0.035 });
  }

  private lap(t: number, flow: number): void {
    noiseBurst(this.ctx, this.out, t, 'bandpass', range(this.rng, 400, 700), 0.9, 0.05 + 0.04 * flow, 0.45, {
      attack: 0.25,
      toFreq: range(this.rng, 250, 350),
      sweep: 0.6,
    });
  }

  /** Vogelruf aus kurzen Frequenzbögen, drei Arten */
  private bird(t: number, amount: number): void {
    const kind = Math.floor(this.rng() * 3);
    const vol = 0.012 + 0.018 * amount;
    const call = (start: number, f0: number, f1: number, dur: number) => {
      const o = osc(this.ctx, 'sine', f0);
      o.frequency.setValueAtTime(f0, start);
      o.frequency.exponentialRampToValueAtTime(f1, start + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(vol, start + dur * 0.2);
      g.gain.linearRampToValueAtTime(0, start + dur);
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = (this.rng() - 0.5) * 1.4;
      o.connect(g).connect(pan).connect(this.out);
      o.start(start);
      o.stop(start + dur + 0.02);
      o.onended = () => [o, g, pan].forEach((n) => n.disconnect());
    };
    if (kind === 0) {
      // Zilpzalp-artig: abwechselnd hoch und tief
      const n = 3 + Math.floor(this.rng() * 4);
      for (let i = 0; i < n; i++) {
        const hi = i % 2 === 0;
        call(t + i * 0.22, hi ? 5200 : 4300, hi ? 4600 : 3900, 0.09);
      }
    } else if (kind === 1) {
      // Pfiff mit Aufschwung
      const base = range(this.rng, 2000, 2800);
      call(t, base, base * 1.5, 0.18);
      call(t + 0.24, base * 1.4, base * 0.9, 0.22);
    } else {
      // Schnelles Trillern
      const base = range(this.rng, 3200, 4200);
      for (let i = 0; i < 8; i++) call(t + i * 0.055, base * 1.15, base, 0.04);
    }
  }

  dispose(): void {
    this.layers?.stop();
    this.layers = null;
    this.out.disconnect();
  }
}
