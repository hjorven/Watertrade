import { describe, expect, it } from 'vitest';
import { VALLEY, type MapDef } from '../data/maps/valley.ts';
import { PROJECTS } from '../data/projects.ts';
import { advance, buy, cargoLoad, depart, effectiveDraft, newGame, planVoyage, type GameState, type Ship } from './game.ts';
import {
  AGROUND_HOURS,
  dice,
  draftWith,
  groundingChance,
  groundingRisks,
  hoursToArrival,
  isNight,
  litSegments,
  maxLoadFor,
  NIGHT_SPEED,
  progressFactor,
  realHours,
  totalChance,
  transship,
} from './navigation.ts';
import { waterLevel } from './calendar.ts';
import { segmentDepth } from './river.ts';
import { TIGHT_DEPTH } from './voyage.ts';
import { addShip } from './fleet.ts';

/** Karte, auf der ein Abschnitt genau `clearance` m Wasser unter dem Kiel von `ship` lässt */
function tightMap(state: GameState, ship: Ship, seg: string, clearance: number): MapDef {
  return {
    ...VALLEY,
    segments: VALLEY.segments.map((s) => {
      if (s.id !== seg) return s;
      const depth = segmentDepth(s, state.waterLevel);
      return { ...s, baseDepth: s.baseDepth - depth + effectiveDraft(ship) + clearance };
    }),
  };
}

describe('Nachtfahrt', () => {
  it('nachts ist es dunkel, mittags hell, im Winter länger als im Sommer', () => {
    const summer = 30 * 24; // erster Sommertag
    const winter = 90 * 24;
    expect(isNight(summer + 12)).toBe(false);
    expect(isNight(summer + 1)).toBe(true);
    expect(isNight(summer + 21)).toBe(false);
    expect(isNight(winter + 19)).toBe(true);
    const dark = (start: number) => Array.from({ length: 24 }, (_, h) => isNight(start + h)).filter(Boolean).length;
    expect(dark(winter)).toBeGreaterThan(dark(summer));
  });

  it('nachts halbe Fahrt, unter einem Leuchtfeuer volle', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', rivals: false });
    const night = 2;
    expect(progressFactor(s, 'treidelkahn', 'muehl-alten', night)).toBe(NIGHT_SPEED);
    expect(progressFactor(s, 'treidelkahn', 'muehl-alten', 12)).toBe(1);
    expect(progressFactor(s, 'treidelkahn', 'muehl-alten', night, ['muehl-alten'])).toBe(1);
    // Motorschiffe haben Scheinwerfer
    expect(progressFactor(s, 'motorschiff', 'muehl-alten', night)).toBeGreaterThan(NIGHT_SPEED);
  });

  it('fertige Leuchtfeuer-Bauten zählen als beleuchtete Abschnitte', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', rivals: false });
    const lamp = PROJECTS.find((p) => p.kind === 'leuchtfeuer')!;
    expect(lamp).toBeDefined();
    expect(progressFactor(s, 'treidelkahn', lamp.seg, 2)).toBe(NIGHT_SPEED);
    s.works.push({ id: lamp.id, started: 0, done: true });
    expect(litSegments(s)).toContain(lamp.seg);
    expect(progressFactor(s, 'treidelkahn', lamp.seg, 2)).toBe(1);
  });

  it('eine Fahrt über Nacht dauert länger als der Fahrplan, die Schätzung trifft die Ankunft', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', rivals: false });
    const ship = s.ships[0];
    s.hour = 24 * 40 + 18; // Sommerabend
    const v = depart(s, VALLEY, ship.id, 'niedermuend')!;
    const eta = hoursToArrival(s, ship);
    expect(eta).toBeGreaterThan(v.hours + 1);
    advance(s, VALLEY, eta - 0.5);
    expect(ship.port).toBeNull();
    advance(s, VALLEY, 0.5);
    expect(ship.port).toBe('niedermuend');
  });

  it('am Tag ohne Nacht stimmt die Dauer mit dem Fahrplan überein', () => {
    const s = newGame(VALLEY, { startTown: 'kesselbrueck', rivals: false });
    const ship = s.ships[0];
    s.hour = 24 * 40 + 8;
    const v = depart(s, VALLEY, ship.id, 'muehlheim')!;
    expect(v.hours).toBeLessThan(10);
    expect(realHours(s, ship.type, v)).toBeCloseTo(v.hours, 6);
  });
});

