import { CAPTAIN_FIRST, CAPTAIN_LAST, MAX_WAGE } from '../data/captains.ts';
import { fairWage, LOYALTY_START, rollTrait } from './captains.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { SHIPS, UPGRADE_BY_ID } from '../data/ships.ts';
import { buyCost, sellRevenue } from './economy.ts';
import { BLOCK_TEXT } from './river.ts';
import {
  capacityOf,
  cargoLoad,
  fail,
  getShip,
  pick,
  rand,
  randInt,
  shipClass,
  type Captain,
  type GameState,
  type RouteOrder,
  type Ship,
  type TradeResult,
  type TradeRoute,
} from './state.ts';
import { activeStops, bookRoute, bookValue, fmtLevel, LOAD_RETRY_HOURS, MAX_LOAD_WAIT_HOURS, stopSkipped, syncPlan } from './routes.ts';
import { buy, load, sell, store } from './trade.ts';
import { depart, departProblem, planVoyage } from './voyage.ts';

const SHIP_NAMES = ['Anna', 'Greta', 'Hoffnung', 'Lotte', 'Möwe', 'Fortuna', 'Elise', 'Biber', 'Wilhelmine', 'Otter', 'Marie', 'Eintracht'];

export function addShip(state: GameState, type: string, port: string): Ship {
  const id = state.nextShipId++;
  const ship: Ship = {
    id,
    type,
    name: SHIP_NAMES[(id - 1) % SHIP_NAMES.length],
    port,
    voyage: null,
    cargo: {},
    condition: 1,
    upgrades: [],
    captain: null,
    route: null,
    // neue Dampfer kommen mit vollem Bunker von der Werft
    bunker: SHIPS[type]?.bunker ?? 0,
  };
  state.ships.push(ship);
  return ship;
}

export function shipAllowed(state: GameState, type: string): boolean {
  if ((SHIPS[type]?.epoch ?? 1) > state.epoch) return false;
  return state.allowedShips.length === 0 || state.allowedShips.includes(type);
}

export function buyShip(state: GameState, map: MapDef, town: string, type: string): { ok: boolean; message: string; ship?: Ship } {
  const def = map.towns.find((t) => t.id === town);
  const cls = SHIPS[type];
  if (!def || !cls || !def.shipyard.includes(type)) return { ok: false, message: 'Hier wird dieser Schiffstyp nicht gebaut.' };
  if (cls.epoch > state.epoch) return { ok: false, message: `${cls.name} gibt es erst in einer späteren Epoche.` };
  if (!shipAllowed(state, type)) return { ok: false, message: `${cls.name} gibt es in diesem Kapitel noch nicht.` };
  if (cls.timber) return buildFromTimber(state, town, type, def.name);
  if (state.money < cls.price) return { ok: false, message: `Ein ${cls.name} kostet ${cls.price} Taler.` };
  state.money -= cls.price;
  const ship = addShip(state, type, town);
  return { ok: true, message: `${cls.name} „${ship.name}" liegt in ${def.name} bereit.`, ship };
}

/** Holz für ein Floß: erst aus dem eigenen Kontor, der Rest vom Markt */
export function timberPlan(state: GameState, town: string, type: string): { fromKontor: number; fromMarket: number; cost: number; problem: string | null } {
  const cls = SHIPS[type];
  const need = cls.timber ?? 0;
  const fromKontor = Math.min(need, Math.floor(state.kontore[town]?.stock.holz?.amount ?? 0));
  const fromMarket = need - fromKontor;
  const m = state.markets[town]?.holz;
  if (fromMarket > 0 && (!m || m.stock - 1 < fromMarket)) return { fromKontor, fromMarket, cost: 0, problem: `Für ein ${cls.name} fehlen ${fromMarket} t Holz.` };
  const cost = cls.price + (fromMarket > 0 ? buyCost(GOOD_BY_ID.get('holz')!.base, m!, fromMarket) : 0);
  if (cost > state.money) return { fromKontor, fromMarket, cost, problem: `Lohn und Holz kosten ${cost} Taler.` };
  return { fromKontor, fromMarket, cost, problem: null };
}

