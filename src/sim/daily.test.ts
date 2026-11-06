import { describe, expect, it } from 'vitest';
import { DAILY_DAYS } from '../data/challenges.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { dailySeed } from '../online/rules.ts';
import { DAILY_RULES, dailyOptions, dailyRule, dayNumber, newDailyGame } from './daily.ts';
import { advance, buy, newGame, type GameState } from './game.ts';
import { deserialize, SAVE_VERSION, serialize } from './save.ts';
import { day, rand, streamSeed, withStream } from './state.ts';
import { season, waterLevel } from './calendar.ts';
import { buyShip } from './fleet.ts';

/** Ereignisse ohne laufende Nummer, die hängt an der Reihenfolge und zählt nicht für den Ablauf */
const eventsOf = (s: GameState) => s.events.map(({ id: _id, ...e }) => e);

/** Ein Spieler, der kräftig in die Märkte eingreift: kauft Schiffe und leert die Märkte */
function busyPlayer(s: GameState): void {
  s.money += 20000;
  const town = s.ships[0].port!;
  buyShip(s, VALLEY, 'muehlheim', 'treidelkahn');
  for (const g of Object.keys(s.markets[town])) buy(s, s.ships[0].id, g, 15);
}

/** Spielt 60 Tage und zeichnet Ereignisse, Aufträge, Kneipen und Konkurrenz-Nachrichten je Tag auf */
function run(
  day: string,
  player?: (s: GameState) => void,
  steps = [0.3, 5.2, 7, 11.5],
): { events: unknown[]; contracts: unknown[]; tavern: unknown[]; news: string[]; rivals: string } {
  const s = newDailyGame(VALLEY, day, dailySeed(day));
  player?.(s);
  const events: unknown[] = [];
  const contracts: unknown[] = [];
  const tavern: unknown[] = [];
  const news: string[] = [];
  for (let d = 0; d < DAILY_DAYS; d++) {
    // unregelmäßige Schritte wie bei schwankender Bildrate
    for (const h of steps) advance(s, VALLEY, h);
    events.push(eventsOf(s));
    contracts.push(s.contracts.map((c) => [c.town, c.good, c.amount, c.reward, c.offerUntil, c.deadline]));
    tavern.push(Object.values(s.tavern).map((l) => l.map((c) => [c.name, c.trait, c.wage, c.hire])));
  }
  for (const n of s.news) if (n.kind === 'ereignis') news.push(n.text);
  return { events, contracts, tavern, news, rivals: JSON.stringify(s.rivals) };
}

describe('Tagesmarkt deterministisch', () => {
  it('Ereignisse und Kneipen sind gleich, egal was der Spieler tut', () => {
    // Aufträge und Konkurrenz reagieren bewusst auf die Märkte, die der Spieler verändert.
    // Ihr Zufall kommt aber aus eigenen Strömen und reißt Ereignisse und Kneipen nicht mehr mit.
    for (const day of ['2026-11-06', '2026-11-07', '2026-11-09', '2026-11-10']) {
      const quiet = run(day);
      const busy = run(day, busyPlayer);
      expect(busy.events).toEqual(quiet.events);
      expect(busy.tavern).toEqual(quiet.tavern);
      expect(busy.news).toEqual(quiet.news);
    }
  });

  it('Ereignisse hängen nicht von der Bildrate ab', () => {
    for (const day of ['2026-11-06', '2026-11-08']) {
      const a = run(day, busyPlayer, [24]);
      const b = run(day, busyPlayer, [0.3, 5.2, 7, 11.5]);
      // Konkurrenz und Aufträge reagieren auf Marktstände, die von der Schrittweite leicht abhängen;
      // Ereignisse, Wetter und Kneipen nicht.
      expect(b.events).toEqual(a.events);
      expect(b.tavern).toEqual(a.tavern);
      expect(b.news).toEqual(a.news);
    }
  });

  it('ohne fairSeed zieht alles weiter aus dem gemeinsamen Strom (freies Spiel unverändert)', () => {
    const a = newGame(VALLEY, { startTown: 'oberau', seed: 42 });
    expect(a.fairSeed).toBeUndefined();
    const before = a.rng;
    withStream(a, 'ereignisse', 1, () => rand(a));
    expect(a.rng).not.toBe(before);
  });

  it('withStream lässt den gemeinsamen Strom unberührt und zieht im selben Zeitpunkt weiter', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', seed: 7, fairSeed: 99 });
    const shared = s.rng;
    const one = withStream(s, 'x', 5, () => [rand(s), rand(s)]);
    expect(s.rng).toBe(shared);
    const split = newGame(VALLEY, { startTown: 'oberau', seed: 7, fairSeed: 99 });
    const a = withStream(split, 'x', 5, () => rand(split));
    const b = withStream(split, 'x', 5, () => rand(split));
    expect([a, b]).toEqual(one);
    // neuer Zeitpunkt beginnt neu
    expect(withStream(split, 'x', 6, () => rand(split))).not.toBe(one[0]);
    expect(streamSeed(99, 'x', 5)).not.toBe(streamSeed(99, 'y', 5));
  });

  it('übersteht Speichern und Laden mitten im Tag', () => {
    const day = '2026-11-08';
    const a = newDailyGame(VALLEY, day, dailySeed(day));
    advance(a, VALLEY, 24 * 10 + 3.5);
    const text = serialize({ version: SAVE_VERSION, savedAt: '', mode: 'tagesmarkt', completedGoals: [], dailyDay: day, dailyScored: true, state: a });
    const loaded = deserialize(text)!;
    expect(loaded.dailyScored).toBe(true);
    const b = loaded.state;
    advance(a, VALLEY, 24 * 20);
    advance(b, VALLEY, 24 * 20);
    expect(eventsOf(b)).toEqual(eventsOf(a));
    expect(JSON.stringify(b.rivals)).toBe(JSON.stringify(a.rivals));
  });
});

