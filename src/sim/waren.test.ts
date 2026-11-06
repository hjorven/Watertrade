import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.ts';
import { GOODS } from '../data/goods.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { PERISH, SHIPS } from '../data/ships.ts';
import { goodIcon, iconGoods } from '../ui/goodicons.ts';
import { paybackDays } from './balance.ts';
import { advance, buy, depart, departProblem, fillBunker, newGame, upgradeState, type GameState } from './game.ts';
import { startProject } from './works.ts';
import { BRICK_DELAY_MAX, bricksPerDay, siteTown, tickBuildSites } from './supply.ts';
import { LEVEL_NEEDS, needs } from './towns.ts';
import { PROJECT_BY_ID } from '../data/projects.ts';
import { bunkerPlan, FUEL_DEALER_FACTOR } from './voyage.ts';

const motorGame = (town = 'niedermuend', ship = 'motorschiff') => newGame(VALLEY, { startTown: town, startShip: ship, money: 5000, epoch: 3, rivals: false });

describe('Diesel', () => {
  it('kommt erst mit der Motorzeit in die Märkte', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', epoch: 2, rivals: false });
    advance(s, VALLEY, 48);
    for (const t of VALLEY.towns) expect(s.markets[t.id].diesel, t.id).toBeUndefined();
    s.epoch = 3;
    advance(s, VALLEY, 24);
    expect(s.markets.niedermuend.diesel.stock).toBeGreaterThan(0);
    expect(s.markets.muehlheim.diesel).toBeDefined();
    expect(s.markets.oberau.diesel).toBeUndefined();
    expect(s.news.some((n) => n.text.includes('Diesel'))).toBe(true);
  });

  it('ein Spiel in der Motorzeit beginnt mit Dieselhandel', () => {
    expect(motorGame().markets.niedermuend.diesel).toBeDefined();
  });

  it('Motorschiffe verbrauchen Diesel aus dem Tank statt Taler je Stunde', () => {
    const s = motorGame();
    const ship = s.ships[0];
    expect(ship.bunker).toBe(SHIPS.motorschiff.bunker);
    const v = depart(s, VALLEY, 1, 'muehlheim')!;
    const money = s.money;
    advance(s, VALLEY, v.hours);
    expect(ship.bunker).toBeCloseTo(SHIPS.motorschiff.bunker! - v.hours * SHIPS.motorschiff.diesel!, 3);
    // unterwegs kostet der Motor kein Geld mehr, nur Löhne und Unterhalt um Mitternacht
    expect(money - s.money).toBeLessThan(50);
  });

  it('zum Grundpreis kostet die Fahrstunde etwa so viel wie früher (10 Taler)', () => {
    expect(SHIPS.motorschiff.diesel! * 40).toBeCloseTo(10, 5);
    expect(SHIPS.kuehlschiff.diesel! * 40).toBeCloseTo(11.2, 5);
  });

  it('ohne Dieselmarkt verkauft ein Händler zum Aufpreis, das Schiff sitzt nicht fest', () => {
    const s = motorGame('oberau');
    expect(s.markets.oberau.diesel).toBeUndefined();
    s.ships[0].bunker = 0;
    expect(departProblem(s, VALLEY, 1, 'kesselbrueck')).toBeNull();
    const money = s.money;
    const v = depart(s, VALLEY, 1, 'kesselbrueck')!;
    expect(v).not.toBeNull();
    const need = Math.ceil(v.hours * SHIPS.motorschiff.diesel!);
    expect(s.ships[0].bunker).toBe(need);
    expect(money - s.money).toBe(need * Math.round(40 * FUEL_DEALER_FACTOR));
  });

  it('am Dieselmarkt wird beim Ablegen bis zum vollen Tank gekauft', () => {
    const s = motorGame();
    s.ships[0].bunker = 0;
    const stock = s.markets.niedermuend.diesel.stock;
    depart(s, VALLEY, 1, 'weidenhof');
    expect(s.ships[0].bunker).toBe(SHIPS.motorschiff.bunker);
    expect(s.markets.niedermuend.diesel.stock).toBeLessThan(stock);
  });

  it('Tank füllen kauft Diesel vom Markt', () => {
    const s = motorGame();
    s.ships[0].bunker = 2;
    expect(fillBunker(s, 1).ok).toBe(true);
    expect(s.ships[0].bunker).toBe(SHIPS.motorschiff.bunker);
  });

  it('Konkurrenz mit Motorschiffen läuft ein halbes Jahr ohne Fehler', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', epoch: 3, rivals: true, seed: 3 });
    advance(s, VALLEY, 24 * 120);
    for (const r of s.rivals) expect(Number.isFinite(r.money), r.id).toBe(true);
    expect(Number.isFinite(s.markets.niedermuend.diesel.stock)).toBe(true);
  }, 20000);
});

