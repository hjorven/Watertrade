import type { MapDef, SegmentDef } from '../data/maps/valley.ts';
import { hasTrait } from '../data/captains.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import { available, buyCost } from './economy.ts';
import { explainBlock, findRoute, segmentDepth, travelTime, type BlockReason, type ShipType } from './river.ts';
import { effectiveSegments } from './works.ts';
import { playerToll } from './standing.ts';
import { towFee } from './epochs.ts';
import { tripDepart } from './market-info.ts';
import { capacityOf, cargoLoad, conditions, effectiveDraft, effectiveType, getShip, hasUpgrade, shipClass, type FeeItem, type GameState, type Leg, type Ship, type Voyage } from './state.ts';
import { dockTime, feeSum, lighterFee, playerPaidFees, worksFees } from './wasserbau.ts';

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
  // ab der Motorzeit kostet Treideln bergauf Treidelgeld; planVoyage rechnet es zum Betrag beim Ablegen
  const fee = towFee(state, type.propulsion, legs.reduce((s, l) => s + (l.downstream ? 0 : l.hours), 0));
  const voyage: Voyage = { from, to, legs, hours, elapsed: 0, toll };
  if (fee > 0) voyage.towFee = fee;
  return { ok: true, voyage };
}

export function planVoyage(state: GameState, map: MapDef, shipId: number, to: string): VoyagePlan | null {
  const ship = getShip(state, shipId);
  if (!ship.port || ship.port === to) return null;
  const boost = hasTrait(ship.captain, 'treidelmeister') && ship.type !== 'segelkahn' ? 1.2 : 1;
  const plan = planRoute(state, map, ship.port, to, effectiveType(state, ship), boost);
  if (!plan.ok) return plan;
  const v = plan.voyage;
  // Ratssitz: halber Zoll auf den Abschnitten an der eigenen Ratsstadt
  if (v.toll) v.toll = playerToll(state, map, v.legs, (seg) => tollOn(state, seg));
  // Der Schmuggler fährt am Zoll vorbei; was er spart, merkt sich die Fahrt für eine mögliche Kontrolle
  if (hasTrait(ship.captain, 'schmuggler') && (v.toll ?? 0) > 0) {
    v.evaded = v.toll;
    v.toll = 0;
  }
  // Gebühren für fremde Bauwerke zahlt auch der Schmuggler, das ist kein Zoll
  const fees: FeeItem[] = worksFees(
    state,
    v.legs.map((l) => l.seg),
    'spieler',
    capacityOf(ship),
  );
  // Liegezeit: Laden im Abfahrtshafen, Löschen am Ziel; zu tiefe Schiffe werden über Schuten geleichtert
  const tons = cargoLoad(ship);
  const draft = effectiveDraft(ship);
  const load = dockTime(state, ship.port, tons, draft);
  const unload = dockTime(state, to, tons, draft, 1);
  if (tons > 0 && load.lighter) fees.push({ work: 'leichtern', amount: lighterFee(tons) });
  if (tons > 0 && unload.lighter) fees.push({ work: 'leichtern', amount: lighterFee(tons) });
  if (fees.length) {
    v.fees = fees;
    v.toll = (v.toll ?? 0) + feeSum(fees);
  }
  if (load.hours > 0) v.dock = load.hours;
  if (unload.hours > 0) v.dockEnd = unload.hours;
  v.hours += load.hours + unload.hours;
  // Treidelgeld (ab der Motorzeit, freies Spiel) zahlt auch der Schmuggler, es ist kein Zoll
  if (v.towFee) v.toll = (v.toll ?? 0) + v.towFee;
  return plan;
}

/** Reine Fahrzeit ohne Liegezeit in den Häfen */
export function sailingHours(v: Voyage): number {
  return v.hours - (v.dock ?? 0) - (v.dockEnd ?? 0);
}

/** Fahrstunden (ohne Liegezeit) im Zeitraum von `before` bis `after` Stunden seit Fahrtbeginn */
export function movingHours(v: Voyage, before: number, after: number): number {
  const start = v.dock ?? 0;
  const end = start + sailingHours(v);
  return Math.max(0, Math.min(after, end) - Math.max(before, start));
}

/* ---------- Kohle für Dampfer ---------- */

/** Kohle in Tonnen, die ein Dampfer für eine Fahrt dieser Länge verbrennt */
export function coalNeed(ship: Ship, hours: number): number {
  return Math.round((shipClass(ship).coal ?? 0) * hours * 10) / 10;
}

