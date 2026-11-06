import { describe, expect, it } from 'vitest';
import { MAST_HOURS, needsMastDown, travelTime } from './river.ts';
import { GOODS } from '../data/goods.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { runBalance } from './balance.ts';
import {
  hoursToArrival,
  advance,
  buy,
  buyShip,
  cargoLoad,
  day,
  depart,
  dismantleRaft,
  effectiveType,
  newGame,
  planVoyage,
  sell,
  voyagePosition,
} from './game.ts';
import { marketTarget, STOCK_CAP, tickTown, tradedGoods } from './towns.ts';

import { EPOCH_GOODS } from './supply.ts';

const start = () => newGame(VALLEY, 'oberau');

describe('Karte', () => {
  it('jede Ware wird irgendwo erzeugt und irgendwo gebraucht', () => {
    for (const g of GOODS) {
      // Waren einer späteren Epoche (Diesel) stehen nicht in den Stadtdaten, sondern in supply.ts
      const epoch = EPOCH_GOODS.find((e) => e.good === g.id);
      const made = VALLEY.towns.some((t) => g.id in t.produces || t.industries.some((i) => g.id in i.outputs)) || !!epoch && Object.keys(epoch.produces).length > 0;
      const used = VALLEY.towns.some((t) => g.id in t.consumes || t.industries.some((i) => g.id in i.inputs)) || !!epoch && Object.keys(epoch.consumes).length > 0;
      expect(made, `${g.name} wird nirgends erzeugt`).toBe(true);
      expect(used, `${g.name} wird nirgends gebraucht`).toBe(true);
    }
  });

  it('Abschnitte verbinden bekannte Städte', () => {
    const ids = new Set(VALLEY.towns.map((t) => t.id));
    for (const s of VALLEY.segments) {
      expect(ids.has(s.from) && ids.has(s.to)).toBe(true);
    }
  });

  it('Märkte bleiben über ein Jahr in gültigen Grenzen', () => {
    const s = start();
    advance(s, VALLEY, 24 * 365);
    for (const town of VALLEY.towns) {
      for (const g of tradedGoods(town)) {
        const m = s.markets[town.id][g];
        expect(Number.isFinite(m.stock)).toBe(true);
        expect(m.stock).toBeGreaterThanOrEqual(0);
        expect(m.stock).toBeLessThanOrEqual(marketTarget(town, s.towns[town.id]) * STOCK_CAP + 1e-9);
      }
    }
  });

  it('Betriebe verarbeiten nur, was da ist', () => {
    const muehl = VALLEY.towns.find((t) => t.id === 'muehlheim')!;
    const s = start();
    const m = s.markets.muehlheim;
    m.getreide.stock = 0;
    m.mehl.stock = m.mehl.target;
    // Produktion 12 reicht für eine volle Mühle (4 -> 3 Mehl), danach gleicht das Umland 8 % aus
    tickTown(muehl, m, s.towns.muehlheim);
    expect(m.mehl.stock).toBeCloseTo(m.mehl.target + 3 * 0.92);

    // ohne Getreide steht die Mühle still
    const empty = { ...muehl, produces: {} };
    m.getreide.stock = 0;
    m.mehl.stock = m.mehl.target;
    tickTown(empty, m, s.towns.muehlheim);
    expect(m.mehl.stock).toBeCloseTo(m.mehl.target);
  });
});

describe('Routen', () => {
  it('Segelkahn legt vor der Brücke bei Kesselbrück den Mast und verliert 2 Stunden', () => {
    const s = start();
    const r = buyShip(s, VALLEY, 'niedermuend', 'segelkahn');
    expect(r.ok).toBe(false); // zu wenig Geld
    s.money = 5000;
    const ship = buyShip(s, VALLEY, 'niedermuend', 'segelkahn').ship!;
    const plan = planVoyage(s, VALLEY, ship.id, 'oberau')!;
    expect(plan.ok).toBe(true);
    const seg = VALLEY.segments.find((x) => x.id === 'kessel-muehl')!;
    const type = effectiveType(s, ship);
    expect(needsMastDown(seg, type, s.waterLevel)).toBe(true);
    const withMast = travelTime(seg, type, false, s.waterLevel)!;
    const noMast = travelTime(seg, { ...type, height: 3, mastHeight: undefined }, false, s.waterLevel)!;
    expect(withMast - noMast).toBeCloseTo(MAST_HOURS, 5);
  });

  it('nur flache Boote kommen zur Erzgrube', () => {
    const s = start();
    s.waterLevel = 0;
    s.money = 5000;
    const kahn = s.ships[0];
    buy(s, kahn.id, 'holz', 40); // voll beladen liegt der Kahn tief
    const plan = planVoyage(s, VALLEY, kahn.id, 'erzgrube')!;
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reasons[0].reason).toBe('tiefgang');

    const plaette = buyShip(s, VALLEY, 'muehlheim', 'plaette').ship!;
    const p2 = planVoyage(s, VALLEY, plaette.id, 'erzgrube')!;
    expect(p2.ok).toBe(true);
    if (p2.ok) expect(p2.voyage.legs.map((l) => l.seg)).toEqual(['muehl-alten', 'glas-alten', 'grube-glas']);
  });

  it('Fahrt über mehrere Abschnitte, Position wandert mit', () => {
    const s = start();
    const ship = s.ships[0];
    const v = depart(s, VALLEY, ship.id, 'niedermuend')!;
    expect(v.legs).toHaveLength(5);
    expect(v.legs.every((l) => l.downstream)).toBe(true);
    advance(s, VALLEY, v.legs[0].hours + 0.1);
    expect(voyagePosition(ship.voyage!).index).toBe(1);
    const events = advance(s, VALLEY, v.hours);
    expect(events.some((e) => e.type === 'arrived')).toBe(true);
    expect(ship.port).toBe('niedermuend');
  });
});

