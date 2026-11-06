import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../data/campaign.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { chapterOneHint } from '../ui/tutorial.ts';
import { runChapterOne, runSteamChapter } from './balance.ts';
import { addShip, advance, buy, buyShip, depart, dismantleRaft, fillBunker, newGame, sell } from './game.ts';
import { bunkerPlan, planVoyage } from './voyage.ts';
import { STEAM_MIN_HOURS, steamDays } from './steam.ts';
import { buyShares } from './rivalry.ts';
import { levelOf, needs } from './towns.ts';
import { goalProgress } from './goals.ts';
import { bestRaftPlan } from './rafting.ts';

const k1 = CHAPTERS.find((c) => c.id === 'k1')!;
const startK1 = () => newGame(VALLEY, { startTown: k1.startTown, money: k1.money, startShip: k1.startShip, allowedShips: k1.allowedShips, rivals: false });
const name = (id: string) => VALLEY.towns.find((t) => t.id === id)!.name;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('Kapitel 1: Floßbau', () => {
  it('beginnt mit dem Floß und lehrt danach die Fahrt bergwärts', () => {
    expect(k1.goals[0]).toMatchObject({ type: 'ships', shipType: 'floss' });
    const order = k1.goals.map((g) => g.type);
    expect(order.indexOf('rafts')).toBeLessThan(order.indexOf('deliver'));
    // "Oberau wird Marktflecken" ist im ersten Kapitel nicht zu schaffen (über 100 Tage Vollversorgung)
    expect(order).not.toContain('townLevel');
  });

  it('das Floß lohnt sich mit der richtigen Ladung', () => {
    const s = startK1();
    const raft = buyShip(s, VALLEY, 'oberau', 'floss').ship!;
    s.money = 1000; // genug für volle Ladung
    const plan = bestRaftPlan(s, VALLEY, raft)!;
    expect(plan.good).not.toBeNull();
    const before = s.money;
    buy(s, raft.id, plan.good!, plan.amount);
    const v = depart(s, VALLEY, raft.id, plan.to)!;
    advance(s, VALLEY, v.hours);
    sell(s, raft.id, plan.good!, Infinity);
    dismantleRaft(s, raft.id);
    // Ladung und Floßholz bringen deutlich mehr als Holz und Lohn fürs Floß gekostet haben (rund 160 Taler)
    expect(s.money - before).toBeGreaterThan(200);
  });

  it('die Hinweise führen Schritt für Schritt durch die erste Floßfahrt', () => {
    const s = startK1();
    const kahn = s.ships[0];
    expect(chapterOneHint(s, VALLEY, kahn, name)).toContain('Floß');
    const raft = buyShip(s, VALLEY, 'oberau', 'floss').ship!;
    expect(chapterOneHint(s, VALLEY, kahn, name)).toContain('Wähl es oben in der Flotte');
    const plan = bestRaftPlan(s, VALLEY, raft)!;
    const loadHint = chapterOneHint(s, VALLEY, raft, name)!;
    expect(loadHint).toContain('Markt');
    expect(loadHint).toContain(name(plan.to));
    if (plan.good) buy(s, raft.id, plan.good, plan.amount);
    expect(chapterOneHint(s, VALLEY, raft, name)).toContain('Leg ab');
    const v = depart(s, VALLEY, raft.id, plan.to)!;
    expect(chapterOneHint(s, VALLEY, kahn, name)).toContain('treibt');
    advance(s, VALLEY, v.hours);
    if (plan.good) {
      expect(chapterOneHint(s, VALLEY, raft, name)).toContain('Verkaufen');
      sell(s, raft.id, plan.good, Infinity);
    }
    expect(chapterOneHint(s, VALLEY, raft, name)).toContain('Floß zerlegen');
    dismantleRaft(s, raft.id);
    // danach geht es bergwärts
    expect(chapterOneHint(s, VALLEY, kahn, name)).toContain('Getreide');
    s.stats.delivered.oberau = { getreide: 60 };
    expect(chapterOneHint(s, VALLEY, kahn, name)).toContain('versorgt');
  });

  it('kein Hinweis schickt Ware in eine Stadt, die sie nicht handelt', () => {
    const s = startK1();
    s.money = 5000;
    const kahn = s.ships[0];
    s.stats.rafts = 1;
    for (const town of ['muehlheim', 'niedermuend', 'kesselbrueck']) {
      kahn.port = town;
      const hint = chapterOneHint(s, VALLEY, kahn, name) ?? '';
      for (const t of VALLEY.towns) {
        if (!hint.includes(`<b>${t.name}</b>`) || !hint.includes('Getreide') || t.id === 'oberau') continue;
        expect(s.markets[t.id].getreide, `${t.name} im Hinweis aus ${town}`).toBeDefined();
      }
    }
  });

  it('Versorgung zählt als Ziel mit Fortschritt', () => {
    const s = startK1();
    const g = k1.goals.find((x) => x.type === 'supply')!;
    const p = goalProgress(s, g);
    expect(p.value).toBeLessThan(p.target);
    expect(p.value).toBeGreaterThan(50);
  });

  it('Bot: Kapitel 1 ist im Median nach 20 bis 120 Tagen geschafft', () => {
    const days = [1, 2, 3, 4, 5].map((seed) => runChapterOne(VALLEY, k1, 300, seed).doneOn ?? Infinity);
    const m = median(days);
    expect(m).toBeGreaterThanOrEqual(20);
    expect(m).toBeLessThanOrEqual(120);
  });
});