describe('Grundberührung', () => {
  it('Chance nur bei weniger als 20 cm Wasser unter dem Kiel, steigt mit weniger Abstand', () => {
    expect(groundingChance(TIGHT_DEPTH)).toBe(0);
    expect(groundingChance(0.5)).toBe(0);
    expect(groundingChance(-0.1)).toBe(0); // ohne Abstand ist die Strecke ohnehin gesperrt
    expect(groundingChance(0.15)).toBeGreaterThan(0);
    expect(groundingChance(0.02)).toBeGreaterThan(groundingChance(0.15));
    expect(groundingChance(0.1, { careful: true })).toBeLessThan(groundingChance(0.1));
    expect(groundingChance(0.1, { dark: true })).toBeGreaterThan(groundingChance(0.1));
    expect(totalChance([{ seg: 'a', clearance: 0.1, chance: 0.5 }, { seg: 'b', clearance: 0.1, chance: 0.5 }])).toBeCloseTo(0.75);
  });

  it('der Würfel ist fest und gleich verteilt', () => {
    expect(dice(1, 2, 3)).toBe(dice(1, 2, 3));
    const xs = Array.from({ length: 2000 }, (_, i) => dice(7, i, 1));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });

  it('knappe Abschnitte erscheinen als Risiko in der Fahrtplanung', () => {
    const s = newGame(VALLEY, { startTown: 'kesselbrueck', rivals: false });
    const ship = s.ships[0];
    const map = tightMap(s, ship, 'kessel-muehl', 0.05);
    const plan = planVoyage(s, map, ship.id, 'muehlheim')!;
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const risks = groundingRisks(s, map, ship, plan.voyage);
    expect(risks).toHaveLength(1);
    expect(risks[0].clearance).toBeCloseTo(0.05, 2);
    expect(risks[0].chance).toBeGreaterThan(0.3);
  });

  it('auf Grund gelaufen: Verschleiß, ein halber Tag Verzug und eine Meldung', () => {
    let grounded = 0;
    let clean = 0;
    for (let i = 0; i < 30; i++) {
      const s = newGame(VALLEY, { startTown: 'kesselbrueck', rivals: false });
      s.hour = 24 * 40 + 8 + i; // Sommer, verschiedene Abfahrtsstunden
      s.waterLevel = waterLevel(s.hour / 24 + 1);
      const ship = s.ships[0];
      const map = tightMap(s, ship, 'kessel-muehl', 0.02);
      expect(depart(s, map, ship.id, 'muehlheim')).not.toBeNull();
      const events = advance(s, map, 60);
      expect(ship.port).toBe('muehlheim');
      const news = events.filter((e) => e.type === 'news' && /auf Grund/.test(e.item.text));
      if (news.length) {
        grounded++;
        expect(news[0].type === 'news' && news[0].item.text).toMatch(/Zustand verloren/);
        // Verschleiß der Fahrt plus der Grundberührung
        expect(1 - ship.condition).toBeGreaterThan(0.03);
      } else clean++;
    }
    // bei 2 cm Abstand läuft man meistens auf, aber nicht immer
    expect(grounded).toBeGreaterThan(10);
    expect(clean).toBeGreaterThan(0);
  });

  it('der Stillstand verlängert die Fahrt um einen halben Tag', () => {
    const s = newGame(VALLEY, { startTown: 'kesselbrueck', rivals: false });
    s.hour = 24 * 40 + 8;
    const ship = s.ships[0];
    const v = depart(s, VALLEY, ship.id, 'muehlheim')!;
    const before = hoursToArrival(s, ship);
    v.aground = AGROUND_HOURS;
    expect(hoursToArrival(s, ship)).toBeGreaterThanOrEqual(before + AGROUND_HOURS - 1e-6);
    const pos = v.elapsed;
    advance(s, VALLEY, AGROUND_HOURS - 1);
    expect(v.elapsed).toBe(pos);
    advance(s, VALLEY, 2);
    expect(v.elapsed).toBeGreaterThan(pos);
  });

  it('ohne knappe Tiefe läuft niemand auf Grund', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', rivals: false });
    s.hour = 24 * 70 + 8; // Herbst, gutes Wasser
    const ship = s.ships[0];
    depart(s, VALLEY, ship.id, 'niedermuend');
    const events = advance(s, VALLEY, 80);
    expect(ship.port).toBe('niedermuend');
    expect(events.some((e) => e.type === 'news' && /auf Grund/.test(e.item.text))).toBe(false);
  });
});

