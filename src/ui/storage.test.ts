import { describe, expect, it } from 'vitest';
import { migrateLegacyStorage, storageKey } from './storage.ts';

/** Speicher wie localStorage, nur im Arbeitsspeicher; limit lässt setItem scheitern, sobald alle Werte zusammen länger wären */
function memoryStore(limit = Infinity) {
  const data = new Map<string, string>();
  return {
    data,
    limit,
    getItem: (k: string) => data.get(k) ?? null,
    setItem(k: string, v: string) {
      const size = [...data].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0) + v.length;
      if (size > this.limit) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

describe('Umzug der Speicherschlüssel von Flussreich auf Watertrade', () => {
  it('neue Schlüssel tragen den Spielnamen', () => {
    expect(storageKey('save.1')).toBe('watertrade.save.1');
  });

  it('übernimmt alte Spielstände, Fortschritt und Einstellungen und räumt die alten Einträge weg', () => {
    const s = memoryStore();
    s.setItem('flussreich.save.auto', '{"state":1}');
    s.setItem('flussreich.save.2', '{"state":2}');
    s.setItem('flussreich.progress', '{"unlocked":["k1","k2"]}');
    s.setItem('flussreich.audio', '{"muted":true}');
    s.setItem('sb-xyz-auth-token', 'bleibt');
    expect(migrateLegacyStorage(s)).toBe(4);
    expect(s.getItem('watertrade.save.auto')).toBe('{"state":1}');
    expect(s.getItem('watertrade.save.2')).toBe('{"state":2}');
    expect(s.getItem('watertrade.progress')).toBe('{"unlocked":["k1","k2"]}');
    expect(s.getItem('watertrade.audio')).toBe('{"muted":true}');
    expect(s.getItem('sb-xyz-auth-token')).toBe('bleibt');
    expect([...s.data.keys()].filter((k) => k.startsWith('flussreich.'))).toEqual([]);
  });

  it('überschreibt keinen neueren Eintrag und ist beim zweiten Mal ohne Wirkung', () => {
    const s = memoryStore();
    s.setItem('flussreich.save.1', 'alt');
    s.setItem('watertrade.save.1', 'neu');
    expect(migrateLegacyStorage(s)).toBe(0);
    expect(s.getItem('watertrade.save.1')).toBe('neu');
    expect(s.getItem('flussreich.save.1')).toBeNull();
    expect(migrateLegacyStorage(s)).toBe(0);
  });

  it('lässt alte Einträge liegen, wenn der Speicher voll ist, und holt sie beim nächsten Start nach', () => {
    const big = 'x'.repeat(40);
    const s = memoryStore(50);
    s.setItem('flussreich.save.1', 'eins');
    s.setItem('flussreich.save.2', big);
    // der kleine Eintrag passt noch daneben, der große nicht mehr
    expect(migrateLegacyStorage(s)).toBe(1);
    expect(s.getItem('watertrade.save.1')).toBe('eins');
    expect(s.getItem('flussreich.save.1')).toBeNull();
    expect(s.getItem('flussreich.save.2')).toBe(big);
    s.limit = 1000;
    expect(migrateLegacyStorage(s)).toBe(1);
    expect(s.getItem('watertrade.save.2')).toBe(big);
    expect(s.getItem('flussreich.save.2')).toBeNull();
  });

  it('kommt ohne Speicher aus', () => {
    expect(migrateLegacyStorage(null)).toBe(0);
  });
});
