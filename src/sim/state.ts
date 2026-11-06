import { hasTrait, isMaster, type Trait } from '../data/captains.ts';
import { PERISH, SHIPS, type ShipClass } from '../data/ships.ts';
import { windOfDay, withWind, type Conditions, type ShipType } from './river.ts';
import type { PriceBookPage, PricePoint, TripRecord } from './market-info.ts';
import type { TownMarket, TownState } from './towns.ts';
import type { MapDef } from '../data/maps/valley.ts';
import type { Season } from './calendar.ts';

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
  /** davon Treidelgeld (ab der Motorzeit bergauf für Treidelschiffe) */
  towFee?: number;
  /** Zoll, den ein Schmuggler auf dieser Fahrt umgeht; bei der Ankunft droht eine Kontrolle */
  evaded?: number;
  /** Liegezeit zum Laden vor dem Ablegen (Stunden, am Anfang der Fahrt) */
  dock?: number;
  /** Liegezeit zum Löschen am Ziel (Stunden, am Ende der Fahrt) */
  dockEnd?: number;
  /** Gebühren für fremde Bauwerke und Leichtern, in `toll` schon enthalten */
  fees?: FeeItem[];
}

/** Eine Gebühr, die beim Ablegen fällig wird, und wer sie bekommt */
export interface FeeItem {
  /** Bauwerk (Projekt-ID) oder Hafen ('hafen:<stadt>') oder 'leichtern' */
  work: string;
  amount: number;
}

export interface Captain {
  id: number;
  name: string;
  trait: Trait;
  wage: number; // Taler pro Tag
  hire: number; // Handgeld
  /** zweite Eigenschaft, gelernt mit der Erfahrung */
  trait2?: Trait;
  /** gefahrene Kilometer */
  km?: number;
  /** Treue 0 bis 100; sinkt, wenn der Lohn unter dem liegt, was der Kapitän wert ist */
  loyalty?: number;
  /** Abwerbeangebot: geht im nächsten Hafen von Bord, wenn der Lohn bis dahin nicht mindestens so hoch ist */
  offer?: { wage: number; from: string; day: number };
  /** Lohnzusage nach einem abgewehrten Angebot: bis zum Tag `until` nicht unter `wage` */
  promised?: { wage: number; until: number };
  /** wurde schon wegen zu wenig Lohn gewarnt */
  warned?: boolean;
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
  /** Erst ablegen, wenn der Laderaum zu diesem Anteil voll ist (0..1), sonst warten und nachkaufen */
  minLoad?: number;
  /** Halt überspringen, wenn der Pegel unter diesem Wert liegt (m über Normalwasser) */
  levelMin?: number;
  /** Halt überspringen, wenn der Pegel über diesem Wert liegt (m über Normalwasser) */
  levelMax?: number;
}

/** Ein Tag im Routenbuch: Gewinn der Route an diesem Tag in Talern */
export interface RouteBookDay {
  day: number;
  taler: number;
}

export interface TradeRoute {
  stops: RouteStop[];
  next: number; // Index des nächsten Halts
  active: boolean;
  /** Spielstunde, ab der der Kapitän es erneut versucht */
  retryAt?: number;
  note?: string; // letzter Hinweis, z. B. warum gewartet wird
  /** Zweite Halte-Liste (Winterplan); `stops` ist dann der Sommerplan */
  winterStops?: RouteStop[];
  /** Jahreszeiten, in denen der Winterplan gilt */
  winterSeasons?: Season[];
  /** Plan, nach dem gerade gefahren wird */
  plan?: RoutePlan;
  /** Spielstunde, seit der der Kapitän auf Ladung wartet (Bedingung Mindestladung) */
  loadingSince?: number;
  /** Gewinn der letzten Tage, höchstens ROUTE_BOOK_DAYS Einträge */
  book?: RouteBookDay[];
  /** Erster Tag, an dem die Route gebucht hat (für den Tagesschnitt) */
  bookSince?: number;
}

