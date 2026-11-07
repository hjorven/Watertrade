import { describe, expect, it } from 'vitest';
import { CHALLENGES } from '../data/challenges.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { PROJECT_BY_ID } from '../data/projects.ts';
import { SHIPS } from '../data/ships.ts';
import { challengeGame } from './challenge.ts';
import { BOT_STRATEGY as STRATEGY, playChallenge } from './challenge-bot.ts';
import { advance, buy, buyShip, day, sell } from './game.ts';
import { goalProgress } from './goals.ts';
import { rivalWorth } from './rivals.ts';
import { seasonsText } from '../ui/menu.ts';
import { deserialize, serialize, SAVE_VERSION } from './save.ts';

const town = (id: string) => VALLEY.towns.some((t) => t.id === id);

describe('Herausforderungen: Aufbau', () => {
  it('Frist in Jahreszeiten ohne krumme Zahlen', () => {
    expect(seasonsText(25)).toBe('');
    expect(seasonsText(30)).toBe(', also eine Jahreszeit');
    expect(seasonsText(120)).toBe(', also 4 Jahreszeiten');
    expect(seasonsText(70)).toBe(', rund 2 Jahreszeiten');
  });

  it('es gibt 20, mit fortlaufenden Nummern', () => {
    expect(CHALLENGES.length).toBe(20);
    expect(CHALLENGES.map((c) => c.number)).toEqual(CHALLENGES.map((_, i) => i + 1));
  });

  it('verweisen nur auf vorhandene Städte, Waren, Schiffe und Bauten', () => {
    const segs = new Set(VALLEY.segments.map((s) => s.id));
    for (const c of CHALLENGES) {
      expect(town(c.startTown), c.id).toBe(true);
      for (const t of [c.startShip, ...(c.extraShips ?? []), ...c.allowedShips]) expect(SHIPS[t], `${c.id} ${t}`).toBeDefined();
      for (const k of c.kontore ?? []) expect(town(k), c.id).toBe(true);
      for (const e of c.events ?? []) {
        if (e.seg) expect(e.seg === 'alle' || segs.has(e.seg), c.id).toBe(true);
        for (const t of e.towns ?? []) expect(town(t), c.id).toBe(true);
        expect(e.days, c.id).toBeGreaterThan(0);
      }
      for (const g of c.goals) {
        if ('town' in g) expect(town(g.town), `${c.id} ${g.text}`).toBe(true);
        if ('good' in g) expect(GOOD_BY_ID.has(g.good), `${c.id} ${g.text}`).toBe(true);
        if (g.type === 'project') expect(PROJECT_BY_ID.has(g.id), c.id).toBe(true);
        // Lieferziele brauchen einen Markt für die Ware in der Zielstadt
        if (g.type === 'deliver') expect(challengeGame(VALLEY, c, 1).markets[g.town][g.good], `${c.id} ${g.text}`).toBeDefined();
      }
    }
  });

  it('Sonderregeln wirken: Dürre, Zoll überall, Fieber, Wintertag, ein Schiff', () => {
    const get = (id: string) => CHALLENGES.find((c) => c.id === id)!;
    const duerre = challengeGame(VALLEY, get('h-duerre'), 1);
    expect(duerre.events.some((e) => e.kind === 'duerre')).toBe(true);
    const zoll = challengeGame(VALLEY, get('h-zollkrieg'), 1);
    expect(zoll.events.filter((e) => e.kind === 'zoll').length).toBe(VALLEY.segments.length);
    const pest = challengeGame(VALLEY, get('h-pest'), 1);
    expect(pest.events.filter((e) => e.kind === 'seuche').map((e) => e.town).sort()).toEqual(['altenfurt', 'kesselbrueck', 'muehlheim']);
    expect(pest.markets.niedermuend.arznei.stock).toBe(0);
    const eis = challengeGame(VALLEY, get('h-eisgang'), 1);
    expect((day(eis) - 1) % 120).toBe(90);
    advance(eis, VALLEY, 24 * 6);
    expect(eis.ice).toBe(true);
    const eins = challengeGame(VALLEY, get('h-einschiff'), 1);
    eins.money = 10000;
    expect(buyShip(eins, VALLEY, 'muehlheim', 'treidelkahn').ok).toBe(false);
    expect(eins.ships.length).toBe(1);
  });

  it('feste Ereignisse enden nach ihrer Dauer', () => {
    const c = CHALLENGES.find((x) => x.id === 'h-zollkrieg')!;
    const s = challengeGame(VALLEY, c, 1);
    advance(s, VALLEY, 24 * (c.events![0].days + 1));
    expect(s.events.some((e) => e.kind === 'zoll' && e.value === c.events![0].value && e.until - e.from === c.events![0].days - 1)).toBe(false);
  });

  it('Sonderregeln überstehen Speichern und Laden', () => {
    const s = challengeGame(VALLEY, CHALLENGES.find((x) => x.id === 'h-einschiff')!, 1);
    const back = deserialize(serialize({ version: SAVE_VERSION, savedAt: '2026-11-06T00:00:00Z', mode: 'herausforderung', chapter: 'h-einschiff', completedGoals: [], startHour: s.hour, state: s }))!;
    expect(back.state.shipLimit).toBe(1);
  });

  it('Marktanteil zählt eigene gegen fremde Tonnen', () => {
    const c = CHALLENGES.find((x) => x.id === 'h-monopol')!;
    const goal = { type: 'share', good: 'holz', percent: 70, min: 800, text: '' } as const;
    const s = challengeGame(VALLEY, c, 1);
    s.stats.delivered = { niedermuend: { holz: 1600 } };
    s.stats.rivalSold = { holz: 900 };
    // 70 % brauchen bei 900 fremden Tonnen 2100 eigene
    expect(goalProgress(s, goal)).toEqual({ value: 1600, target: 2100 });
    // wenig fremder Handel: dann gilt die Mindestmenge
    s.stats.rivalSold = { holz: 100 };
    expect(goalProgress(s, goal).target).toBe(800);
    // die Herausforderung selbst nutzt dieselbe Formel
    expect(c.goals[0].type).toBe('share');
  });

  it('Konkurrenz wirkt nach einem Einkauf nicht ärmer', () => {
    const s = challengeGame(VALLEY, CHALLENGES.find((x) => x.id === 'h-rang')!, 1);
    const before = s.rivals.map(rivalWorth);
    advance(s, VALLEY, 24);
    // nach einem Tag haben Schiffe der Konkurrenz Ladung an Bord
    expect(s.rivals.some((r) => r.ships.some((x) => x.cargo))).toBe(true);
    s.rivals.forEach((r, i) => expect(rivalWorth(r)).toBeGreaterThan(before[i] * 0.9));
  });

  it('Kaufen und sofort Zurückverkaufen erfüllt keine Liefer- oder Marktanteilsziele', () => {
    for (const id of ['h-monopol', 'h-duerre']) {
      const c = CHALLENGES.find((x) => x.id === id)!;
      const s = challengeGame(VALLEY, c, 1);
      s.money = 100000;
      const ship = s.ships[0];
      const g0 = c.goals[0];
      if (g0.type === 'deliver') ship.port = g0.town;
      const good = c.goals[0].type === 'share' || c.goals[0].type === 'deliver' ? c.goals[0].good : 'holz';
      // im eigenen Hafen kaufen und gleich wieder verkaufen
      s.markets[ship.port!][good] ??= { good, stock: 200, target: 80 };
      for (let i = 0; i < 20; i++) {
        buy(s, ship.id, good, 40);
        sell(s, ship.id, good, 40);
      }
      expect(goalProgress(s, c.goals[0]).value, id).toBe(0);
    }
  });
});

/**
 * Machbarkeit: Der Prüf-Bot muss jede Herausforderung mit wenigstens zwei von drei Startwerten schaffen.
 * Je Herausforderung die Spielweise, mit der er es schafft (Betriebe bauen, Flottengröße).
 * Ermittelt mit allen vier Spielweisen, Ergebnisse im PR beschrieben.
 */

describe('Herausforderungen: Machbarkeit mit dem Prüf-Bot', () => {
  for (const c of CHALLENGES) {
    it(`${c.number}. ${c.title}`, () => {
      const runs = [1, 5, 9].map((seed) => playChallenge(VALLEY, c, seed, STRATEGY[c.id]));
      const wins = runs.filter((r) => r.won);
      expect(wins.length, JSON.stringify(runs.map((r) => r.goals))).toBeGreaterThanOrEqual(2);
      // nicht geschenkt: Der Bot braucht wenigstens ein paar Tage
      for (const r of wins) expect(r.days, c.id).toBeGreaterThan(3);
    }, 120000);
  }
});