function buildFromTimber(state: GameState, town: string, type: string, townName: string): { ok: boolean; message: string; ship?: Ship } {
  const cls = SHIPS[type];
  const p = timberPlan(state, town, type);
  if (p.problem) return { ok: false, message: p.problem };
  if (p.fromKontor > 0) {
    const slot = state.kontore[town].stock.holz;
    const share = (slot.cost * p.fromKontor) / slot.amount;
    slot.amount -= p.fromKontor;
    slot.cost -= share;
    if (slot.amount < 0.001) delete state.kontore[town].stock.holz;
  }
  if (p.fromMarket > 0) state.markets[town].holz.stock -= p.fromMarket;
  state.money -= p.cost;
  const ship = addShip(state, type, town);
  const src = p.fromKontor && p.fromMarket ? 'Kontor und Markt' : p.fromKontor ? 'dem Kontor' : 'vom Markt';
  return { ok: true, message: `${cls.name} „${ship.name}" aus ${cls.timber} t Holz (${src}) gezimmert, ${p.cost} Taler. Es liegt in ${townName} bereit.`, ship };
}

/** Werft in einer Stadt: alles, wo überhaupt Schiffe gebaut werden */
export function hasYard(map: MapDef, town: string): boolean {
  return (map.towns.find((t) => t.id === town)?.shipyard.length ?? 0) > 0;
}

export function repairCost(ship: Ship): number {
  return Math.round((1 - ship.condition) * shipClass(ship).price * 0.5);
}

export function repair(state: GameState, map: MapDef, shipId: number): TradeResult {
  const ship = getShip(state, shipId);
  if (!ship.port || !hasYard(map, ship.port)) return fail('Reparieren kann nur eine Werft.');
  const cost = repairCost(ship);
  if (cost <= 0) return fail('Das Schiff ist in bestem Zustand.');
  if (cost > state.money) return fail(`Die Reparatur kostet ${cost} Taler.`);
  state.money -= cost;
  ship.condition = 1;
  return { ok: true, message: `${ship.name} ist überholt, ${cost} Taler.`, amount: 0, taler: cost };
}

export function upgradeCost(ship: Ship, id: string): number {
  return Math.round(shipClass(ship).price * (UPGRADE_BY_ID.get(id)?.cost ?? 0));
}

export function upgrade(state: GameState, map: MapDef, shipId: number, id: string): TradeResult {
  const ship = getShip(state, shipId);
  const u = UPGRADE_BY_ID.get(id);
  if (!u) return fail('Unbekannter Ausbau.');
  if (ship.type === 'floss') return fail('Ein Floß lohnt keinen Ausbau.');
  if (!ship.port || !hasYard(map, ship.port)) return fail('Ausbauen kann nur eine Werft.');
  if (ship.upgrades.includes(id)) return fail('Schon eingebaut.');
  const cost = upgradeCost(ship, id);
  if (cost > state.money) return fail(`${u.name} kostet ${cost} Taler.`);
  state.money -= cost;
  ship.upgrades.push(id);
  return { ok: true, message: `${ship.name}: ${u.name} eingebaut.`, amount: 0, taler: cost };
}

/** Holzmenge, die ein zerlegtes Floß ergibt: das Bauholz kommt zurück */
export const RAFT_TIMBER = SHIPS.floss.timber ?? 20;

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

/* ---------- Kapitäne ---------- */

/** Anteil erfahrener Kapitäne mit zweiter Eigenschaft in der Hafenkneipe */
const VETERAN_SHARE = 0.12;

export function newCaptain(state: GameState): Captain {
  const trait = rollTrait(state);
  const veteran = rand(state) < VETERAN_SHARE;
  const c: Captain = {
    id: state.nextId++,
    name: `${pick(state, CAPTAIN_FIRST)} ${pick(state, CAPTAIN_LAST)}`,
    trait,
    wage: 0,
    hire: 0,
    km: veteran ? randInt(state, 40, 120) * 10 : randInt(state, 0, 15) * 10,
  };
  if (veteran) c.trait2 = rollTrait(state, trait);
  // Wer anheuert, verhandelt: bis zu 4 Taler über dem, was er wert ist
  c.wage = Math.min(MAX_WAGE, fairWage(c) + randInt(state, 0, 4));
  c.hire = c.wage * 10 + randInt(state, 0, 4) * 10;
  return c;
}

/** Hafenkneipen bekommen alle 20 Tage neue Leute */
export function refreshTavern(state: GameState, map: MapDef): void {
  for (const t of map.towns) {
    const n = rand(state) < 0.5 ? 1 : 2;
    state.tavern[t.id] = Array.from({ length: n }, () => newCaptain(state));
  }
}

