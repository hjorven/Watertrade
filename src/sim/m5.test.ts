import { FUEL_DEALER_FACTOR } from './voyage.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../data/campaign.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { PERISH, SHIPS } from '../data/ships.ts';
import { buyShip } from './fleet.ts';
import { advance, buy, depart, departProblem, fillBunker, hoursToArrival, newGame, planVoyage, sell, type NewGameOptions } from './game.ts';
import { needsMastDown } from './river.ts';
import { goalProgress } from './goals.ts';
import { effectiveSegments, startProject } from './works.ts';

const chapterGame = (i: number) => {
  const c = CHAPTERS[i];
  const opts: NewGameOptions = {
    startTown: c.startTown,
    money: c.money,
    startShip: c.startShip,
    allowedShips: c.allowedShips,
    rivals: c.rivals ?? false,
    epoch: c.epoch ?? 1,
    startYear: c.startYear,
    extraShips: c.extraShips,
    kontore: c.kontore,
    works: c.works,
    seed: 5,
  };
  return newGame(VALLEY, opts);
};

describe('Kampagne', () => {
  it('sechs Kapitel mit gültigen Zielen und Startschiffen', () => {
    expect(CHAPTERS.length).toBe(6);
    CHAPTERS.forEach((c, i) => {
      const s = chapterGame(i);
      for (const g of c.goals) {
        const p = goalProgress(s, g);
        expect(Number.isFinite(p.value)).toBe(true);
        // kein Ziel ist zu Beginn schon erfüllt
        expect(p.value >= p.target, `${c.id}: ${g.text}`).toBe(false);
      }
      expect(s.ships.every((x) => SHIPS[x.type].epoch <= s.epoch)).toBe(true);
    });
  });

  it('jedes Kapitel lässt sich ein Jahr lang ohne Fehler spielen', () => {
    CHAPTERS.forEach((_, i) => {
      const s = chapterGame(i);
      for (let d = 0; d < 120; d++) advance(s, VALLEY, 24);
      expect(Number.isFinite(s.money)).toBe(true);
    });
  });
});

