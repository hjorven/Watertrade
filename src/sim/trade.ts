import { KONTOR_CAPACITY, KONTOR_SELL_FACTOR } from '../data/buildings.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import { available, price, SELL_FACTOR, type MarketEntry } from './economy.ts';
import { FRESH_GOODS } from '../data/ships.ts';
import { tripSale } from './market-info.ts';
import { addToSlot, capacityOf, cargoLoad, fail, getShip, shipClass, type CargoSlot, type GameState, type Ship, type TradeResult } from './state.ts';

/** Händlerblut am Ruder: etwas bessere Preise */
const HAENDLER = 0.04;

/** Preis der i-ten gekauften Einheit (1-basiert) */
const unitBuy = (base: number, m: MarketEntry, i: number) => price(base, m.stock - i, m.target);
const unitSell = (base: number, m: MarketEntry, i: number, f: number) => Math.floor(price(base, m.stock + i, m.target) * f);

export function sellFactorAt(state: GameState, town: string): number {
  return state.kontore[town] ? KONTOR_SELL_FACTOR : SELL_FACTOR;
}

export function kontorSpace(state: GameState, town: string): number {
  const k = state.kontore[town];
  if (!k) return 0;
  return KONTOR_CAPACITY[k.level] - cargoLoad({ cargo: k.stock });
}

/**
 * Kauf vom Markt in einen Laderaum (Schiff oder Kontor).
 * Kauft so viel wie Platz, Geld, Angebot und Höchstpreis erlauben.
 */
function buyInto(
  state: GameState,
  town: string,
  cargo: Record<string, CargoSlot>,
  space: number,
  goodId: string,
  wanted: number,
  opts: { haendler?: boolean; limit?: number } = {},
): TradeResult {
  const good = GOOD_BY_ID.get(goodId);
  const m = state.markets[town][goodId];
  if (!good || !m) return fail('Diese Ware wird hier nicht gehandelt.');
  const rebate = opts.haendler ? 1 - HAENDLER : 1;
  const max = Math.min(wanted, space, available(m));
  let amount = 0;
  let cost = 0;
  for (let i = 1; i <= max; i++) {
    const p = unitBuy(good.base, m, i);
    if (opts.limit && p > opts.limit) break;
    if (Math.round((cost + p) * rebate) > state.money) break;
    cost += p;
    amount = i;
  }
  cost = Math.round(cost * rebate);
  if (amount <= 0) {
    if (space <= 0) return fail('Der Laderaum ist voll.');
    if (available(m) <= 0) return fail(`Kein ${good.name} mehr auf dem Markt.`);
    if (opts.limit && unitBuy(good.base, m, 1) > opts.limit) return fail(`${good.name} ist teurer als ${opts.limit} Taler.`);
    return fail('Nicht genug Taler.');
  }
  state.money -= cost;
  m.stock -= amount;
  addToSlot(cargo, goodId, amount, cost);
  return { ok: true, message: `${amount} t ${good.name} für ${cost} Taler gekauft.`, amount, taler: cost };
}

/** Verkauf aus einem Laderaum an den Markt */
function sellFrom(
  state: GameState,
  town: string,
  cargo: Record<string, CargoSlot>,
  goodId: string,
  wanted: number,
  opts: { haendler?: boolean; limit?: number; bonus?: number } = {},
): TradeResult {
  const good = GOOD_BY_ID.get(goodId);
  if (!good) return fail('Unbekannte Ware.');
  const slot = cargo[goodId];
  const max = Math.min(wanted, Math.floor(slot?.amount ?? 0));
  if (max <= 0) return fail(`Kein ${good.name} vorrätig.`);
  const m = state.markets[town][goodId];
  if (!m) return fail(`${good.name} wird hier nicht gehandelt.`);
  // verdorbene Ware bringt weniger
  const f = sellFactorAt(state, town) * (opts.haendler ? 1 + HAENDLER : 1) * (1 + (opts.bonus ?? 0)) * (slot.fresh ?? 1);
  let amount = 0;
  let revenue = 0;
  for (let i = 1; i <= max; i++) {
    const p = unitSell(good.base, m, i, f);
    if (opts.limit && p < opts.limit) break;
    revenue += p;
    amount = i;
  }
  if (amount <= 0) return fail(`${good.name} bringt hier weniger als ${opts.limit} Taler.`);

  const costShare = Math.round((slot.cost * amount) / slot.amount);
  slot.cost -= costShare;
  slot.amount -= amount;
  if (slot.amount < 0.001) delete cargo[goodId];
  m.stock += amount;
  state.money += revenue;

  const profit = revenue - costShare;
  state.totalProfit += profit;
  const delivered = (state.stats.delivered[town] ??= {});
  delivered[goodId] = (delivered[goodId] ?? 0) + amount;
  const firstProfit = profit > 0 && !state.firstProfitDone;
  if (firstProfit) state.firstProfitDone = true;
  return { ok: true, message: `${amount} t ${good.name} für ${revenue} Taler verkauft.`, amount, taler: revenue, profit, firstProfit };
}

