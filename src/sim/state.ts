import type { Trait } from '../data/captains.ts';
import { PERISH, SHIPS, type ShipClass } from '../data/ships.ts';
import { windOfDay, withWind, type Conditions, type ShipType } from './river.ts';
import type { TownMarket, TownState } from './towns.ts';

/** Datentypen des Spielstands und kleine Helfer, die alle Simulationsmodule brauchen */

export interface CargoSlot {
  amount: number;
  cost: number; // gezahlte Taler für die aktuelle Menge, für die Gewinnanzeige
  /** Frische verderblicher Ware, 1 = frisch. Fehlt bei Ware, die nicht verdirbt. */
  fresh?: number;
}

/** Ware in einen Laderaum legen; bei verderblicher Ware mischt sich die Frische nach Menge */
export function addToSlot(cargo: Record<string, CargoSlot>, good: string, amount: number, cost: number, fresh = 1): CargoSlot {
  const slot = (cargo[good] ??= { amount: 0, cost: 0 });
  if (PERISH[good] !== undefined && amount > 0) {
    const before = slot.amount > 0 ? (slot.fresh ?? 1) : fresh;
    slot.fresh = (before * slot.amount + fresh * amount) / (slot.amount + amount);
  }
  slot.amount += amount;
  slot.cost += cost;
  return slot;
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
  toll?: number;
}

export interface Captain {
  id: number;
  name: string;
  trait: Trait;
  wage: number; // Taler pro Tag
  hire: number; // Handgeld
}

export type OrderKind = 'kaufen' | 'verkaufen' | 'einlagern' | 'auslagern';

export interface RouteOrder {
  kind: OrderKind;
  good: string;
  /** kaufen/auslagern: bis zu dieser Menge an Bord; verkaufen/einlagern: diese Menge, 0 = alles */
  amount: number;
  /** kaufen: Höchstpreis je t, verkaufen: Mindestpreis je t, 0 = egal */
  limit: number;
}

export interface RouteStop {
  town: string;
  orders: RouteOrder[];
}

export interface TradeRoute {
  stops: RouteStop[];
  next: number; // Index des nächsten Halts
  active: boolean;
  /** Spielstunde, ab der der Kapitän es erneut versucht */
  retryAt?: number;
  note?: string; // letzter Hinweis, z. B. warum gewartet wird
}

export interface Ship {
  id: number;
  type: string;
  name: string;
  port: string | null; // aktueller Hafen, null während der Fahrt
  voyage: Voyage | null;
  cargo: Record<string, CargoSlot>;
  condition: number; // 1 = neu, 0 = Wrack
  upgrades: string[];
  captain: Captain | null;
  route: TradeRoute | null;
  /** Kohle im Bunker (Dampfer), in Tonnen */
  bunker?: number;
}

export interface Kontor {
  level: number; // 1..3
  stock: Record<string, CargoSlot>;
}

export interface Betrieb {
  id: number;
  type: string;
  town: string;
  active: boolean;
  /** Auslastung am letzten Tag, 0..1 */
  lastShare: number;
}

export interface RivalShip {
  id: number;
  type: string;
  name: string;
  port: string | null;
  voyage: Voyage | null;
  cargo: { good: string; amount: number; cost: number; dest: string } | null;
  /** Spielstunde, ab der das Schiff wieder handelt */
  idleUntil: number;
}

export interface RivalState {
  id: string;
  money: number;
  ships: RivalShip[];
  kontore: string[];
  profit: number;
}

export type WorldEventKind = 'hochwasser' | 'duerre' | 'zoll' | 'bruecke' | 'stadtfest' | 'seuche';

export interface WorldEvent {
  id: number;
  kind: WorldEventKind;
  from: number; // Tag
  until: number; // letzter Tag
  town?: string;
  seg?: string;
  value?: number; // Pegel, Zollhöhe
}

export interface NewsItem {
  day: number;
  kind: 'ereignis' | 'konkurrenz' | 'stadt' | 'auftrag' | 'haus';
  text: string;
}

export interface Contract {
  id: number;
  town: string;
  good: string;
  amount: number;
  delivered: number;
  reward: number;
  issued: number; // Tag
  offerUntil: number; // bis dahin kann man annehmen
  deadline: number; // bis dahin muss geliefert sein
  accepted: boolean;
}

