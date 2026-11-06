import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef, SegmentDef } from '../data/maps/valley.ts';
import { SHIPS, type ShipClass } from '../data/ships.ts';
import { available, buyCost, sellRevenue } from './economy.ts';
import { isIce, waterLevel } from './calendar.ts';
import { explainBlock, findRoute, travelTime, windOfDay, withWind, type BlockReason, type Conditions } from './river.ts';
import { initialMarket, initialTown, tickTown, type TownMarket, type TownState } from './towns.ts';

export interface CargoSlot {
  amount: number;
  cost: number; // gezahlte Taler für die aktuelle Menge, für die Gewinnanzeige
}

export interface Leg {
  seg: string;
  from: string;
  to: string;
  hours: number;
  downstream: boolean;
}

export interface Voyage {
  from: string;
  to: string;
  legs: Leg[];
  hours: number;
  elapsed: number;
}

export interface Ship {
  id: number;
  type: string;
  name: string;
  port: string | null; // aktueller Hafen, null während der Fahrt
  voyage: Voyage | null;
  cargo: Record<string, CargoSlot>;
}

export interface GameState {
  money: number;
  hour: number; // Spielstunden seit Start
  ships: Ship[];
  markets: Record<string, TownMarket>;
  towns: Record<string, TownState>;
  waterLevel: number;
  ice: boolean;
  totalProfit: number;
  firstProfitDone: boolean;
  nextShipId: number;
  /** Erlaubte Schiffstypen (Kampagne schränkt ein), leer = alle */
  allowedShips: string[];
  stats: {
    delivered: Record<string, Record<string, number>>; // Stadt -> Ware -> verkaufte Tonnen
    rafts: number; // zerlegte Flöße
    trips: number;
  };
}

export interface NewGameOptions {
  startTown: string;
  startShip?: string;
  money?: number;
  allowedShips?: string[];
}

export type GameEvent =
  | { type: 'arrived'; ship: number; town: string }
  | { type: 'newDay'; day: number }
  | { type: 'townLevel'; town: string; level: number; up: boolean; newGoods: string[] };

export interface TradeResult {
  ok: boolean;
  message: string;
  amount: number;
  taler: number;
  profit?: number;
  firstProfit?: boolean;
}

export const START_MONEY = 500;

const SHIP_NAMES = ['Anna', 'Greta', 'Hoffnung', 'Lotte', 'Möwe', 'Fortuna', 'Elise', 'Biber', 'Wilhelmine', 'Otter', 'Marie', 'Eintracht'];

export function newGame(map: MapDef, startTownOrOptions: string | NewGameOptions): GameState {
  const opts: NewGameOptions =
    typeof startTownOrOptions === 'string' ? { startTown: startTownOrOptions } : startTownOrOptions;
  const startTown = opts.startTown;
  const startShip = opts.startShip ?? 'treidelkahn';
  const markets: GameState['markets'] = {};
  const towns: GameState['towns'] = {};
  for (const def of map.towns) {
    towns[def.id] = initialTown(def);
    markets[def.id] = initialMarket(def, towns[def.id]);
  }
  const state: GameState = {
    money: opts.money ?? START_MONEY,
    hour: 8,
    ships: [],
    markets,
    towns,
    waterLevel: waterLevel(1),
    ice: isIce(1),
    totalProfit: 0,
    firstProfitDone: false,
    nextShipId: 1,
    allowedShips: opts.allowedShips ?? [],
    stats: { delivered: {}, rafts: 0, trips: 0 },
  };
  addShip(state, startShip, startTown);
  return state;
}

function addShip(state: GameState, type: string, port: string): Ship {
  const id = state.nextShipId++;
  const ship: Ship = {
    id,
    type,
    name: SHIP_NAMES[(id - 1) % SHIP_NAMES.length],
    port,
    voyage: null,
    cargo: {},
  };
  state.ships.push(ship);
  return ship;
}

export function shipClass(ship: Ship): ShipClass {
  return SHIPS[ship.type];
}

export function getShip(state: GameState, id: number): Ship {
  const s = state.ships.find((x) => x.id === id);
  if (!s) throw new Error(`Schiff ${id} unbekannt`);
  return s;
}

export function day(state: GameState): number {
  return Math.floor(state.hour / 24) + 1;
}

