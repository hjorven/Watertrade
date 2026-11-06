import { KONTOR_PRICE } from '../data/buildings.ts';
import { GOODS } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { RIVAL_BY_ID, RIVALS } from '../data/rivals.ts';
import { SHIPS } from '../data/ships.ts';
import { available, buyCost, sellRevenue } from './economy.ts';
import { withWind, type ShipType } from './river.ts';
import { addNews, rand, wind, type GameState, type NewsItem, type RivalShip, type RivalState } from './state.ts';
import { planRoute } from './voyage.ts';
import { connectedTowns } from './works.ts';
import { houseAvoids, tickRivalry } from './rivalry.ts';
import { sail } from './navigation.ts';
import { chargeRival, rivalDocks, rivalFeeFor } from './wasserbau.ts';

const RIVAL_SHIP_NAMES = ['Adler', 'Zuversicht', 'Merkur', 'Stolz', 'Treue', 'Sturmvogel', 'Hanse', 'Glück', 'Kranich', 'Neptun'];

/** Tageskosten je Schiff der Konkurrenz */
const RIVAL_UPKEEP = 6;
export const MAX_RIVAL_SHIPS = 3;

export function initialRivals(state: GameState): RivalState[] {
  // In späteren Kapiteln sind die Häuser schon gewachsen
  const years = Math.max(0, Math.floor(state.hour / 24 / 120));
  return RIVALS.map((def, i) => {
    const home = homeOf(state, def.home, i);
    const r: RivalState = { id: def.id, money: Math.round(def.money * (1 + years * 1.5)), ships: [], kontore: [], profit: 0 };
    // auf anderen Karten wird der Ersatzhafen einmal festgelegt, damit das Haus nicht mit der Zeit umzieht
    if (home !== def.home) r.home = home;
    for (const type of def.startShips) addRivalShip(state, r, preferredShip(type, state.epoch), home);
    for (let i = 0; i < Math.min(2, Math.floor(years / 3)); i++) addRivalShip(state, r, preferredShip(def.preferredShip, state.epoch), home);
    return r;
  });
}

/** Heimathafen eines Hauses; liegt er nicht auf dieser Karte (Zufallsflüsse), nimmt es eine der größten Städte zu Spielbeginn */
function homeOf(state: GameState, home: string, index: number): string {
  if (state.towns[home]) return home;
  const big = Object.entries(state.towns)
    .sort((a, b) => b[1].population - a[1].population || a[0].localeCompare(b[0]))
    .map(([id]) => id);
  return big[index % Math.min(3, big.length)];
}

function addRivalShip(state: GameState, r: RivalState, type: string, port: string): RivalShip {
  const id = 1000 + state.nextId++;
  const ship: RivalShip = {
    id,
    type,
    name: RIVAL_SHIP_NAMES[id % RIVAL_SHIP_NAMES.length],
    port,
    voyage: null,
    cargo: null,
    // Startschiffe legen gestaffelt ab, damit nicht alle gleichzeitig den Markt leerkaufen
    idleUntil: state.hour + Math.floor(rand(state) * 36),
  };
  r.ships.push(ship);
  return ship;
}

function rivalType(state: GameState, ship: RivalShip): ShipType {
  const cls = withWind(SHIPS[ship.type], wind(state));
  const load = ship.cargo?.amount ?? 0;
  return { ...cls, draft: cls.draft * (0.6 + 0.4 * Math.min(1, load / cls.capacity)) };
}

/** Vermögen: Geld, Schiffe zum Zeitwert, Kontore */
export function rivalWorth(r: RivalState): number {
  const ships = r.ships.reduce((s, x) => s + SHIPS[x.type].price * 0.7, 0);
  return Math.round(r.money + ships + r.kontore.length * KONTOR_PRICE);
}

function sellCargo(state: GameState, r: RivalState, ship: RivalShip, town: string): void {
  const c = ship.cargo;
  if (!c) return;
  const good = GOODS.find((g) => g.id === c.good)!;
  const m = state.markets[town][c.good];
  if (m) {
    const factor = r.kontore.includes(town) ? 0.95 : 0.9;
    const revenue = sellRevenue(good.base, m, c.amount, factor);
    m.stock += c.amount;
    r.money += revenue;
    r.profit += revenue - c.cost;
  }
  ship.cargo = null;
}

interface Deal {
  good: string;
  amount: number;
  cost: number;
  dest: string;
  score: number;
}