const k4 = CHAPTERS.find((c) => c.id === 'k4')!;
const startK4 = () =>
  newGame(VALLEY, { startTown: k4.startTown, money: k4.money, startShip: 'raddampfer', rivals: false, epoch: 2, startYear: 6, kontore: ['niedermuend'], works: k4.works });

describe('Kapitel 4: Dampfer mit Kohle versorgen', () => {
  it('ein Dampfer auf langer Fahrt bringt Dampfertage, kurze Hafentage nicht', () => {
    const s = startK4();
    const ship = s.ships[0];
    advance(s, VALLEY, 48);
    expect(steamDays(s)).toBe(0);
    const v = depart(s, VALLEY, ship.id, 'muehlheim')!;
    expect(v.hours).toBeGreaterThan(STEAM_MIN_HOURS);
    advance(s, VALLEY, v.hours + 24);
    expect(steamDays(s)).toBeGreaterThanOrEqual(1);
    expect(steamDays(s)).toBeLessThanOrEqual(Math.ceil(v.hours / 24) + 1);
  });

  it('Kahn und Plätte zählen nicht', () => {
    const s = startK4();
    const kahn = addShip(s, 'treidelkahn', 'niedermuend');
    const v = depart(s, VALLEY, kahn.id, 'weidenhof')!;
    advance(s, VALLEY, v.hours + 24);
    expect(steamDays(s)).toBe(0);
  });

  it('Dampfer bunkern zuerst eigene Kohle aus dem Kontor', () => {
    const s = startK4();
    const ship = s.ships[0];
    ship.bunker = 0;
    s.kontore.niedermuend.stock.kohle = { amount: 10, cost: 120 };
    const hours = (planVoyage(s, VALLEY, ship.id, 'muehlheim') as { voyage: { hours: number } }).voyage.hours;
    const plan = bunkerPlan(s, ship, hours);
    expect(plan.fromKontor).toBe(10);
    const money = s.money;
    const marketBefore = s.markets.niedermuend.kohle.stock;
    depart(s, VALLEY, ship.id, 'muehlheim');
    expect(s.kontore.niedermuend.stock.kohle).toBeUndefined();
    // der Rest kam vom Markt
    expect(s.markets.niedermuend.kohle.stock).toBeCloseTo(marketBefore - plan.buy);
    expect(money - s.money).toBe(plan.cost);
  });

  it('ohne Markt reicht Kontorkohle zum Ablegen', () => {
    const s = startK4();
    const ship = s.ships[0];
    ship.port = 'muehlheim';
    ship.bunker = 0;
    s.kontore.muehlheim = { level: 1, stock: { kohle: { amount: 25, cost: 300 } } };
    expect(s.markets.muehlheim.kohle).toBeUndefined();
    const r = fillBunker(s, ship.id);
    expect(r.ok).toBe(true);
    expect(ship.bunker).toBe(25);
    expect(r.taler).toBe(0);
    expect(depart(s, VALLEY, ship.id, 'niedermuend')).not.toBeNull();
  });

  it('die Kapitelziele fragen Dampfer, Schleuse, Dampfertage und Vermögen ab', () => {
    expect(k4.goals.map((g) => g.type)).toEqual(['ships', 'project', 'steamDays', 'worth']);
    expect(k4.goals.some((g) => g.type === 'deliver')).toBe(false);
  });

  it('Bot: Kapitel 4 ist im Median in unter 400 Tagen geschafft, die Dampfertage nicht vor dem 150. Tag', () => {
    const runs = [1, 2, 5].map((seed) => runSteamChapter(VALLEY, k4, 400, seed));
    const steam = runs.map((r) => r.goalDays[2] ?? Infinity);
    expect(median(steam)).toBeGreaterThanOrEqual(150);
    expect(median(runs.map((r) => r.doneOn ?? Infinity))).toBeLessThan(400);
  }, 60000);
});

