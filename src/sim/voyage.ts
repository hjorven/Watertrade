import type { MapDef, SegmentDef } from '../data/maps/valley.ts';
import { explainBlock, findRoute, travelTime, type BlockReason, type ShipType } from './river.ts';
import { conditions, effectiveType, getShip, hasUpgrade, type GameState, type Leg, type Ship, type Voyage } from './state.ts';

export type VoyagePlan = { ok: true; voyage: Voyage } | { ok: false; reasons: { seg: SegmentDef; reason: BlockReason }[] };

/** Zoll, der auf einem Abschnitt gerade erhoben wird */
export function tollOn(state: GameState, seg: string): number {
  return state.events.filter((e) => e.kind === 'zoll' && e.seg === seg).reduce((s, e) => s + (e.value ?? 0), 0);
}

/** Route für einen beliebigen Schiffstyp zwischen zwei Häfen planen */
export function planRoute(
  state: GameState,
  map: MapDef,
  from: string,
  to: string,
  type: ShipType,
  upstreamBoost = 1,
): VoyagePlan {
  const cond = conditions(state);
  const route = findRoute(map.segments, from, to, type, cond);
  if (!route) {
    const reasons = explainBlock(map.segments, from, to, type, cond);
    return { ok: false, reasons: reasons as { seg: SegmentDef; reason: BlockReason }[] };
  }
  const legs: Leg[] = [];
  let node = from;
  let toll = 0;
  for (const id of route.path) {
    const seg = map.segments.find((s) => s.id === id)!;
    const downstream = seg.from === node;
    const next = downstream ? seg.to : seg.from;
    const t = downstream ? type : { ...type, speed: type.speed * upstreamBoost };
    // mit Treidelmeister wird bergauf neu gerechnet; ist das nicht möglich, gilt die normale Zeit
    const hours = travelTime(seg, t, downstream, cond) ?? travelTime(seg, type, downstream, cond)!;
    legs.push({ seg: id, from: node, to: next, downstream, hours });
    toll += tollOn(state, id);
    node = next;
  }
  const hours = legs.reduce((s, l) => s + l.hours, 0);
  return { ok: true, voyage: { from, to, legs, hours, elapsed: 0, toll } };
}

export function planVoyage(state: GameState, map: MapDef, shipId: number, to: string): VoyagePlan | null {
  const ship = getShip(state, shipId);
  if (!ship.port || ship.port === to) return null;
  const boost = ship.captain?.trait === 'treidelmeister' && ship.type !== 'segelkahn' ? 1.2 : 1;
  const plan = planRoute(state, map, ship.port, to, effectiveType(state, ship), boost);
  if (plan.ok && ship.captain?.trait === 'schmuggler') plan.voyage.toll = 0;
  return plan;
}

export function depart(state: GameState, map: MapDef, shipId: number, to: string): Voyage | null {
  const plan = planVoyage(state, map, shipId, to);
  if (!plan || !plan.ok) return null;
  const ship = getShip(state, shipId);
  const toll = plan.voyage.toll ?? 0;
  if (toll > state.money) return null;
  state.money -= toll;
  ship.voyage = plan.voyage;
  ship.port = null;
  state.stats.trips++;
  return plan.voyage;
}

/** Aktueller Abschnitt einer Fahrt und Fortschritt darin (0..1) */
export function voyagePosition(v: Voyage): { leg: Leg; progress: number; index: number } {
  let t = v.elapsed;
  for (let i = 0; i < v.legs.length; i++) {
    const leg = v.legs[i];
    if (t <= leg.hours || i === v.legs.length - 1) return { leg, progress: Math.min(1, t / leg.hours), index: i };
    t -= leg.hours;
  }
  throw new Error('Fahrt ohne Abschnitte');
}

/** Verschleiß pro Fahrstunde */
export const WEAR_PER_HOUR = 0.0012;

export function wearRate(ship: Ship): number {
  let w = WEAR_PER_HOUR;
  if (ship.captain?.trait === 'vorsichtig') w *= 0.5;
  if (hasUpgrade(ship, 'beschlag')) w *= 0.6;
  if (ship.type === 'floss') w = 0;
  return w;
}