export interface Ledger {
  day: number;
  wages: number;
  upkeep: number;
  production: number; // Wert der eigenen Erzeugung zum Marktpreis
  fuel?: number; // Kohle und Diesel
}

export interface Work {
  id: string; // Projekt aus data/projects.ts
  started: number; // Tag
  done: boolean;
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
    contracts: number; // erfüllte Aufträge
  };
  kontore: Record<string, Kontor>;
  betriebe: Betrieb[];
  tavern: Record<string, Captain[]>;
  rivals: RivalState[];
  /** Konkurrenz aktiv (im ersten Kapitel noch nicht) */
  rivalsActive: boolean;
  events: WorldEvent[];
  news: NewsItem[];
  contracts: Contract[];
  nextId: number;
  rng: number;
  ledger: Ledger;
  /** Technische Epoche: 1 Treidelzeit, 2 Dampf, 3 Motor */
  epoch: number;
  /** Epoche folgt den Spieljahren (freies Spiel) */
  epochAuto: boolean;
  works: Work[];
  /** Brennstoffkosten seit Mitternacht */
  fuelToday: number;
}

export function shipClass(ship: { type: string }): ShipClass {
  return SHIPS[ship.type];
}

export function hasUpgrade(ship: Ship, id: string): boolean {
  return ship.upgrades.includes(id);
}

export function capacityOf(ship: Ship): number {
  const cap = shipClass(ship).capacity;
  return hasUpgrade(ship, 'laderaum') ? Math.round(cap * 1.2) : cap;
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

/** Gesperrte Abschnitte aus laufenden Ereignissen */
export function closedSegments(state: GameState): string[] {
  return state.events.filter((e) => e.kind === 'bruecke' && e.seg).map((e) => e.seg!);
}

export function conditions(state: GameState): Conditions {
  return { level: state.waterLevel, ice: state.ice, closed: closedSegments(state) };
}

export function cargoLoad(ship: { cargo: Record<string, CargoSlot> }): number {
  return Object.values(ship.cargo).reduce((s, c) => s + c.amount, 0);
}

/** Leicht beladene Schiffe liegen höher im Wasser: Tiefgang zwischen 60 % (leer) und 100 % (voll) */
export function effectiveDraft(ship: Ship): number {
  const cls = shipClass(ship);
  const base = hasUpgrade(ship, 'kiel') ? cls.draft * 0.85 : cls.draft;
  return base * (0.6 + 0.4 * Math.min(1, cargoLoad(ship) / capacityOf(ship)));
}

/** Verschleiß bremst: ein abgenutztes Schiff fährt bis zu 30 % langsamer */
export function speedFactor(ship: Ship): number {
  let f = 0.7 + 0.3 * ship.condition;
  if (hasUpgrade(ship, 'antrieb')) f *= 1.12;
  if (ship.captain?.trait === 'schnell') f *= 1.12;
  return f;
}

/** Schiffsdaten für die Routenplanung: Wind, Ladung, Ausbau, Zustand und Kapitän eingerechnet */
export function effectiveType(state: GameState, ship: Ship): ShipType {
  const cls = withWind(shipClass(ship), wind(state));
  return { ...cls, draft: effectiveDraft(ship), capacity: capacityOf(ship), speed: cls.speed * speedFactor(ship) };
}

/** Deterministischer Zufall aus dem Spielstand, damit Spielstände reproduzierbar bleiben */
export function rand(state: GameState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function pick<T>(state: GameState, list: T[]): T {
  return list[Math.floor(rand(state) * list.length)];
}

export function randInt(state: GameState, min: number, max: number): number {
  return min + Math.floor(rand(state) * (max - min + 1));
}

export function addNews(state: GameState, kind: NewsItem['kind'], text: string): NewsItem {
  const item = { day: day(state), kind, text };
  state.news.unshift(item);
  if (state.news.length > 60) state.news.length = 60;
  return item;
}

export interface TradeResult {
  ok: boolean;
  message: string;
  amount: number;
  taler: number;
  profit?: number;
  firstProfit?: boolean;
}

export const fail = (message: string): TradeResult => ({ ok: false, message, amount: 0, taler: 0 });

export type GameEvent =
  | { type: 'arrived'; ship: number; town: string; auto?: boolean }
  | { type: 'newDay'; day: number }
  | { type: 'townLevel'; town: string; level: number; up: boolean; newGoods: string[] }
  | { type: 'news'; item: NewsItem; important: boolean }
  | { type: 'epoch'; epoch: number };
