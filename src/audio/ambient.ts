/**
 * Flussgeräusch: tiefes Rauschen, plätschernde Mittellage, Wind, dazu zufällige Ereignisse
 * (Blubbern, Wellen am Ufer, Vogelrufe). Die Dichte folgt den Parametern.
 */
import { mulberry32, range, type Rng } from './rng.ts';
import { brownBuffer, noiseBurst, osc, ping } from './voices.ts';

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
  private readonly pans: StereoPannerNode[];
  private params = { flow: 0, wind: 0, birds: 0 };
  private layers: { stop(): void; rumble: GainNode; wind: GainNode } | null = null;
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
    this.pans = [-0.6, -0.2, 0.2, 0.6].map((v) => {
      const p = ctx.createStereoPanner();
      p.pan.value = v;
      p.connect(this.out);
      return p;
    });
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
    l.rumble.gain.setTargetAtTime(p.flow > 0 ? 0.02 + 0.04 * p.flow : 0, at, tc);
    l.wind.gain.setTargetAtTime(0.035 * p.wind, at, tc);
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
    const lowpass = (freq: number) => {
      const f = add(ctx.createBiquadFilter());
      f.type = 'lowpass';
      f.frequency.value = freq;
      f.Q.value = 0.5;
      return f;
    };

    // Ganz leises, tiefes Murmeln der Strömung. Nur braunes Rauschen, stark gefiltert:
    // es soll man eher spüren als hören, sonst klingt es nach Rauschen statt nach Wasser.
    const brown = src(ctx.createBufferSource());
    brown.buffer = brownBuffer(ctx);
    brown.loop = true;
    const rumble = add(ctx.createGain());
    rumble.gain.value = 0;
    brown.connect(lowpass(220)).connect(rumble).connect(this.out);

    // Wind nur als seltene, weiche Böen, ebenfalls aus tiefem Rauschen
    const brown2 = src(ctx.createBufferSource());
    brown2.buffer = brownBuffer(ctx);
    brown2.loop = true;
    const windLp = lowpass(450);
    const gust = add(ctx.createGain());
    gust.gain.value = 0.5;
    const glfo = src(osc(ctx, 'sine', 0.07));
    const gd = add(ctx.createGain());
    gd.gain.value = 0.5;
    glfo.connect(gd).connect(gust.gain);
    const wind = add(ctx.createGain());
    wind.gain.value = 0;
    brown2.connect(windLp).connect(gust).connect(wind).connect(this.out);

    sources.forEach((s, i) => (s instanceof AudioBufferSourceNode ? s.start(t, i * 1.7) : s.start(t)));
    this.nextBubble = this.nextBird = this.nextLap = t + 0.5;
    this.layers = {
      rumble,
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
        // Plätschern entsteht aus vielen winzigen Tropfen statt aus Rauschen
        this.nextBubble += range(this.rng, 0.03, 0.22) / (0.4 + flow);
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
    const f = range(this.rng, 450, 1400);
    const pan = this.pans[Math.floor(this.rng() * this.pans.length)];
    const big = this.rng() < 0.08;
    ping(this.ctx, pan, t, big ? f * 0.6 : f, range(this.rng, 0.004, 0.014) * (big ? 2 : 1), big ? 0.06 : 0.03, {
      toFreq: f * range(this.rng, 1.4, 2.0),
      glide: 0.025,
    });
  }

  private lap(t: number, flow: number): void {
    // Welle am Ufer: weich, tief, ohne Zischen
    noiseBurst(this.ctx, this.out, t, 'lowpass', range(this.rng, 500, 700), 0.5, 0.012 + 0.012 * flow, 0.5, {
      attack: 0.35,
      toFreq: range(this.rng, 200, 280),
      sweep: 0.8,
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
    this.pans.forEach((p) => p.disconnect());
    this.out.disconnect();
  }
}
