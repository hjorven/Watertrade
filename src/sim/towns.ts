import type { TownDef } from '../data/maps/valley.ts';
import type { MarketEntry } from './economy.ts';

/** Lager wächst durch Produktion höchstens bis zu diesem Vielfachen des Zielbestands */
export const STOCK_CAP = 2.5;

/** Kleinhandel mit dem Umland zieht den Bestand jeden Tag um diesen Anteil zum Zielbestand */
export const LOCAL_DRIFT = 0.08;

export type TownMarket = Record<string, MarketEntry>;

/** Alle Waren, mit denen eine Stadt handelt */
export function tradedGoods(def: TownDef): string[] {
  const set = new Set<string>([...Object.keys(def.produces), ...Object.keys(def.consumes)]);
  for (const ind of def.industries) {
    Object.keys(ind.inputs).forEach((g) => set.add(g));
    Object.keys(ind.outputs).forEach((g) => set.add(g));
  }
  return [...set];
}

/** Täglicher Überschuss (positiv) oder Bedarf (negativ) einer Ware bei vollem Betrieb */
export function netFlow(def: TownDef, good: string): number {
  let net = (def.produces[good] ?? 0) - (def.consumes[good] ?? 0);
  for (const ind of def.industries) net += (ind.outputs[good] ?? 0) - (ind.inputs[good] ?? 0);
  return net;
}

export function initialMarket(def: TownDef): TownMarket {
  const m: TownMarket = {};
  for (const good of tradedGoods(def)) {
    const net = netFlow(def, good);
    const factor = net > 0 ? 1.6 : net < 0 ? 0.7 : 1;
    m[good] = { good, stock: def.target * factor, target: def.target };
  }
  return m;
}

/**
 * Ein Tag in der Stadt:
 * 1. Rohstoffe werden erzeugt (nicht über das Lagerlimit)
 * 2. Betriebe verarbeiten, soweit Eingangswaren da sind
 * 3. Die Bevölkerung verbraucht, weniger wenn die Ware knapp ist
 * 4. Das Umland gleicht etwas aus, so pendelt sich jeder Markt ohne Spieler auf einen mittleren Preis ein
 */
export function tickTown(def: TownDef, market: TownMarket): void {
  const cap = def.target * STOCK_CAP;

  for (const [good, amount] of Object.entries(def.produces)) {
    const m = market[good];
    m.stock = Math.min(cap, m.stock + amount);
  }

  for (const ind of def.industries) {
    // Anteil eines vollen Arbeitstags, den die Eingangswaren erlauben
    let share = 1;
    for (const [good, need] of Object.entries(ind.inputs)) share = Math.min(share, market[good].stock / need);
    for (const [good, out] of Object.entries(ind.outputs)) {
      const room = (cap - market[good].stock) / out;
      share = Math.min(share, Math.max(0, room));
    }
    if (share <= 0) continue;
    for (const [good, need] of Object.entries(ind.inputs)) market[good].stock -= need * share;
    for (const [good, out] of Object.entries(ind.outputs)) market[good].stock += out * share;
  }

  for (const [good, amount] of Object.entries(def.consumes)) {
    const m = market[good];
    const appetite = Math.min(1.5, Math.max(0, m.stock / m.target));
    m.stock = Math.max(0, m.stock - amount * appetite);
  }

  for (const m of Object.values(market)) {
    m.stock = Math.min(cap, Math.max(0, m.stock + (m.target - m.stock) * LOCAL_DRIFT));
  }
}