describe('Milch und Käse', () => {
  it('Milch verdirbt schneller als Fisch, Käse hält länger als Brot', () => {
    expect(PERISH.milch).toBeGreaterThan(PERISH.fisch);
    expect(PERISH.kaese).toBeLessThan(PERISH.brot);
  });

  it('im Kühlschiff bleibt Milch frisch', () => {
    const run = (type: string) => {
      const s = motorGame('weidenhof', type);
      buy(s, 1, 'milch', 10);
      const v = depart(s, VALLEY, 1, 'niedermuend')!;
      advance(s, VALLEY, v.hours + 30);
      return s.ships[0].cargo.milch.fresh ?? 1;
    };
    expect(run('kuehlschiff')).toBe(1);
    expect(run('motorschiff')).toBeLessThan(1);
  });
});

describe('Ziegel', () => {
  it('Städte und Großstädte brauchen Ziegel, Großstädte Wein', () => {
    expect(LEVEL_NEEDS[2].ziegel).toBeGreaterThan(0);
    expect(LEVEL_NEEDS[3].wein).toBeGreaterThan(0);
    const def = VALLEY.towns.find((t) => t.id === 'altenfurt')!;
    expect(needs(def, { population: 2500, satisfaction: 0.8 }).ziegel).toBeGreaterThan(0);
  });

  const site = (bricks: number): GameState => {
    const s = newGame(VALLEY, { startTown: 'kesselbrueck', money: 20000, rivals: false });
    expect(startProject(s, 'bruecke-kessel').ok).toBe(true);
    const town = siteTown(s, VALLEY, 'bruecke-kessel')!;
    s.markets[town].ziegel.stock = bricks;
    return s;
  };

  it('eine Baustelle nimmt Ziegel vom Markt der Stadt am Abschnitt', () => {
    const s = site(60);
    const town = siteTown(s, VALLEY, 'bruecke-kessel')!;
    expect(['kesselbrueck', 'muehlheim']).toContain(town);
    const before = s.markets[town].ziegel.stock;
    advance(s, VALLEY, 24);
    expect(before - s.markets[town].ziegel.stock).toBeGreaterThanOrEqual(bricksPerDay('bruecke-kessel') - 0.5);
    expect(s.works[0].brickDelay ?? 0).toBe(0);
  });

  it('ohne Ziegel ruht der Bau, aber nicht ewig', () => {
    const s = site(0);
    const town = siteTown(s, VALLEY, 'bruecke-kessel')!;
    const p = PROJECT_BY_ID.get('bruecke-kessel')!;
    const started = s.works[0].started;
    for (let d = 0; d < p.days * 3; d++) {
      s.markets[town].ziegel.stock = 0;
      tickBuildSites(s, VALLEY);
    }
    const cap = Math.ceil(p.days * BRICK_DELAY_MAX);
    expect(s.works[0].brickDelay).toBe(cap);
    expect(s.works[0].started).toBe(started + cap);
    expect(s.news.filter((n) => n.text.includes('wartet auf Ziegel')).length).toBe(1);
    advance(s, VALLEY, 24 * (p.days + cap + 1));
    expect(s.works[0].done).toBe(true);
  });

  it('eine Baustelle treibt den Ziegelpreis: die Stadt hat weniger auf Lager', () => {
    const a = newGame(VALLEY, { startTown: 'kesselbrueck', money: 20000, rivals: false, seed: 4 });
    const b = newGame(VALLEY, { startTown: 'kesselbrueck', money: 20000, rivals: false, seed: 4 });
    startProject(a, 'bruecke-kessel');
    advance(a, VALLEY, 24 * 15);
    advance(b, VALLEY, 24 * 15);
    const town = siteTown(a, VALLEY, 'bruecke-kessel')!;
    expect(a.markets[town].ziegel.stock).toBeLessThan(b.markets[town].ziegel.stock);
  });

  it('ohne Lieferungen verzögert sich die Brücke, mit Lieferungen nicht', () => {
    const run = (deliver: boolean) => {
      const s = newGame(VALLEY, { startTown: 'kesselbrueck', money: 20000, rivals: false, seed: 2 });
      startProject(s, 'bruecke-kessel');
      const town = siteTown(s, VALLEY, 'bruecke-kessel')!;
      for (let d = 0; d < 40 && !s.works[0].done; d++) {
        if (deliver) s.markets[town].ziegel.stock = Math.max(s.markets[town].ziegel.stock, 40);
        advance(s, VALLEY, 24);
      }
      return s.works[0].brickDelay ?? 0;
    };
    expect(run(false)).toBeGreaterThan(0);
    expect(run(true)).toBe(0);
  });

  it('ein Ziegelmarkt nur für die Baustelle schließt nach dem Bau', () => {
    const s = newGame(VALLEY, { startTown: 'altenfurt', money: 30000, epoch: 2, rivals: false });
    startProject(s, 'schleuse-erzbach');
    const town = siteTown(s, VALLEY, 'schleuse-erzbach')!;
    advance(s, VALLEY, 24);
    expect(s.markets[town].ziegel).toBeDefined();
    s.works[0].done = true;
    advance(s, VALLEY, 24);
    expect(s.markets[town].ziegel).toBeUndefined();
  });

  it('Ausbaggern braucht keine Ziegel', () => {
    expect(bricksPerDay('vertiefung-glas')).toBe(0);
  });
});

