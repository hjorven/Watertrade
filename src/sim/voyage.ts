import type { MapDef, SegmentDef } from '../data/maps/valley.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import { available, buyCost } from './economy.ts';
import { explainBlock, findRoute, segmentDepth, travelTime, type BlockReason, type ShipType } from './river.ts';
import { effectiveSegments } from './works.ts';
import { conditions, effectiveDraft, effectiveType, getShip, hasUpgrade, shipClass, type GameState, type Leg, type Ship, type Voyage } from './state.ts';

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
  const segments = effectiveSegments(state, map);
  const route = findRoute(segments, from, to, type, cond);
  if (!route) {
    const reasons = explainBlock(segments, from, to, type, cond);
    return { ok: false, reasons: reasons as { seg: SegmentDef; reason: BlockReason }[] };
  }
  const legs: Leg[] = [];
  let node = from;
  let toll = 0;
  for (const id of route.path) {
    const seg = segments.find((s) => s.id === id)!;
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

/* ---------- Kohle für Dampfer ---------- */

/** Kohle in Tonnen, die ein Dampfer für eine Fahrt dieser Länge verbrennt */
export function coalNeed(ship: Ship, hours: number): number {
  return Math.round((shipClass(ship).coal ?? 0) * hours * 10) / 10;
}

export interface BunkerPlan {
  /** Kohle für die ganze Fahrt */
  need: number;
  /** Tonnen, die vor dem Ablegen gekauft werden müssen */
  buy: number;
  /** Preis dafür auf dem Markt im Hafen */
  cost: number;
  /** null, wenn genug Kohle da ist oder gekauft werden kann, sonst der Grund */
  problem: string | null;
}

/**
 * Was ein Dampfer vor dieser Fahrt bunkern muss. Fehlt Kohle, wird beim Ablegen am Hafenmarkt gekauft,
 * und zwar gleich bis zum vollen Bunker, soweit Geld und Markt reichen, damit auch die Rückfahrt
 * aus einem Hafen ohne Kohlehandel klappt.
 */
export function bunkerPlan(state: GameState, ship: Ship, hours: number, toll = 0): BunkerPlan {
  const cls = shipClass(ship);
  const need = coalNeed(ship, hours);
  if (!cls.coal || need <= 0) return { need: 0, buy: 0, cost: 0, problem: null };
  if (need > (cls.bunker ?? 0)) return { need, buy: 0, cost: 0, problem: `Der Bunker fasst nur ${cls.bunker} t Kohle, die Fahrt braucht ${need} t` };
  const min = Math.max(0, Math.ceil(need - (ship.bunker ?? 0)));
  if (min === 0) return { need, buy: 0, cost: 0, problem: null };
  const m = ship.port ? state.markets[ship.port]?.kohle : undefined;
  if (!m) return { need, buy: min, cost: 0, problem: `Zu wenig Kohle im Bunker, und hier wird keine verkauft (${min} t fehlen)` };
  if (available(m) < min) return { need, buy: min, cost: 0, problem: `Der Markt hat nur ${available(m)} t Kohle, es fehlen ${min} t` };
  const base = GOOD_BY_ID.get('kohle')!.base;
  let buy = Math.max(min, Math.min(Math.floor((cls.bunker ?? 0) - (ship.bunker ?? 0)), available(m)));
  while (buy > min && toll + buyCost(base, m, buy) > state.money) buy--;
  return { need, buy, cost: buyCost(base, m, buy), problem: null };
}

/** Kohle vom Markt in den Bunker kaufen */
function bunkerCoal(state: GameState, ship: Ship, amount: number): number {
  const m = state.markets[ship.port!].kohle;
  const cost = buyCost(GOOD_BY_ID.get('kohle')!.base, m, amount);
  m.stock -= amount;
  state.money -= cost;
  state.fuelToday += cost;
  ship.bunker = (ship.bunker ?? 0) + amount;
  return cost;
}

/** Bunker im Hafen bis oben füllen, damit auch Häfen ohne Kohlemarkt erreichbar sind */
export function fillBunker(state: GameState, shipId: number): { ok: boolean; message: string; amount: number; taler: number } {
  const ship = getShip(state, shipId);
  const cls = shipClass(ship);
  if (!cls.coal) return { ok: false, message: 'Dieses Schiff braucht keine Kohle.', amount: 0, taler: 0 };
  if (!ship.port) return { ok: false, message: 'Bunkern geht nur im Hafen.', amount: 0, taler: 0 };
  const m = state.markets[ship.port].kohle;
  if (!m) return { ok: false, message: 'Hier wird keine Kohle verkauft.', amount: 0, taler: 0 };
  let amount = Math.min(Math.floor((cls.bunker ?? 0) - (ship.bunker ?? 0)), available(m));
  while (amount > 0 && buyCost(GOOD_BY_ID.get('kohle')!.base, m, amount) > state.money) amount--;
  if (amount <= 0) return { ok: false, message: (ship.bunker ?? 0) >= (cls.bunker ?? 0) - 1 ? 'Der Bunker ist voll.' : 'Nicht genug Kohle oder Taler.', amount: 0, taler: 0 };
  const cost = bunkerCoal(state, ship, amount);
  return { ok: true, message: `${amount} t Kohle gebunkert, ${cost} Taler.`, amount, taler: cost };
}

/** Grund, warum ein Schiff nicht nach `to` ablegen kann, oder null */
export function departProblem(state: GameState, map: MapDef, shipId: number, to: string): string | null {
  const plan = planVoyage(state, map, shipId, to);
  if (!plan) return 'Das Schiff liegt nicht in einem anderen Hafen.';
  if (!plan.ok) return 'Diese Fahrt ist gerade nicht möglich.';
  const ship = getShip(state, shipId);
  const toll = plan.voyage.toll ?? 0;
  const coal = bunkerPlan(state, ship, plan.voyage.hours, toll);
  if (coal.problem) return `${coal.problem}.`;
  if (toll + coal.cost > state.money) return coal.cost ? `Zoll und Kohle kosten ${toll + coal.cost} Taler.` : `Der Zoll kostet ${toll} Taler.`;
  return null;
}

export function depart(state: GameState, map: MapDef, shipId: number, to: string): Voyage | null {
  const plan = planVoyage(state, map, shipId, to);
  if (!plan || !plan.ok) return null;
  const ship = getShip(state, shipId);
  const toll = plan.voyage.toll ?? 0;
  const coal = bunkerPlan(state, ship, plan.voyage.hours, toll);
  if (coal.problem || toll + coal.cost > state.money) return null;
  if (coal.buy > 0) bunkerCoal(state, ship, coal.buy);
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

/** Verschleiß pro Fahrstunde: nach rund 400 Fahrstunden ist ein Schiff ohne Pflege am Ende */
export const WEAR_PER_HOUR = 0.0025;

/** Unter diesem Abstand zwischen Kiel und Grund schleift das Schiff: doppelter Verschleiß */
export const TIGHT_DEPTH = 0.2;

/** Treibeis auf dem Strom im Winter: anderthalbfacher Verschleiß */
export const ICE_WEAR = 1.5;

export function wearRate(ship: Ship, extra = 1): number {
  let w = WEAR_PER_HOUR * extra;
  if (ship.captain?.trait === 'vorsichtig') w *= 0.5;
  if (hasUpgrade(ship, 'beschlag')) w *= 0.6;
  if (ship.type === 'floss') w = 0;
  return w;
}

/** Zusätzlicher Verschleiß auf dem Abschnitt, auf dem das Schiff gerade fährt */
export function wearFactor(state: GameState, map: MapDef, ship: Ship): number {
  const v = ship.voyage;
  if (!v) return 1;
  const { leg } = voyagePosition(v);
  const seg = effectiveSegments(state, map).find((s) => s.id === leg.seg);
  let f = 1;
  if (seg && segmentDepth(seg, state.waterLevel) - effectiveDraft(ship) < TIGHT_DEPTH) f *= 2;
  if (state.ice) f *= ICE_WEAR;
  return f;
}
