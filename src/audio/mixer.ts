/** Mischpult: Kanäle Musik, Effekte, Umgebung, gemeinsamer Hall und sanfter Kompressor. */
import { mulberry32 } from './rng.ts';

export type Channel = 'master' | 'music' | 'sfx' | 'ambient';
export const CHANNELS: readonly Channel[] = ['master', 'music', 'sfx', 'ambient'];

export interface Mixer {
  ctx: BaseAudioContext;
  buses: Record<Channel, GainNode>;
}

/** Raumklang-Impulsantwort: abklingendes, abgedunkeltes Rauschen (Stereo, deterministisch) */
export function makeImpulse(ctx: BaseAudioContext, seconds = 2.2, decay = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rng = mulberry32(17 + ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Höhen klingen schneller ab als Tiefen
      const a = 0.25 + 0.6 * t;
      lp = lp * a + (rng() * 2 - 1) * (1 - a);
      d[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

export function createMixer(ctx: BaseAudioContext): Mixer {
  const master = ctx.createGain();
  // Grundverstärkung, damit die Standardregler nicht zu leise sind; der Kompressor fängt Spitzen ab
  const makeup = ctx.createGain();
  makeup.gain.value = 1.5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  master.connect(makeup).connect(comp).connect(ctx.destination);

  // Hall ohne Tiefen, sonst dröhnen Schläge und Bass nach
  const reverbIn = ctx.createBiquadFilter();
  reverbIn.type = 'highpass';
  reverbIn.frequency.value = 280;
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx);
  const ret = ctx.createGain();
  ret.gain.value = 0.9;
  reverbIn.connect(reverb).connect(ret).connect(master);

  const bus = (send: number, tone?: number) => {
    const g = ctx.createGain();
    let head: AudioNode = g;
    if (tone) {
      // Wärme: leichte Höhendämpfung
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = tone;
      lp.Q.value = 0.5;
      g.connect(lp);
      head = lp;
    }
    head.connect(master);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      head.connect(s).connect(reverbIn);
    }
    return g;
  };

  return {
    ctx,
    buses: {
      master,
      music: bus(0.35, 7000),
      sfx: bus(0.12),
      ambient: bus(0),
    },
  };
}
