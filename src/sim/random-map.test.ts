import { describe, expect, it } from 'vitest';
import { GOODS } from '../data/goods.ts';
import { mapById, mapFor, mapIdOf, randomMap, randomMapId, stateFitsMap } from '../data/maps/index.ts';
import { generateCandidate, layoutProblems, seedOfMapId } from '../data/maps/random.ts';
import { VALLEY, type MapDef } from '../data/maps/valley.ts';
import { TOWN_STYLES } from '../render/townstyles.ts';
import { advance, newGame, upgradeState } from './game.ts';
import { botCheck, checkMap, playableRandomMap, startOf, structureProblems } from './mapcheck.ts';
import { deserialize, SAVE_VERSION, serialize } from './save.ts';
import { startProjectWith } from './wasserbau.ts';
import { effectiveSegments, gaugeCount, litSegments } from './works.ts';

const SEEDS = Array.from({ length: 25 }, (_, i) => 1 + i * 7919);

/** Tiefe Kopie, damit Tests Karten verändern können, ohne den Zwischenspeicher zu stören */
const copy = (m: MapDef): MapDef => JSON.parse(JSON.stringify(m)) as MapDef;

describe('Zufallsflüsse: Generator', () => {
  it('gleicher Startwert ergibt dieselbe Karte, andere Startwerte andere', () => {
    const a = playableRandomMap(4242).map;
    const b = playableRandomMap(4242).map;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = playableRandomMap(4243).map;
    expect(c.towns.map((t) => t.name)).not.toEqual(a.towns.map((t) => t.name));
  });

  it('Karten-Id und Startwert passen zusammen', () => {
    expect(seedOfMapId(randomMapId(123))).toBe(123);
    expect(seedOfMapId('tal')).toBeNull();
    expect(seedOfMapId('zufall-abc')).toBeNull();
    expect(mapById(randomMapId(77)).towns).toEqual(randomMap(77).towns);
    expect(mapById(undefined)).toBe(VALLEY);
    expect(mapById('tal')).toBe(VALLEY);
  });

  it('jede erzeugte Karte besteht die Prüfung durch den Balance-Bot', () => {
    for (const seed of SEEDS) {
      const r = playableRandomMap(seed);
      expect(r.report.ok, `Startwert ${seed}: ${r.report.problems.join('; ')}`).toBe(true);
      expect(r.attempts).toBeLessThanOrEqual(6);
    }
  }, 60000);

  it('erzeugte Karten sind vollständig: Ketten, Werften, Brücken, Wasserbauten, Baustile', () => {
    for (const seed of SEEDS) {
      const map = randomMap(seed);
      const msg = `Startwert ${seed}`;
      expect(map.id, msg).toBe(randomMapId(seed));
      expect(map.towns.length, msg).toBeGreaterThanOrEqual(7);
      expect(map.rivers.length, msg).toBeGreaterThanOrEqual(2);
      expect(map.towns.find((t) => t.id === map.start), msg).toBeDefined();
      // jeder Betrieb der Städte kommt vor, damit alle Warenketten bestehen
      const made = new Set(map.towns.flatMap((t) => [...Object.keys(t.produces), ...t.industries.flatMap((i) => Object.keys(i.outputs))]));
      for (const g of GOODS) expect(made.has(g.id), `${msg}: ${g.name} fehlt`).toBe(true);
      expect(map.segments.some((s) => s.bridgeHeight !== undefined), msg).toBe(true);
      expect(map.towns.some((t) => t.shipyard.includes('raddampfer')), msg).toBe(true);
      expect(map.towns.some((t) => t.shipyard.includes('floss')), msg).toBe(true);
      for (const p of map.projects ?? []) expect(map.segments.some((s) => s.id === p.seg), `${msg}: ${p.id}`).toBe(true);
      expect(new Set(map.projects!.map((p) => p.id)).size, msg).toBe(map.projects!.length);
      for (const t of map.towns) expect(TOWN_STYLES[t.style!], `${msg}: Stil ${t.style}`).toBeDefined();
      // Nebenflüsse münden in eine Stadt am Hauptstrom
      for (const r of map.rivers.filter((x) => x.joins)) {
        const last = map.segments.filter((s) => s.river === r.id).at(-1);
        if (!last) continue;
        expect(last.toT, msg).toBe(1);
        expect(map.towns.find((t) => t.id === last.to)!.river, msg).toBe('strom');
      }
    }
  }, 60000);

  it('Kandidaten, die sich nicht auflösen lassen, werden verworfen statt halb gebaut', () => {
    let built = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const m = generateCandidate(seed, 0);
      if (!m) continue;
      built++;
      expect(layoutProblems(m), `Startwert ${seed}`).toEqual([]);
    }
    expect(built).toBeGreaterThan(40);
  });
});

