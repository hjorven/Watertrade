/** Spielt eine Komposition taktweise mit Vorausplanung ab. */
import type { Composition } from './compositions.ts';
import { hashString, mulberry32, type Rng } from './rng.ts';
import { renderBar, secondsPerBar, secondsPerStep } from './sequencer.ts';
import { VOICES } from './voices.ts';

export class MusicPlayer {
  readonly composition: Composition;
  private readonly ctx: BaseAudioContext;
  private readonly fade: GainNode;
  private readonly rng: Rng;
  private bar: number;
  private nextTime: number;
  private stopAt = Infinity;

  constructor(ctx: BaseAudioContext, dest: AudioNode, composition: Composition, startTime: number, startBar = 0) {
    this.ctx = ctx;
    this.composition = composition;
    this.bar = startBar;
    this.nextTime = startTime;
    this.rng = mulberry32(hashString(composition.id) + startBar);
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    this.fade.connect(dest);
  }

  fadeIn(at: number, seconds: number): void {
    this.fade.gain.setValueAtTime(0, at);
    this.fade.gain.linearRampToValueAtTime(this.composition.level ?? 1, at + seconds);
  }

  /** Ausblenden und danach nichts mehr planen */
  fadeOut(at: number, seconds: number): void {
    this.fade.gain.cancelScheduledValues(at);
    this.fade.gain.setValueAtTime(this.fade.gain.value, at);
    this.fade.gain.linearRampToValueAtTime(0, at + seconds);
    this.stopAt = at + seconds;
  }

  get finished(): boolean {
    return this.ctx.currentTime > this.stopAt + 3;
  }

  /** Plant alle Takte, die vor `until` beginnen. */
  scheduleUntil(until: number): void {
    const c = this.composition;
    const step = secondsPerStep(c);
    // Hing der Tab, nicht nachholen, sondern sauber weiter
    if (this.nextTime < this.ctx.currentTime) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < until && this.nextTime < this.stopAt) {
      for (const e of renderBar(c, this.bar)) {
        // Menschliches Timing: wenige Millisekunden Schwankung
        const jitter = (this.rng() - 0.5) * 0.016;
        VOICES[e.instrument]({
          ctx: this.ctx,
          out: this.fade,
          time: Math.max(this.ctx.currentTime, this.nextTime + e.step * step + jitter),
          dur: e.len * step,
          midi: e.midi,
          vel: e.vel,
        });
      }
      this.nextTime += secondsPerBar(c);
      this.bar++;
    }
  }

  dispose(): void {
    this.fade.disconnect();
  }
}
