/**
 * Audio für Flussreich: prozedurale Soundeffekte, Flussgeräusch und eigene Musik, nur WebAudio.
 *
 * Einbindung:
 * ```ts
 * import { initAudio, playSfx, ambient, setMusic, setVolume, mute } from './audio/index.ts';
 * window.addEventListener('pointerdown', () => initAudio(), { once: true }); // oder unlockAudioOnGesture()
 * setMusic('epoche1');          // darf schon vor initAudio() aufgerufen werden
 * ambient({ flow: 0.6 });       // oder ambient(0.6), ambient(null) zum Ausschalten
 * playSfx('verkauf');
 * setVolume(0.5, 'music');      // Kanäle: master, music, sfx, ambient
 * mute();                       // umschalten, mute(true)/mute(false) setzt fest
 * ```
 * Alle Funktionen sind ohne WebAudio (z. B. in Tests oder alten Browsern) gefahrlos aufrufbar.
 */
import { RiverAmbience, type AmbientInput, type AmbientOptions } from './ambient.ts';
import { COMPOSITIONS, MUSIC_MOODS, type MusicMood } from './compositions.ts';
import { CHANNELS, createMixer, type Channel, type Mixer } from './mixer.ts';
import { MusicPlayer } from './music.ts';
import { loadSettings, saveSettings, volumeToGain, clampVolume, type AudioSettings } from './settings.ts';
import { SFX_NAMES, playRecipe, type SfxName } from './sfx.ts';

export type { AmbientOptions, Channel, MusicMood, SfxName };
export { MUSIC_MOODS, SFX_NAMES };

const LOOKAHEAD = 0.6;
const TICK_MS = 100;
const CROSSFADE = 3;

interface Engine {
  ctx: AudioContext;
  mixer: Mixer;
  ambience: RiverAmbience;
  players: MusicPlayer[];
  timer: ReturnType<typeof setInterval>;
}

let engine: Engine | null = null;
let initPromise: Promise<boolean> | null = null;
const settings: AudioSettings = loadSettings();
let mood: MusicMood | null = null;
let ambientInput: AmbientInput = null;
const lastSfx = new Map<SfxName, number>();

function audioContextClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function applyGains(at?: number): void {
  if (!engine) return;
  const t = at ?? engine.ctx.currentTime;
  for (const ch of CHANNELS) {
    let g = volumeToGain(settings.volume[ch]);
    if (ch === 'master' && settings.muted) g = 0;
    engine.mixer.buses[ch].gain.setTargetAtTime(g, t, 0.05);
  }
}

function tick(): void {
  if (!engine || engine.ctx.state !== 'running') return;
  const until = engine.ctx.currentTime + LOOKAHEAD;
  for (const p of engine.players) p.scheduleUntil(until);
  engine.players = engine.players.filter((p) => {
    if (p.finished) p.dispose();
    return !p.finished;
  });
  engine.ambience.tick(until);
}

function startMood(m: MusicMood | null): void {
  if (!engine) return;
  const { ctx, mixer } = engine;
  const now = ctx.currentTime;
  for (const p of engine.players) p.fadeOut(now, CROSSFADE);
  if (!m) return;
  const p = new MusicPlayer(ctx, mixer.buses.music, COMPOSITIONS[m], now + 0.3);
  p.fadeIn(now + 0.3, engine.players.length ? CROSSFADE : 2);
  engine.players.push(p);
  p.scheduleUntil(now + LOOKAHEAD);
}

function onVisibility(): void {
  if (!engine) return;
  // Im Hintergrund pausieren: Timer werden dort gedrosselt, und niemand hört zu
  if (document.hidden) void engine.ctx.suspend().catch(() => {});
  else void engine.ctx.resume().catch(() => {});
}

/**
 * Startet die Audio-Engine. Muss aus einer Nutzergeste (Klick, Taste) heraus aufgerufen werden,
 * sonst blockiert der Browser die Wiedergabe. Mehrfache Aufrufe sind unschädlich.
 * Liefert true, wenn Audio läuft.
 */
