import { describe, expect, it } from 'vitest';
import { VALLEY } from '../data/maps/valley.ts';
import { advance, buy, day, depart, hoursToArrival, newGame, sell, store, type GameState } from './game.ts';
import {
  dayHash,
  isLive,
  knownPrices,
  priceHistory,
  quote,
  roughPrice,
  rumorFor,
  tripProfit,
  trips,
  HISTORY_POINTS,
  RUMOR_CHANCE,
} from './market-info.ts';

const start = () => newGame(VALLEY, 'oberau');

/** Fahrt zu Ende segeln */
function sailTo(state: GameState, shipId: number, to: string): void {
  const v = depart(state, VALLEY, shipId, to);
  expect(v, `Fahrt nach ${to} möglich`).not.toBeNull();
  // nachts fahren Schiffe langsamer: bis zur echten Ankunft fahren
  advance(state, VALLEY, hoursToArrival(state, state.ships.find((x) => x.id === shipId)!) + 0.01);
}

describe('Preisbuch', () => {
  it('kennt zu Beginn nur die Starthafen-Preise', () => {
    const s = start();
    expect(knownPrices(s, 'oberau')?.live).toBe(true);
    expect(knownPrices(s, 'kesselbrueck')).toBeNull();
  });

  it('hält den Stand des letzten Besuchs fest und zeigt ihn nicht live', () => {
    const s = start();
    const ship = s.ships[0];
    sailTo(s, ship.id, 'kesselbrueck');
    sailTo(s, ship.id, 'oberau');
    const page = knownPrices(s, 'kesselbrueck')!;
    expect(page.live).toBe(false);
    expect(isLive(s, 'kesselbrueck')).toBe(false);
    // der Markt dort ändert sich weiter, das Buch nicht
    const good = Object.keys(page.prices)[0];
    const seen = page.prices[good].buy;
    s.markets.kesselbrueck[good].stock = 0.5;
    expect(knownPrices(s, 'kesselbrueck')!.prices[good].buy).toBe(seen);
    expect(quote(s, 'kesselbrueck', good)!.buy).not.toBe(seen);
  });

  it('zeigt Städte mit eigenem Kontor live', () => {
    const s = start();
    s.kontore.niedermuend = { level: 1, stock: {} };
    const k = knownPrices(s, 'niedermuend')!;
    expect(k.live).toBe(true);
    const good = Object.keys(k.prices)[0];
    expect(k.prices[good]).toEqual(quote(s, 'niedermuend', good));
  });

  it('der Verkaufspreis im Buch entspricht dem Erlös der ersten Tonne', () => {
    const s = start();
    const ship = s.ships[0];
    const q = quote(s, 'oberau', 'holz')!;
    const b = buy(s, ship.id, 'holz', 1);
    expect(b.taler).toBe(q.buy);
    const q2 = quote(s, 'oberau', 'holz')!;
    const r = sell(s, ship.id, 'holz', 1);
    expect(r.taler).toBe(q2.sell);
  });
});

describe('Preisverlauf', () => {
  it('notiert sichtbare Märkte täglich und begrenzt die Länge', () => {
    const s = start();
    advance(s, VALLEY, 24 * 5);
    const h = priceHistory(s, 'oberau', 'holz');
    expect(h.length).toBe(6); // Start plus fünf Mitternächte
    expect(h.map((p) => p[0])).toEqual([1, 2, 3, 4, 5, 6]);
    advance(s, VALLEY, 24 * (HISTORY_POINTS + 10));
    expect(priceHistory(s, 'oberau', 'holz').length).toBe(HISTORY_POINTS);
    // ferne Städte ohne Besuch haben keinen Verlauf
    expect(priceHistory(s, 'glashuette', 'glas')).toEqual([]);
  });
});

