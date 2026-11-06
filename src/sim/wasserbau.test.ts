import { describe, expect, it } from 'vitest';
import { HARBOR_LEVELS } from '../data/harbors.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { PROJECT_BY_ID } from '../data/projects.ts';
import { advance, buy, depart, newGame, planVoyage, upgradeState, type GameState } from './game.ts';
import { movingHours, voyagePosition } from './voyage.ts';
import {
  baseFee,
  berths,
  buildHarbor,
  chargeRival,
  dockTime,
  dredge,
  dredgeCost,
  passageFee,
  quayDepth,
  setFee,
  setUpkeep,
  SILT_PER_DAY,
  startProjectWith,
  tickWaterworks,
  upkeepCost,
} from './wasserbau.ts';
import { effectiveSegments } from './works.ts';
import { planRoute } from './voyage.ts';
import { SHIPS } from '../data/ships.ts';

const game = (opts: Partial<Parameters<typeof newGame>[1] & object> = {}): GameState =>
  newGame(VALLEY, { startTown: 'altenfurt', money: 50000, rivals: true, epoch: 2, seed: 7, ...opts });

/** Irgendeine Ware an Bord nehmen, bis `tons` erreicht sind */
const buyAny = (s: GameState, tons: number) => {
  let got = 0;
  for (const g of Object.keys(s.markets[s.ships[0].port!])) {
    if (got >= tons) break;
    const r = buy(s, 1, g, tons - got);
    if (r.ok) got += r.amount;
  }
  return got;
};

/** Bauwerk sofort fertigstellen */
const finish = (s: GameState, id: string) => {
  const w = s.works.find((x) => x.id === id)!;
  w.done = true;
  return w;
};

/** Eine KI-Fahrt über den Abschnitt planen und die Gebühr abrechnen */
const rivalPasses = (s: GameState, from: string, to: string, rivalIndex = 0) => {
  const r = s.rivals[rivalIndex];
  const type = { ...SHIPS.treidelkahn };
  const plan = planRoute(s, VALLEY, from, to, type);
  if (!plan.ok) throw new Error('keine Route');
  return chargeRival(s, r, plan.voyage, type.capacity);
};

describe('Wasserbau: Gebühren', () => {
  it('eigene Bauwerke kassieren von fremden Schiffen', () => {
    const s = game();
    expect(startProjectWith(s, VALLEY, 'bruecke-kessel').ok).toBe(true);
    const w = finish(s, 'bruecke-kessel');
    expect(w.owner).toBe('spieler');
    const fee = passageFee(w, SHIPS.treidelkahn.capacity);
    expect(fee).toBeGreaterThan(0);
    const money = s.money;
    const rival = s.rivals[0].money;
    expect(rivalPasses(s, 'kesselbrueck', 'muehlheim')).toBe(fee);
    expect(s.money).toBeCloseTo(money + fee, 5);
    expect(s.rivals[0].money).toBeCloseTo(rival - fee, 5);
    expect(w.earned).toBeCloseTo(fee, 5);
  });

  it('Gebührenstufe frei, üblich, hoch', () => {
    const s = game();
    startProjectWith(s, VALLEY, 'bruecke-kessel');
    const w = finish(s, 'bruecke-kessel');
    const normal = passageFee(w, 60);
    expect(normal).toBe(baseFee(PROJECT_BY_ID.get('bruecke-kessel')!));
    expect(setFee(s, 'bruecke-kessel', 'hoch').ok).toBe(true);
    expect(passageFee(w, 60)).toBe(normal * 2);
    setFee(s, 'bruecke-kessel', 'frei');
    expect(passageFee(w, 60)).toBe(0);
    expect(rivalPasses(s, 'kesselbrueck', 'muehlheim')).toBe(0);
  });

  it('öffentliche Bauten zu Kapitelbeginn bleiben gebührenfrei', () => {
    const s = game({ works: ['bruecke-kessel'] });
    expect(s.works[0].owner).toBeUndefined();
    expect(rivalPasses(s, 'kesselbrueck', 'muehlheim')).toBe(0);
  });

  it('der Spieler zahlt für Bauwerke eines KI-Hauses, das Haus bekommt das Geld', () => {
    const s = newGame(VALLEY, { startTown: 'kesselbrueck', money: 5000, rivals: true, epoch: 2, seed: 3 });
    const r = s.rivals[1];
    s.works.push({ id: 'bruecke-kessel', started: 1, done: true, owner: r.id, fee: 'normal' });
    const plan = planVoyage(s, VALLEY, 1, 'muehlheim');
    expect(plan?.ok).toBe(true);
    if (!plan?.ok) return;
    const fee = passageFee(s.works[0], SHIPS.treidelkahn.capacity);
    expect(plan.voyage.fees?.find((f) => f.work === 'bruecke-kessel')?.amount).toBe(fee);
    expect(plan.voyage.toll).toBe(fee);
    const money = s.money;
    const rivalMoney = r.money;
    expect(depart(s, VALLEY, 1, 'muehlheim')).not.toBeNull();
    expect(s.money).toBe(money - fee);
    expect(r.money).toBe(rivalMoney + fee);
    // das Haus selbst fährt frei
    expect(rivalPasses(s, 'kesselbrueck', 'muehlheim', 1)).toBe(0);
  });

  it('der Schmuggler spart den Zoll, aber nicht die Gebühr', () => {
    const s = newGame(VALLEY, { startTown: 'kesselbrueck', money: 5000, rivals: true, epoch: 2, seed: 3 });
    s.works.push({ id: 'bruecke-kessel', started: 1, done: true, owner: s.rivals[0].id, fee: 'normal' });
    s.ships[0].captain = { id: 1, name: 'Test', trait: 'schmuggler', wage: 5, hire: 0 };
    s.events.push({ id: 99, kind: 'zoll', from: 1, until: 30, seg: 'kessel-muehl', value: 40 });
    const plan = planVoyage(s, VALLEY, 1, 'muehlheim');
    expect(plan?.ok && plan.voyage.toll).toBe(passageFee(s.works[0], SHIPS.treidelkahn.capacity));
  });
});