export function initAudio(): Promise<boolean> {
  if (engine) {
    if (engine.ctx.state === 'suspended') return engine.ctx.resume().then(() => true, () => false);
    return Promise.resolve(engine.ctx.state === 'running');
  }
  if (initPromise) return initPromise;
  const AC = audioContextClass();
  if (!AC) return Promise.resolve(false);
  let ctx: AudioContext;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
  } catch {
    return Promise.resolve(false);
  }
  const mixer = createMixer(ctx);
  engine = {
    ctx,
    mixer,
    ambience: new RiverAmbience(ctx, mixer.buses.ambient),
    players: [],
    timer: setInterval(tick, TICK_MS),
  };
  for (const ch of CHANNELS) mixer.buses[ch].gain.value = 0;
  applyGains();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  initPromise = ctx
    .resume()
    .catch(() => {})
    .then(() => {
      engine?.ambience.set(ambientInput);
      startMood(mood);
      return ctx.state === 'running';
    });
  return initPromise;
}

/** Registriert einmalige Listener, die initAudio() bei der ersten Geste aufrufen. */
export function unlockAudioOnGesture(el?: EventTarget): void {
  const target = el ?? (typeof window !== 'undefined' ? window : null);
  if (!target) return;
  const events = ['pointerdown', 'keydown', 'touchend'];
  const handler = () => {
    events.forEach((e) => target.removeEventListener(e, handler));
    void initAudio();
  };
  events.forEach((e) => target.addEventListener(e, handler));
}

export function isAudioReady(): boolean {
  return engine?.ctx.state === 'running';
}

/** Spielt einen Soundeffekt. Vor initAudio() oder bei Stummschaltung passiert nichts. */
export function playSfx(name: SfxName, opts: { volume?: number } = {}): void {
  if (!engine || engine.ctx.state !== 'running' || settings.muted) return;
  const now = engine.ctx.currentTime;
  // Schutz vor Dauerfeuer (z. B. gedrückt gehaltene Taste)
  const last = lastSfx.get(name) ?? -1;
  if (now - last < 0.04) return;
  lastSfx.set(name, now);
  try {
    playRecipe(name, {
      ctx: engine.ctx,
      out: engine.mixer.buses.sfx,
      time: now + 0.005,
      rng: Math.random,
      vol: opts.volume === undefined ? 1 : clampVolume(opts.volume),
    });
  } catch (err) {
    console.warn('Soundeffekt fehlgeschlagen', name, err);
  }
}

/**
 * Flussgeräusch. `ambient(0.7)` setzt die Strömung (mit etwas Wind und Vögeln),
 * `ambient({ flow, wind, birds })` steuert alles einzeln (je 0..1), `ambient(null)` blendet aus.
 */
export function ambient(river: AmbientInput): void {
  ambientInput = river;
  engine?.ambience.set(river);
}

/** Wechselt die Musik mit Überblendung. `null` blendet die Musik aus. */
export function setMusic(next: MusicMood | null): void {
  if (next !== null && !(next in COMPOSITIONS)) return;
  if (next === mood) return;
  mood = next;
  startMood(next);
}

export function getMusic(): MusicMood | null {
  return mood;
}

/** Lautstärke 0..1, ohne Kanal für die Gesamtlautstärke. Wird gespeichert. */
export function setVolume(value: number, channel: Channel = 'master'): void {
  if (!CHANNELS.includes(channel)) return;
  settings.volume[channel] = clampVolume(value);
  saveSettings(settings);
  applyGains();
}

export function getVolume(channel: Channel = 'master'): number {
  return settings.volume[channel];
}

/** Stumm schalten. Ohne Argument wird umgeschaltet. Liefert den neuen Zustand. */
export function mute(on?: boolean): boolean {
  settings.muted = on ?? !settings.muted;
  saveSettings(settings);
  applyGains();
  return settings.muted;
}

export function isMuted(): boolean {
  return settings.muted;
}