describe('Leichtern', () => {
  // Altenfurt hat viel Stoff auf dem Markt
  function harbour(): { s: GameState; kahn: Ship; plaette: Ship } {
    const s = newGame(VALLEY, { startTown: 'altenfurt', rivals: false, money: 5000 });
    const kahn = s.ships[0];
    const plaette = addShip(s, 'plaette', 'altenfurt');
    return { s, kahn, plaette };
  }

  it('ohne eigenes Kontor kein Umladen', () => {
    const { s, kahn, plaette } = harbour();
    buy(s, kahn.id, 'holz', 20);
    const r = transship(s, kahn.id, plaette.id, 'holz', 10);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Kontor/);
  });

  it('mit Kontor geht Ladung direkt aufs flachere Schiff, Einkaufswert wandert mit', () => {
    const { s, kahn, plaette } = harbour();
    s.kontore.altenfurt = { level: 1, stock: {} };
    expect(buy(s, kahn.id, 'stoff', 30).ok).toBe(true);
    const cost = kahn.cargo.stoff.cost;
    const r = transship(s, kahn.id, plaette.id, 'stoff', 100);
    expect(r.ok).toBe(true);
    // die Plätte fasst 25 t
    expect(r.amount).toBe(25);
    expect(cargoLoad(plaette)).toBe(25);
    expect(cargoLoad(kahn)).toBe(5);
    expect(kahn.cargo.stoff.cost + plaette.cargo.stoff.cost).toBe(cost);
    // das Kontorlager bleibt dabei leer
    expect(Object.keys(s.kontore.altenfurt.stock)).toHaveLength(0);
  });

  it('Umladen geht nur zwischen Schiffen im selben Hafen', () => {
    const { s, kahn } = harbour();
    s.kontore.altenfurt = { level: 1, stock: {} };
    const far = addShip(s, 'plaette', 'weidenhof');
    buy(s, kahn.id, 'holz', 10);
    expect(transship(s, kahn.id, far.id, 'holz', 10).ok).toBe(false);
  });

  it('Höchstladung: ein zu tief beladener Kahn kommt mit weniger Ladung durch', () => {
    const { s, kahn } = harbour();
    buy(s, kahn.id, 'stoff', 40);
    expect(cargoLoad(kahn)).toBe(40);
    // voll 1,0 m Tiefgang, leer 0,6 m: bei 0,9 m Wasser passen höchstens drei Viertel der Ladung
    const map = tightMap(s, kahn, 'alten-weiden', -0.1);
    expect(planVoyage(s, map, kahn.id, 'weidenhof')!.ok).toBe(false);
    const max = maxLoadFor(s, map, kahn, 'weidenhof')!;
    expect(max).toBeGreaterThanOrEqual(29);
    expect(max).toBeLessThanOrEqual(30);
    expect(draftWith(kahn, max)).toBeLessThanOrEqual(draftWith(kahn, 40) - 0.1 + 1e-9);
    // nach dem Leichtern auf die Plätte kommt der Kahn durch
    s.kontore.altenfurt = { level: 1, stock: {} };
    const plaette = s.ships.find((x) => x.type === 'plaette')!;
    expect(transship(s, kahn.id, plaette.id, 'stoff', 40 - max).ok).toBe(true);
    expect(planVoyage(s, map, kahn.id, 'weidenhof')!.ok).toBe(true);
    // gar nicht, wenn auch leer zu tief
    const deep = tightMap(s, kahn, 'alten-weiden', -0.6);
    expect(maxLoadFor(s, deep, kahn, 'weidenhof')).toBeNull();
  });

  it('Höchstladung ist die volle Ladung, wenn die Fahrt ohnehin geht', () => {
    const { s, kahn } = harbour();
    s.hour = 24 * 70 + 8;
    advance(s, VALLEY, 1);
    buy(s, kahn.id, 'stoff', 20);
    expect(maxLoadFor(s, VALLEY, kahn, 'weidenhof')).toBe(20);
  });
});
