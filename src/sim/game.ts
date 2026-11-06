import { GOOD_BY_ID, GOODS } from '../data/goods.ts';
import type { MapDef } from '../data/maps/m1.ts';
import { buyCost, dailyTick, sellRevenue, type MarketEntry } from './economy.ts';
import { findRoute, type ShipType } from './river.ts';

export interface CargoSlot {
  amount: number;
  cost: number; // gezahlte Taler für die aktuelle Menge, für die Gewinnanzeige
}

export interface Voyage {
  from: string;
  to: string;
  hours: number;
  elapsed: number;
  downstream: boolean;
}

export interface GameState {
  money: number;
  hour: number; // Spielstunden seit Start
  shipType: ShipType;
  port: string | null; // aktueller Hafen, null während der Fahrt
  voyage: Voyage | null;
  cargo: Record<string, CargoSlot>;
  markets: Record<string, Record<string, MarketEntry>>;
  waterLevel: number;
  totalProfit: number;
  firstProfitDone: boolean;
}

export type GameEvent =
  | { type: 'arrived'; town: string }
  | { type: 'newDay'; day: number };

export interface TradeResult {
  ok: boolean;
  message: string;
  amount: number;
  taler: number;
  profit?: number;
  firstProfit?: boolean;
}

export const START_MONEY = 300;

export function newGame(map: MapDef, shipType: ShipType, startTown: string): GameState {
  const markets: GameState['markets'] = {};
  for (const town of map.towns) {
    markets[town.id] = {};
    for (const good of GOODS) {
      const rest = Math.round(map.target * (town.market[good.id] ?? 1));
      markets[town.id][good.id] = { good: good.id, stock: rest, target: map.target, rest };
    }
  }
  const cargo: GameState['cargo'] = {};
  for (const good of GOODS) cargo[good.id] = { amount: 0, cost: 0 };

  return {
    money: START_MONEY,
    hour: 8,
    shipType,
    port: startTown,
    voyage: null,
    cargo,
    markets,
    waterLevel: 0,
    totalProfit: 0,
    firstProfitDone: false,
  };
}

export function day(state: GameState): number {
  return Math.floor(state.hour / 24) + 1;
}

export function cargoLoad(state: GameState): number {
  return Object.values(state.cargo).reduce((s, c) => s + c.amount, 0);
}

export function buy(state: GameState, goodId: string, wanted: number): TradeResult {
  const fail = (message: string): TradeResult => ({ ok: false, message, amount: 0, taler: 0 });
  if (!state.port) return fail('Unterwegs kann nicht gehandelt werden.');
  const good = GOOD_BY_ID.get(goodId);
  if (!good) return fail('Unbekannte Ware.');
  const m = state.markets[state.port][goodId];

  const space = state.shipType.capacity - cargoLoad(state);
  let amount = Math.min(wanted, space, m.stock);
  // so viel kaufen, wie das Geld reicht
  while (amount > 0 && buyCost(good.base, m, amount) > state.money) amount--;

  if (amount <= 0) {
    if (space <= 0) return fail('Der Laderaum ist voll.');
    if (m.stock <= 0) return fail(`Kein ${good.name} mehr auf dem Markt.`);
    return fail('Nicht genug Taler.');
  }

  const cost = buyCost(good.base, m, amount);
  state.money -= cost;
  m.stock -= amount;
  state.cargo[goodId].amount += amount;
  state.cargo[goodId].cost += cost;
  return { ok: true, message: `${amount} ${good.unit} ${good.name} für ${cost} Taler gekauft.`, amount, taler: cost };
}

export function sell(state: GameState, goodId: string, wanted: number): TradeResult {
  const fail = (message: string): TradeResult => ({ ok: false, message, amount: 0, taler: 0 });
  if (!state.port) return fail('Unterwegs kann nicht gehandelt werden.');
  const good = GOOD_BY_ID.get(goodId);
  if (!good) return fail('Unbekannte Ware.');
  const slot = state.cargo[goodId];
  const amount = Math.min(wanted, slot.amount);
  if (amount <= 0) return fail(`Kein ${good.name} an Bord.`);

  const m = state.markets[state.port][goodId];
  const revenue = sellRevenue(good.base, m, amount);
  // anteiliger Einkaufspreis der verkauften Menge
  const costShare = Math.round((slot.cost * amount) / slot.amount);
  slot.cost -= costShare;
  slot.amount -= amount;
  m.stock += amount;
  state.money += revenue;

  const profit = revenue - costShare;
  state.totalProfit += profit;
  const firstProfit = profit > 0 && !state.firstProfitDone;
  if (firstProfit) state.firstProfitDone = true;

  return {
    ok: true,
    message: `${amount} ${good.unit} ${good.name} für ${revenue} Taler verkauft.`,
    amount,
    taler: revenue,
    profit,
    firstProfit,
  };
}

export function planVoyage(state: GameState, map: MapDef, to: string): Voyage | null {
  if (!state.port || state.port === to) return null;
  const route = findRoute(map.segments, state.port, to, state.shipType, state.waterLevel);
  if (!route) return null;
  // In M1 gibt es nur einen Abschnitt; Richtung aus dem ersten Abschnitt der Route
  const seg = map.segments.find((s) => s.id === route.path[0])!;
  return { from: state.port, to, hours: route.hours, elapsed: 0, downstream: seg.from === state.port };
}

export function depart(state: GameState, map: MapDef, to: string): Voyage | null {
  const voyage = planVoyage(state, map, to);
  if (!voyage) return null;
  state.voyage = voyage;
  state.port = null;
  return voyage;
}

/** Spielzeit vorrücken. Märkte arbeiten jeden Tag um Mitternacht. */
export function advance(state: GameState, hours: number): GameEvent[] {
  const events: GameEvent[] = [];
  const before = day(state);
  state.hour += hours;
  const after = day(state);
  for (let d = before + 1; d <= after; d++) {
    for (const town of Object.values(state.markets)) {
      for (const m of Object.values(town)) dailyTick(m);
    }
    events.push({ type: 'newDay', day: d });
  }

  const v = state.voyage;
  if (v) {
    v.elapsed = Math.min(v.hours, v.elapsed + hours);
    if (v.elapsed >= v.hours) {
      state.port = v.to;
      state.voyage = null;
      events.push({ type: 'arrived', town: v.to });
    }
  }
  return events;
}
