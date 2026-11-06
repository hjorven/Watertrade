import { describe, expect, it } from 'vitest';
import { BUILDING_BY_ID, BUILDINGS } from '../data/buildings.ts';
import { CHAPTERS, type Chapter } from '../data/campaign.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { EPOCHS, SHIPS } from '../data/ships.ts';
import {
  dailyMargin,
  K2_MIN_DAYS,
  paybackDays,
  RAW_PAYBACK_MIN_DAYS,
  RIVAL_MAX_WORTH_2Y,
  rivalPeak,
  runGrowth,
} from './balance.ts';
import { waterLevel, YEAR_DAYS } from './calendar.ts';
import { price } from './economy.ts';
import { marketDepth } from './towns.ts';
import { advance, buyShip, depart, dismantleRaft, hoursToArrival, newGame } from './game.ts';
import { blockReason, type ShipType } from './river.ts';
import { TIGHT_DEPTH, WEAR_PER_HOUR, wearFactor } from './voyage.ts';

const b = (id: string) => BUILDING_BY_ID.get(id)!;

describe('Balance: Betriebe', () => {
  it(`kein Rohstoffbetrieb zahlt sich zum Grundpreis in unter ${RAW_PAYBACK_MIN_DAYS} Tagen ab`, () => {
    for (const x of BUILDINGS.filter((x) => x.rawFrom)) expect(paybackDays(x), x.name).toBeGreaterThanOrEqual(RAW_PAYBACK_MIN_DAYS);
  });

  it('jeder Verarbeiter zahlt sich schneller ab als der schnellste Rohstoffbetrieb', () => {
    const fastestRaw = Math.min(...BUILDINGS.filter((x) => x.rawFrom).map((x) => paybackDays(x)));
    for (const x of BUILDINGS.filter((x) => !x.rawFrom)) expect(paybackDays(x), x.name).toBeLessThan(fastestRaw);
  });

  it('längere Ketten schöpfen mehr Wert: die Endstufe bringt mehr als die Vorstufe', () => {
    expect(dailyMargin(b('tischlerei'))).toBeGreaterThan(dailyMargin(b('saegewerk')));
    expect(dailyMargin(b('baeckerei'))).toBeGreaterThan(dailyMargin(b('muehle')));
    expect(dailyMargin(b('apotheke'))).toBeGreaterThan(dailyMargin(b('glashuette')));
    // Werkzeug und Arznei sind die Belohnung für die schwierigen Ketten
    const best = Math.max(...BUILDINGS.map((x) => dailyMargin(x)));
    expect(dailyMargin(b('schmiede'))).toBe(best);
  });

  it('Betriebe kosten Unterhalt, auch wenn sie ruhen', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', money: 5000, rivals: false, kontore: ['oberau'] });
    s.betriebe.push({ id: 99, type: 'holzfaeller', town: 'oberau', active: false, lastShare: 0 });
    const money = s.money;
    advance(s, VALLEY, 24);
    expect(s.ledger.upkeep).toBeGreaterThan(5); // Kontor plus Betrieb
    expect(s.money).toBeLessThan(money);
  });
});

describe('Balance: Bot-Ziele', () => {
  it(`Kapitel 2: das Vermögensziel braucht im Median mindestens ${K2_MIN_DAYS} Tage`, () => {
    const k2 = CHAPTERS[1];
    const goal = k2.goals.find((g) => g.type === 'worth')!;
    if (goal.type !== 'worth') throw new Error('Kapitel 2 ohne Vermögensziel');
    const days = [1, 2, 3, 4, 5, 6, 7].map((seed) => runGrowth(VALLEY, k2, goal.amount, 400, { build: true, seed }).reachedOn ?? Infinity);
    days.sort((a, c) => a - c);
    expect(days[3]).toBeGreaterThanOrEqual(K2_MIN_DAYS);
    // erreichbar bleibt es trotzdem
    expect(days[6]).toBeLessThan(400);
  }, 30000);

  it('kein Haus der Konkurrenz wird im freien Spiel in zwei Jahren übermächtig', () => {
    expect(rivalPeak(VALLEY, 240).worth).toBeLessThan(RIVAL_MAX_WORTH_2Y);
  }, 30000);
});

describe('Balance: Schiffe', () => {
  it('ein Floß wird aus 20 t Holz gezimmert und gibt sie am Ziel zurück', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', money: 1000, rivals: false });
    const wood = s.markets.oberau.holz.stock;
    const r = buyShip(s, VALLEY, 'oberau', 'floss');
    expect(r.ok).toBe(true);
    expect(wood - s.markets.oberau.holz.stock).toBe(SHIPS.floss.timber);
    expect(1000 - s.money).toBeGreaterThan(SHIPS.floss.price); // Lohn und Holz
    const v = depart(s, VALLEY, r.ship!.id, 'niedermuend')!;
    expect(v.hours).toBeGreaterThan(0);
    advance(s, VALLEY, hoursToArrival(s, r.ship!));
    const before = s.markets.niedermuend.holz.stock;
    expect(dismantleRaft(s, r.ship!.id).amount).toBe(SHIPS.floss.timber);
    expect(s.markets.niedermuend.holz.stock - before).toBe(SHIPS.floss.timber);
  });

  it('ohne Holz kein Floß', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', money: 1000, rivals: false });
    s.markets.oberau.holz.stock = 5;
    expect(buyShip(s, VALLEY, 'oberau', 'floss').ok).toBe(false);
  });

  it('Floß nimmt das Holz zuerst aus dem eigenen Kontor', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', money: 1000, rivals: false, kontore: ['oberau'] });
    s.kontore.oberau.stock.holz = { amount: 30, cost: 150 };
    const market = s.markets.oberau.holz.stock;
    expect(buyShip(s, VALLEY, 'oberau', 'floss').ok).toBe(true);
    expect(s.kontore.oberau.stock.holz.amount).toBe(10);
    expect(s.markets.oberau.holz.stock).toBe(market);
    expect(s.money).toBe(1000 - SHIPS.floss.price);
  });

  it('Verschleiß: rund 400 Fahrstunden bis zum Wrack, knappe Tiefe verdoppelt ihn', () => {
    expect(1 / WEAR_PER_HOUR).toBe(400);
    const s = newGame(VALLEY, { startTown: 'oberau', startShip: 'treidelkahn', money: 1000, rivals: false });
    const ship = s.ships[0];
    ship.voyage = { from: 'oberau', to: 'kesselbrueck', legs: [{ seg: 'oberau-kessel', from: 'oberau', to: 'kesselbrueck', hours: 10, downstream: true }], hours: 10, elapsed: 0 };
    ship.port = null;
    s.waterLevel = 0;
    expect(wearFactor(s, VALLEY, ship)).toBe(1);
    // 1,8 m Tiefe, der leere Kahn geht 0,6 m tief: knapp darüber schleift er
    s.waterLevel = -(1.8 - 0.6 - TIGHT_DEPTH / 2);
    expect(wearFactor(s, VALLEY, ship)).toBe(2);
  });
});