describe('Handel', () => {
  it('Holz talwärts nach Niedermünd bringt Gewinn', () => {
    const s = start();
    const ship = s.ships[0];
    expect(buy(s, ship.id, 'holz', 30).ok).toBe(true);
    expect(depart(s, VALLEY, ship.id, 'niedermuend')).not.toBeNull();
    advance(s, VALLEY, hoursToArrival(s, ship));
    const r = sell(s, ship.id, 'holz', 30);
    expect(r.profit!).toBeGreaterThan(0);
    expect(r.firstProfit).toBe(true);
  });

  it('Laderaum und Geld begrenzen den Kauf', () => {
    const s = start();
    const ship = s.ships[0];
    buy(s, ship.id, 'holz', 1000);
    expect(cargoLoad(ship)).toBeLessThanOrEqual(40);
    expect(s.money).toBeGreaterThanOrEqual(0);
  });

  it('Waren, die eine Stadt nicht handelt, lassen sich dort nicht kaufen', () => {
    const s = start();
    expect(buy(s, s.ships[0].id, 'erz', 5).ok).toBe(false);
  });

  it('Floß treibt talwärts und wird am Ziel zu Holz', () => {
    const s = start();
    const raft = buyShip(s, VALLEY, 'oberau', 'floss').ship!;
    const plan = planVoyage(s, VALLEY, raft.id, 'kesselbrueck')!;
    expect(plan.ok).toBe(true);
    expect(depart(s, VALLEY, raft.id, 'kesselbrueck')).not.toBeNull();
    advance(s, VALLEY, hoursToArrival(s, raft));
    expect(planVoyage(s, VALLEY, raft.id, 'oberau')!.ok).toBe(false);
    const before = s.money;
    const r = dismantleRaft(s, raft.id);
    expect(r.ok).toBe(true);
    expect(s.ships.find((x) => x.id === raft.id)).toBeUndefined();
    expect(s.money).toBeGreaterThanOrEqual(before);
  });

  it('Tage vergehen und Städte arbeiten', () => {
    const s = start();
    const events = advance(s, VALLEY, 24 * 3);
    expect(events.filter((e) => e.type === 'newDay')).toHaveLength(3);
    expect(day(s)).toBe(4);
  });
});

describe('Balance', () => {
  it('ein einfacher Händler wird reich, aber nicht absurd schnell', () => {
    const r = runBalance(VALLEY, 60);
    console.log(`Balance 60 Tage: ${r.money} Taler, ${r.trips} Fahrten, Verlauf alle 10 Tage: ${r.moneyByDay.filter((_, i) => i % 10 === 9).join(', ')}`);
    expect(r.trips).toBeGreaterThan(5);
    expect(r.money).toBeGreaterThan(1500);
    expect(r.money).toBeLessThan(100000);
  });
});

describe('Jahreszeiten und Wachstum', () => {
  it('leere Schiffe liegen höher und kommen über seichte Stellen', () => {
    const s = start();
    s.waterLevel = 0;
    expect(planVoyage(s, VALLEY, s.ships[0].id, 'erzgrube')!.ok).toBe(true);
  });

  it('im Winter friert der Erzbach zu', () => {
    const s = start();
    advance(s, VALLEY, 24 * 99);
    expect(s.ice).toBe(true);
    const plan = planVoyage(s, VALLEY, s.ships[0].id, 'glashuette')!;
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reasons.map((r) => r.reason)).toContain('eis');
  });

  it('gut versorgte Städte wachsen, vernachlässigte nicht', () => {
    const s = start();
    const before = s.towns.oberau.population;
    advance(s, VALLEY, 24 * 60);
    expect(s.towns.oberau.population).toBeLessThan(before * 1.1);

    const s2 = start();
    const events = [];
    for (let d = 0; d < 120; d++) {
      for (const m of Object.values(s2.markets.oberau)) m.stock = Math.max(m.stock, m.target * 1.3);
      events.push(...advance(s2, VALLEY, 24));
    }
    expect(s2.towns.oberau.population).toBeGreaterThan(800);
    const up = events.find((e) => e.type === 'townLevel' && e.town === 'oberau');
    expect(up).toBeDefined();
    if (up && up.type === 'townLevel') expect(up.newGoods.length).toBeGreaterThan(0);
  });
});
