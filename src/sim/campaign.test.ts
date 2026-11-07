import { describe, expect, it } from 'vitest';
import { CHAPTERS, chapterForSave } from '../data/campaign.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { chapterOneHint } from '../ui/tutorial.ts';
import { runCanalChapter, runChapterOne, runSteamChapter } from './balance.ts';
import { NORTH_TOWN_IDS, ZWEI_TAELER } from '../data/maps/zwei-taeler.ts';
import { SCHEITELKANAL } from '../data/canal.ts';
import { addShip, advance, buy, buyShip, depart, dismantleRaft, fillBunker, hoursToArrival, newGame, sell } from './game.ts';
import { bunkerPlan, planVoyage, sailingHours } from './voyage.ts';
import type { Voyage } from './state.ts';
import { STEAM_MIN_HOURS, steamDays } from './steam.ts';
import { buyShares } from './rivalry.ts';
import { levelOf, needs } from './towns.ts';
import { goalProgress, restoreCompleted } from './goals.ts';
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
    expect(depart(s, VALLEY, raft.id, plan.to)).not.toBeNull();
    advance(s, VALLEY, hoursToArrival(s, raft));
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
    expect(chapterOneHint(s, VALLEY, raft, name)).toContain('<b>Ablegen</b> ab');
    expect(depart(s, VALLEY, raft.id, plan.to)).not.toBeNull();
    expect(chapterOneHint(s, VALLEY, kahn, name)).toContain('treibt');
    advance(s, VALLEY, hoursToArrival(s, raft));
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

  it('Dampfer bunkern zuerst eigene Kohle aus dem Kontor, aber nur den Bedarf der Fahrt', () => {
    const s = startK4();
    const ship = s.ships[0];
    ship.bunker = 0;
    s.kontore.niedermuend.stock.kohle = { amount: 40, cost: 480 };
    const hours = sailingHours((planVoyage(s, VALLEY, ship.id, 'muehlheim') as { voyage: Voyage }).voyage);
    const plan = bunkerPlan(s, ship, hours);
    expect(plan.fromKontor).toBe(Math.ceil(plan.need));
    const money = s.money;
    depart(s, VALLEY, ship.id, 'muehlheim');
    // der Rest bleibt für Betriebe im Kontor
    expect(s.kontore.niedermuend.stock.kohle.amount).toBe(40 - plan.fromKontor);
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
  });

describe('Kapitel 5: Kanal über den Rücken', () => {
  const k5 = CHAPTERS.find((c) => c.id === 'k5')!;

  it('spielt auf der Karte mit Kanal und endet mit der Einweihung', () => {
    expect(k5.map).toBe(ZWEI_TAELER.id);
    expect(ZWEI_TAELER.towns.some((t) => t.id === k5.startTown)).toBe(true);
    expect(SCHEITELKANAL.sites).toContain(k5.startTown);
    expect(k5.goals.map((g) => g.type)).toEqual(['canalStage', 'canalStage', 'project', 'deliver']);
    expect(k5.goals.find((g) => g.type === 'project')).toMatchObject({ id: SCHEITELKANAL.id });
    // das Startgeld reicht für die ersten beiden Abschnitte, nicht für den ganzen Kanal
    const cost = SCHEITELKANAL.stages.reduce((n, st) => n + st.cost, 0);
    expect(k5.money).toBeGreaterThan(SCHEITELKANAL.stages[0].cost + SCHEITELKANAL.stages[1].cost);
    expect(k5.money).toBeLessThan(cost);
  });

  it('alte Spielstände auf der Talkarte behalten die frühere Fassung', () => {
    expect(chapterForSave('k5', VALLEY.id!, VALLEY.id!)?.title).toBe('Die große Stadt');
    expect(chapterForSave('k5', ZWEI_TAELER.id!, VALLEY.id!)).toBe(k5);
    expect(chapterForSave('k4', VALLEY.id!, VALLEY.id!)).toBe(CHAPTERS.find((c) => c.id === 'k4'));
  });

  it('nach Nordhafen kommt man erst durch den Kanal', () => {
    const north = k5.goals.find((g) => g.type === 'deliver')!;
    expect(north.type === 'deliver' && NORTH_TOWN_IDS.includes(north.town)).toBe(true);
    const s = newGame(ZWEI_TAELER, { startTown: k5.startTown, money: k5.money, startShip: 'treidelkahn', rivals: false, epoch: k5.epoch });
    expect(planVoyage(s, ZWEI_TAELER, s.ships[0].id, 'nordhafen')?.ok ?? false).toBe(false);
    s.works.push({ id: SCHEITELKANAL.id, started: 1, done: true, owner: 'spieler', fee: 'frei' });
    expect(planVoyage(s, ZWEI_TAELER, s.ships[0].id, 'nordhafen')?.ok).toBe(true);
  });

  it('Bot: der Kanal ist im Median nach 250 bis 450 Tagen eingeweiht', () => {
    const runs = [1, 2, 3, 4].map((seed) => runCanalChapter(ZWEI_TAELER, k5, 900, seed));
    for (const r of runs) {
      expect(r.doneOn).not.toBeNull();
      // alle Abschnitte fertig, jeder frühestens nach seinen Arbeitstagen
      expect(r.stageDays).toHaveLength(SCHEITELKANAL.stages.length);
      r.stageDays.forEach((d, i) => expect(d - (r.stageDays[i - 1] ?? 0)).toBeGreaterThanOrEqual(SCHEITELKANAL.stages[i].days));
    }
    const days = runs.map((r) => r.doneOn!);
    expect(median(days)).toBeGreaterThanOrEqual(250);
    expect(median(days)).toBeLessThan(450);
  }, 120_000);
});

describe('Kapitel 6: Übernahme als Höhepunkt', () => {
  it('endet mit einer Übernahme statt nur mit Vermögenszielen', () => {
    expect(k6.goals.some((g) => g.type === 'takeover')).toBe(true);
    // "jede Stadt Marktflecken" hieße fünf Städte mehr als verdoppeln, das ist kein Kapitelziel
    expect(k6.goals.some((g) => g.type === 'allTowns')).toBe(false);
  });

  it('kein Haus lässt sich mit dem Startgeld allein übernehmen', () => {
    const s = startK6();
    for (const r of s.rivals) {
      const before = s.money;
      let done = false;
      for (let i = 0; i < 6 && !done; i++) {
        const res = buyShares(s, VALLEY, r.id);
        if (!res.ok) break;
        done = res.message.includes('gehört dir');
      }
      expect(done, r.id).toBe(false);
      s.money = before; // nächster Versuch mit vollem Startgeld (Anteile bleiben, macht es nur leichter)
    }
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

describe('Spielstände nach der Überarbeitung', () => {
  it('alte Nummern haken nur Ziele ab, die jetzt wirklich erfüllt sind', () => {
    const s = startK1();
    // alter Stand: Ziele 0 bis 4 erledigt, Nummer 4 heißt jetzt "vier Flöße"
    const done = restoreCompleted(s, k1.goals, [0, 1, 2, 3, 4]);
    expect(done.size).toBe(0);
  });

  it('neue Stände ordnen über den Zieltext zu', () => {
    const s = startK1();
    const texts = [k1.goals[2].text, k1.goals[5].text];
    expect([...restoreCompleted(s, k1.goals, [9, 9], texts)].sort()).toEqual([2, 5]);
  });
});