describe('Zufallsflüsse: Prüfung', () => {
  it('das handgebaute Tal besteht dieselbe Prüfung', () => {
    const r = checkMap(VALLEY);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('erkennt Karten, auf denen nichts fährt', () => {
    const m = copy(randomMap(SEEDS[0]));
    for (const s of m.segments) s.baseDepth = 0.3;
    const r = checkMap(m);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/nicht erreichbar/);
  });

  it('erkennt fehlende Werften und Waren ohne Abnehmer', () => {
    const m = copy(randomMap(SEEDS[1]));
    for (const t of m.towns) t.shipyard = [];
    for (const t of m.towns) {
      delete t.consumes.werkzeug;
    }
    const problems = structureProblems(m).join(' ');
    expect(problems).toMatch(/Werft/);
    expect(problems).toMatch(/Werkzeug wird hergestellt, aber nirgends gebraucht/);
  });

  it('erkennt eine Karte, auf der der Bot kaum verdient', () => {
    const m = copy(randomMap(SEEDS[2]));
    // endlos lange Wege: Aufbau und Lage stimmen, aber Handel lohnt kaum
    for (const s of m.segments) s.length *= 15;
    expect(structureProblems(m)).toEqual([]);
    const bot = botCheck(m);
    expect(bot.problems.length).toBeGreaterThan(0);
    expect(checkMap(m).ok).toBe(false);
  });
});

describe('Zufallsflüsse: Spielen', () => {
  it('ein ganzes Jahr freies Spiel mit Konkurrenz läuft ohne Fehler', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const map = randomMap(seed);
      const s = newGame(map, { startTown: startOf(map), seed: 99 });
      expect(s.map).toEqual({ id: map.id, seed, def: map });
      advance(s, map, 24 * 120);
      expect(Number.isFinite(s.money)).toBe(true);
      // die Häuser der Konkurrenz liegen in Häfen dieser Karte
      const ids = new Set(map.towns.map((t) => t.id));
      for (const r of s.rivals) for (const ship of r.ships) {
        if (ship.port) expect(ids.has(ship.port)).toBe(true);
        else expect(ship.voyage).not.toBeNull();
      }
      for (const t of map.towns) expect(s.towns[t.id].population).toBeGreaterThan(0);
      // Häuser ohne Heimathafen auf dieser Karte behalten ihren Ersatzhafen
      for (const r of s.rivals) if (r.home) expect(ids.has(r.home)).toBe(true);
    }
  });

  it('Spielstände merken sich ihre Karte', () => {
    const map = randomMap(SEEDS[3]);
    const s = newGame(map, { startTown: startOf(map) });
    const back = deserialize(serialize({ version: SAVE_VERSION, savedAt: '', mode: 'frei', completedGoals: [], state: s }))!;
    expect(mapIdOf(back.state)).toBe(map.id);
    expect(mapFor(back.state).towns).toEqual(map.towns);
    upgradeState(back.state, mapFor(back.state));
    // die Karte reist im Spielstand mit: auch wenn der Generator sie heute anders bauen würde, bleibt sie gleich
    back.state.map!.def!.name = 'Geändert';
    expect(mapFor(back.state).name).toBe('Geändert');
    expect(stateFitsMap(back.state, mapFor(back.state))).toBe(true);
    expect(stateFitsMap(back.state, VALLEY)).toBe(false);
    // alte Spielstände ohne Karte spielen im Tal
    const old = newGame(VALLEY, 'oberau');
    delete old.map;
    expect(mapIdOf(old)).toBe('tal');
    expect(mapFor(old)).toBe(VALLEY);
  });

  it('Wasserbauten der Zufallskarte lassen sich bauen und wirken', () => {
    const map = randomMap(SEEDS[4]);
    const s = newGame(map, { startTown: startOf(map), money: 50000, rivals: false });
    const p = map.projects!.find((x) => x.epoch === 1 && x.kind === 'bruecke')!;
    expect(startProjectWith(s, map, p.id).ok).toBe(true);
    advance(s, map, 24 * (p.days + 1));
    const seg = effectiveSegments(s, map).find((x) => x.id === p.seg)!;
    expect(seg.bridgeHeight).toBe(11);
    // Projekte des Tals gibt es auf dieser Karte nicht
    expect(startProjectWith(s, map, 'bruecke-kessel').ok).toBe(false);
  });

  it('Pegel und Leuchtfeuer der Zufallskarte zählen', () => {
    const map = randomMap(SEEDS[5]);
    const s = newGame(map, { startTown: startOf(map), money: 50000, rivals: false });
    const gauge = map.projects!.find((x) => x.kind === 'pegel')!;
    const light = map.projects!.find((x) => x.kind === 'leuchtfeuer')!;
    expect(startProjectWith(s, map, gauge.id).ok).toBe(true);
    expect(startProjectWith(s, map, light.id).ok).toBe(true);
    advance(s, map, 24 * 20);
    expect(gaugeCount(s, map)).toBe(1);
    expect(litSegments(s, map)).toEqual([light.seg]);
  });
});
