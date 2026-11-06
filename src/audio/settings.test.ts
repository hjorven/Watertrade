import { describe, expect, it } from 'vitest';
import { normalizeAmbient } from './ambient.ts';
import { DEFAULT_SETTINGS, STORAGE_KEY, clampVolume, loadSettings, saveSettings, volumeToGain } from './settings.ts';
import { SFX_NAMES } from './sfx.ts';
import * as audio from './index.ts';

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe('Einstellungen', () => {
  it('begrenzt Lautstärken', () => {
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
  });

  it('speichert und lädt', () => {
    const store = memoryStore();
    const s = loadSettings(store);
    expect(s).toEqual(DEFAULT_SETTINGS);
    s.volume.music = 0.2;
    s.muted = true;
    saveSettings(s, store);
    expect(loadSettings(store)).toEqual({ volume: { ...DEFAULT_SETTINGS.volume, music: 0.2 }, muted: true });
  });

  it('übersteht kaputte Einträge', () => {
    const store = memoryStore();
    store.setItem(STORAGE_KEY, '{kaputt');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.setItem(STORAGE_KEY, JSON.stringify({ volume: { sfx: 'laut', music: 3 } }));
    const s = loadSettings(store);
    expect(s.volume.sfx).toBe(DEFAULT_SETTINGS.volume.sfx);
    expect(s.volume.music).toBe(1);
  });
});

describe('Umgebung', () => {
  it('Zahl = Strömung, null = aus', () => {
    expect(normalizeAmbient(null)).toEqual({ flow: 0, wind: 0, birds: 0 });
    expect(normalizeAmbient(0.7).flow).toBe(0.7);
    expect(normalizeAmbient({ flow: 2, birds: -1 })).toEqual({ flow: 1, wind: 0.3, birds: 0 });
  });
});

describe('Öffentliche Schnittstelle ohne WebAudio', () => {
  it('alle Aufrufe sind gefahrlos', async () => {
    expect(await audio.initAudio()).toBe(false);
    expect(audio.isAudioReady()).toBe(false);
    for (const n of SFX_NAMES) audio.playSfx(n);
    audio.ambient(0.5);
    audio.setMusic('epoche2');
    expect(audio.getMusic()).toBe('epoche2');
    audio.setVolume(0.3, 'sfx');
    expect(audio.getVolume('sfx')).toBe(0.3);
    expect(audio.mute()).toBe(true);
    expect(audio.mute(false)).toBe(false);
  });

  it('kennt die geforderten Effekte', () => {
    for (const n of ['muenzen', 'kauf', 'verkauf', 'stempel', 'ablegen', 'anlegen', 'glocke', 'klick']) {
      expect(SFX_NAMES).toContain(n);
    }
  });
});