describe('Wasserbau: Gemeinschaftsbau', () => {
  it('mit der Stadt: halbe Kosten, halbe Gebühr', () => {
    const s = game();
    const money = s.money;
    const r = startProjectWith(s, VALLEY, 'bruecke-kessel', 'stadt');
    expect(r.ok).toBe(true);
    expect(money - s.money).toBe(3000);
    const w = finish(s, 'bruecke-kessel');
    expect(w.partner?.kind).toBe('stadt');
    expect(w.partner?.id).toBe('kesselbrueck');
    const before = s.money;
    const fee = rivalPasses(s, 'kesselbrueck', 'muehlheim');
    expect(s.money - before).toBeCloseTo(fee / 2, 5);
  });

  it('kleine Orte am oberen Erzbach bauen nicht mit', () => {
    const s = game();
    expect(startProjectWith(s, VALLEY, 'schleuse-erzbach', 'stadt').ok).toBe(false);
  });

  it('mit einem KI-Haus: das Haus zahlt die Hälfte, teilt die Gebühren und fährt frei', () => {
    const s = game();
    s.rivals[2].money = 20000;
    const before = s.rivals[2].money;
    const r = startProjectWith(s, VALLEY, 'bruecke-kessel', 'haus');
    expect(r.ok).toBe(true);
    const w = finish(s, 'bruecke-kessel');
    expect(w.partner).toEqual({ kind: 'haus', id: s.rivals[2].id, share: 0.5 });
    expect(s.rivals[2].money).toBe(before - 3000);
    // Partner fährt frei
    expect(rivalPasses(s, 'kesselbrueck', 'muehlheim', 2)).toBe(0);
    // ein anderes Haus zahlt, Spieler und Partner teilen
    const p0 = s.money;
    const r2 = s.rivals[2].money;
    const fee = rivalPasses(s, 'kesselbrueck', 'muehlheim', 0);
    expect(fee).toBeGreaterThan(0);
    expect(s.money - p0).toBeCloseTo(fee / 2, 5);
    expect(s.rivals[2].money - r2).toBeCloseTo(fee / 2, 5);
  });

  it('ohne reiches Haus gibt es keinen Partner', () => {
    const s = game();
    for (const r of s.rivals) r.money = 100;
    expect(startProjectWith(s, VALLEY, 'bruecke-kessel', 'haus').ok).toBe(false);
  });
});