export interface BunkerPlan {
  /** Kohle für die ganze Fahrt */
  need: number;
  /** Tonnen, die vor dem Ablegen am Markt gekauft werden müssen */
  buy: number;
  /** Tonnen aus dem eigenen Kontor im Hafen (kostenlos, die Kohle gehört dir schon) */
  fromKontor: number;
  /** Preis dafür auf dem Markt im Hafen */
  cost: number;
  /** null, wenn genug Kohle da ist oder gekauft werden kann, sonst der Grund */
  problem: string | null;
}

/** Eigene Kohle im Kontor des Hafens, ganze Tonnen */
function kontorCoal(state: GameState, ship: Ship): number {
  return ship.port ? Math.floor(state.kontore[ship.port]?.stock.kohle?.amount ?? 0) : 0;
}

/**
 * Was ein Dampfer vor dieser Fahrt bunkern muss. Fehlt Kohle, kommt der Bedarf der Fahrt zuerst aus dem
 * eigenen Kontor im Hafen, der Rest wird beim Ablegen am Hafenmarkt gekauft, und zwar gleich bis zum vollen Bunker,
 * soweit Geld und Markt reichen, damit auch die Rückfahrt aus einem Hafen ohne Kohlehandel klappt.
 */
export function bunkerPlan(state: GameState, ship: Ship, hours: number, toll = 0): BunkerPlan {
  const cls = shipClass(ship);
  const need = coalNeed(ship, hours);
  const none = { need: 0, buy: 0, fromKontor: 0, cost: 0, problem: null };
  if (!cls.coal || need <= 0) return none;
  if (need > (cls.bunker ?? 0)) return { ...none, need, problem: `Der Bunker fasst nur ${cls.bunker} t Kohle, die Fahrt braucht ${need} t` };
  const min = Math.max(0, Math.ceil(need - (ship.bunker ?? 0)));
  if (min === 0) return { ...none, need };
  const room = Math.max(0, Math.floor((cls.bunker ?? 0) - (ship.bunker ?? 0)));
  // eigene Kohle zuerst, aber nur so viel, wie die Fahrt braucht: Betriebe im Kontor brauchen sie vielleicht auch
  const fromKontor = Math.min(min, room, kontorCoal(state, ship));
  const rest = Math.max(0, min - fromKontor);
  const m = ship.port ? state.markets[ship.port]?.kohle : undefined;
  // reicht die Kontorkohle für die Fahrt, füllt der Markt (falls es einen gibt) nur noch freiwillig auf
  if (rest === 0 && !m) return { need, buy: 0, fromKontor, cost: 0, problem: null };
  const stored = fromKontor ? `, im Kontor liegen nur ${fromKontor} t` : '';
  if (!m) return { need, buy: rest, fromKontor, cost: 0, problem: `Zu wenig Kohle im Bunker${stored}, und hier wird keine verkauft (${rest} t fehlen)` };
  if (available(m) < rest) return { need, buy: rest, fromKontor, cost: 0, problem: `Der Markt hat nur ${available(m)} t Kohle${stored}, es fehlen ${rest} t` };
  const base = GOOD_BY_ID.get('kohle')!.base;
  let buy = Math.max(rest, Math.min(room - fromKontor, available(m)));
  while (buy > rest && toll + buyCost(base, m, buy) > state.money) buy--;
  return { need, buy, fromKontor, cost: buyCost(base, m, buy), problem: null };
}

/** Kohle aus dem eigenen Kontor in den Bunker laden */
function bunkerFromKontor(state: GameState, ship: Ship, amount: number): void {
  const slot = state.kontore[ship.port!]?.stock.kohle;
  if (!slot || amount <= 0) return;
  const take = Math.min(amount, slot.amount);
  slot.cost -= (slot.cost * take) / slot.amount;
  slot.amount -= take;
  if (slot.amount < 0.001) delete state.kontore[ship.port!].stock.kohle;
  ship.bunker = (ship.bunker ?? 0) + take;
}

/** Kohle vom Markt in den Bunker kaufen */
function bunkerCoal(state: GameState, ship: Ship, amount: number): number {
  if (amount <= 0) return 0;
  const m = state.markets[ship.port!].kohle;
  const cost = buyCost(GOOD_BY_ID.get('kohle')!.base, m, amount);
  m.stock -= amount;
  state.money -= cost;
  state.fuelToday += cost;
  ship.bunker = (ship.bunker ?? 0) + amount;
  return cost;
}

