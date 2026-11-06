import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OFFLINE_ERROR,
  currentPlayer,
  dailySeed,
  deleteSlot,
  displayName,
  ensureSession,
  fail,
  getClient,
  getLeagueMarket,
  getStatus,
  initOnline,
  isConfigured,
  joinLeague,
  leagueRanking,
  leagueTrade,
  leagueTravel,
  listSlots,
  loadSlot,
  onStatusChange,
  resetOnlineForTests,
  saveSlot,
  secondsUntilArrival,
  setUsername,
  signInWithMagicLink,
  signOut,
  submitDaily,
  subscribeLeagueMarket,
  todayUtc,
  topDaily,
  type Result,
  REALTIME_MAX_FAILURES,
  onRealtimeGiveUp,
  realtimeBackoff,
  realtimeGaveUpAlready,
} from './index.ts';

function expectOffline<T>(r: Result<T>): void {
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.offline).toBe(true);
    expect(r.error).toBe(OFFLINE_ERROR);
  }
}

describe('ohne Konfiguration', () => {
  beforeEach(() => {
    resetOnlineForTests();
    initOnline({});
  });

  it('bleibt offline und baut keinen Client', () => {
    expect(getClient()).toBeNull();
    expect(isConfigured()).toBe(false);
    expect(getStatus()).toBe('offline');
  });

  it('erkennt Platzhalter aus .env.example als nicht konfiguriert', () => {
    initOnline({ url: 'https://DEINE_PROJECT_REF.supabase.co', key: 'sb_publishable_DEIN_KEY' });
    expect(isConfigured()).toBe(false);
    initOnline({ url: 'kein url', key: 'abc' });
    expect(isConfigured()).toBe(false);
  });

  it('liefert bei Anmeldung offline statt Absturz', async () => {
    expect(await currentPlayer()).toBeNull();
    expectOffline(await ensureSession());
    expectOffline(await signInWithMagicLink('a@b.de'));
    expectOffline(await signOut());
    expectOffline(await setUsername('Kapitän'));
  });

  it('liefert bei Cloud-Saves offline', async () => {
    expectOffline(await saveSlot(1, 'Test', { gold: 5, nested: [1, 2, { a: 'b' }] }));
    expectOffline(await loadSlot(1));
    expectOffline(await listSlots());
    expectOffline(await deleteSlot(1));
  });

  it('lehnt ungültige Plätze vor der Verbindungsprüfung ab', async () => {
    for (const slot of [0, 6, 1.5, Number.NaN]) {
      const r = await saveSlot(slot, 'x', {});
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.offline).toBe(false);
    }
  });

  it('liefert beim Tagesmarkt offline', async () => {
    expectOffline(await submitDaily(1234));
    expectOffline(await topDaily());
  });

  it('lehnt ungültiges Vermögen ab', async () => {
    const r = await submitDaily(-1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offline).toBe(false);
  });

  it('liefert bei der Liga offline', async () => {
    expectOffline(await getLeagueMarket());
    expectOffline(await joinLeague());
    expectOffline(await leagueTravel('oberau'));
    expectOffline(await leagueTrade('oberau', 'holz', -5));
    expectOffline(await leagueRanking());
  });

  it('prüft die Handelsmenge vor dem Server', async () => {
    for (const amount of [0, 201, -201, 2.5]) {
      const r = await leagueTrade('oberau', 'holz', amount);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.offline).toBe(false);
    }
  });

  it('gibt beim Realtime-Abo eine harmlose Abmeldefunktion zurück', () => {
    let calls = 0;
    const unsubscribe = subscribeLeagueMarket(() => calls++);
    expect(() => unsubscribe()).not.toThrow();
    expect(calls).toBe(0);
  });
});

describe('mit Konfiguration', () => {
  afterEach(() => resetOnlineForTests());

  it('baut einen Client und meldet den Statuswechsel', () => {
    resetOnlineForTests();
    const seen: string[] = [];
    onStatusChange((s) => seen.push(s));
    expect(initOnline({ url: 'https://beispiel.supabase.co', key: 'sb_publishable_test' })).toBe(true);
    expect(isConfigured()).toBe(true);
    expect(getStatus()).toBe('verbinde');
    expect(seen).toEqual(['verbinde']);
  });
});

describe('Hilfsfunktionen', () => {
  it('todayUtc liefert das UTC-Datum', () => {
    expect(todayUtc(new Date('2026-11-06T23:30:00-02:00'))).toBe('2026-11-07');
  });

  it('dailySeed ist pro Tag gleich und zwischen Tagen verschieden', () => {
    expect(dailySeed('2026-11-06')).toBe(dailySeed('2026-11-06'));
    expect(dailySeed('2026-11-06')).not.toBe(dailySeed('2026-11-07'));
    expect(Number.isInteger(dailySeed('2026-11-06'))).toBe(true);
    expect(dailySeed('2026-11-06')).toBeGreaterThanOrEqual(0);
  });

  it('übersetzt Server-Fehler', () => {
    const r = fail(new Error('nicht genug taler'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('Nicht genug Taler.');
      expect(r.offline).toBe(false);
    }
    const r2 = fail({ message: 'P0001: laderaum voll' });
    if (!r2.ok) expect(r2.error).toBe('Der Laderaum ist voll.');
  });

  it('displayName nimmt den Profilnamen oder einen Platzhalter', () => {
    expect(displayName({ username: 'Hanne' }, 'abcd-1234')).toBe('Hanne');
    expect(displayName([{ username: 'Ole' }], 'abcd-1234')).toBe('Ole');
    expect(displayName(null, 'abcd-1234')).toBe('Händler ABCD');
  });

  it('secondsUntilArrival rechnet die Restzeit', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    const p = { userId: 'x', gold: 0, cargo: {}, townId: 'oberau', wealth: 0, arrivesAt: '2026-11-06T12:00:30Z' };
    expect(secondsUntilArrival(p, now)).toBe(30);
    expect(secondsUntilArrival({ ...p, arrivesAt: '2026-11-06T11:00:00Z' }, now)).toBe(0);
  });
});

describe('Realtime-Backoff', () => {
  afterEach(() => resetOnlineForTests());

  it('wartet immer länger und gibt nach REALTIME_MAX_FAILURES Versuchen auf', async () => {
    resetOnlineForTests();
    initOnline({ url: 'https://beispiel.supabase.co', key: 'sb_publishable_test' });
    let gaveUp = 0;
    onRealtimeGiveUp(() => gaveUp++);
    const delays = [1, 2, 3].map((t) => realtimeBackoff(t));
    expect(delays[0]).toBeLessThan(delays[1]);
    expect(delays[1]).toBeLessThan(delays[2]);
    await Promise.resolve();
    expect(gaveUp).toBe(0);
    realtimeBackoff(REALTIME_MAX_FAILURES);
    realtimeBackoff(REALTIME_MAX_FAILURES + 1);
    await Promise.resolve();
    expect(gaveUp).toBe(1);
    expect(realtimeGaveUpAlready()).toBe(true);
    expect(getStatus()).toBe('fehler');
  });

  it('ein neues Abo setzt den Abbruch zurück', async () => {
    resetOnlineForTests();
    initOnline({ url: 'https://beispiel.supabase.co', key: 'sb_publishable_test' });
    realtimeBackoff(REALTIME_MAX_FAILURES);
    await Promise.resolve();
    expect(realtimeGaveUpAlready()).toBe(true);
    const stop = subscribeLeagueMarket(() => {});
    expect(realtimeGaveUpAlready()).toBe(false);
    stop();
  });
});