describe('Wasserbau: Verlandung und Unterhalt', () => {
  const depthOf = (s: GameState) => effectiveSegments(s, VALLEY).find((x) => x.id === 'glas-alten')!.baseDepth;

  it('ohne Pflege verlandet die Rinne, Nachbaggern macht sie wieder frei', () => {
    const s = game({ rivals: false });
    startProjectWith(s, VALLEY, 'vertiefung-glas');
    const w = finish(s, 'vertiefung-glas');
    expect(w.upkeep).toBe(true);
    const full = depthOf(s);
    expect(full).toBeCloseTo(1.3 + 0.8, 5);
    setUpkeep(s, 'vertiefung-glas', false);
    advance(s, VALLEY, 24 * 100);
    expect(w.silt).toBeGreaterThan(100 * SILT_PER_DAY * 0.95);
    expect(depthOf(s)).toBeLessThan(full - 0.25);
    const cost = dredgeCost(w);
    expect(cost).toBeGreaterThan(0);
    const money = s.money;
    expect(dredge(s, 'vertiefung-glas').ok).toBe(true);
    expect(money - s.money).toBe(cost);
    expect(w.silt).toBe(0);
    expect(depthOf(s)).toBeCloseTo(full, 5);
  });

  it('mit Pflege bleibt die Rinne tief und kostet jeden Tag', () => {
    const s = game({ rivals: false });
    startProjectWith(s, VALLEY, 'vertiefung-glas');
    const w = finish(s, 'vertiefung-glas');
    const daily = upkeepCost(w);
    expect(daily).toBe(5);
    const money = s.money;
    for (let i = 0; i < 10; i++) tickWaterworks(s, VALLEY);
    expect(money - s.money).toBe(10 * daily);
    expect(w.silt ?? 0).toBe(0);
    expect(s.ledger.works?.cost).toBe(daily);
  });

  it('Pflege hält nur den Stand, verlandeter Sand muss nachgebaggert werden', () => {
    const s = game({ rivals: false });
    startProjectWith(s, VALLEY, 'vertiefung-glas');
    const w = finish(s, 'vertiefung-glas');
    w.upkeep = false;
    w.silt = 1;
    setUpkeep(s, 'vertiefung-glas', true);
    s.hour += 24;
    tickWaterworks(s, VALLEY);
    expect(w.silt).toBe(1);
  });

  it('Hochwasser schwemmt schneller zu', () => {
    const s = game({ rivals: false });
    startProjectWith(s, VALLEY, 'vertiefung-glas');
    const w = finish(s, 'vertiefung-glas');
    setUpkeep(s, 'vertiefung-glas', false);
    tickWaterworks(s, VALLEY);
    const calm = w.silt!;
    s.events.push({ id: 98, kind: 'hochwasser', from: 1, until: 9, value: 1 });
    tickWaterworks(s, VALLEY);
    expect(w.silt! - calm).toBeCloseTo(calm * 3, 6);
  });

  it('öffentliche Rinnen verlanden nicht', () => {
    const s = game({ rivals: false, works: ['vertiefung-glas'] });
    advance(s, VALLEY, 24 * 60);
    expect(s.works[0].silt ?? 0).toBe(0);
  });
});

