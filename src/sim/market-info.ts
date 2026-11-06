import { KONTOR_SELL_FACTOR } from '../data/buildings.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { buyPrice, sellPrice, SELL_FACTOR } from './economy.ts';
import { addNews, day, shipClass, type GameState, type NewsItem, type Ship } from './state.ts';

/**
 * Marktinformationen (Ausbauplan 5.1):
 * - Preisbuch: Preise anderer Städte nur mit dem Stand des letzten Besuchs, mit eigenem Kontor live
 * - Preisverlauf je Ware und Stadt aus den eigenen Beobachtungen
 * - Gerüchte im Flussboten mit groben Preisen ferner Städte
 * - Schiffsbuch: Gewinn je Fahrt mit Verkauf, Einstand, Brennstoff, Zoll und Lohn
 *
 * Alles hier liest nur den Markt und schreibt eigene Felder des Spielstands. Der gemeinsame
 * Zufallsstrom (state.rng) wird nicht angefasst, damit Ereignisse, Aufträge und KI gleich bleiben.
 */

export interface PriceQuote {
  buy: number;
  sell: number;
}

export interface PriceBookPage {
  /** Spieltag der Beobachtung */
  day: number;
  prices: Record<string, PriceQuote>;
}

/** Ein Eintrag im Preisverlauf: Tag, Kaufpreis, Verkaufspreis */
export type PricePoint = [number, number, number];

/** So viele Beobachtungen je Ware und Stadt bleiben im Verlauf */
export const HISTORY_POINTS = 45;

/** Abgeschlossene Fahrten, die das Schiffsbuch behält */
export const TRIP_LOG = 12;

export interface TripRecord {
  from: string;
  to: string;
  /** Abfahrtstag */
  day: number;
  /** Ankunftstag, solange unterwegs leer */
  arrived?: number;
  /** Erlös aus Verkäufen und Aufträgen im Zielhafen */
  sell: number;
  /** Einstandswert der dort verkauften Ware */
  cost: number;
  /** verkaufte Tonnen */
  tons: number;
  /** Diesel und verbrannte Kohle */
  fuel: number;
  toll: number;
  /** Kapitänslohn für die Fahrzeit */
  wage: number;
  /** davon ins eigene Kontor eingelagert (Tonnen), zum Marktwert als Erlös gebucht */
  stored?: number;
  /** Teillieferung für einen noch offenen Auftrag: Einstand gebucht, Belohnung kommt später */
  partial?: boolean;
}

/** Gewinn einer Fahrt nach allen Kosten */
export function tripProfit(t: TripRecord): number {
  return Math.round(t.sell - t.cost - t.fuel - t.toll - t.wage);
}

/** Kohle wird zum Grundpreis bewertet, weil der Bunker Kohle aus mehreren Käufen mischt */
const coalValue = () => GOOD_BY_ID.get('kohle')?.base ?? 12;

/* ---------- Preise ---------- */

/** Aktueller Kauf- und Verkaufspreis je Tonne, so wie der Markt-Reiter sie zeigt */
export function quote(state: GameState, town: string, good: string): PriceQuote | null {
  const m = state.markets[town]?.[good];
  const g = GOOD_BY_ID.get(good);
  if (!m || !g) return null;
  const factor = state.kontore[town] ? KONTOR_SELL_FACTOR : SELL_FACTOR;
  return { buy: buyPrice(g.base, m), sell: Math.floor((sellPrice(g.base, m) / SELL_FACTOR) * factor) };
}

/** Städte, deren Markt der Spieler gerade sieht: ein eigenes Schiff liegt dort oder ein eigenes Kontor steht dort */
export function liveTowns(state: GameState): Set<string> {
  const out = new Set<string>(Object.keys(state.kontore));
  for (const s of state.ships) if (s.port) out.add(s.port);
  return out;
}

export function isLive(state: GameState, town: string): boolean {
  return !!state.kontore[town] || state.ships.some((s) => s.port === town);
}

