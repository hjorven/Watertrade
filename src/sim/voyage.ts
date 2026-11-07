import type { MapDef, SegmentDef } from '../data/maps/valley.ts';
import { hasTrait } from '../data/captains.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import { fuelOf } from '../data/ships.ts';
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
  // Gebühren für fremde Bauwerke (kein Zoll)
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
  // Treidelgeld (ab der Motorzeit, freies Spiel), kein Zoll
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

/* ---------- Brennstoff: Kohle für Dampfer, Diesel für Motorschiffe ---------- */

/** Brennstoff in Tonnen (Kohle oder Diesel), den ein Schiff für eine Fahrt dieser Länge verbraucht */
export function coalNeed(ship: Ship, hours: number): number {
  return Math.round((fuelOf(shipClass(ship))?.rate ?? 0) * hours * 10) / 10;
}

/**
 * Wo es keinen Markt für Kohle oder Diesel gibt oder er nicht reicht, verkauft ein Händler zu diesem Vielfachen
 * des Grundpreises, aber nur so viel, wie die Fahrt braucht. So sitzt kein Dampfer und kein Motorschiff fest.
 */
export const FUEL_DEALER_FACTOR = 1.5;

export interface BunkerPlan {
  /** 'kohle' oder 'diesel', leer bei Schiffen ohne Brennstoff */
  good: string;
  /** Anzeigename des Brennstoffs */
  fuelName: string;
  /** Brennstoff für die ganze Fahrt */
  need: number;
  /** Tonnen, die vor dem Ablegen gekauft werden müssen (Markt und Händler) */
  buy: number;
  /** davon beim Händler zum Aufpreis, wenn der Markt fehlt oder nicht reicht */
  dealer: number;
  /** Tonnen aus dem eigenen Kontor im Hafen (kostenlos, der Brennstoff gehört dir schon) */
  fromKontor: number;
  /** Preis für den Kauf im Hafen */
  cost: number;
  /** null, wenn genug Brennstoff da ist oder beschafft werden kann, sonst der Grund */
  problem: string | null;
}

function dealerPrice(good: string): number {
  return Math.round(GOOD_BY_ID.get(good)!.base * FUEL_DEALER_FACTOR);
}

/** Eigener Brennstoff im Kontor des Hafens, ganze Tonnen */
function kontorFuel(state: GameState, ship: Ship, good: string): number {
  return ship.port ? Math.floor(state.kontore[ship.port]?.stock[good]?.amount ?? 0) : 0;
}

/**
 * Was ein Dampfer oder Motorschiff vor dieser Fahrt bunkern muss. Der Bedarf der Fahrt kommt zuerst aus dem
 * eigenen Kontor im Hafen, der Rest wird beim Ablegen am Hafenmarkt gekauft, und zwar gleich bis zum vollen
 * Bunker oder Tank, soweit Geld und Markt reichen, damit auch die Rückfahrt aus einem Hafen ohne Brennstoffhandel
 * klappt. Fehlt dann noch etwas für die Fahrt, deckt es der Händler zum Aufpreis.
 */
export function bunkerPlan(state: GameState, ship: Ship, hours: number, toll = 0): BunkerPlan {
  const cls = shipClass(ship);
  const fuel = fuelOf(cls);
  const need = coalNeed(ship, hours);
  const none = { good: fuel?.good ?? '', fuelName: fuel?.name ?? '', need, buy: 0, dealer: 0, fromKontor: 0, cost: 0, problem: null };
  if (!fuel || need <= 0) return { ...none, need: 0 };
  const cap = cls.bunker ?? 0;
  const where = fuel.good === 'diesel' ? 'Tank' : 'Bunker';
  if (need > cap) return { ...none, problem: `Der ${where} fasst nur ${cap} t ${fuel.name}, die Fahrt braucht ${need} t` };
  const min = Math.max(0, Math.ceil(need - (ship.bunker ?? 0)));
  if (min === 0) return none;
  const room = Math.max(0, Math.floor(cap - (ship.bunker ?? 0)));
  // eigener Brennstoff zuerst, aber nur so viel, wie die Fahrt braucht: Betriebe im Kontor brauchen ihn vielleicht auch
  const fromKontor = Math.min(min, room, kontorFuel(state, ship, fuel.good));
  const rest = Math.max(0, min - fromKontor);
  const m = ship.port ? state.markets[ship.port]?.[fuel.good] : undefined;
  const stock = m ? available(m) : 0;
  const base = GOOD_BY_ID.get(fuel.good)!.base;
  // vom Markt bis zum vollen Bunker, der Händler nur für das, was der Fahrt dann noch fehlt
  let buy = Math.min(Math.max(rest, room - fromKontor), stock);
  const dealer = Math.max(0, rest - buy);
  const dealerCost = dealer * dealerPrice(fuel.good);
  // Pflicht ist nur der Bedarf der Fahrt; das Auffüllen darüber hinaus nimmt höchstens die halbe Kasse,
  // damit für Waren noch Geld bleibt
  const must = Math.max(0, rest - dealer);
  while (buy > must && toll + dealerCost + buyCost(base, m!, buy) > state.money * 0.5) buy--;
  const cost = (buy > 0 ? buyCost(base, m!, buy) : 0) + dealerCost;
  return { ...none, buy: buy + dealer, dealer, fromKontor, cost };
}