export function hireCaptain(state: GameState, shipId: number, captainId: number): TradeResult {
  const ship = getShip(state, shipId);
  if (!ship.port) return fail('Anheuern geht nur im Hafen.');
  if (ship.type === 'floss') return fail('Ein Floß braucht keinen Kapitän.');
  const list = state.tavern[ship.port] ?? [];
  const c = list.find((x) => x.id === captainId);
  if (!c) return fail('Der Kapitän ist nicht mehr da.');
  if (c.hire > state.money) return fail(`${c.name} will ${c.hire} Taler Handgeld.`);
  state.money -= c.hire;
  state.tavern[ship.port] = list.filter((x) => x.id !== captainId);
  if (ship.captain) state.tavern[ship.port].push(releaseCaptain(ship.captain));
  c.loyalty = LOYALTY_START;
  ship.captain = c;
  return { ok: true, message: `${c.name} führt jetzt die ${ship.name}.`, amount: 0, taler: c.hire };
}

/** Wer zurück in die Kneipe geht, vergisst Angebot und Kränkung und verlangt wieder, was er wert ist */
function releaseCaptain(c: Captain): Captain {
  c.offer = undefined;
  c.promised = undefined;
  c.warned = undefined;
  c.loyalty = undefined;
  c.wage = Math.max(c.wage, fairWage(c));
  c.hire = c.wage * 10;
  return c;
}

export function dismissCaptain(state: GameState, shipId: number): TradeResult {
  const ship = getShip(state, shipId);
  if (!ship.captain) return fail('Kein Kapitän an Bord.');
  const name = ship.captain.name;
  if (ship.port) (state.tavern[ship.port] ??= []).push(releaseCaptain(ship.captain));
  ship.captain = null;
  if (ship.route) ship.route.active = false;
  return { ok: true, message: `${name} geht von Bord.`, amount: 0, taler: 0 };
}

/* ---------- Handelsrouten ---------- */

export function setRoute(state: GameState, shipId: number, route: Ship['route']): void {
  const ship = getShip(state, shipId);
  ship.route = route;
}

function execOrder(state: GameState, ship: Ship, o: RouteOrder): TradeResult {
  const have = ship.cargo[o.good]?.amount ?? 0;
  switch (o.kind) {
    case 'kaufen': {
      const want = (o.amount || capacityOf(ship)) - have;
      return want > 0 ? buy(state, ship.id, o.good, want, o.limit) : fail('genug an Bord');
    }
    case 'verkaufen':
      return sell(state, ship.id, o.good, o.amount || have, o.limit);
    case 'einlagern':
      return store(state, ship.id, o.good, o.amount || have);
    case 'auslagern': {
      const want = (o.amount || capacityOf(ship)) - have;
      return want > 0 ? load(state, ship.id, o.good, want) : fail('genug an Bord');
    }
  }
}

/**
 * Ein Schiff mit Kapitän und aktiver Route arbeitet seinen Halt ab und legt zum nächsten ab.
 * Erst wird verkauft und eingelagert, dann gekauft, damit Platz im Laderaum ist.
 * Bedingungen je Halt: Mindestladung vor dem Ablegen, Halt überspringen bei zu niedrigem oder hohem Pegel.
 * Zur Jahreszeit passend gilt der Sommer- oder Winterplan. Was der Halt einbringt, kommt ins Routenbuch.
 */
export function runRoute(state: GameState, map: MapDef, ship: Ship): string | null {
  const r = ship.route;
  if (!r || !r.active || !ship.port || ship.voyage || !ship.captain) return null;
  syncPlan(state, r, ship.port);
  if (r.retryAt !== undefined && state.hour < r.retryAt) return null;
  const before = bookValue(state, ship);
  const log = runStop(state, map, ship, r);
  bookRoute(state, r, bookValue(state, ship) - before);
  return log;
}

const isLoading = (o: RouteOrder) => o.kind === 'kaufen' || o.kind === 'auslagern';

