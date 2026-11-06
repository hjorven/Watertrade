import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../data/campaign.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { SHIPS } from '../data/ships.ts';
import { buyShip } from './fleet.ts';
import { advance, buy, depart, newGame, planVoyage, sell, type NewGameOptions } from './game.ts';
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

  it('Dampfer kosten Kohle je Fahrstunde', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'raddampfer', money: 1000, epoch: 2, rivals: false });
    const v = depart(s, VALLEY, 1, 'muehlheim')!;
    const before = s.money;
    advance(s, VALLEY, v.hours);
    expect(before - s.money).toBeGreaterThanOrEqual(Math.floor(v.hours * 3) - 1);
  });

  it('das Kühlschiff verkauft Fisch teurer', () => {
    const a = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'kuehlschiff', money: 5000, epoch: 3, rivals: false });
    const b = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'motorschiff', money: 5000, epoch: 3, rivals: false });
    for (const s of [a, b]) {
      buy(s, 1, 'fisch', 20);
      s.ships[0].port = 'muehlheim';
    }
    expect(sell(a, 1, 'fisch', 20).taler).toBeGreaterThan(sell(b, 1, 'fisch', 20).taler * 1.15);
  });
});

describe('Wasserbau', () => {
  it('die neue Brücke lässt den Segelkahn durch', () => {
    const s = newGame(VALLEY, { startTown: 'kesselbrueck', startShip: 'segelkahn', money: 20000, rivals: false });
    s.hour = 24 * 40; // Sommer, Normalwasser
    const before = planVoyage(s, VALLEY, 1, 'muehlheim')!;
    expect(before.ok).toBe(false);
    expect(startProject(s, 'bruecke-kessel').ok).toBe(true);
    advance(s, VALLEY, 24 * 21);
    expect(effectiveSegments(s, VALLEY).find((x) => x.id === 'kessel-muehl')!.bridgeHeight).toBe(11);
    expect(planVoyage(s, VALLEY, 1, 'muehlheim')!.ok).toBe(true);
  });

  it('Schleusen braucht Epoche 2 und machen den Erzbach tief', () => {
    const s = newGame(VALLEY, { startTown: 'altenfurt', money: 20000, epoch: 1, rivals: false });
    expect(startProject(s, 'schleuse-erzbach').ok).toBe(false);
    s.epoch = 2;
    expect(startProject(s, 'schleuse-erzbach').ok).toBe(true);
    advance(s, VALLEY, 24 * 31);
    const seg = effectiveSegments(s, VALLEY).find((x) => x.id === 'grube-glas')!;
    expect(seg.baseDepth).toBeCloseTo(2, 5);
  });
});
