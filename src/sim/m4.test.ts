import { describe, expect, it } from 'vitest';
import { VALLEY } from '../data/maps/valley.ts';
import { acceptContract, deliverContract } from './contracts.ts';
import { dismissCaptain, hireCaptain, repair, repairCost, setRoute, upgrade } from './fleet.ts';
import { advance, buy, capacityOf, depart, kontorBuy, kontorSell, load, newGame, store, type GameState } from './game.ts';
import { buildBetrieb, buildKontor, upgradeKontor } from './house.ts';
import { rivalWorth } from './rivals.ts';
import { runBalance } from './balance.ts';

const fresh = (money = 5000, rivals = false): GameState => newGame(VALLEY, { startTown: 'oberau', money, rivals });

describe('Kontor und Betriebe', () => {
  it('Kontor lagert Ware und verkauft besser', () => {
    const s = fresh();
    expect(buildKontor(s, 'oberau').ok).toBe(true);
    expect(buy(s, 1, 'holz', 20).ok).toBe(true);
    expect(store(s, 1, 'holz', 20).amount).toBe(20);
    expect(s.ships[0].cargo.holz).toBeUndefined();
    expect(s.kontore.oberau.stock.holz.amount).toBe(20);
    expect(load(s, 1, 'holz', 5).amount).toBe(5);
    expect(kontorSell(s, 'oberau', 'holz', 15).ok).toBe(true);
    expect(kontorBuy(s, 'oberau', 'wolle', 10).amount).toBe(10);
  });

  it('Sägewerk macht aus Holz im Kontor Bretter', () => {
    const s = fresh();
    buildKontor(s, 'oberau');
    expect(buildBetrieb(s, VALLEY, 'oberau', 'saegewerk').ok).toBe(true);
    kontorBuy(s, 'oberau', 'holz', 30);
    const money = s.money;
    advance(s, VALLEY, 24 * 3);
    expect(s.kontore.oberau.stock.bretter.amount).toBeCloseTo(15, 5); // 3 Tage je 6 t Holz zu 5 t Brettern
    expect(s.money).toBeLessThan(money); // Löhne und Unterhalt
  });

  it('Rohstoffbetriebe nur mit Vorkommen, Bauplätze je Stufe', () => {
    const s = fresh(20000);
    buildKontor(s, 'oberau');
    expect(buildBetrieb(s, VALLEY, 'oberau', 'grube').ok).toBe(false);
    expect(buildBetrieb(s, VALLEY, 'oberau', 'holzfaeller').ok).toBe(true);
    expect(buildBetrieb(s, VALLEY, 'oberau', 'saegewerk').ok).toBe(true);
    expect(buildBetrieb(s, VALLEY, 'oberau', 'tischlerei').ok).toBe(false);
    expect(upgradeKontor(s, 'oberau').ok).toBe(true);
    expect(buildBetrieb(s, VALLEY, 'oberau', 'tischlerei').ok).toBe(true);
    // Kette Holz -> Bretter -> Möbel läuft ohne Zukauf
    advance(s, VALLEY, 24 * 10);
    expect(s.kontore.oberau.stock.moebel?.amount ?? 0).toBeGreaterThan(5);
  });
});

describe('Werft und Kapitäne', () => {
  it('Fahren nutzt das Schiff ab, die Werft repariert', () => {
    const s = fresh();
    s.hour = 24 * 40; // Sommer: keine Schneeschmelze
    depart(s, VALLEY, 1, 'niedermuend');
    advance(s, VALLEY, 200);
    const ship = s.ships[0];
    expect(ship.port).toBe('niedermuend');
    expect(ship.condition).toBeLessThan(1);
    expect(repairCost(ship)).toBeGreaterThan(0);
    expect(repair(s, VALLEY, 1).ok).toBe(true);
    expect(ship.condition).toBe(1);
    expect(upgrade(s, VALLEY, 1, 'laderaum').ok).toBe(true);
    expect(capacityOf(ship)).toBe(48);
  });

  it('Kapitän anheuern und entlassen', () => {
    const s = fresh();
    const c = s.tavern.oberau[0];
    expect(hireCaptain(s, 1, c.id).ok).toBe(true);
    expect(s.ships[0].captain?.name).toBe(c.name);
    expect(dismissCaptain(s, 1).ok).toBe(true);
    expect(s.ships[0].captain).toBeNull();
  });
});

describe('Handelsrouten', () => {
  it('Ein Kapitän fährt die Holzroute allein', () => {
    const s = fresh(1000);
    s.hour = 24 * 35;
    const c = s.tavern.oberau[0];
    hireCaptain(s, 1, c.id);
    setRoute(s, 1, {
      active: true,
      next: 0,
      stops: [
        { town: 'oberau', orders: [{ kind: 'kaufen', good: 'holz', amount: 0, limit: 0 }] },
        { town: 'niedermuend', orders: [{ kind: 'verkaufen', good: 'holz', amount: 0, limit: 0 }] },
      ],
    });
    const start = s.money;
    advance(s, VALLEY, 24 * 30);
    expect(s.stats.trips).toBeGreaterThanOrEqual(4);
    expect(s.stats.delivered.niedermuend?.holz ?? 0).toBeGreaterThan(60);
    expect(s.money).not.toBe(start);
  });
});

describe('Aufträge', () => {
  it('Auftrag annehmen und liefern bringt die Belohnung', () => {
    const s = fresh();
    s.contracts.push({ id: 999, town: 'oberau', good: 'holz', amount: 10, delivered: 0, reward: 700, issued: 1, offerUntil: 10, deadline: 20, accepted: false });
    expect(acceptContract(s, 999).ok).toBe(true);
    buy(s, 1, 'holz', 10);
    const money = s.money;
    const r = deliverContract(s, 1, 999);
    expect(r.ok).toBe(true);
    expect(s.money).toBe(money + 700);
    expect(s.stats.contracts).toBe(1);
  });

  it('Über ein Jahr entstehen Angebote, Ereignisse und Nachrichten', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', seed: 7 });
    let offers = 0;
    let events = 0;
    for (let d = 0; d < 120; d++) {
      advance(s, VALLEY, 24);
      offers += s.contracts.length ? 1 : 0;
      events += s.events.length ? 1 : 0;
    }
    expect(offers).toBeGreaterThan(30);
    expect(events).toBeGreaterThan(10);
    expect(s.news.length).toBeGreaterThan(10);
  });
});

describe('Konkurrenz', () => {
  it('Die Handelshäuser handeln, bleiben zahlungsfähig und überholen niemanden absurd', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', seed: 3 });
    const before = s.rivals.map(rivalWorth);
    for (let d = 0; d < 240; d++) advance(s, VALLEY, 24);
    const after = s.rivals.map(rivalWorth);
    const traded = s.rivals.reduce((n, r) => n + Math.abs(r.profit), 0);
    expect(traded).toBeGreaterThan(1000);
    for (let i = 0; i < after.length; i++) {
      expect(after[i]).toBeGreaterThan(before[i] * 0.5);
      expect(after[i]).toBeLessThan(60000);
    }
  });

  it('Mit Konkurrenz bleibt Handeln lohnend', () => {
    const free = runBalance(VALLEY, 120, 'oberau', { rivals: false, seed: 1 });
    const contested = runBalance(VALLEY, 120, 'oberau', { rivals: true, seed: 1 });
    expect(contested.money).toBeGreaterThan(8000);
    expect(contested.money).toBeLessThan(free.money);
  });
});