export type RoutePlan = 'sommer' | 'winter';

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
  /** Schiffsbuch: laufende oder zuletzt beendete Fahrt (nimmt Verkäufe im Zielhafen auf) */
  trip?: TripRecord;
  /** Schiffsbuch: abgeschlossene Fahrten, neueste zuerst */
  tripLog?: TripRecord[];
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
  /** Heimathafen, wenn der aus data/rivals.ts nicht auf der Karte liegt (Zufallsflüsse) */
  home?: string;
  /** Verärgerung über den Spieler, 0..100 (siehe rivalry.ts) */
  anger?: number;
  /** Vom Spieler verkaufte Tonnen je Revierware beim letzten Tageswechsel */
  seen?: Record<string, number>;
  /** Laufende Vergeltung gegen den Spieler */
  retaliation?: Retaliation | null;
  /** Anteile in Spielerhand, 0..100 % */
  shares?: number;
  /** Tage in Folge mit Schulden */
  debtDays?: number;
  /** Anzahl Schiffe, für die schon ein Kaufplan im Flussboten stand */
  planned?: number;
  /** bis zu diesem Tag kein neues Abkommen (nach Kündigung) */
  noPactUntil?: number;
}

export interface Retaliation {
  kind: 'unterbieten' | 'leerkaufen';
  good: string;
  town: string;
  until: number; // letzter Tag
}

/** Gebietsabkommen: Der Spieler lässt `playerGood` in Ruhe, das Haus `houseGood` */
export interface Pact {
  house: string;
  playerGood: string;
  houseGood: string;
  from: number; // Tag
  until: number; // letzter Tag
  /** vom Spieler verkaufte Tonnen von playerGood bei Abschluss */
  baseline: number;
}

export interface AuctionLot {
  town: string;
  min: number;
  bid: number; // 0 = noch kein Gebot
  /** 'player' oder Haus-ID */
  bidder: string | null;
}

/** Versteigerung der Kontore eines Hauses im Konkurs */
export interface Auction {
  house: string; // Name des gefallenen Hauses
  until: number; // letzter Tag
  lots: AuctionLot[];
}

export interface FallenHouse {
  id: string;
  how: 'konkurs' | 'uebernahme';
  day: number;
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
  /** Tag der Ankündigung (nur Hochwasser und Dürre) */
  announced?: number;
}

export interface NewsItem {
  day: number;
  kind: 'ereignis' | 'konkurrenz' | 'stadt' | 'auftrag' | 'haus' | 'geruecht';
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
  /** Wasserbau: Gebühreneinnahmen und Ausgaben (Unterhalt, fremde Gebühren, Leichtern) */
  works?: { income: number; cost: number };
}

/** Gemeinschaftsbau: Stadt oder KI-Haus zahlt die Hälfte und bekommt einen Anteil an den Gebühren */
export interface WorkPartner {
  kind: 'stadt' | 'haus';
  id: string; // Stadt- oder Haus-ID
  share: number; // Anteil an Gebühren und Unterhalt, 0..1
}

/** Gebührenstufe für eigene Bauwerke */
export type FeeLevel = 'frei' | 'normal' | 'hoch';

export interface Work {
  id: string; // Projekt aus data/projects.ts
  started: number; // Tag
  done: boolean;
  /** Bauherr: 'spieler' oder ID eines KI-Hauses. Fehlt bei öffentlichen Bauten (Kampagnenstart), die nichts kosten und nicht verlanden. */
  owner?: string;
  partner?: WorkPartner;
  fee?: FeeLevel;
  /** Verlandung einer Fahrrinne, 0 = frisch gebaggert, 1 = ganz zugeschwemmt */
  silt?: number;
  /** Laufende Pflege: hält die Rinne frei, kostet täglich */
  upkeep?: boolean;
  /** Gebühren, die der Spieler mit diesem Bauwerk eingenommen hat */
  earned?: number;
  /** Gebührenanteil, der an den Partner ging */
  partnerEarned?: number;
}

