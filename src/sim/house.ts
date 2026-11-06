import { BUILDING_BY_ID, KONTOR_CAPACITY, KONTOR_PRICE, KONTOR_SLOTS, KONTOR_UPGRADE } from '../data/buildings.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { SHIPS } from '../data/ships.ts';
import { price } from './economy.ts';
import { captainWages } from './fleet.ts';
import { cargoLoad, day, fail, type GameState, type TradeResult } from './state.ts';

/** Tägliche Unterhaltskosten eines Kontors je Stufe */
export const KONTOR_UPKEEP = [0, 3, 6, 12];

export function buildKontor(state: GameState, town: string): TradeResult {
  if (state.kontore[town]) return fail('Hier steht schon ein Kontor.');
  if (state.money < KONTOR_PRICE) return fail(`Ein Kontor kostet ${KONTOR_PRICE} Taler.`);
  state.money -= KONTOR_PRICE;
  state.kontore[town] = { level: 1, stock: {} };
  return { ok: true, message: `Kontor gebaut. ${KONTOR_CAPACITY[1]} t Lager, bessere Verkaufspreise.`, amount: 0, taler: KONTOR_PRICE };
}

export function upgradeKontor(state: GameState, town: string): TradeResult {
  const k = state.kontore[town];
  if (!k) return fail('Erst ein Kontor bauen.');
  if (k.level >= 3) return fail('Das Kontor ist voll ausgebaut.');
  const cost = KONTOR_UPGRADE[k.level + 1];
  if (state.money < cost) return fail(`Der Ausbau kostet ${cost} Taler.`);
  state.money -= cost;
  k.level++;
  return { ok: true, message: `Kontor auf Stufe ${k.level} ausgebaut: ${KONTOR_CAPACITY[k.level]} t Lager.`, amount: 0, taler: cost };
}

export function betriebeIn(state: GameState, town: string) {
  return state.betriebe.filter((b) => b.town === town);
}

/** Kann dieser Betrieb hier stehen? Rohstoffbetriebe brauchen das Vorkommen der Stadt. */
export function buildingAllowed(map: MapDef, town: string, type: string): boolean {
  const b = BUILDING_BY_ID.get(type);
  const def = map.towns.find((t) => t.id === town);
  if (!b || !def) return false;
  return !b.rawFrom || (def.produces[b.rawFrom] ?? 0) > 0;
}

export function buildBetrieb(state: GameState, map: MapDef, town: string, type: string): TradeResult {
  const b = BUILDING_BY_ID.get(type);
  const k = state.kontore[town];
  if (!b) return fail('Unbekannter Betrieb.');
  if (!k) return fail('Betriebe brauchen ein Kontor in der Stadt.');
  if (!buildingAllowed(map, town, type)) return fail(`Für eine ${b.name} fehlt hier das Vorkommen.`);
  if (betriebeIn(state, town).length >= KONTOR_SLOTS[k.level]) return fail('Kein Bauplatz mehr. Das Kontor ausbauen.');
  if (state.money < b.price) return fail(`${b.name} kostet ${b.price} Taler.`);
  state.money -= b.price;
  state.betriebe.push({ id: state.nextId++, type, town, active: true, lastShare: 0 });
  return { ok: true, message: `${b.name} gebaut. Sie arbeitet mit dem Lager im Kontor.`, amount: 0, taler: b.price };
}

export function toggleBetrieb(state: GameState, id: number): TradeResult {
  const b = state.betriebe.find((x) => x.id === id);
  if (!b) return fail('Unbekannter Betrieb.');
  b.active = !b.active;
  return { ok: true, message: `${BUILDING_BY_ID.get(b.type)?.name} ${b.active ? 'läuft wieder' : 'ruht'}.`, amount: 0, taler: 0 };
}

