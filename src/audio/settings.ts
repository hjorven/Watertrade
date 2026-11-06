/** Lautstärke-Einstellungen, im localStorage gespeichert. */
import { CHANNELS, type Channel } from './mixer.ts';

export interface AudioSettings {
  volume: Record<Channel, number>;
  muted: boolean;
}

export const STORAGE_KEY = 'flussreich.audio';

export const DEFAULT_SETTINGS: AudioSettings = {
  volume: { master: 0.9, music: 0.65, sfx: 0.8, ambient: 0.45 },
  muted: false,
};

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function clampVolume(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Regler 0..1 auf Verstärkung: quadratisch, damit leise Stufen fein einstellbar sind */
export function volumeToGain(v: number): number {
  const c = clampVolume(v);
  return c * c;
}

export function defaultStore(): Store | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(store: Store | null = defaultStore()): AudioSettings {
  const s: AudioSettings = { volume: { ...DEFAULT_SETTINGS.volume }, muted: DEFAULT_SETTINGS.muted };
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return s;
    const data = JSON.parse(raw) as Partial<AudioSettings>;
    for (const ch of CHANNELS) {
      const v = data.volume?.[ch];
      if (typeof v === 'number' && Number.isFinite(v)) s.volume[ch] = clampVolume(v);
    }
    if (typeof data.muted === 'boolean') s.muted = data.muted;
  } catch {
    // Kaputte Einträge ignorieren
  }
  return s;
}

export function saveSettings(s: AudioSettings, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Privater Modus o. ä.: Einstellungen gelten dann nur für diese Sitzung
  }
}
