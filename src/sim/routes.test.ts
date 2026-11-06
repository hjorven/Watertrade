import { describe, expect, it } from 'vitest';
import { VALLEY } from '../data/maps/valley.ts';
import { hireCaptain, setRoute } from './fleet.ts';
import { advance, newGame, type GameState, type RouteStop, type Ship, type TradeRoute } from './game.ts';
import { activePlan, bookRoute, bookValue, MAX_LOAD_WAIT_HOURS, routeProfit, ROUTE_BOOK_DAYS, stopSkipped } from './routes.ts';

const fresh = (money = 5000): GameState => newGame(VALLEY, { startTown: 'oberau', money, rivals: false });

/** Neues Spiel am gegebenen Tag (Mittag) mit Kapitän auf Schiff 1 */
function withCaptain(dayNo: number): { s: GameState; ship: Ship } {
  const s = fresh();
  s.hour = 24 * (dayNo - 1) + 12;
  advance(s, VALLEY, 0.01);
  const c = s.tavern.oberau[0];
  expect(hireCaptain(s, 1, c.id).ok).toBe(true);
  return { s, ship: s.ships[0] };
}

const buyWood = (town = 'oberau'): RouteStop => ({ town, orders: [{ kind: 'kaufen', good: 'holz', amount: 0, limit: 0 }] });
const sellWood = (town: string): RouteStop => ({ town, orders: [{ kind: 'verkaufen', good: 'holz', amount: 0, limit: 0 }] });

const cargoCost = (ship: Ship) => Object.values(ship.cargo).reduce((n, c) => n + c.cost, 0);

describe('Routenauswertung', () => {
  it('Das Routenbuch erklärt die Geldänderung einer Route genau', () => {
    const { s, ship } = withCaptain(35);
    setRoute(s, 1, { active: true, next: 0, stops: [buyWood(), sellWood('niedermuend')] });
    const before = s.money + cargoCost(ship);
    advance(s, VALLEY, 24 * 20);
    const p = routeProfit(s, ship.route!);
    expect(s.stats.trips).toBeGreaterThanOrEqual(3);
    expect(p.days).toBe(21);
    expect(p.series).toHaveLength(21);
    // Bargeld plus Einstand an Bord: das ist der ganze Gewinn der Route, Löhne eingeschlossen
    expect(p.total).toBeCloseTo(s.money + cargoCost(ship) - before, 3);
    expect(p.perDay).toBeCloseTo(p.total / p.days, 6);
  });

  it('Es zählen nur die letzten 30 Tage', () => {
    const { s, ship } = withCaptain(10);
    const r: TradeRoute = (ship.route = { active: true, next: 0, stops: [buyWood(), sellWood('niedermuend')] });
    bookRoute(s, r, 1000);
    s.hour += 24 * 40;
    bookRoute(s, r, -50);
    const p = routeProfit(s, r);
    expect(p.days).toBe(ROUTE_BOOK_DAYS);
    expect(p.total).toBe(-50);
    expect(r.book!.length).toBe(1);
  });

  it('Einlagern ins Kontor ist kein Verlust', () => {
    const { s, ship } = withCaptain(35);
    s.kontore.oberau = { level: 1, stock: {} };
    ship.cargo.holz = { amount: 10, cost: 120 };
    const v = bookValue(s, ship);
    s.kontore.oberau.stock.holz = ship.cargo.holz;
    delete ship.cargo.holz;
    expect(bookValue(s, ship)).toBe(v);
  });
});

describe('Bedingungen je Halt', () => {
  it('Mindestladung: der Kapitän wartet, kauft nach und legt nach der Höchstwartezeit trotzdem ab', () => {
    const { s, ship } = withCaptain(35);
    // Preisgrenze 1 Taler: hier kauft er nie etwas
    setRoute(s, 1, {
      active: true,
      next: 0,
      stops: [{ town: 'oberau', orders: [{ kind: 'kaufen', good: 'holz', amount: 0, limit: 1 }], minLoad: 0.8 }, sellWood('muehlheim')],
    });
    advance(s, VALLEY, 24 * 2);
    expect(ship.port).toBe('oberau');
    expect(ship.route!.note).toMatch(/wartet in Oberau auf Ladung/);
    advance(s, VALLEY, MAX_LOAD_WAIT_HOURS - 24 * 2 + 24);
    expect(s.stats.trips).toBeGreaterThanOrEqual(1);
  });

  it('Mindestladung erfüllt: es geht sofort los', () => {
    const { s } = withCaptain(35);
    setRoute(s, 1, { active: true, next: 0, stops: [{ ...buyWood(), minLoad: 0.8 }, sellWood('muehlheim')] });
    advance(s, VALLEY, 2);
    expect(s.ships[0].voyage).not.toBeNull();
  });

  it('Pegelgrenze: ein Halt wird bei zu niedrigem Wasser übersprungen', () => {
    const { s, ship } = withCaptain(35);
    setRoute(s, 1, {
      active: true,
      next: 0,
      stops: [buyWood(), { ...sellWood('muehlheim'), levelMin: 5 }, sellWood('niedermuend')],
    });
    expect(stopSkipped(s, ship.route!.stops[1])).toBe(true);
    advance(s, VALLEY, 24 * 20);
    expect(s.stats.delivered.muehlheim?.holz ?? 0).toBe(0);
    expect(s.stats.delivered.niedermuend?.holz ?? 0).toBeGreaterThan(0);
  });

  it('Werden alle Halte übersprungen, wartet das Schiff', () => {
    const { s, ship } = withCaptain(35);
    setRoute(s, 1, { active: true, next: 0, stops: [{ ...buyWood(), levelMax: -9 }, { ...sellWood('muehlheim'), levelMax: -9 }] });
    advance(s, VALLEY, 24 * 3);
    expect(ship.port).toBe('oberau');
    expect(s.stats.trips).toBe(0);
    expect(ship.route!.note).toMatch(/jeder Halt übersprungen/);
  });
});

describe('Sommer- und Winterplan', () => {
  it('Mit dem Herbst schaltet die Route auf den Winterplan um', () => {
    // Tag 50: Sommer; Herbst beginnt an Tag 61
    const { s, ship } = withCaptain(50);
    setRoute(s, 1, {
      active: true,
      next: 0,
      stops: [buyWood(), sellWood('muehlheim')],
      winterStops: [buyWood(), sellWood('niedermuend')],
    });
    expect(activePlan(s, ship.route!)).toBe('sommer');
    advance(s, VALLEY, 24 * 10);
    expect(s.stats.delivered.niedermuend?.holz ?? 0).toBe(0);
    advance(s, VALLEY, 24 * 25);
    expect(ship.route!.plan).toBe('winter');
    expect(s.stats.delivered.niedermuend?.holz ?? 0).toBeGreaterThan(0);
  });

  it('Ein Winterplan mit weniger als zwei Halten gilt nicht', () => {
    const { s, ship } = withCaptain(70);
    ship.route = { active: true, next: 0, stops: [buyWood(), sellWood('muehlheim')], winterStops: [buyWood()] };
    expect(activePlan(s, ship.route)).toBe('sommer');
    ship.route.winterSeasons = ['fruehling'];
    ship.route.winterStops!.push(sellWood('niedermuend'));
    expect(activePlan(s, ship.route)).toBe('sommer');
    ship.route.winterSeasons = ['herbst'];
    expect(activePlan(s, ship.route)).toBe('winter');
  });
});
