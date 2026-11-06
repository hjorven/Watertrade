import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../data/campaign.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { advance, buy, buyShip, depart, dismantleRaft, newGame, sell } from './game.ts';
import { goalDone, goalProgress } from './goals.ts';
import { deserialize, SAVE_VERSION, serialize } from './save.ts';

const k1 = CHAPTERS[0];
const start = () =>
  newGame(VALLEY, { startTown: k1.startTown, money: k1.money, startShip: k1.startShip, allowedShips: k1.allowedShips });

describe('Kapitel 1', () => {
  it('Ziele beziehen sich auf bekannte Städte und Waren', () => {
    const s = start();
    for (const g of k1.goals) expect(() => goalProgress(s, g)).not.toThrow();
  });

  it('nur erlaubte Schiffe', () => {
    const s = start();
    s.money = 5000;
    expect(buyShip(s, VALLEY, 'muehlheim', 'plaette').ok).toBe(false);
    expect(buyShip(s, VALLEY, 'muehlheim', 'treidelkahn').ok).toBe(true);
    expect(goalDone(s, k1.goals[3])).toBe(true);
  });

  it('Floß zerlegen und Getreide liefern zählen', () => {
    const s = start();
    const raft = buyShip(s, VALLEY, 'oberau', 'floss').ship!;
    const v = depart(s, VALLEY, raft.id, 'kesselbrueck')!;
    advance(s, VALLEY, v.hours);
    dismantleRaft(s, raft.id);
    expect(goalDone(s, k1.goals[1])).toBe(true);

    const kahn = s.ships[0];
    const v2 = depart(s, VALLEY, kahn.id, 'muehlheim')!;
    advance(s, VALLEY, v2.hours);
    buy(s, kahn.id, 'getreide', 30);
    const v3 = depart(s, VALLEY, kahn.id, 'oberau')!;
    advance(s, VALLEY, v3.hours);
    sell(s, kahn.id, 'getreide', 30);
    expect(goalProgress(s, k1.goals[2]).value).toBe(30);
  });
});

describe('Spielstand', () => {
  it('speichern und laden ergibt denselben Zustand', () => {
    const s = start();
    advance(s, VALLEY, 50);
    const text = serialize({ version: SAVE_VERSION, savedAt: '2026-11-06T00:00:00Z', mode: 'kampagne', chapter: 'k1', completedGoals: [0], state: s });
    const back = deserialize(text)!;
    expect(back.state).toEqual(s);
    expect(back.completedGoals).toEqual([0]);
  });

  it('kaputte oder alte Stände werden abgelehnt', () => {
    expect(deserialize('kein json')).toBeNull();
    expect(deserialize(JSON.stringify({ version: 1, state: {} }))).toBeNull();
  });
});
