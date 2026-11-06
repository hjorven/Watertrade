import type { TownDef } from '../data/maps/valley.ts';
import type { MarketEntry } from './economy.ts';

/** Lager wächst durch Produktion höchstens bis zu diesem Vielfachen des Zielbestands */
export const STOCK_CAP = 2.5;

/** Kleinhandel mit dem Umland zieht den Bestand jeden Tag um diesen Anteil zum Zielbestand */
export const LOCAL_DRIFT = 0.08;

export type TownMarket = Record<string, MarketEntry>;

/** Anteil des Bedarfs, den das Umland ohne Spieler liefert */
export const UMLAND_SHARE = 0.7;

/** Bevölkerungsstufen und ab welcher Einwohnerzahl sie gelten */
export const LEVELS = [
  { name: 'Dorf', from: 0 },
  { name: 'Marktflecken', from: 800 },
  { name: 'Stadt', from: 2000 },
  { name: 'Großstadt', from: 4500 },
];

/** Zusätzlicher Bedarf je Stufe, in Tonnen pro Tag bei Startgröße der Stadt */
export const LEVEL_NEEDS: Record<string, number>[] = [
  {},
  { bier: 1, stoff: 0.6 },
  { moebel: 0.5, glas: 0.5, werkzeug: 0.4 },
  { moebel: 0.8, stoff: 1, bier: 1.5, brot: 2 },
];

export const MAX_POPULATION = 8000;

/** Zufriedenheit, ab der eine Stadt wächst. Ohne Spieler pendeln sich Städte knapp darunter ein. */
export const GROWTH_THRESHOLD = 0.75;

export interface TownState {
  population: number;
  satisfaction: number; // 0..1, wie gut die Bedürfnisse gedeckt sind
}

export function levelOf(population: number): number {
  let l = 0;
  for (let i = 0; i < LEVELS.length; i++) if (population >= LEVELS[i].from) l = i;
  return l;
}

/** Tagesbedarf je Ware bei aktueller Größe und Stufe */
export function needs(def: TownDef, town: TownState): Record<string, number> {
  const scale = town.population / def.population;
  const out: Record<string, number> = {};
  for (const [g, n] of Object.entries(def.consumes)) out[g] = n;
  const level = levelOf(town.population);
  for (let l = 1; l <= level; l++) {
    for (const [g, n] of Object.entries(LEVEL_NEEDS[l])) out[g] = (out[g] ?? 0) + n;
  }
  for (const g of Object.keys(out)) out[g] *= scale;
  return out;
}

/** Waren, die die nächste Stufe neu verlangt (für die Anzeige) */
export function nextLevelNeeds(def: TownDef, town: TownState): string[] {
  const level = levelOf(town.population);
  if (level + 1 >= LEVELS.length) return [];
  const have = needs(def, town);
  return Object.keys(LEVEL_NEEDS[level + 1]).filter((g) => !(g in have) && !(g in def.produces));
}

/** Alle Waren, mit denen eine Stadt bei Spielbeginn handelt */
export function tradedGoods(def: TownDef): string[] {
  const set = new Set<string>([...Object.keys(def.produces), ...Object.keys(def.consumes)]);
  for (const ind of def.industries) {
    Object.keys(ind.inputs).forEach((g) => set.add(g));
    Object.keys(ind.outputs).forEach((g) => set.add(g));
  }
  return [...set];
}

/** Täglicher Überschuss (positiv) oder Bedarf (negativ) einer Ware bei vollem Betrieb */
export function netFlow(def: TownDef, good: string, town?: TownState): number {
  const need = town ? (needs(def, town)[good] ?? 0) : (def.consumes[good] ?? 0);
  let net = (def.produces[good] ?? 0) - need;
  for (const ind of def.industries) net += (ind.outputs[good] ?? 0) - (ind.inputs[good] ?? 0);
  return net;
}

/** Marktgröße wächst mit der Stadt, aber langsamer als die Einwohnerzahl */
export function marketTarget(def: TownDef, town: TownState): number {
  return Math.round(def.target * Math.sqrt(town.population / def.population));
}

export function initialTown(def: TownDef): TownState {
  return { population: def.population, satisfaction: GROWTH_THRESHOLD };
}

export function initialMarket(def: TownDef, town: TownState = initialTown(def)): TownMarket {
  const m: TownMarket = {};
  const goods = new Set([...tradedGoods(def), ...Object.keys(needs(def, town))]);
  for (const good of goods) {
    const net = netFlow(def, good, town);
    const factor = net > 0 ? 1.6 : net < 0 ? 0.7 : 1;
    m[good] = { good, stock: def.target * factor, target: def.target };
  }
  return m;
}

export interface TownTickResult {
  levelUp?: number; // neue Stufe
  levelDown?: number;
  newGoods: string[]; // neue Nachfrage
}

/**
 * Ein Tag in der Stadt:
 * 1. Rohstoffe werden erzeugt (nicht über das Lagerlimit)
 * 2. Betriebe verarbeiten, soweit Eingangswaren da sind
 * 3. Die Bevölkerung verbraucht, weniger wenn die Ware knapp ist
 * 4. Das Umland gleicht etwas aus, so pendelt sich jeder Markt ohne Spieler auf einen mittleren Preis ein
 * 5. Zufriedene Städte wachsen, unterversorgte schrumpfen bis auf ihre Startgröße
 */
export function tickTown(def: TownDef, market: TownMarket, town: TownState): TownTickResult {
  const result: TownTickResult = { newGoods: [] };
  const target = marketTarget(def, town);
  for (const m of Object.values(market)) m.target = target;
  const cap = target * STOCK_CAP;
  const workforce = 0.6 + 0.4 * (town.population / def.population);

  for (const [good, amount] of Object.entries(def.produces)) {
    const m = market[good];
    m.stock = Math.min(cap, m.stock + amount * workforce);
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

  const want = needs(def, town);
  let satSum = 0;
  let satN = 0;
  for (const [good, amount] of Object.entries(want)) {
    const m = (market[good] ??= { good, stock: 0, target });
    const ratio = m.stock / m.target;
    satSum += Math.min(1, ratio);
    satN++;
    const appetite = Math.min(1.5, Math.max(0, ratio));
    m.stock = Math.max(0, m.stock - amount * appetite);
  }

  // Das Umland deckt den Bedarf nur zum Teil: ohne Händler bleiben Bedarfswaren knapp
  for (const m of Object.values(market)) {
    const goal = m.good in want ? m.target * UMLAND_SHARE : m.target;
    m.stock = Math.min(cap, Math.max(0, m.stock + (goal - m.stock) * LOCAL_DRIFT));
  }

  // Zufriedenheit träge mitteln, damit ein einzelner Tag nicht alles kippt
  const sat = satN ? satSum / satN : 1;
  town.satisfaction = town.satisfaction * 0.8 + sat * 0.2;

  const before = levelOf(town.population);
  const growth = (town.satisfaction - GROWTH_THRESHOLD) * 0.03;
  town.population = Math.min(MAX_POPULATION, Math.max(def.population, town.population * (1 + growth)));
  const after = levelOf(town.population);
  if (after > before) {
    result.levelUp = after;
    // neue Stufe, neue Nachfrage: der Markt öffnet mit leerem Lager
    for (const good of Object.keys(needs(def, town))) {
      if (market[good]) continue;
      market[good] = { good, stock: 0, target };
      result.newGoods.push(good);
    }
  }
  if (after < before) result.levelDown = after;
  return result;
}
