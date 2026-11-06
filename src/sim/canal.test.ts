import { describe, expect, it } from 'vitest';
import { SCHEITELKANAL } from '../data/canal.ts';
import { GOOD_BY_ID, GOODS } from '../data/goods.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { CANAL_ID, NORTH_TOWN_IDS, ZWEI_TAELER } from '../data/maps/zwei-taeler.ts';
import { SHIPS } from '../data/ships.ts';
import { YEAR_DAYS } from './calendar.ts';
import {
  canalAccepts,
  canalOf,
  canalProgress,
  canalStagesDone,
  deliverToCanal,
  stageNeeds,
  startCanalStage,
  tickCanal,
} from './canal.ts';
import { advance, addShip, day, effectiveSegments, newGame, planRoute, type GameState } from './game.ts';
import { goalDone } from './goals.ts';

const MAP = ZWEI_TAELER;
const kahn = SHIPS.treidelkahn;

function fresh(money = 100000): GameState {
  return newGame(MAP, { startTown: 'altenfurt', money, rivals: false });
}

/** Tag auf einen bestimmten Jahrestag setzen (1 = erster Frühlingstag) */
function setDayOfYear(s: GameState, doy: number): void {
  s.hour = (doy - 1) * 24 + 8;
}

/** Baulager für den laufenden Abschnitt voll machen */
function supply(s: GameState): void {
  const st = SCHEITELKANAL.stages[s.canal?.stage ?? 0];
  for (const [g, n] of Object.entries(st.goods)) s.canal!.stock[g] = (s.canal!.stock[g] ?? 0) + n;
}

describe('Karte Zwei Täler', () => {
  it('Städte, Flüsse und Abschnitte passen zusammen', () => {
    const towns = new Set(MAP.towns.map((t) => t.id));
    const rivers = new Set(MAP.rivers.map((r) => r.id));
    expect(towns.size).toBe(MAP.towns.length);
    expect(new Set(MAP.segments.map((s) => s.id)).size).toBe(MAP.segments.length);
    for (const s of MAP.segments) {
      expect(towns.has(s.from) && towns.has(s.to), s.id).toBe(true);
      expect(rivers.has(s.river), s.id).toBe(true);
      expect(s.fromT).toBeLessThan(s.toT);
    }
    for (const t of MAP.towns) {
      expect(rivers.has(t.river), t.id).toBe(true);
      for (const y of t.shipyard) expect(SHIPS[y], `${t.id}: ${y}`).toBeDefined();
      const goods = [
        ...Object.keys(t.produces),
        ...Object.keys(t.consumes),
        ...t.industries.flatMap((i) => [...Object.keys(i.inputs), ...Object.keys(i.outputs)]),
      ];
      for (const g of goods) expect(GOOD_BY_ID.has(g), `${t.id}: ${g}`).toBe(true);
    }
    for (const r of MAP.rivers) if (r.joins) expect(rivers.has(r.joins.river)).toBe(true);
    for (const x of MAP.rivers.flatMap((r) => r.points)) {
      expect(x[0]).toBeGreaterThanOrEqual(MAP.bounds!.minX);
      expect(x[0]).toBeLessThanOrEqual(MAP.bounds!.maxX);
      expect(x[1]).toBeGreaterThanOrEqual(MAP.bounds!.minZ);
      expect(x[1]).toBeLessThanOrEqual(MAP.bounds!.maxZ);
    }
  });

  it('jede Ware wird im Norden erzeugt oder dort gebraucht, und der Norden hat eine Werft', () => {
    const north = MAP.towns.filter((t) => NORTH_TOWN_IDS.includes(t.id));
    for (const g of GOODS) {
      const touched = north.some(
        (t) => g.id in t.produces || g.id in t.consumes || t.industries.some((i) => g.id in i.inputs || g.id in i.outputs),
      );
      expect(touched, g.name).toBe(true);
    }
    expect(north.some((t) => t.shipyard.includes('treidelkahn'))).toBe(true);
  });

  it('das Tal ist unverändert', () => {
    const s = newGame(VALLEY, 'oberau');
    expect(effectiveSegments(s, VALLEY)).toBe(VALLEY.segments);
    expect(canalOf(VALLEY)).toBeNull();
    expect(canalProgress(s, VALLEY)).toBeNull();
    expect(startCanalStage(s, VALLEY).ok).toBe(false);
  });

  it('vor dem Kanal sind die Flusssysteme getrennt, jedes für sich befahrbar', () => {
    const s = fresh();
    expect(effectiveSegments(s, MAP).some((x) => x.id === 'scheitelkanal')).toBe(false);
    expect(planRoute(s, MAP, 'altenfurt', 'tuchingen', kahn).ok).toBe(false);
    expect(planRoute(s, MAP, 'oberau', 'nordhafen', kahn).ok).toBe(false);
    expect(planRoute(s, MAP, 'russheim', 'nordhafen', kahn).ok).toBe(true);
    expect(planRoute(s, MAP, 'nordhafen', 'russheim', kahn).ok).toBe(true);
    expect(planRoute(s, MAP, 'moorwalde', 'lindenbrueck', SHIPS.plaette).ok).toBe(true);
    expect(planRoute(s, MAP, 'altenfurt', 'oberau', kahn).ok).toBe(true);
  });

  it('ein Jahr freies Spiel mit Konkurrenz läuft ohne Fehler, Märkte bleiben gültig', () => {
    const s = newGame(MAP, { startTown: 'altenfurt', rivals: true });
    advance(s, MAP, 24 * YEAR_DAYS);
    for (const t of MAP.towns) {
      for (const m of Object.values(s.markets[t.id])) {
        expect(Number.isFinite(m.stock)).toBe(true);
        expect(m.stock).toBeGreaterThanOrEqual(0);
      }
    }
    // kein Zoll auf dem ungebauten Kanal
    expect(s.events.some((e) => e.seg === 'scheitelkanal')).toBe(false);
  });
});