describe('Epochen', () => {
  it('im freien Spiel kommen mit den Jahren Dampfer und Motorschiffe', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', money: 50000, rivals: false });
    expect(buyShip(s, VALLEY, 'niedermuend', 'raddampfer').ok).toBe(false);
    s.hour = 120 * 24 * 4 - 12; // kurz vor Jahr 5
    const ev = advance(s, VALLEY, 24);
    expect(ev.some((e) => e.type === 'epoch')).toBe(true);
    expect(s.epoch).toBe(2);
    expect(buyShip(s, VALLEY, 'niedermuend', 'raddampfer').ok).toBe(true);
    expect(buyShip(s, VALLEY, 'niedermuend', 'motorschiff').ok).toBe(false);
  });

  it('Dampfer verbrennen Kohle aus dem Bunker und kaufen beim Ablegen nach', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'raddampfer', money: 1000, epoch: 2, rivals: false });
    const ship = s.ships[0];
    expect(ship.bunker).toBe(SHIPS.raddampfer.bunker);
    const v = depart(s, VALLEY, 1, 'muehlheim')!;
    advance(s, VALLEY, hoursToArrival(s, ship));
    expect(ship.port).toBe('muehlheim');
    expect(ship.bunker).toBeCloseTo(SHIPS.raddampfer.bunker! - v.hours * SHIPS.raddampfer.coal!, 3);
    // in Mühlheim gibt es keinen Kohlemarkt: mit leerem Bunker hilft der Händler zum Aufpreis, nur so viel wie nötig
    ship.bunker = 0;
    expect(departProblem(s, VALLEY, 1, 'niedermuend')).toBeNull();
    const before = s.money;
    expect(depart(s, VALLEY, 1, 'niedermuend')).not.toBeNull();
    expect(before - s.money).toBe(ship.bunker * Math.round(GOOD_BY_ID.get('kohle')!.base * FUEL_DEALER_FACTOR));
    ship.voyage = null;
    // in Niedermünd wird die fehlende Kohle beim Ablegen gekauft
    ship.port = 'niedermuend';
    const coal = s.markets.niedermuend.kohle.stock;
    const money = s.money;
    const v2 = depart(s, VALLEY, 1, 'muehlheim')!;
    expect(v2).not.toBeNull();
    expect(s.markets.niedermuend.kohle.stock).toBeLessThan(coal);
    expect(s.money).toBeLessThan(money);
    expect(s.fuelToday).toBeGreaterThan(0);
  });

  it('Bunker füllen kauft Kohle bis zur Grenze', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'raddampfer', money: 2000, epoch: 2, rivals: false });
    s.ships[0].bunker = 5;
    const r = fillBunker(s, 1);
    expect(r.ok).toBe(true);
    expect(s.ships[0].bunker).toBe(SHIPS.raddampfer.bunker);
  });

  it('das Kühlschiff verkauft frischen Fisch teurer', () => {
    const a = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'kuehlschiff', money: 5000, epoch: 3, rivals: false });
    const b = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'motorschiff', money: 5000, epoch: 3, rivals: false });
    for (const s of [a, b]) {
      buy(s, 1, 'fisch', 20);
      s.ships[0].port = 'muehlheim';
    }
    expect(sell(a, 1, 'fisch', 20).taler).toBeGreaterThan(sell(b, 1, 'fisch', 20).taler * 1.05);
  });

  it('Fisch verdirbt unterwegs, im Kühlschiff nicht', () => {
    const a = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'kuehlschiff', money: 5000, epoch: 3, rivals: false });
    const b = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'motorschiff', money: 5000, epoch: 3, rivals: false });
    for (const s of [a, b]) {
      buy(s, 1, 'fisch', 20);
      s.ships[0].voyage = { from: 'niedermuend', to: 'oberau', legs: [{ seg: 'weiden-nieder', from: 'niedermuend', to: 'weidenhof', hours: 48, downstream: false }], hours: 48, elapsed: 0 };
      s.ships[0].port = null;
      advance(s, VALLEY, 48);
    }
    expect(a.ships[0].cargo.fisch.fresh).toBe(1);
    expect(b.ships[0].cargo.fisch.fresh).toBeCloseTo(1 - 2 * PERISH.fisch, 3);
  });
});

describe('Wasserbau', () => {
  it('die neue Brücke lässt den Segelkahn durch', () => {
    const s = newGame(VALLEY, { startTown: 'kesselbrueck', startShip: 'segelkahn', money: 20000, rivals: false });
    s.hour = 24 * 40; // Sommer, Normalwasser
    const seg = () => effectiveSegments(s, VALLEY).find((x) => x.id === 'kessel-muehl')!;
    // vorher passt der Kahn nur mit gelegtem Mast durch
    expect(planVoyage(s, VALLEY, 1, 'muehlheim')!.ok).toBe(true);
    expect(needsMastDown(seg(), SHIPS.segelkahn, s.waterLevel)).toBe(true);
    expect(startProject(s, 'bruecke-kessel').ok).toBe(true);
    advance(s, VALLEY, 24 * 31); // 20 Bautage, dazu höchstens 10 Tage Wartezeit auf Ziegel
    expect(seg().bridgeHeight).toBe(11);
    expect(needsMastDown(seg(), SHIPS.segelkahn, s.waterLevel)).toBe(false);
  });

  it('Schleusen braucht Epoche 2 und machen den Erzbach tief', () => {
    const s = newGame(VALLEY, { startTown: 'altenfurt', money: 20000, epoch: 1, rivals: false });
    expect(startProject(s, 'schleuse-erzbach').ok).toBe(false);
    s.epoch = 2;
    expect(startProject(s, 'schleuse-erzbach').ok).toBe(true);
    advance(s, VALLEY, 24 * 46); // 30 Bautage, dazu höchstens 15 Tage Wartezeit auf Ziegel
    const seg = effectiveSegments(s, VALLEY).find((x) => x.id === 'grube-glas')!;
    expect(seg.baseDepth).toBeCloseTo(2, 5);
  });
});