/** Markt einer Stadt ins Preisbuch und in den Verlauf schreiben */
export function observe(state: GameState, town: string): void {
  const market = state.markets[town];
  if (!market) return;
  const d = day(state);
  const prices: Record<string, PriceQuote> = {};
  const hist = ((state.priceHistory ??= {})[town] ??= {});
  for (const good of Object.keys(market)) {
    const q = quote(state, town, good);
    if (!q) continue;
    prices[good] = q;
    const list = (hist[good] ??= []);
    const last = list[list.length - 1];
    if (last && last[0] === d) {
      last[1] = q.buy;
      last[2] = q.sell;
    } else {
      list.push([d, q.buy, q.sell]);
      if (list.length > HISTORY_POINTS) list.splice(0, list.length - HISTORY_POINTS);
    }
  }
  (state.priceBook ??= {})[town] = { day: d, prices };
}

/** Bekannte Preise einer Stadt: live, wenn sichtbar, sonst der Stand des letzten Besuchs */
export function knownPrices(state: GameState, town: string): { live: boolean; day: number; prices: Record<string, PriceQuote> } | null {
  if (isLive(state, town)) {
    const prices: Record<string, PriceQuote> = {};
    for (const good of Object.keys(state.markets[town] ?? {})) {
      const q = quote(state, town, good);
      if (q) prices[good] = q;
    }
    return { live: true, day: day(state), prices };
  }
  const page = state.priceBook?.[town];
  return page ? { live: false, day: page.day, prices: page.prices } : null;
}

/** Beobachteter Verlauf einer Ware in einer Stadt, älteste zuerst */
export function priceHistory(state: GameState, town: string, good: string): PricePoint[] {
  return state.priceHistory?.[town]?.[good] ?? [];
}

/* ---------- Gerüchte ---------- */

/** Etwa an jedem dritten Tag erzählt der Flussbote ein Gerücht */
export const RUMOR_CHANCE = 0.35;

/** Bestand unter diesem Anteil des Zielbestands gilt als knapp, über dem zweiten als reichlich */
export const RUMOR_SCARCE = 0.6;
export const RUMOR_PLENTY = 1.45;
/** Abstand in Tagen, bevor dasselbe Gerücht wieder erzählt wird */
const RUMOR_REPEAT_DAYS = 12;