function runStop(state: GameState, map: MapDef, ship: Ship, r: TradeRoute): string | null {
  const stops = activeStops(state, r);
  if (stops.length < 2) return null;
  if (r.next >= stops.length) r.next = 0;
  const port = ship.port!;
  const townName = (id: string) => map.towns.find((t) => t.id === id)?.name ?? id;
  const here = stops[r.next].town === port ? stops[r.next] : null;
  const waitingForLoad = r.loadingSince !== undefined;
  let log: string | null = null;
  if (here && (r.retryAt === undefined || waitingForLoad)) {
    const order = (k: RouteOrder['kind']) => (k === 'verkaufen' || k === 'einlagern' ? 0 : 1);
    // beim Warten auf Ladung nur noch nachkaufen und aus dem Kontor holen
    const list = waitingForLoad ? here.orders.filter(isLoading) : here.orders;
    const sorted = [...list].sort((a, b) => order(a.kind) - order(b.kind));
    const done = sorted.map((o) => execOrder(state, ship, o)).filter((x) => x.ok);
    if (done.length) log = done.map((x) => x.message).join(' ');
  }
  // Bedingung: erst ablegen, wenn genug geladen ist (höchstens MAX_LOAD_WAIT_HOURS lang warten)
  if (here && here.minLoad) {
    const cap = capacityOf(ship);
    const loaded = cargoLoad(ship);
    const since = r.loadingSince ?? state.hour;
    if (loaded < cap * here.minLoad - 1e-6 && state.hour - since < MAX_LOAD_WAIT_HOURS) {
      r.loadingSince = since;
      r.retryAt = state.hour + LOAD_RETRY_HOURS;
      r.note = `wartet in ${townName(port)} auf Ladung: ${Math.floor(loaded)} von ${Math.ceil(cap * here.minLoad)} t`;
      return log;
    }
  }
  // nächstes Ziel: der folgende Halt, oder der aktuelle, falls das Schiff woanders liegt;
  // Halte, deren Pegelbedingung nicht passt, werden übersprungen
  let nextIndex = here ? (r.next + 1) % stops.length : r.next;
  const skipped: string[] = [];
  while (skipped.length < stops.length && stopSkipped(state, stops[nextIndex])) {
    skipped.push(townName(stops[nextIndex].town));
    nextIndex = (nextIndex + 1) % stops.length;
  }
  if (skipped.length >= stops.length) {
    r.note = `wartet in ${townName(port)}: bei diesem Pegel wird jeder Halt übersprungen`;
    r.retryAt = state.hour + 12;
    return log;
  }
  const skipText = skipped.length ? `, ${skipped.join(' und ')} übersprungen (Pegel ${fmtLevel(state.waterLevel)})` : '';
  const target = stops[nextIndex].town;
  if (target === port) {
    if (here && nextIndex === r.next) {
      // alle anderen Halte werden übersprungen: hier warten, ohne erneut zu handeln
      r.note = `wartet in ${townName(port)}${skipText}`;
      r.retryAt = state.hour + 12;
      return log;
    }
    // der nächste gültige Halt ist ein anderer Halt in diesem Hafen: dort beim nächsten Durchlauf handeln
    r.next = nextIndex;
    r.loadingSince = undefined;
    r.retryAt = undefined;
    if (skipText) r.note = `bleibt in ${townName(port)}${skipText}`;
    return log;
  }
  const plan = planVoyage(state, map, ship.id, target);
  if (!plan) return log;
  if (!plan.ok) {
    const why = plan.reasons.map((x) => BLOCK_TEXT[x.reason]).join(', ') || 'keine Verbindung';
    r.note = `wartet in ${townName(port)}: ${why}`;
    // Halt gilt als erledigt, damit beim nächsten Versuch nicht noch einmal gehandelt wird
    r.next = nextIndex;
    r.loadingSince = undefined;
    r.retryAt = state.hour + 12;
    return log;
  }
  if (!depart(state, map, ship.id, target)) {
    const why = departProblem(state, map, ship.id, target) ?? 'kein Geld für den Zoll';
    r.note = `wartet: ${why.replace(/\.$/, '')}`;
    r.next = nextIndex;
    r.loadingSince = undefined;
    r.retryAt = state.hour + 12;
    return log;
  }
  r.next = nextIndex;
  r.retryAt = undefined;
  r.loadingSince = undefined;
  r.note = `unterwegs nach ${townName(target)}${skipText}`;
  return log;
}

/** Tageslöhne aller Kapitäne */
export function captainWages(state: GameState): number {
  return state.ships.reduce((s, x) => s + (x.captain?.wage ?? 0), 0);
}