/** Bestes Geschäft vom aktuellen Hafen aus: Gewinn pro Stunde, gewichtet mit den Vorlieben des Hauses */
function bestDeal(state: GameState, map: MapDef, r: RivalState, ship: RivalShip): Deal | null {
  const def = RIVAL_BY_ID.get(r.id)!;
  const here = ship.port!;
  const cls = SHIPS[ship.type];
  const routes = new Map<string, { hours: number; fee: number }>();
  const empty = { ...rivalType(state, { ...ship, cargo: null }) };
  const full = { ...empty, draft: cls.draft };
  for (const t of map.towns) {
    if (t.id === here) continue;
    const p = planRoute(state, map, here, t.id, full);
    if (p.ok) routes.set(t.id, { hours: p.voyage.hours, fee: rivalFeeFor(state, r, p.voyage.legs.map((l) => l.seg), cls.capacity) });
  }
  let best: Deal | null = null;
  for (const [goodId, m] of Object.entries(state.markets[here])) {
    const good = GOODS.find((g) => g.id === goodId);
    if (!good || houseAvoids(state, r.id, goodId)) continue;
    const amount = Math.min(Math.floor(cls.capacity * def.greed), available(m) - 5);
    if (amount < 8) continue;
    const cost = buyCost(good.base, m, amount);
    if (cost > r.money * 0.8) continue;
    for (const [dest, { hours, fee }] of routes) {
      const m2 = state.markets[dest][goodId];
      if (!m2) continue;
      const revenue = sellRevenue(good.base, m2, amount, r.kontore.includes(dest) ? 0.95 : 0.9);
      // Gebühren für fremde Bauwerke schmälern den Gewinn
      const profit = revenue - cost - fee;
      if (profit < amount * 2) continue;
      const score = (profit * (def.favorite[goodId] ?? 1)) / (hours + 8);
      if (!best || score > best.score) best = { good: goodId, amount, cost, dest, score };
    }
  }
  return best;
}

/**
 * Dampfer der Konkurrenz bunkern Kohle am Hafenmarkt, genau wie der Spieler.
 * Gibt es dort keine, zahlen sie den anderthalbfachen Grundpreis beim Kohlenhändler.
 */
function rivalBunker(state: GameState, r: RivalState, ship: RivalShip, hours: number): void {
  const cls = SHIPS[ship.type];
  if (cls.fuel) r.money -= Math.round(cls.fuel * hours); // Diesel
  const rate = cls.coal;
  if (!rate) return;
  const need = Math.ceil(rate * hours);
  const base = GOODS.find((g) => g.id === 'kohle')!.base;
  const m = state.markets[ship.port!]?.kohle;
  const fromMarket = m ? Math.max(0, Math.min(need, available(m) - 5)) : 0;
  if (fromMarket > 0) {
    r.money -= buyCost(base, m!, fromMarket);
    m!.stock -= fromMarket;
  }
  r.money -= Math.round((need - fromMarket) * base * 1.5);
}

function sailTo(state: GameState, map: MapDef, ship: RivalShip, dest: string, r?: RivalState): boolean {
  const plan = planRoute(state, map, ship.port!, dest, rivalType(state, ship));
  if (!plan.ok) return false;
  if (r) {
    rivalBunker(state, r, ship, plan.voyage.hours);
    chargeRival(state, r, plan.voyage, SHIPS[ship.type].capacity);
  }
  ship.voyage = plan.voyage;
  ship.port = null;
  return true;
}

/** Ein Schiff der Konkurrenz im Hafen entscheidet, was es tut */
function decide(state: GameState, map: MapDef, r: RivalState, ship: RivalShip): void {
  const here = ship.port!;
  if (ship.cargo) {
    // Ladung am Ziel verkaufen, oder hier, wenn das Ziel nicht mehr erreichbar ist
    if (ship.cargo.dest === here || !sailTo(state, map, ship, ship.cargo.dest, r)) sellCargo(state, r, ship, here);
    else return;
  }
  const deal = bestDeal(state, map, r, ship);
  if (deal) {
    const m = state.markets[here][deal.good];
    const cost = buyCost(GOODS.find((g) => g.id === deal.good)!.base, m, deal.amount);
    m.stock -= deal.amount;
    r.money -= cost;
    ship.cargo = { good: deal.good, amount: deal.amount, cost, dest: deal.dest };
    if (sailTo(state, map, ship, deal.dest, r)) return;
    // doch nicht losgekommen: Ware zurück
    m.stock += deal.amount;
    r.money += cost;
    ship.cargo = null;
  }
  // nichts zu tun: einen Tag warten, dann zufällig einen anderen Hafen anlaufen
  const def = RIVAL_BY_ID.get(r.id)!;
  if (rand(state) < 0.5) {
    const others = map.towns.filter((t) => t.id !== here);
    const target = rand(state) < 0.4 ? (r.home ?? homeOf(state, def.home, state.rivals.indexOf(r))) : others[Math.floor(rand(state) * others.length)].id;
    if (target !== here && sailTo(state, map, ship, target, r)) return;
  }
  ship.idleUntil = state.hour + 18 + Math.floor(rand(state) * 12);
}