describe('Tagesregeln', () => {
  it('wechseln jeden Tag und kommen alle reihum dran', () => {
    const start = dayNumber('2026-11-01');
    const ids: string[] = [];
    for (let i = 0; i < DAILY_RULES.length; i++) {
      const d = new Date((start + i) * 86400000).toISOString().slice(0, 10);
      ids.push(dailyRule(d).id);
    }
    expect(new Set(ids).size).toBe(DAILY_RULES.length);
    for (let i = 1; i < 40; i++) {
      const d1 = new Date((start + i - 1) * 86400000).toISOString().slice(0, 10);
      const d2 = new Date((start + i) * 86400000).toISOString().slice(0, 10);
      expect(dailyRule(d2).id).not.toBe(dailyRule(d1).id);
    }
  });

  /** Erster Kalendertag ab 2026-11-01 mit dieser Regel */
  const dayWith = (id: string) => {
    const start = dayNumber('2026-11-01');
    for (let i = 0; i < 16; i++) {
      const d = new Date((start + i) * 86400000).toISOString().slice(0, 10);
      if (dailyRule(d).id === id) return d;
    }
    throw new Error(id);
  };
  const gameWith = (id: string) => {
    const d = dayWith(id);
    return newDailyGame(VALLEY, d, dailySeed(d));
  };

  it('Dürre-Sommer: Start im Sommer mit Plätte und Dürre über den ganzen Markt', () => {
    const s = gameWith('duerre_sommer');
    expect(s.ships[0].type).toBe('plaette');
    const e = s.events.find((x) => x.kind === 'duerre')!;
    expect(e.until - e.from).toBe(DAILY_DAYS);
    advance(s, VALLEY, 2);
    expect(season(day(s))).toBe('sommer');
    expect(s.waterLevel).toBeCloseTo(waterLevel(s.hour / 24 + 1) - 0.3, 5);
  });

  it('Nur Plätten: andere Schiffe lassen sich nicht kaufen', () => {
    const s = gameWith('nur_plaetten');
    s.money = 100000;
    expect(s.ships[0].type).toBe('plaette');
    expect(buyShip(s, VALLEY, 'muehlheim', 'treidelkahn').ok).toBe(false);
    expect(buyShip(s, VALLEY, 'muehlheim', 'plaette').ok).toBe(true);
  });

  it('Zollkrieg: drei Zölle auf dem Strom für den ganzen Markt', () => {
    const s = gameWith('zollkrieg');
    const z = s.events.filter((x) => x.kind === 'zoll');
    expect(z).toHaveLength(3);
    expect(new Set(z.map((x) => x.seg)).size).toBe(3);
    for (const e of z) {
      expect(VALLEY.segments.find((x) => x.id === e.seg)?.river).toBe('strom');
      expect(e.value).toBeGreaterThanOrEqual(40);
    }
    advance(s, VALLEY, 24 * 30);
    expect(s.events.filter((x) => x.kind === 'zoll')).toHaveLength(3);
  });

  it('jede Regel ergibt einen spielbaren Start mit Hinweis im Flussboten', () => {
    for (const r of DAILY_RULES) {
      const d = dayWith(r.id);
      const s = newDailyGame(VALLEY, d, dailySeed(d));
      expect(s.fairSeed).toBe(dailySeed(d));
      expect(s.news.some((n) => n.text.includes(r.name))).toBe(true);
      expect(s.ships).toHaveLength(1);
      expect(s.money).toBe(dailyOptions(d, dailySeed(d)).money);
      advance(s, VALLEY, 24 * 5);
    }
  });
});