/** Betrieb abreißen und die Hälfte zurückbekommen */
export function sellBetrieb(state: GameState, id: number): TradeResult {
  const b = state.betriebe.find((x) => x.id === id);
  if (!b) return fail('Unbekannter Betrieb.');
  const t = BUILDING_BY_ID.get(b.type)!;
  const back = Math.round(t.price * 0.5);
  state.money += back;
  state.betriebe = state.betriebe.filter((x) => x.id !== id);
  return { ok: true, message: `${t.name} verkauft, ${back} Taler zurück.`, amount: 0, taler: back };
}

/**
 * Ein Tag im Handelshaus: Betriebe arbeiten mit dem Kontorlager, Löhne und Unterhalt werden fällig.
 */
export function tickHouse(state: GameState): void {
  let wages = captainWages(state);
  let upkeep = 0;
  let production = 0;
  for (const [, k] of Object.entries(state.kontore)) upkeep += KONTOR_UPKEEP[k.level];

  for (const b of state.betriebe) {
    const t = BUILDING_BY_ID.get(b.type)!;
    const k = state.kontore[b.town];
    if (!b.active || !k) {
      b.lastShare = 0;
      continue;
    }
    let share = 1;
    for (const [g, n] of Object.entries(t.inputs)) share = Math.min(share, (k.stock[g]?.amount ?? 0) / n);
    const outTotal = Object.values(t.outputs).reduce((s, n) => s + n, 0);
    const inTotal = Object.entries(t.inputs).reduce((s, [, n]) => s + n * share, 0);
    // verbrauchte Eingangswaren machen Platz für die Erzeugnisse
    const cap = Math.max(0, roomOf(state, b.town) + inTotal);
    share = Math.max(0, Math.min(share, cap / outTotal));
    // ohne Arbeit gibt es nur ein Wartegeld
    const wage = Math.round(t.wage * (share > 0 ? 1 : 0.3));
    wages += wage;
    b.lastShare = share;
    if (share <= 0) continue;
    let inputCost = 0;
    for (const [g, n] of Object.entries(t.inputs)) {
      const slot = k.stock[g];
      const used = n * share;
      const c = (slot.cost * used) / slot.amount;
      slot.amount -= used;
      slot.cost -= c;
      inputCost += c;
      if (slot.amount < 0.001) delete k.stock[g];
    }
    const outs = Object.entries(t.outputs);
    for (const [g, n] of outs) {
      const made = n * share;
      const slot = (k.stock[g] ??= { amount: 0, cost: 0 });
      slot.amount += made;
      slot.cost += (inputCost + wage) * (n / outTotal);
      const good = GOOD_BY_ID.get(g)!;
      const m = state.markets[b.town][g];
      production += made * (m ? price(good.base, m.stock, m.target) : good.base);
    }
  }
  state.money -= wages + upkeep;
  state.ledger = { day: day(state), wages, upkeep, production: Math.round(production), fuel: Math.round(state.fuelToday ?? 0) };
  state.fuelToday = 0;
}

function roomOf(state: GameState, town: string): number {
  const k = state.kontore[town];
  return k ? KONTOR_CAPACITY[k.level] - cargoLoad({ cargo: k.stock }) : 0;
}

/** Ganze Tonnen im Kontor (Betriebe erzeugen Bruchteile) */
export function kontorAmount(state: GameState, town: string, good: string): number {
  return Math.floor(state.kontore[town]?.stock[good]?.amount ?? 0);
}

/** Vermögen des Handelshauses für das Handelsregister: Geld, Schiffe zum Zeitwert, Kontore, Betriebe, Lager */
export function playerWorth(state: GameState): number {
  let w = state.money;
  for (const s of state.ships) w += SHIPS[s.type].price * 0.7 * (0.5 + 0.5 * s.condition);
  for (const k of Object.values(state.kontore)) {
    w += KONTOR_PRICE;
    for (let l = 2; l <= k.level; l++) w += KONTOR_UPGRADE[l];
    for (const slot of Object.values(k.stock)) w += slot.cost;
  }
  for (const b of state.betriebe) w += (BUILDING_BY_ID.get(b.type)?.price ?? 0) * 0.5;
  for (const s of state.ships) for (const slot of Object.values(s.cargo)) w += slot.cost;
  return Math.round(w);
}