export function wind(state: GameState): number {
  return windOfDay(day(state));
}

export function conditions(state: GameState): Conditions {
  return { level: state.waterLevel, ice: state.ice };
}

/** Leicht beladene Schiffe liegen höher im Wasser: Tiefgang zwischen 60 % (leer) und 100 % (voll) */
export function effectiveDraft(ship: Ship): number {
  const cls = shipClass(ship);
  return cls.draft * (0.6 + 0.4 * Math.min(1, cargoLoad(ship) / cls.capacity));
}

export function cargoLoad(ship: Ship): number {
  return Object.values(ship.cargo).reduce((s, c) => s + c.amount, 0);
}

const fail = (message: string): TradeResult => ({ ok: false, message, amount: 0, taler: 0 });

export function buy(state: GameState, shipId: number, goodId: string, wanted: number): TradeResult {
  const ship = getShip(state, shipId);
  if (!ship.port) return fail('Unterwegs kann nicht gehandelt werden.');
  const good = GOOD_BY_ID.get(goodId);
  const m = state.markets[ship.port][goodId];
  if (!good || !m) return fail('Diese Ware wird hier nicht gehandelt.');

  const space = shipClass(ship).capacity - cargoLoad(ship);
  let amount = Math.min(wanted, space, available(m));
  // so viel kaufen, wie das Geld reicht
  while (amount > 0 && buyCost(good.base, m, amount) > state.money) amount--;

  if (amount <= 0) {
    if (space <= 0) return fail('Der Laderaum ist voll.');
    if (available(m) <= 0) return fail(`Kein ${good.name} mehr auf dem Markt.`);
    return fail('Nicht genug Taler.');
  }

  const cost = buyCost(good.base, m, amount);
  state.money -= cost;
  m.stock -= amount;
  const slot = (ship.cargo[goodId] ??= { amount: 0, cost: 0 });
  slot.amount += amount;
  slot.cost += cost;
  return { ok: true, message: `${amount} t ${good.name} für ${cost} Taler gekauft.`, amount, taler: cost };
}

export function sell(state: GameState, shipId: number, goodId: string, wanted: number): TradeResult {
  const ship = getShip(state, shipId);
  if (!ship.port) return fail('Unterwegs kann nicht gehandelt werden.');
  const good = GOOD_BY_ID.get(goodId);
  if (!good) return fail('Unbekannte Ware.');
  const slot = ship.cargo[goodId];
  const amount = Math.min(wanted, slot?.amount ?? 0);
  if (amount <= 0) return fail(`Kein ${good.name} an Bord.`);
  const m = state.markets[ship.port][goodId];
  if (!m) return fail(`${good.name} wird hier nicht gehandelt.`);

  const revenue = sellRevenue(good.base, m, amount);
  // anteiliger Einkaufspreis der verkauften Menge
  const costShare = Math.round((slot.cost * amount) / slot.amount);
  slot.cost -= costShare;
  slot.amount -= amount;
  if (slot.amount === 0) delete ship.cargo[goodId];
  m.stock += amount;
  state.money += revenue;

  const profit = revenue - costShare;
  state.totalProfit += profit;
  const town = (state.stats.delivered[ship.port] ??= {});
  town[goodId] = (town[goodId] ?? 0) + amount;
  const firstProfit = profit > 0 && !state.firstProfitDone;
  if (firstProfit) state.firstProfitDone = true;

  return {
    ok: true,
    message: `${amount} t ${good.name} für ${revenue} Taler verkauft.`,
    amount,
    taler: revenue,
    profit,
    firstProfit,
  };
}

export type VoyagePlan = { ok: true; voyage: Voyage } | { ok: false; reasons: { seg: SegmentDef; reason: BlockReason }[] };

export function planVoyage(state: GameState, map: MapDef, shipId: number, to: string): VoyagePlan | null {
  const ship = getShip(state, shipId);
  if (!ship.port || ship.port === to) return null;
  const type = { ...withWind(shipClass(ship), wind(state)), draft: effectiveDraft(ship) };
  const cond = conditions(state);
  const route = findRoute(map.segments, ship.port, to, type, cond);
  if (!route) {
    const reasons = explainBlock(map.segments, ship.port, to, type, cond);
    return { ok: false, reasons: reasons as { seg: SegmentDef; reason: BlockReason }[] };
  }
  const legs: Leg[] = [];
  let node = ship.port;
  for (const id of route.path) {
    const seg = map.segments.find((s) => s.id === id)!;
    const downstream = seg.from === node;
    const next = downstream ? seg.to : seg.from;
    legs.push({ seg: id, from: node, to: next, downstream, hours: travelTime(seg, type, downstream, cond)! });
    node = next;
  }
  return { ok: true, voyage: { from: ship.port, to, legs, hours: route.hours, elapsed: 0 } };
}