describe('Balance: Dampf und Motor', () => {
  /** Gewinn in 120 Tagen reinem Handel ab Niedermünd mit nur diesem Schiff (Vermögen am Ende minus Anfang) */
  const gain = (ship: string, seed: number) => {
    const chapter = { startTown: 'niedermuend', money: 3000, startShip: ship, epoch: 3, rivals: false, goals: [] } as unknown as Chapter;
    const start = 3000 + SHIPS[ship].price * 0.7;
    return runGrowth(VALLEY, chapter, Infinity, 120, { seed }).worth - start;
  };

  it('eiserne Rümpfe verschleißen langsamer als Holz', () => {
    for (const id of ['raddampfer', 'schleppverband', 'motorschiff', 'kuehlschiff']) expect(SHIPS[id].wear, id).toBeLessThan(1);
    expect(SHIPS.treidelkahn.wear ?? 1).toBe(1);
  });

  it('Raddampfer und Motorschiff verdienen mehr als Brennstoff und Werft kosten', () => {
    for (const seed of [1, 2]) {
      const kahn = gain('treidelkahn', seed);
      // der Markt bremst jedes Schiff gleich, schneller ist ein Dampfer deshalb nicht reicher; aber er muss sich lohnen
      expect(gain('raddampfer', seed), `Raddampfer, Seed ${seed}`).toBeGreaterThan(kahn * 0.5);
      expect(gain('motorschiff', seed), `Motorschiff, Seed ${seed}`).toBeGreaterThan(kahn * 0.5);
    }
  }, 60000);
});

describe('Balance: tiefere Märkte in späteren Epochen', () => {
  it('Dampf- und Motorzeit haben tiefere Märkte bei gleichen Preisen', () => {
    expect(marketDepth(1)).toBe(1);
    expect(marketDepth(2)).toBeGreaterThan(1);
    expect(marketDepth(3)).toBeGreaterThan(marketDepth(2));
    const a = newGame(VALLEY, { startTown: 'niedermuend', epoch: 1, rivals: false });
    const c = newGame(VALLEY, { startTown: 'niedermuend', epoch: 3, rivals: false });
    const m1 = a.markets.niedermuend.getreide;
    const m3 = c.markets.niedermuend.getreide;
    expect(m3.target).toBe(Math.round(m1.target * marketDepth(3)));
    expect(price(10, m3.stock, m3.target)).toBe(price(10, m1.stock, m1.target));
  });

  it('beim Epochenwechsel wachsen die Lager mit, die Preise springen nicht', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', rivals: false });
    // kurz vor Beginn der Dampfzeit
    s.hour = ((EPOCHS[1].from - 1) * YEAR_DAYS - 1) * 24 + 8;
    expect(s.epoch).toBe(1);
    const m = s.markets.niedermuend.getreide;
    const before = price(10, m.stock, m.target);
    advance(s, VALLEY, 48);
    expect(s.epoch).toBe(2);
    expect(m.target).toBeGreaterThan(VALLEY.towns.find((t) => t.id === 'niedermuend')!.target);
    expect(Math.abs(price(10, m.stock, m.target) - before)).toBeLessThanOrEqual(2);
  });
});

describe('Balance: Erzbach im Sommer', () => {
  const grube = VALLEY.segments.find((x) => x.id === 'grube-glas')!;
  const plaette = (load: number): ShipType => ({ ...SHIPS.plaette, draft: SHIPS.plaette.draft * (0.6 + 0.4 * load) });
  /** Tage im Sommer, an denen eine halb beladene Plätte von der Erzgrube talwärts kommt */
  const summerDays = (seg = grube) => {
    let n = 0;
    for (let d = 31; d <= 60; d++) if (!blockReason(seg, plaette(0.5), true, waterLevel(d))) n++;
    return n;
  };

  it('Niedrigwasser fällt am Erzbach nur halb so stark', () => {
    expect(grube.lowWater).toBe(0.5);
    const before = summerDays({ ...grube, lowWater: undefined });
    const after = summerDays();
    // vorher 12, jetzt 18 von 30 Sommertagen; in der größten Dürre bleibt der Bach zu (Anreiz für die Schleuse)
    expect(after).toBeGreaterThanOrEqual(before + 5);
    expect(after).toBeLessThan(30);
  });
});