describe('Neue Betriebe und Waren', () => {
  it('die neuen Waren sind da und haben ein Bildzeichen', () => {
    for (const id of ['lehm', 'ziegel', 'milch', 'kaese', 'wein', 'diesel']) expect(GOODS.some((g) => g.id === id), id).toBe(true);
    for (const g of GOODS) expect(goodIcon(g.id), g.id).toMatch(/^<svg/);
    expect(iconGoods().length).toBe(GOODS.length);
  });

  it('Ziegelei und Käserei lohnen sich mehr als ihre Rohstoffbetriebe', () => {
    const b = (id: string) => BUILDINGS.find((x) => x.id === id)!;
    expect(paybackDays(b('ziegelei'))).toBeLessThan(paybackDays(b('lehmgrube')));
    expect(paybackDays(b('kaeserei'))).toBeLessThan(paybackDays(b('milchhof')));
  });

  it('alte Spielstände bekommen die neuen Märkte und einen vollen Tank', () => {
    const s = motorGame();
    delete s.markets.weidenhof.lehm;
    delete s.markets.glashuette.wein;
    s.ships[0].bunker = 0;
    delete s.dieselTanks;
    const up = upgradeState(JSON.parse(JSON.stringify(s)), VALLEY);
    expect(up.markets.weidenhof.lehm.stock).toBeGreaterThan(0);
    expect(up.markets.glashuette.wein).toBeDefined();
    expect(up.ships[0].bunker).toBe(SHIPS.motorschiff.bunker);
    // nur einmal: ein leer gefahrener Tank wird beim nächsten Laden nicht wieder gratis voll
    up.ships[0].bunker = 0;
    expect(upgradeState(JSON.parse(JSON.stringify(up)), VALLEY).ships[0].bunker).toBe(0);
  });

  it('Dampfer kaufen Kohle am Markt, beim Händler nur, wenn der Markt fehlt', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'raddampfer', money: 5000, epoch: 2, rivals: false });
    const ship = s.ships[0];
    ship.bunker = 0.5;
    // Fahrt, die fast den ganzen Bunker braucht: alles vom Markt, nichts beim Händler
    const plan = bunkerPlan(s, ship, 41.5);
    expect(plan.problem).toBeNull();
    expect(plan.dealer).toBe(0);
    expect(ship.bunker + plan.buy).toBeGreaterThanOrEqual(plan.need);
    // in Weidenhof gibt es keinen Kohlemarkt: der Händler verkauft genau das Nötige, das Schiff sitzt nicht fest
    ship.port = 'weidenhof';
    ship.bunker = 0;
    expect(s.markets.weidenhof.kohle).toBeUndefined();
    expect(departProblem(s, VALLEY, 1, 'niedermuend')).toBeNull();
    const money = s.money;
    expect(depart(s, VALLEY, 1, 'niedermuend')).not.toBeNull();
    expect(money - s.money).toBe(ship.bunker * Math.round(12 * FUEL_DEALER_FACTOR));
  });

  it('Märkte mit den neuen Waren bleiben über ein Jahr in Grenzen', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', rivals: true, seed: 7 });
    advance(s, VALLEY, 24 * 240);
    for (const t of VALLEY.towns) {
      for (const g of ['lehm', 'ziegel', 'milch', 'kaese', 'wein']) {
        const m = s.markets[t.id][g];
        if (!m) continue;
        expect(Number.isFinite(m.stock) && m.stock >= 0, `${t.id}:${g}`).toBe(true);
      }
    }
  }, 20000);
});