/** Bunker im Hafen bis oben füllen, zuerst aus dem eigenen Kontor, dann vom Markt */
export function fillBunker(state: GameState, shipId: number): { ok: boolean; message: string; amount: number; taler: number } {
  const ship = getShip(state, shipId);
  const cls = shipClass(ship);
  if (!cls.coal) return { ok: false, message: 'Dieses Schiff braucht keine Kohle.', amount: 0, taler: 0 };
  if (!ship.port) return { ok: false, message: 'Bunkern geht nur im Hafen.', amount: 0, taler: 0 };
  const room = Math.floor((cls.bunker ?? 0) - (ship.bunker ?? 0));
  if (room <= 0) return { ok: false, message: 'Der Bunker ist voll.', amount: 0, taler: 0 };
  const own = Math.min(room, kontorCoal(state, ship));
  bunkerFromKontor(state, ship, own);
  const m = state.markets[ship.port].kohle;
  let amount = m ? Math.min(room - own, available(m)) : 0;
  while (amount > 0 && buyCost(GOOD_BY_ID.get('kohle')!.base, m, amount) > state.money) amount--;
  const cost = bunkerCoal(state, ship, amount);
  if (own + amount <= 0) return { ok: false, message: m ? 'Nicht genug Kohle oder Taler.' : 'Hier wird keine Kohle verkauft, und im Kontor liegt keine.', amount: 0, taler: 0 };
  const parts = [own ? `${own} t aus dem Kontor` : '', amount ? `${amount} t für ${cost} Taler vom Markt` : ''].filter(Boolean).join(' und ');
  return { ok: true, message: `${own + amount} t Kohle gebunkert, ${parts}.`, amount: own + amount, taler: cost };
}

/** Grund, warum ein Schiff nicht nach `to` ablegen kann, oder null */
export function departProblem(state: GameState, map: MapDef, shipId: number, to: string): string | null {
  const plan = planVoyage(state, map, shipId, to);
  if (!plan) return 'Das Schiff liegt nicht in einem anderen Hafen.';
  if (!plan.ok) return 'Diese Fahrt ist gerade nicht möglich.';
  const ship = getShip(state, shipId);
  const toll = plan.voyage.toll ?? 0;
  const coal = bunkerPlan(state, ship, sailingHours(plan.voyage), toll);
  if (coal.problem) return `${coal.problem}.`;
  if (toll + coal.cost > state.money) {
    const fee = plan.voyage.towFee ?? 0;
    const fees = feeSum(plan.voyage.fees);
    const parts: string[] = [];
    if (toll - fee - fees > 0) parts.push('Zoll');
    if (fees > 0) parts.push('Gebühren');
    if (fee > 0) parts.push('Treidelgeld');
    if (coal.cost) parts.push('Kohle');
    const total = toll + coal.cost;
    if (parts.length > 1) return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]} kosten ${total} Taler.`;
    const one = { Zoll: 'Der Zoll', Gebühren: 'Die Gebühren', Treidelgeld: 'Das Treidelgeld', Kohle: 'Die Kohle' }[parts[0] ?? 'Zoll'];
    return `${one} ${parts[0] === 'Gebühren' ? 'kosten' : 'kostet'} ${total} Taler.`;
  }
  return null;
}

export function depart(state: GameState, map: MapDef, shipId: number, to: string): Voyage | null {
  const plan = planVoyage(state, map, shipId, to);
  if (!plan || !plan.ok) return null;
  const ship = getShip(state, shipId);
  const toll = plan.voyage.toll ?? 0;
  const coal = bunkerPlan(state, ship, sailingHours(plan.voyage), toll);
  if (coal.problem || toll + coal.cost > state.money) return null;
  bunkerFromKontor(state, ship, coal.fromKontor);
  bunkerCoal(state, ship, coal.buy);
  state.money -= toll;
  playerPaidFees(state, plan.voyage);
  tripDepart(state, ship, ship.port!, to, toll);
  ship.voyage = plan.voyage;
  ship.port = null;
  state.stats.trips++;
  return plan.voyage;
}

/** Aktueller Abschnitt einer Fahrt und Fortschritt darin (0..1) */
export function voyagePosition(v: Voyage): { leg: Leg; progress: number; index: number } {
  // während der Liegezeit zum Laden liegt das Schiff noch am Anleger
  let t = Math.max(0, v.elapsed - (v.dock ?? 0));
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
  if (hasTrait(ship.captain, 'vorsichtig')) w *= 0.5;
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