const k6 = CHAPTERS.find((c) => c.id === 'k6')!;
const startK6 = () =>
  newGame(VALLEY, {
    startTown: k6.startTown,
    money: k6.money,
    startShip: k6.startShip,
    extraShips: k6.extraShips,
    allowedShips: k6.allowedShips,
    rivals: true,
    epoch: k6.epoch,
    startYear: k6.startYear,
    kontore: k6.kontore,
    works: k6.works,
    weakHouse: k6.weakHouse,
  });

describe('Kapitel 6: Übernahme als Höhepunkt', () => {
  it('endet mit einer Übernahme statt nur mit Vermögenszielen', () => {
    expect(k6.goals.some((g) => g.type === 'takeover')).toBe(true);
    expect(k6.weakHouse).toBeDefined();
    // "jede Stadt Marktflecken" hieße fünf Städte mehr als verdoppeln, das ist kein Kapitelziel
    expect(k6.goals.some((g) => g.type === 'allTowns')).toBe(false);
  });

  it('das geschwächte Haus ist mit Startgeld und etwas Handel zu übernehmen, kein Geschenk', () => {
    const s = startK6();
    s.money = k6.money * 2;
    const house = k6.weakHouse!;
    let spent = 0;
    for (let i = 0; i < 6; i++) {
      const r = buyShares(s, VALLEY, house);
      if (!r.ok) break;
      spent += r.taler;
    }
    expect(goalProgress(s, k6.goals.find((g) => g.type === 'takeover')!).value).toBe(1);
    expect(spent).toBeGreaterThan(3000);
    expect(spent).toBeLessThan(k6.money * 2);
  });

  it('Mühlheim wird bei guter Versorgung in einem halben Jahr Marktflecken', () => {
    const s = startK6();
    const def = VALLEY.towns.find((t) => t.id === 'muehlheim')!;
    let d = 0;
    for (; d < 180 && levelOf(s.towns.muehlheim.population) < 1; d++) {
      for (const g of Object.keys(needs(def, s.towns.muehlheim))) {
        const m = s.markets.muehlheim[g];
        m.stock = Math.max(m.stock, m.target * 0.95);
      }
      advance(s, VALLEY, 24);
    }
    expect(d).toBeLessThan(180);
    expect(d).toBeGreaterThan(10);
  });
});
