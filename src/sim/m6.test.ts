import { describe, expect, it } from 'vitest';
import { CHALLENGES, DAILY_DAYS, DAILY_TOWNS, dailySetup } from '../data/challenges.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { ACHIEVEMENTS, newAchievements } from './achievements.ts';
import { advance, newGame } from './game.ts';
import { goalDone } from './goals.ts';
import { deserialize, serialize, SAVE_VERSION } from './save.ts';

describe('Herausforderungen', () => {
  it('starten mit Zeitlimit und noch offenen Zielen', () => {
    for (const c of CHALLENGES) {
      const s = newGame(VALLEY, {
        startTown: c.startTown,
        money: c.money,
        startShip: c.startShip,
        allowedShips: c.allowedShips,
        rivals: c.rivals ?? false,
        seed: 7,
        epoch: c.epoch ?? 1,
        startYear: c.startYear,
      });
      expect(c.deadlineDays, c.id).toBeGreaterThan(0);
      expect(s.ships.length, c.id).toBe(1);
      expect(c.goals.some((g) => !goalDone(s, g)), c.id).toBe(true);
    }
  });

  it('haben eindeutige Ids, getrennt von den Kapiteln', () => {
    const ids = CHALLENGES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('h-'))).toBe(true);
  });
});

describe('Tagesmarkt', () => {
  it('ist für denselben Startwert für alle gleich', () => {
    const seed = 123456789;
    const a = dailySetup(seed);
    expect(dailySetup(seed)).toEqual(a);
    expect(DAILY_TOWNS).toContain(a.startTown);
    const g1 = newGame(VALLEY, { ...a, seed, rivals: true });
    const g2 = newGame(VALLEY, { ...a, seed, rivals: true });
    advance(g1, VALLEY, 24 * 20);
    advance(g2, VALLEY, 24 * 20);
    expect(JSON.stringify(g1.markets)).toBe(JSON.stringify(g2.markets));
    expect(JSON.stringify(g1.rivals)).toBe(JSON.stringify(g2.rivals));
  });

  it('unterscheidet sich von Tag zu Tag', () => {
    const setups = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => JSON.stringify(dailySetup(n * 9973))));
    expect(setups.size).toBeGreaterThan(1);
    expect(DAILY_DAYS).toBeGreaterThan(0);
  });

  it('Spielstand mit Tagesmarkt-Feldern übersteht Speichern und Laden', () => {
    const state = newGame(VALLEY, 'oberau');
    const text = serialize({
      version: SAVE_VERSION,
      savedAt: '2026-11-06T00:00:00Z',
      mode: 'tagesmarkt',
      completedGoals: [],
      startHour: state.hour,
      dailyDay: '2026-11-06',
      state,
    });
    const back = deserialize(text)!;
    expect(back.mode).toBe('tagesmarkt');
    expect(back.dailyDay).toBe('2026-11-06');
    expect(back.startHour).toBe(state.hour);
  });
});

describe('Erfolge', () => {
  it('sind am Anfang nicht erreicht und melden sich einmal', () => {
    const s = newGame(VALLEY, 'oberau');
    expect(newAchievements(s, {})).toEqual([]);
    s.money = 20000;
    s.firstProfitDone = true;
    const got = newAchievements(s, {}).map((a) => a.id);
    expect(got).toContain('reich10k');
    expect(got).toContain('gewinn');
    const have = Object.fromEntries(got.map((id) => [id, 'x']));
    expect(newAchievements(s, have)).toEqual([]);
  });

  it('haben eindeutige Ids', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