describe('Kanalbau', () => {
  it('beginnt nur mit genug Geld, zieht die Kosten ab', () => {
    const poor = fresh(1000);
    expect(startCanalStage(poor, MAP).ok).toBe(false);
    expect(poor.money).toBe(1000);
    const s = fresh();
    const r = startCanalStage(s, MAP);
    expect(r.ok).toBe(true);
    expect(s.money).toBe(100000 - SCHEITELKANAL.stages[0].cost);
    expect(startCanalStage(s, MAP).ok).toBe(false); // läuft schon
  });

  it('Vermessung braucht keine Baustoffe und ist nach ihren Arbeitstagen fertig', () => {
    const s = fresh();
    setDayOfYear(s, 1);
    startCanalStage(s, MAP);
    advance(s, MAP, 24 * SCHEITELKANAL.stages[0].days + 1);
    expect(canalStagesDone(s)).toBe(1);
    expect(s.canal!.active).toBe(false);
    expect(goalDone(s, { type: 'canalStage', stage: 1, text: '' })).toBe(true);
    expect(goalDone(s, { type: 'canalStage', stage: 2, text: '' })).toBe(false);
  });

  it('ohne Baustoffe ruht die Arbeit, mit halber Lieferung kommt sie halb voran', () => {
    const s = fresh();
    setDayOfYear(s, 1);
    s.canal = undefined;
    startCanalStage(s, MAP);
    s.canal!.stage = 1; // direkt zum Durchstich
    s.canal!.worked = 0;
    const news = tickCanal(s, MAP);
    expect(s.canal!.worked).toBe(0);
    expect(s.canal!.waiting.sort()).toEqual(['brot', 'holz', 'werkzeug']);
    expect(news.length).toBe(1);
    // zweiter Tag ohne Ware: keine neue Meldung
    expect(tickCanal(s, MAP).length).toBe(0);
    const st = SCHEITELKANAL.stages[1];
    for (const [g, n] of Object.entries(st.goods)) s.canal!.stock[g] = (n / st.days) * 0.5;
    tickCanal(s, MAP);
    expect(s.canal!.worked).toBeCloseTo(0.5, 6);
    expect(s.canal!.stock.brot ?? 0).toBeCloseTo(0, 6);
  });

  it('Erdarbeiten ruhen im Winter, Vermessung nicht', () => {
    const s = fresh();
    setDayOfYear(s, 91); // erster Wintertag
    startCanalStage(s, MAP);
    tickCanal(s, MAP);
    expect(s.canal!.worked).toBe(1);
    s.canal!.stage = 1;
    s.canal!.worked = 0;
    supply(s);
    tickCanal(s, MAP);
    expect(s.canal!.worked).toBe(0);
    expect(s.canal!.waiting).toEqual([]);
  });

  it('Lieferung nur an den Kanalenden, nicht mehr als gebraucht', () => {
    const s = fresh();
    const ship = addShip(s, 'treidelkahn', 'altenfurt');
    ship.cargo.brot = { amount: 200, cost: 5200 };
    ship.cargo.salz = { amount: 10, cost: 200 };
    expect(deliverToCanal(s, MAP, { ship: ship.id }, 'salz', 10).ok).toBe(false);
    // Brot wird im Durchstich (150) und bei der Einweihung (30) gebraucht
    expect(canalAccepts(s, SCHEITELKANAL, 'brot')).toBe(180);
    const r = deliverToCanal(s, MAP, { ship: ship.id }, 'brot', 999);
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(180);
    expect(ship.cargo.brot.amount).toBe(20);
    expect(ship.cargo.brot.cost).toBe(520);
    expect(s.canal!.stock.brot).toBe(180);
    expect(deliverToCanal(s, MAP, { ship: ship.id }, 'brot', 5).ok).toBe(false);
    const other = addShip(s, 'treidelkahn', 'muehlheim');
    other.cargo.holz = { amount: 10, cost: 100 };
    expect(deliverToCanal(s, MAP, { ship: other.id }, 'holz', 10).ok).toBe(false);
  });

  it('Lieferung aus dem Kontor in Tuchingen zählt auch', () => {
    const s = fresh();
    s.kontore.tuchingen = { level: 1, stock: { kohle: { amount: 50, cost: 600 } } };
    const r = deliverToCanal(s, MAP, { kontor: 'tuchingen' }, 'kohle', 50);
    expect(r.ok).toBe(true);
    expect(s.kontore.tuchingen.stock.kohle).toBeUndefined();
    expect(s.canal!.delivered.kohle).toBe(50);
    expect(deliverToCanal(s, MAP, { kontor: 'oberau' }, 'kohle', 1).ok).toBe(false);
  });

  it('stageNeeds zeigt den Restbedarf des laufenden Abschnitts', () => {
    const s = fresh();
    startCanalStage(s, MAP);
    expect(stageNeeds(s, SCHEITELKANAL)).toEqual({});
    s.canal!.stage = 1;
    s.canal!.stock.brot = 50;
    expect(stageNeeds(s, SCHEITELKANAL)).toEqual({ brot: 100, werkzeug: 30, holz: 120 });
  });

  it('der ganze Kanal dauert mit voller Versorgung zwei bis drei Jahre und öffnet dann den Weg', () => {
    const s = fresh(200000);
    setDayOfYear(s, 1);
    const begin = day(s);
    let guard = 0;
    while (!s.canal?.done && guard++ < 2000) {
      if (!s.canal?.active) {
        expect(startCanalStage(s, MAP).ok).toBe(true);
        supply(s);
      }
      advance(s, MAP, 24);
    }
    expect(s.canal!.done).toBe(true);
    const years = (day(s) - begin) / YEAR_DAYS;
    expect(years).toBeGreaterThan(1.8);
    expect(years).toBeLessThan(3);
    expect(s.works.some((w) => w.id === CANAL_ID && w.done)).toBe(true);
    expect(goalDone(s, { type: 'project', id: CANAL_ID, text: '' })).toBe(true);
    expect(goalDone(s, { type: 'canalStage', stage: 4, text: '' })).toBe(true);
    expect(canalProgress(s, MAP)!.total).toBe(1);
    expect(effectiveSegments(s, MAP).some((x) => x.id === 'scheitelkanal')).toBe(true);
    // im Sommer, ohne Eis, fährt ein Treidelkahn durch den Kanal bis Nordhafen
    setDayOfYear(s, 40 + YEAR_DAYS * 3);
    s.ice = false;
    s.waterLevel = 0;
    const r = planRoute(s, MAP, 'oberau', 'nordhafen', kahn);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.voyage.legs.some((l) => l.seg === 'scheitelkanal')).toBe(true);
    expect(startCanalStage(s, MAP).ok).toBe(false);
    expect(canalAccepts(s, SCHEITELKANAL, 'brot')).toBe(0);
    // das Spiel läuft mit dem Kanal-Eintrag in state.works weiter (kein Eintrag in PROJECTS)
    s.rivalsActive = true;
    advance(s, MAP, 24 * 60);
    expect(s.works.filter((w) => w.id === CANAL_ID).length).toBe(1);
  });

  it('Fortschritt wächst stetig über die Abschnitte', () => {
    const s = fresh();
    expect(canalProgress(s, MAP)!.total).toBe(0);
    startCanalStage(s, MAP);
    s.canal!.worked = 12.5;
    const p = canalProgress(s, MAP)!;
    expect(p.stageShare).toBeCloseTo(0.5);
    expect(p.total).toBeCloseTo(12.5 / 235);
  });
});