/** Ausbau eines Hafens durch den Spieler */
export interface Harbor {
  level: number; // 0 = natürlicher Hafen, bis 3
  /** laufender Ausbau auf die nächste Stufe */
  building?: { level: number; started: number };
  partner?: WorkPartner;
  fee?: FeeLevel;
  earned?: number;
  partnerEarned?: number;
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
  /** Angekündigte Hochwasser und Dürren; sie beginnen am Tag `from` und kommen dann nach `events` */
  forecast?: WorldEvent[];
  news: NewsItem[];
  contracts: Contract[];
  nextId: number;
  rng: number;
  /**
   * Tagesmarkt: Startwert für getrennte Zufallsströme. Ist er gesetzt, ziehen Ereignisse, Aufträge,
   * Kapitäne und Konkurrenz jeden Tag (bzw. jede Stunde) aus einem eigenen Strom, der nur vom
   * Startwert abhängt. So läuft der Tag für alle gleich ab, egal was der Spieler tut.
   */
  fairSeed?: number;
  /** Tagesmarkt: Stand je Zufallsstrom [Zeitpunkt, Zustand], damit mehrere Aufrufe im selben Zeitpunkt weiterziehen */
  fairStreams?: Record<string, [number, number]>;
  ledger: Ledger;
  /** Technische Epoche: 1 Treidelzeit, 2 Dampf, 3 Motor */
  epoch: number;
  /** Epoche folgt dem Fortschritt im Tal, spätestens den Spieljahren (freies Spiel) */
  epochAuto: boolean;
  /** Tag, an dem die aktuelle Epoche begann (fehlt in älteren Spielständen) */
  epochDay?: number;
  works: Work[];
  /** Brennstoffkosten seit Mitternacht */
  fuelToday: number;
  /** Preisbuch: Stand des letzten Besuchs je Stadt */
  priceBook?: Record<string, PriceBookPage>;
  /** Beobachteter Preisverlauf: Stadt -> Ware -> Punkte */
  priceHistory?: Record<string, Record<string, PricePoint[]>>;
  /** Gebietsabkommen mit KI-Häusern */
  pacts?: Pact[];
  /** bis zu diesem Tag schließt nach einem Vertragsbruch niemand ein Abkommen */
  pactBanUntil?: number;
  /** laufende Versteigerung von Kontoren */
  auction?: Auction | null;
  /** Häuser, die pleitegingen oder übernommen wurden */
  housesGone?: FallenHouse[];
  /** Hafenausbau je Stadt (fehlt = überall natürlicher Hafen) */
  harbors?: Record<string, Harbor>;
  /** Gebühren und Unterhalt des Wasserbaus seit Mitternacht (+ Einnahmen, − Ausgaben) */
  worksToday?: { income: number; cost: number };
  /**
   * Karte des Spielstands; fehlt bei älteren Ständen und heißt dann: Tal der zwei Flüsse.
   * Zufallskarten liegen vollständig bei (`def`), damit ein Stand auch nach Änderungen am Generator
   * oder an der Balance genau seine Karte behält.
   */
  map?: { id: string; seed?: number; def?: MapDef };
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
  if (hasTrait(ship.captain, 'schnell')) f *= 1.12;
  if (isMaster(ship.captain)) f *= 1.05;
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

/** Startwert eines Zufallsstroms aus Grundwert, Name und Zeitpunkt (Tag oder Stunde) */
export function streamSeed(seed: number, name: string, tick: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (tick | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}

/**
 * Führt fn mit einem eigenen Zufallsstrom aus, wenn der Spielstand einen fairSeed hat (Tagesmarkt).
 * Jeder Strom beginnt zu jedem Zeitpunkt (tick) neu aus dem Startwert; wird er im selben Zeitpunkt
 * mehrmals benutzt (Bildrate teilt eine Stunde in mehrere Schritte), zieht er dort weiter.
 * Der gemeinsame Strom state.rng bleibt unberührt. Ohne fairSeed ändert sich nichts.
 */
export function withStream<T>(state: GameState, name: string, tick: number, fn: () => T): T {
  if (state.fairSeed === undefined) return fn();
  const streams = (state.fairStreams ??= {});
  const saved = state.rng;
  const last = streams[name];
  state.rng = last && last[0] === tick ? last[1] : streamSeed(state.fairSeed, name, tick);
  try {
    return fn();
  } finally {
    streams[name] = [tick, state.rng];
    state.rng = saved;
  }
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
