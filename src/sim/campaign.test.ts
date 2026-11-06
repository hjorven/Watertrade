import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../data/campaign.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { chapterOneHint } from '../ui/tutorial.ts';
import { runChapterOne } from './balance.ts';
import { advance, buy, buyShip, depart, dismantleRaft, newGame, sell } from './game.ts';
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