export function depart(state: GameState, map: MapDef, shipId: number, to: string): Voyage | null {
  const plan = planVoyage(state, map, shipId, to);
  if (!plan || !plan.ok) return null;
  const ship = getShip(state, shipId);
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

export function buyShip(state: GameState, map: MapDef, town: string, type: string): { ok: boolean; message: string; ship?: Ship } {
  const def = map.towns.find((t) => t.id === town);
  const cls = SHIPS[type];
  if (!def || !cls || !def.shipyard.includes(type)) return { ok: false, message: 'Hier wird dieser Schiffstyp nicht gebaut.' };
  if (!shipAllowed(state, type)) return { ok: false, message: `${cls.name} gibt es in diesem Kapitel noch nicht.` };
  if (state.money < cls.price) return { ok: false, message: `Ein ${cls.name} kostet ${cls.price} Taler.` };
  state.money -= cls.price;
  const ship = addShip(state, type, town);
  return { ok: true, message: `${cls.name} „${ship.name}" liegt in ${def.name} bereit.`, ship };
}

export function shipAllowed(state: GameState, type: string): boolean {
  return state.allowedShips.length === 0 || state.allowedShips.includes(type);
}

/** Holzmenge, die ein zerlegtes Floß ergibt */
export const RAFT_TIMBER = 20;

/** Floß am Ziel zerlegen und das Holz verkaufen. Ladung muss vorher von Bord. */
export function dismantleRaft(state: GameState, shipId: number): TradeResult {
  const ship = getShip(state, shipId);
  if (ship.type !== 'floss') return fail('Nur ein Floß kann zerlegt werden.');
  if (!ship.port) return fail('Erst anlegen, dann zerlegen.');
  if (cargoLoad(ship) > 0) return fail('Erst die Ladung verkaufen.');
  const m = state.markets[ship.port].holz;
  const revenue = m ? sellRevenue(GOOD_BY_ID.get('holz')!.base, m, RAFT_TIMBER) : 0;
  if (m) m.stock += RAFT_TIMBER;
  state.money += revenue;
  state.ships = state.ships.filter((s) => s.id !== shipId);
  state.stats.rafts++;
  return {
    ok: true,
    message: m ? `Floß zerlegt, ${RAFT_TIMBER} t Holz für ${revenue} Taler verkauft.` : 'Floß zerlegt. Hier kauft niemand Holz.',
    amount: RAFT_TIMBER,
    taler: revenue,
  };
}

/** Spielzeit vorrücken. Städte arbeiten jeden Tag um Mitternacht. */
export function advance(state: GameState, map: MapDef, hours: number): GameEvent[] {
  const events: GameEvent[] = [];
  const before = day(state);
  state.hour += hours;
  const after = day(state);
  for (let d = before + 1; d <= after; d++) {
    for (const def of map.towns) {
      const r = tickTown(def, state.markets[def.id], state.towns[def.id]);
      if (r.levelUp !== undefined || r.levelDown !== undefined) {
        const up = r.levelUp !== undefined;
        events.push({ type: 'townLevel', town: def.id, level: (r.levelUp ?? r.levelDown)!, up, newGoods: r.newGoods });
      }
    }
    state.ice = isIce(d);
    events.push({ type: 'newDay', day: d });
  }
  state.waterLevel = waterLevel(state.hour / 24 + 1);

  for (const ship of state.ships) {
    const v = ship.voyage;
    if (!v) continue;
    v.elapsed = Math.min(v.hours, v.elapsed + hours);
    if (v.elapsed >= v.hours) {
      ship.port = v.to;
      ship.voyage = null;
      events.push({ type: 'arrived', ship: ship.id, town: v.to });
    }
  }
  return events;
}

export function anySailing(state: GameState): boolean {
  return state.ships.some((s) => s.voyage !== null);
}