const isHaendler = (ship: Ship) => ship.captain?.trait === 'haendler';

export function buy(state: GameState, shipId: number, goodId: string, wanted: number, limit = 0): TradeResult {
  const ship = getShip(state, shipId);
  if (!ship.port) return fail('Unterwegs kann nicht gehandelt werden.');
  return buyInto(state, ship.port, ship.cargo, capacityOf(ship) - cargoLoad(ship), goodId, wanted, { haendler: isHaendler(ship), limit });
}

export function sell(state: GameState, shipId: number, goodId: string, wanted: number, limit = 0): TradeResult {
  const ship = getShip(state, shipId);
  if (!ship.port) return fail('Unterwegs kann nicht gehandelt werden.');
  // Kühlschiff: frische Ware bringt einen Aufpreis
  const fresh = FRESH_GOODS.includes(goodId) ? (shipClass(ship).fresh ?? 0) : 0;
  const r = sellFrom(state, ship.port, ship.cargo, goodId, wanted, { haendler: isHaendler(ship), limit, bonus: fresh });
  if (!r.ok && r.message.startsWith('Kein ')) return fail(r.message.replace('vorrätig', 'an Bord'));
  if (r.ok) tripSale(ship, r.taler, r.taler - (r.profit ?? 0), r.amount);
  return r;
}

/** Vom Markt direkt ins Kontorlager kaufen */
export function kontorBuy(state: GameState, town: string, goodId: string, wanted: number): TradeResult {
  const k = state.kontore[town];
  if (!k) return fail('Hier gibt es kein eigenes Kontor.');
  return buyInto(state, town, k.stock, kontorSpace(state, town), goodId, wanted);
}

/** Aus dem Kontorlager an den Markt verkaufen */
export function kontorSell(state: GameState, town: string, goodId: string, wanted: number): TradeResult {
  const k = state.kontore[town];
  if (!k) return fail('Hier gibt es kein eigenes Kontor.');
  return sellFrom(state, town, k.stock, goodId, wanted);
}

function move(from: Record<string, CargoSlot>, to: Record<string, CargoSlot>, goodId: string, amount: number): void {
  const slot = from[goodId];
  const costShare = Math.round((slot.cost * amount) / slot.amount);
  const fresh = slot.fresh ?? 1;
  slot.amount -= amount;
  slot.cost -= costShare;
  if (slot.amount < 0.001) delete from[goodId];
  addToSlot(to, goodId, amount, costShare, fresh);
}

/** Ware vom Schiff ins Kontor */
export function store(state: GameState, shipId: number, goodId: string, wanted: number): TradeResult {
  const ship = getShip(state, shipId);
  const name = GOOD_BY_ID.get(goodId)?.name ?? goodId;
  if (!ship.port || !state.kontore[ship.port]) return fail('Hier gibt es kein eigenes Kontor.');
  const amount = Math.min(wanted, ship.cargo[goodId]?.amount ?? 0, Math.floor(kontorSpace(state, ship.port)));
  if (amount <= 0) return fail(ship.cargo[goodId] ? 'Das Kontor ist voll.' : `Kein ${name} an Bord.`);
  move(ship.cargo, state.kontore[ship.port].stock, goodId, amount);
  return { ok: true, message: `${amount} t ${name} eingelagert.`, amount, taler: 0 };
}

/** Ware aus dem Kontor an Bord */
export function load(state: GameState, shipId: number, goodId: string, wanted: number): TradeResult {
  const ship = getShip(state, shipId);
  const name = GOOD_BY_ID.get(goodId)?.name ?? goodId;
  const k = ship.port ? state.kontore[ship.port] : undefined;
  if (!k) return fail('Hier gibt es kein eigenes Kontor.');
  const amount = Math.min(wanted, Math.floor(k.stock[goodId]?.amount ?? 0), capacityOf(ship) - cargoLoad(ship));
  if (amount <= 0) return fail((k.stock[goodId]?.amount ?? 0) >= 1 ? 'Der Laderaum ist voll.' : `Kein ${name} im Kontor.`);
  move(k.stock, ship.cargo, goodId, amount);
  return { ok: true, message: `${amount} t ${name} an Bord genommen.`, amount, taler: 0 };
}