describe('Gerüchte', () => {
  it('kommen höchstens an etwa jedem dritten Tag und betreffen nie sichtbare Städte', () => {
    const s = start();
    let count = 0;
    for (let d = 1; d <= 300; d++) {
      const r = rumorFor(s, VALLEY, d);
      if (r) {
        count++;
        expect(isLive(s, r.town)).toBe(false);
      }
    }
    // nur an Gerüchtetagen und nur, wenn irgendwo etwas auffällig knapp oder reichlich ist
    expect(count).toBeGreaterThan(10);
    expect(count).toBeLessThan(300 * RUMOR_CHANCE * 1.3);
  });

  it('nennen eine knappe Ware mit grobem Verkaufspreis', () => {
    const s = start();
    for (const m of Object.values(s.markets.glashuette)) m.stock = m.target;
    s.markets.glashuette.glas.stock = s.markets.glashuette.glas.target * 0.2;
    // nur Glashütte ist fern und auffällig: alle anderen Märkte ausgeglichen
    for (const t of VALLEY.towns) {
      if (t.id === 'glashuette') continue;
      for (const m of Object.values(s.markets[t.id])) m.stock = m.target;
    }
    const d = Array.from({ length: 50 }, (_, i) => i + 1).find((x) => dayHash(x, 0) < RUMOR_CHANCE)!;
    const r = rumorFor(s, VALLEY, d)!;
    expect(r).toEqual({ town: 'glashuette', good: 'glas', scarce: true, price: roughPrice(quote(s, 'glashuette', 'glas')!.sell) });
  });

  it('verbrauchen keinen Zufall aus dem Spielstand', () => {
    const a = start();
    const b = start();
    for (let d = 1; d <= 30; d++) rumorFor(a, VALLEY, d);
    expect(a.rng).toBe(b.rng);
  });

  it('erscheinen im Flussboten', () => {
    const s = start();
    advance(s, VALLEY, 24 * 30);
    expect(s.news.some((n) => n.kind === 'geruecht')).toBe(true);
  });

  it('runden Preise grob', () => {
    expect(roughPrice(13)).toBe(14);
    expect(roughPrice(43)).toBe(45);
    expect(roughPrice(87)).toBe(90);
  });
});

describe('Schiffsbuch', () => {
  it('rechnet Gewinn je Fahrt aus Verkauf, Einstand, Zoll, Brennstoff und Lohn', () => {
    const s = start();
    const ship = s.ships[0];
    ship.captain = { id: 1, name: 'Test', trait: 'vorsichtig', wage: 12, hire: 0 };
    const b = buy(s, ship.id, 'getreide', 10);
    expect(b.ok).toBe(true);
    const v = depart(s, VALLEY, ship.id, 'kesselbrueck')!;
    expect(trips(ship)[0].arrived).toBeUndefined();
    advance(s, VALLEY, v.hours + 0.01);
    const r = sell(s, ship.id, 'getreide', 10);
    expect(r.ok).toBe(true);
    const t = trips(ship)[0];
    expect(t.from).toBe('oberau');
    expect(t.to).toBe('kesselbrueck');
    expect(t.arrived).toBe(day(s));
    expect(t.sell).toBe(r.taler);
    expect(t.cost).toBe(b.taler);
    expect(t.tons).toBe(10);
    expect(t.wage).toBeCloseTo((12 * v.hours) / 24, 5);
    expect(tripProfit(t)).toBe(Math.round(r.taler - b.taler - t.fuel - t.toll - t.wage));
  });

  it('schließt die Fahrt beim nächsten Ablegen ab und zählt Verkäufe anderswo nicht', () => {
    const s = start();
    const ship = s.ships[0];
    buy(s, ship.id, 'holz', 5);
    sailTo(s, ship.id, 'kesselbrueck');
    sailTo(s, ship.id, 'oberau');
    expect(ship.tripLog?.length).toBe(1);
    expect(ship.tripLog![0].to).toBe('kesselbrueck');
    // Verkauf in Oberau gehört zur Fahrt Kesselbrück -> Oberau
    sell(s, ship.id, 'holz', 5);
    expect(trips(ship)[0].from).toBe('kesselbrueck');
    expect(trips(ship)[0].tons).toBe(5);
    expect(ship.tripLog![0].tons).toBe(0);
  });
});

describe('Schiffsbuch mit Kontor', () => {
  it('Einlagern im Zielhafen zählt zum Marktwert', () => {
    const s = start();
    const ship = s.ships[0];
    s.kontore.kesselbrueck = { level: 1, stock: {} };
    const b = buy(s, ship.id, 'getreide', 10);
    sailTo(s, ship.id, 'kesselbrueck');
    const q = quote(s, 'kesselbrueck', 'getreide')!;
    const r = store(s, ship.id, 'getreide', 10);
    expect(r.ok).toBe(true);
    const t = trips(ship)[0];
    expect(t.stored).toBe(10);
    expect(t.cost).toBe(b.taler);
    expect(t.sell).toBe(q.sell * 10);
  });
});

describe('alte Spielstände', () => {
  it('ein Stand ohne Preisbuch läuft weiter', () => {
    const s = start();
    delete (s as Partial<GameState>).priceBook;
    delete (s as Partial<GameState>).priceHistory;
    advance(s, VALLEY, 48);
    expect((s as GameState).priceBook?.oberau).toBeDefined();
  });
});