/** Konkurrenz in Stundenschritten bewegen */
export function moveRivals(state: GameState, map: MapDef, hours: number): void {
  for (const r of state.rivals) {
    for (const ship of r.ships) {
      const v = ship.voyage;
      if (v) {
        // auch die Konkurrenz fährt nachts ohne Leuchtfeuer langsamer
        v.elapsed = Math.min(v.hours, v.elapsed + sail(state, ship.type, v, state.hour - hours, hours).progress);
        if (v.elapsed >= v.hours - 1e-6) {
          ship.port = v.to;
          ship.voyage = null;
          // Liegezeit zum Laden, im ausgebauten Hafen kürzer; dort wird Liegegeld fällig
          const quick = rivalDocks(state, r, ship.port);
          ship.idleUntil = state.hour + (3 + Math.floor(rand(state) * 4)) * quick;
        }
        continue;
      }
      if (state.hour >= ship.idleUntil) decide(state, map, r, ship);
    }
  }
}

/** Mit neuen Epochen kaufen die Häuser moderne Schiffe */
export function preferredShip(base: string, epoch: number): string {
  if (epoch >= 3) return base === 'plaette' ? 'raddampfer' : 'motorschiff';
  if (epoch >= 2) return base === 'treidelkahn' || base === 'segelkahn' ? 'raddampfer' : base;
  return base;
}

/** Täglich: Unterhalt zahlen, wachsen, Kontore bauen */
export function tickRivals(state: GameState, map: MapDef): NewsItem[] {
  const news: NewsItem[] = [];
  for (const r of state.rivals) {
    const def = RIVAL_BY_ID.get(r.id)!;
    r.money -= r.ships.length * RIVAL_UPKEEP;
    const type = preferredShip(def.preferredShip, state.epoch);
    const cls = SHIPS[type];
    if (r.ships.length < MAX_RIVAL_SHIPS + state.epoch - 1 && r.money > def.expandAt * state.epoch + cls.price) {
      const yard = map.towns.find((t) => t.shipyard.includes(type));
      if (yard) {
        r.money -= cls.price;
        const s = addRivalShip(state, r, type, yard.id);
        news.push(addNews(state, 'konkurrenz', `${def.name} stellt einen neuen ${cls.name} in Dienst, die „${s.name}".`));
      }
    }
    if (def.builds && r.kontore.length < 3 && r.money > 2500) {
      // nur Städte, die die eigenen Schiffe erreichen (Karte mit ungebautem Kanal)
      const reach = connectedTowns(state, map, r.ships.map((s) => s.port ?? s.voyage?.to ?? '').filter(Boolean));
      const options = map.towns.filter((t) => !r.kontore.includes(t.id) && reach.has(t.id));
      if (options.length) {
        const town = options[Math.floor(rand(state) * options.length)];
        r.money -= KONTOR_PRICE;
        r.kontore.push(town.id);
        news.push(addNews(state, 'konkurrenz', `${def.name} eröffnet ein Kontor in ${town.name}.`));
      }
    }
    // Ein Haus in Not verkauft ein Schiff
    if (r.money < 0 && r.ships.length > 1) {
      const idle = r.ships.find((s) => s.port && !s.cargo);
      if (idle) {
        r.ships = r.ships.filter((s) => s !== idle);
        r.money += SHIPS[idle.type].price * 0.5;
        news.push(addNews(state, 'konkurrenz', `${def.name} muss die „${idle.name}" verkaufen.`));
      }
    }
  }
  // Reaktion auf den Spieler, Abkommen, Konkurs, Anteile (rivalry.ts)
  news.push(...tickRivalry(state, map));
  return news;
}
