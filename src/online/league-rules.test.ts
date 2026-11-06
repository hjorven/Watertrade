import { beforeEach, describe, expect, it } from 'vitest';
import {
  fail,
  getLeagueInfo,
  initOnline,
  leagueBuyShip,
  OFFLINE_ERROR,
  resetOnlineForTests,
  toEvent,
  toPlayer,
} from './index.ts';
import {
  LEAGUE_ACTIONS_PER_MINUTE,
  LEAGUE_CAPACITY,
  LEAGUE_SHIPS,
  LEAGUE_TRAVEL_SECONDS,
  isEventActive,
  isFlooding,
  leagueBuyTotal,
  leagueEventPercent,
  leagueEventText,
  leagueSellTotal,
  leagueShip,
  leagueShipCost,
  leagueShipValue,
  leagueTravelSeconds,
  remainingText,
  travelProgress,
  type LeagueEvent,
} from './rules.ts';
// Vite liefert die Datei als Text, so prüft der Test Client und Datenbank gegeneinander
import MIGRATION from '../../supabase/migrations/20261106210000_liga_saisons.sql?raw';

const NOW = new Date('2026-11-10T12:00:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60000).toISOString();
const ev = (kind: LeagueEvent['kind'], townId: string | null, from = -10, to = 50, id = 1): LeagueEvent => ({
  id,
  kind,
  townId,
  startsAt: at(from),
  endsAt: at(to),
});

describe('Liga-Schiffe', () => {
  it('Startschiff entspricht den alten Liga-Regeln', () => {
    const s = leagueShip('treidelkahn');
    expect(s.price).toBe(0);
    expect(s.capacity).toBe(LEAGUE_CAPACITY);
    expect(s.travelSeconds).toBe(LEAGUE_TRAVEL_SECONDS);
  });

  it('unbekannte oder fehlende Typen fallen auf den Treidelkahn zurück', () => {
    expect(leagueShip(undefined).id).toBe('treidelkahn');
    expect(leagueShip('dampfer').id).toBe('treidelkahn');
  });

  it('jedes Schiff hat einen Vorteil, keines ist in allem besser', () => {
    for (const a of LEAGUE_SHIPS) {
      for (const b of LEAGUE_SHIPS) {
        if (a === b) continue;
        const better =
          a.capacity >= b.capacity && a.travelSeconds <= b.travelSeconds && a.floodSeconds <= b.floodSeconds && a.price <= b.price;
        expect(better, `${a.id} schlägt ${b.id} in allem`).toBe(false);
      }
    }
  });

  it('Wechsel kostet den neuen Preis minus halben alten Preis', () => {
    expect(leagueShipCost('treidelkahn', 'plaette')).toBe(280);
    expect(leagueShipCost('plaette', 'segelkahn')).toBe(950 - 140);
    expect(leagueShipCost('segelkahn', 'treidelkahn')).toBe(-475);
    expect(leagueShipValue('segelkahn')).toBe(475);
  });

  it('Hochwasser verlängert die Fahrt, die Plätte am wenigsten', () => {
    for (const s of LEAGUE_SHIPS) expect(leagueTravelSeconds(s.id, true)).toBeGreaterThanOrEqual(leagueTravelSeconds(s.id, false));
    const extra = (id: string) => leagueTravelSeconds(id, true) - leagueTravelSeconds(id, false);
    expect(extra('plaette')).toBeLessThan(extra('treidelkahn'));
    expect(extra('treidelkahn')).toBeLessThan(extra('segelkahn'));
  });

  it('Werte stimmen mit der Migration überein', () => {
    for (const s of LEAGUE_SHIPS) {
      const re = new RegExp(`\\('${s.id}',\\s*'[^']+',\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),`);
      const m = MIGRATION.match(re);
      expect(m, s.id).not.toBeNull();
      expect(m!.slice(1, 5).map(Number)).toEqual([s.price, s.capacity, s.travelSeconds, s.floodSeconds]);
    }
    expect(MIGRATION).toContain(`if v_count > ${LEAGUE_ACTIONS_PER_MINUTE} then`);
    expect(MIGRATION).toContain("when e.kind = 'zollstreit' then case when p_buy then 115 else 85 end");
    expect(MIGRATION).toContain("when e.kind = 'markttag'   then case when p_buy then 100 else 120 end");
  });
});

describe('Liga-Ereignisse', () => {
  it('erkennt laufende, vergangene und künftige Ereignisse', () => {
    expect(isEventActive(ev('hochwasser', null), NOW)).toBe(true);
    expect(isEventActive(ev('hochwasser', null, -60, -1), NOW)).toBe(false);
    expect(isEventActive(ev('hochwasser', null, 5, 60), NOW)).toBe(false);
    // Ende ist ausschließlich wie auf dem Server (ends_at > now())
    expect(isEventActive(ev('hochwasser', null, -60, 0), NOW)).toBe(false);
  });

  it('Hochwasser gilt im ganzen Tal', () => {
    expect(isFlooding([ev('hochwasser', null)], NOW)).toBe(true);
    expect(isFlooding([ev('zollstreit', 'oberau')], NOW)).toBe(false);
  });

  it('Zollstreit und Markttag wirken nur in ihrer Stadt', () => {
    const list = [ev('zollstreit', 'oberau', -10, 50, 1), ev('markttag', 'weidenhof', -10, 50, 2)];
    expect(leagueEventPercent(list, 'oberau', true, NOW)).toBe(115);
    expect(leagueEventPercent(list, 'oberau', false, NOW)).toBe(85);
    expect(leagueEventPercent(list, 'weidenhof', true, NOW)).toBe(100);
    expect(leagueEventPercent(list, 'weidenhof', false, NOW)).toBe(120);
    expect(leagueEventPercent(list, 'altenfurt', true, NOW)).toBe(100);
    expect(leagueEventPercent([ev('zollstreit', 'oberau', -60, -1)], 'oberau', true, NOW)).toBe(100);
  });

  it('rundet wie der Server: Kauf auf, Verkauf ab', () => {
    // Werte aus dem Datenbanktest: 241 Taler Erlös bei Zollstreit ergeben 204
    expect(leagueSellTotal(241, 85)).toBe(204);
    expect(leagueBuyTotal(277, 115)).toBe(319);
    expect(leagueBuyTotal(20, 115)).toBe(23);
    expect(leagueBuyTotal(100, 100)).toBe(100);
    expect(leagueSellTotal(100, 120)).toBe(120);
  });

  it('beschreibt jedes Ereignis mit Stadtnamen', () => {
    const name = (id: string) => id.toUpperCase();
    expect(leagueEventText(ev('zollstreit', 'oberau'), name).title).toBe('Zollstreit in OBERAU');
    expect(leagueEventText(ev('markttag', 'oberau'), name).text).toContain('20 %');
    expect(leagueEventText(ev('hochwasser', null), name).title).toContain('Hochwasser');
  });
});

describe('Liga-Anzeige', () => {
  it('Fahrtfortschritt nutzt die echte Abfahrt', () => {
    expect(travelProgress({ departedAt: at(-1), arrivesAt: at(1) }, NOW)).toBeCloseTo(0.5);
    expect(travelProgress({ departedAt: at(-2), arrivesAt: at(-1) }, NOW)).toBe(1);
    // ältere Server ohne departed_at: 45 Sekunden vor Ankunft
    expect(travelProgress({ arrivesAt: new Date(NOW.getTime() + 22500).toISOString() }, NOW)).toBeCloseTo(0.5);
  });

  it('Restzeit als Text', () => {
    expect(remainingText(3 * 86400000 + 4 * 3600000)).toBe('3 Tage 4 Std');
    expect(remainingText(86400000 + 60000)).toBe('1 Tag 0 Std');
    expect(remainingText(2 * 3600000 + 5 * 60000)).toBe('2 Std 5 Min');
    expect(remainingText(30000)).toBe('1 Min');
    expect(remainingText(-5)).toBe('0 Min');
  });

  it('übersetzt Zeilen vom Server', () => {
    const p = toPlayer({ user_id: 'u', gold: 5, cargo: null, town_id: 'oberau', arrives_at: at(0), wealth: 5 });
    expect(p.ship).toBe('treidelkahn');
    expect(p.departedAt).toBeUndefined();
    expect(p.cargo).toEqual({});
    const q = toPlayer({ user_id: 'u', gold: 5, cargo: { holz: 2 }, town_id: 'oberau', arrives_at: at(0), departed_at: at(-1), ship: 'plaette', wealth: 5 });
    expect(q.ship).toBe('plaette');
    expect(q.departedAt).toBe(at(-1));
    expect(toEvent({ id: 3, kind: 'markttag', town_id: 'oberau', starts_at: at(0), ends_at: at(60) })).toEqual({
      id: 3,
      kind: 'markttag',
      townId: 'oberau',
      startsAt: at(0),
      endsAt: at(60),
    });
  });

  it('übersetzt die neuen Serverfehler', () => {
    expect(fail(new Error('zu viele aktionen')).ok).toBe(false);
    const r = fail(new Error('zu viele aktionen'));
    if (!r.ok) expect(r.error).toContain('40 Aktionen');
    const s = fail({ message: 'ladung passt nicht' });
    if (!s.ok) expect(s.error).toContain('Ladung');
  });
});

describe('Liga ohne Server', () => {
  beforeEach(() => {
    resetOnlineForTests();
    initOnline({});
  });

  it('liefert offline statt zu werfen', async () => {
    for (const r of [await leagueBuyShip('plaette'), await getLeagueInfo()]) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.offline).toBe(true);
        expect(r.error).toBe(OFFLINE_ERROR);
      }
    }
  });
});