/** Brennstoff aus dem eigenen Kontor in Bunker oder Tank laden */
function bunkerFromKontor(state: GameState, ship: Ship, good: string, amount: number): void {
  const slot = state.kontore[ship.port!]?.stock[good];
  if (!slot || amount <= 0) return;
  const take = Math.min(amount, slot.amount);
  slot.cost -= (slot.cost * take) / slot.amount;
  slot.amount -= take;
  if (slot.amount < 0.001) delete state.kontore[ship.port!].stock[good];
  ship.bunker = (ship.bunker ?? 0) + take;
}

/** Brennstoff vom Markt (notfalls vom Händler) in Bunker oder Tank kaufen */
function bunkerFuel(state: GameState, ship: Ship, amount: number, dealer = 0): number {
  if (amount <= 0) return 0;
  const fuel = fuelOf(shipClass(ship))!;
  const fromMarket = amount - dealer;
  let cost = dealer * dealerPrice(fuel.good);
  if (fromMarket > 0) {
    const m = state.markets[ship.port!][fuel.good];
    cost += buyCost(GOOD_BY_ID.get(fuel.good)!.base, m, fromMarket);
    m.stock -= fromMarket;
  }
  state.money -= cost;
  state.fuelToday += cost;
  ship.bunker = (ship.bunker ?? 0) + amount;
  return cost;
}

/** Bunker oder Tank im Hafen bis oben füllen, zuerst aus dem eigenen Kontor, dann vom Markt */
export function fillBunker(state: GameState, shipId: number): { ok: boolean; message: string; amount: number; taler: number } {
  const ship = getShip(state, shipId);
  const cls = shipClass(ship);
  const fuel = fuelOf(cls);
  if (!fuel) return { ok: false, message: 'Dieses Schiff braucht keinen Brennstoff.', amount: 0, taler: 0 };
  if (!ship.port) return { ok: false, message: 'Bunkern geht nur im Hafen.', amount: 0, taler: 0 };
  const where = fuel.good === 'diesel' ? 'Der Tank' : 'Der Bunker';
  const room = Math.floor((cls.bunker ?? 0) - (ship.bunker ?? 0));
  if (room <= 0) return { ok: false, message: `${where} ist voll.`, amount: 0, taler: 0 };
  const own = Math.min(room, kontorFuel(state, ship, fuel.good));
  bunkerFromKontor(state, ship, fuel.good, own);
  const m = state.markets[ship.port][fuel.good];
  let amount = m ? Math.min(room - own, available(m)) : 0;
  while (amount > 0 && buyCost(GOOD_BY_ID.get(fuel.good)!.base, m, amount) > state.money) amount--;
  const cost = bunkerFuel(state, ship, amount);
  if (own + amount <= 0) return { ok: false, message: m ? `Nicht genug ${fuel.name} oder Taler.` : `Hier wird kein ${fuel.name} verkauft, und im Kontor liegt keiner.`, amount: 0, taler: 0 };
  const parts = [own ? `${own} t aus dem Kontor` : '', amount ? `${amount} t für ${cost} Taler vom Markt` : ''].filter(Boolean).join(' und ');
  return { ok: true, message: `${own + amount} t ${fuel.name} gebunkert, ${parts}.`, amount: own + amount, taler: cost };
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
    if (coal.cost) parts.push(coal.fuelName);
    const total = toll + coal.cost;
    if (parts.length > 1) return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]} kosten ${total} Taler.`;
    const one = ({ Zoll: 'Der Zoll', Gebühren: 'Die Gebühren', Treidelgeld: 'Das Treidelgeld', Kohle: 'Die Kohle', Diesel: 'Der Diesel' } as Record<string, string>)[parts[0] ?? 'Zoll'];
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
  if (coal.good) bunkerFromKontor(state, ship, coal.good, coal.fromKontor);
  bunkerFuel(state, ship, coal.buy, coal.dealer);
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

/** Verschleiß pro Fahrstunde: nach rund 400 Fahrstunden ist ein Holzschiff ohne Pflege am Ende (eiserne Rümpfe: ShipClass.wear) */
export const WEAR_PER_HOUR = 0.0025;

/** Unter diesem Abstand zwischen Kiel und Grund schleift das Schiff: doppelter Verschleiß */
export const TIGHT_DEPTH = 0.2;

/** Treibeis auf dem Strom im Winter: anderthalbfacher Verschleiß */
export const ICE_WEAR = 1.5;

export function wearRate(ship: Ship, extra = 1): number {
  let w = WEAR_PER_HOUR * (shipClass(ship).wear ?? 1) * extra;
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