describe('Hafenausbau', () => {
  it('Ausbau dauert, danach schneller umschlagen, mehr Liegeplätze, tieferer Kai', () => {
    const s = game({ rivals: false });
    const slow = dockTime(s, 'weidenhof', 70, 1);
    const room = berths(s, 'weidenhof');
    const depth = quayDepth(s, 'weidenhof');
    expect(buildHarbor(s, VALLEY, 'weidenhof').ok).toBe(true);
    expect(buildHarbor(s, VALLEY, 'weidenhof').ok).toBe(false); // schon im Bau
    advance(s, VALLEY, 24 * (HARBOR_LEVELS[1].days + 1));
    expect(s.harbors?.weidenhof.level).toBe(1);
    expect(dockTime(s, 'weidenhof', 70, 1).hours).toBeLessThan(slow.hours);
    expect(berths(s, 'weidenhof')).toBe(room + 2);
    expect(depth).toBeGreaterThan(0);
    expect(quayDepth(s, 'weidenhof') - s.waterLevel).toBeCloseTo(1.9 + HARBOR_LEVELS[1].depth, 5);
  });

  it('Stufe 3 braucht die Dampfzeit', () => {
    const s = game({ rivals: false, epoch: 1 });
    s.harbors = { niedermuend: { level: 2 } };
    expect(buildHarbor(s, VALLEY, 'niedermuend').ok).toBe(false);
    s.epoch = 2;
    expect(buildHarbor(s, VALLEY, 'niedermuend').ok).toBe(true);
  });

  it('mit der Stadt halb so teuer, aber nicht in kleinen Orten', () => {
    const s = game({ rivals: false });
    const money = s.money;
    expect(buildHarbor(s, VALLEY, 'niedermuend', true).ok).toBe(true);
    expect(money - s.money).toBe(HARBOR_LEVELS[1].cost / 2);
    expect(buildHarbor(s, VALLEY, 'erzgrube', true).ok).toBe(false);
  });

  it('wer allein ausbaut, löst die Beteiligung der Stadt ab', () => {
    const s = game({ rivals: false });
    s.harbors = { niedermuend: { level: 1, partner: { kind: 'stadt', id: 'niedermuend', share: 0.5 } } };
    expect(buildHarbor(s, VALLEY, 'niedermuend').ok).toBe(true);
    expect(s.harbors.niedermuend.partner).toBeUndefined();
  });

  it('ein armes Haus zahlt höchstens, was es hat', () => {
    const s = game();
    startProjectWith(s, VALLEY, 'bruecke-kessel');
    finish(s, 'bruecke-kessel');
    s.rivals[0].money = 3;
    rivalPasses(s, 'kesselbrueck', 'muehlheim');
    expect(s.rivals[0].money).toBe(0);
  });

  it('zu tiefe Schiffe werden geleichtert: langsamer und mit Leichtergeld', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'schleppverband', money: 50000, rivals: false, epoch: 2 });
    s.waterLevel = -0.8;
    expect(buyAny(s, 100)).toBeGreaterThan(50);
    const deep = dockTime(s, 'niedermuend', 100, 1.7);
    expect(deep.lighter).toBe(true);
    const plan = planVoyage(s, VALLEY, 1, 'weidenhof');
    expect(plan?.ok && plan.voyage.fees?.some((f) => f.work === 'leichtern')).toBe(true);
    // Kaimauer mit Tiefwasser hilft
    s.harbors = { niedermuend: { level: 2 } };
    expect(dockTime(s, 'niedermuend', 100, 1.7).lighter).toBe(false);
  });

  it('volle Häfen schlagen langsamer um', () => {
    const s = game({ rivals: false, extraShips: ['treidelkahn', 'treidelkahn', 'treidelkahn', 'treidelkahn'] });
    const crowded = dockTime(s, 'altenfurt', 40, 1);
    expect(crowded.crowded).toBe(true);
    const alone = newGame(VALLEY, { startTown: 'altenfurt', money: 500, rivals: false });
    expect(dockTime(alone, 'altenfurt', 40, 1).hours).toBeLessThan(crowded.hours);
  });

  it('Liegezeit verlängert die Fahrt, kostet aber keinen Brennstoff und keinen Verschleiß', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'motorschiff', money: 50000, rivals: false, epoch: 3 });
    expect(buyAny(s, 60)).toBeGreaterThan(20);
    const v = depart(s, VALLEY, 1, 'weidenhof')!;
    expect(v.dock).toBeGreaterThan(0);
    expect(v.dockEnd).toBeGreaterThan(0);
    expect(v.hours).toBeCloseTo(v.legs.reduce((a, l) => a + l.hours, 0) + v.dock! + v.dockEnd!, 5);
    expect(movingHours(v, 0, v.dock!)).toBe(0);
    const money = s.money;
    const cond = s.ships[0].condition;
    advance(s, VALLEY, Math.min(1, v.dock!) * 0.99);
    expect(s.money).toBe(money);
    expect(s.ships[0].condition).toBe(cond);
    expect(voyagePosition(v).progress).toBe(0);
  });

  it('Liegegeld von KI-Schiffen im eigenen Hafen', () => {
    const s = game();
    s.harbors = { altenfurt: { level: 2, fee: 'normal' } };
    const money = s.money;
    for (let i = 0; i < 24 * 30; i++) advance(s, VALLEY, 1);
    expect(s.harbors.altenfurt.earned ?? 0).toBeGreaterThan(0);
    expect(s.money).not.toBe(money);
  });
});

describe('KI-Häuser bauen selbst', () => {
  it('im freien Spiel baut ein reiches Haus irgendwann und nimmt Gebühren', () => {
    const s = newGame(VALLEY, { startTown: 'altenfurt', money: 500, seed: 11 });
    s.hour += 24 * 70;
    s.epoch = 2;
    for (const r of s.rivals) r.money = 60000;
    let built = false;
    for (let i = 0; i < 400 && !built; i++) {
      s.hour += 24;
      tickWaterworks(s, VALLEY);
      built = s.works.some((w) => w.owner && w.owner !== 'spieler');
    }
    expect(built).toBe(true);
    expect(s.news.some((n) => n.kind === 'konkurrenz' && n.text.includes('Gebühr'))).toBe(true);
  });

  it('in der Kampagne (feste Epoche) bauen sie nicht', () => {
    const s = newGame(VALLEY, { startTown: 'altenfurt', money: 500, seed: 11, epoch: 2 });
    s.hour += 24 * 70;
    for (const r of s.rivals) r.money = 60000;
    for (let i = 0; i < 400; i++) {
      s.hour += 24;
      tickWaterworks(s, VALLEY);
    }
    expect(s.works.length).toBe(0);
  });
});

describe('Alte Spielstände', () => {
  it('selbst gebaute Werke gehören danach dem Spieler', () => {
    const s = game({ rivals: false });
    s.works.push({ id: 'vertiefung-glas', started: 12, done: true });
    s.works.push({ id: 'bruecke-kessel', started: 0, done: true });
    upgradeState(s, VALLEY);
    expect(s.works[0].owner).toBe('spieler');
    expect(s.works[0].upkeep).toBe(true);
    expect(s.works[1].owner).toBeUndefined();
  });
});