/** Zufall aus Tag und Zusatzwert, ohne den Zufallsstrom des Spielstands zu verbrauchen */
export function dayHash(d: number, salt: number): number {
  let t = (Math.imul(d, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Grob gerundeter Preis, wie man ihn im Wirtshaus hört */
export function roughPrice(p: number): number {
  if (p < 20) return Math.max(1, Math.round(p / 2) * 2);
  if (p < 60) return Math.round(p / 5) * 5;
  return Math.round(p / 10) * 10;
}

export interface Rumor {
  town: string;
  good: string;
  scarce: boolean;
  price: number;
}

/**
 * Gerücht für einen Tag: eine Stadt, die der Spieler gerade nicht sieht, mit einer Ware,
 * die dort deutlich knapp oder reichlich ist. null, wenn heute nichts erzählt wird.
 */
export function rumorFor(state: GameState, map: MapDef, d: number): Rumor | null {
  if (dayHash(d, 0) >= RUMOR_CHANCE) return null;
  const live = liveTowns(state);
  const towns = map.towns.filter((t) => !live.has(t.id));
  if (!towns.length) return null;
  // dasselbe Gerücht nicht zweimal kurz hintereinander
  const recent = new Set(state.news.filter((n) => n.kind === 'geruecht' && d - n.day < RUMOR_REPEAT_DAYS).map((n) => n.text));
  const start = Math.floor(dayHash(d, 1) * towns.length);
  for (let i = 0; i < towns.length; i++) {
    const town = towns[(start + i) % towns.length];
    const market = state.markets[town.id];
    if (!market) continue;
    const candidates = Object.values(market)
      .map((m) => ({ m, ratio: m.stock / Math.max(1, m.target) }))
      .filter(({ ratio }) => ratio < RUMOR_SCARCE || ratio > RUMOR_PLENTY)
      .sort((a, b) => a.m.good.localeCompare(b.m.good));
    const first = Math.floor(dayHash(d, 2 + i) * candidates.length);
    for (let j = 0; j < candidates.length; j++) {
      const { m, ratio } = candidates[(first + j) % candidates.length];
      const q = quote(state, town.id, m.good);
      if (!q) continue;
      const scarce = ratio < 1;
      const r = { town: town.id, good: m.good, scarce, price: roughPrice(scarce ? q.sell : q.buy) };
      if (!recent.has(rumorText(map, r))) return r;
    }
  }
  return null;
}

export function rumorText(map: MapDef, r: Rumor): string {
  const town = map.towns.find((t) => t.id === r.town)?.name ?? r.town;
  const good = GOOD_BY_ID.get(r.good)?.name ?? r.good;
  return r.scarce
    ? `Man hört, in ${town} wird ${good} knapp. Händler sollen dort um die ${r.price} Taler je Tonne bekommen.`
    : `Man hört, in ${town} gibt es ${good} im Überfluss, für etwa ${r.price} Taler je Tonne.`;
}

/* ---------- Tageslauf ---------- */

/** Um Mitternacht: sichtbare Märkte notieren, vielleicht ein Gerücht. Liefert neue Nachrichten. */
export function tickMarketInfo(state: GameState, map: MapDef): NewsItem[] {
  for (const town of liveTowns(state)) observe(state, town);
  const r = rumorFor(state, map, day(state));
  return r ? [addNews(state, 'geruecht', rumorText(map, r))] : [];
}

/* ---------- Schiffsbuch ---------- */

/** Beim Ablegen: letzte Fahrt abschließen, neue beginnen, Hafenpreise ins Buch */
export function tripDepart(state: GameState, ship: Ship, from: string, to: string, toll: number): void {
  observe(state, from);
  closeTrip(ship);
  ship.trip = { from, to, day: day(state), sell: 0, cost: 0, tons: 0, fuel: 0, toll, wage: 0 };
}

function closeTrip(ship: Ship): void {
  if (!ship.trip) return;
  ship.tripLog = [ship.trip, ...(ship.tripLog ?? [])].slice(0, TRIP_LOG);
  ship.trip = undefined;
}

/** Unterwegs: Brennstoff für `hours` Fahrstunden, Lohn für `wageHours` (mit Liegezeit zum Laden und Löschen) */
export function tripSail(ship: Ship, hours: number, diesel: number, wageHours = hours): void {
  const t = ship.trip;
  if (!t || t.arrived !== undefined) return;
  t.fuel += diesel + (shipClass(ship).coal ?? 0) * hours * coalValue();
  t.wage += ((ship.captain?.wage ?? 0) * wageHours) / 24;
}

export function tripArrive(state: GameState, ship: Ship): void {
  if (ship.trip && ship.trip.arrived === undefined) ship.trip.arrived = day(state);
  if (ship.port) observe(state, ship.port);
}

/** Verkauf oder Auftrag im Zielhafen der laufenden Fahrt zählt zu dieser Fahrt */
export function tripSale(ship: Ship, revenue: number, cost: number, tons: number): void {
  const t = ship.trip;
  if (!t || t.arrived === undefined || ship.port !== t.to) return;
  t.sell += revenue;
  t.cost += cost;
  t.tons += tons;
}

/**
 * Einlagern im Zielhafen zählt wie ein Verkauf zum aktuellen Marktwert, damit Kontor-Routen
 * im Schiffsbuch nicht als Verlust erscheinen. Der Einstand wandert mit ins Lager.
 */
export function tripStore(state: GameState, ship: Ship, good: string, tons: number, cost: number, fresh = 1): void {
  const t = ship.trip;
  if (!t || t.arrived === undefined || ship.port !== t.to) return;
  const q = quote(state, t.to, good);
  t.sell += Math.round((q?.sell ?? 0) * tons * fresh);
  t.cost += cost;
  t.tons += tons;
  t.stored = (t.stored ?? 0) + tons;
}

/** Teillieferung eines Auftrags: Einstand buchen und die Fahrt kennzeichnen */
export function tripPartialDelivery(ship: Ship, cost: number, tons: number): void {
  const t = ship.trip;
  if (!t || t.arrived === undefined || ship.port !== t.to) return;
  t.cost += cost;
  t.tons += tons;
  t.partial = true;
}

/** Fahrten eines Schiffs, neueste zuerst, die laufende vorne */
export function trips(ship: Ship): TripRecord[] {
  return ship.trip ? [ship.trip, ...(ship.tripLog ?? [])] : (ship.tripLog ?? []);
}
