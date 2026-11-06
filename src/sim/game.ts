import type { MapDef } from '../data/maps/valley.ts';
import { isIce, waterLevel } from './calendar.ts';
import { tickContracts } from './contracts.ts';
import { eventWaterOffset, tickEvents } from './events.ts';
import { addShip, refreshTavern, runRoute } from './fleet.ts';
import { tickHouse } from './house.ts';
import { initialRivals, moveRivals, tickRivals } from './rivals.ts';
import { day, type GameEvent, type GameState, type NewsItem } from './state.ts';
import { initialMarket, initialTown, tickTown } from './towns.ts';
import { wearRate } from './voyage.ts';

export * from './state.ts';
export * from './trade.ts';
export * from './voyage.ts';
export { addShip, buyShip, dismantleRaft, RAFT_TIMBER, shipAllowed } from './fleet.ts';

export interface NewGameOptions {
  startTown: string;
  startShip?: string;
  money?: number;
  allowedShips?: string[];
  /** Konkurrenz ab Spielbeginn (Standard: an) */
  rivals?: boolean;
  seed?: number;
}

export const START_MONEY = 500;

/** Tage zwischen neuen Leuten in den Hafenkneipen */
const TAVERN_DAYS = 20;

export function newGame(map: MapDef, startTownOrOptions: string | NewGameOptions): GameState {
  const opts: NewGameOptions =
    typeof startTownOrOptions === 'string' ? { startTown: startTownOrOptions } : startTownOrOptions;
  const markets: GameState['markets'] = {};
  const towns: GameState['towns'] = {};
  for (const def of map.towns) {
    towns[def.id] = initialTown(def);
    markets[def.id] = initialMarket(def, towns[def.id]);
  }
  const state: GameState = {
    money: opts.money ?? START_MONEY,
    hour: 8,
    ships: [],
    markets,
    towns,
    waterLevel: waterLevel(1),
    ice: isIce(1),
    totalProfit: 0,
    firstProfitDone: false,
    nextShipId: 1,
    allowedShips: opts.allowedShips ?? [],
    stats: { delivered: {}, rafts: 0, trips: 0, contracts: 0 },
    kontore: {},
    betriebe: [],
    tavern: {},
    rivals: [],
    rivalsActive: opts.rivals ?? true,
    events: [],
    news: [],
    contracts: [],
    nextId: 1,
    rng: opts.seed ?? 20260601,
    ledger: { day: 0, wages: 0, upkeep: 0, production: 0 },
  };
  addShip(state, opts.startShip ?? 'treidelkahn', opts.startTown);
  refreshTavern(state, map);
  if (state.rivalsActive) state.rivals = initialRivals(state);
  return state;
}

/** Ältere Spielstände auf den aktuellen Aufbau bringen */
export function upgradeState(state: GameState, map: MapDef): GameState {
  const s = state as Partial<GameState> & GameState;
  s.stats.contracts ??= 0;
  s.kontore ??= {};
  s.betriebe ??= [];
  s.tavern ??= {};
  s.events ??= [];
  s.news ??= [];
  s.contracts ??= [];
  s.nextId ??= 1;
  s.rng ??= 20260601;
  s.ledger ??= { day: 0, wages: 0, upkeep: 0, production: 0 };
  if (s.rivalsActive === undefined) {
    s.rivalsActive = true;
    s.rivals = [];
  }
  s.rivals ??= [];
  for (const ship of s.ships) {
    ship.condition ??= 1;
    ship.upgrades ??= [];
    ship.captain ??= null;
    ship.route ??= null;
  }
  if (!Object.keys(s.tavern).length) refreshTavern(s, map);
  if (s.rivalsActive && !s.rivals.length) s.rivals = initialRivals(s);
  return s;
}

/** Konkurrenz zuschalten, etwa ab Kapitel 2 */
export function enableRivals(state: GameState): void {
  if (state.rivalsActive) return;
  state.rivalsActive = true;
  state.rivals = initialRivals(state);
}

/** Längster Zeitschritt in Stunden, damit Konkurrenz und Routen nichts überspringen */
const STEP = 1;

/** Spielzeit vorrücken. Städte arbeiten jeden Tag um Mitternacht. */
export function advance(state: GameState, map: MapDef, hours: number): GameEvent[] {
  const events: GameEvent[] = [];
  let left = hours;
  while (left > 1e-9) {
    const h = Math.min(STEP, left);
    left -= h;
    step(state, map, h, events);
  }
  return events;
}

function pushNews(events: GameEvent[], items: NewsItem[], important: boolean): void {
  for (const item of items) events.push({ type: 'news', item, important });
}

function step(state: GameState, map: MapDef, hours: number, events: GameEvent[]): void {
  const before = day(state);
  state.hour += hours;
  const after = day(state);
  for (let d = before + 1; d <= after; d++) {
    for (const def of map.towns) {
      const r = tickTown(def, state.markets[def.id], state.towns[def.id]);
      if (r.levelUp !== undefined || r.levelDown !== undefined) {
        const up = r.levelUp !== undefined;
        events.push({ type: 'townLevel', town: def.id, level: (r.levelUp ?? r.levelDown)!, up, newGoods: r.newGoods });
      }
    }
    tickHouse(state);
    pushNews(events, tickEvents(state, map), true);
    pushNews(events, tickContracts(state, map), false);
    if (state.rivalsActive) pushNews(events, tickRivals(state, map), false);
    if (d % TAVERN_DAYS === 0) refreshTavern(state, map);
    state.ice = isIce(d);
    events.push({ type: 'newDay', day: d });
  }
  state.waterLevel = waterLevel(state.hour / 24 + 1) + eventWaterOffset(state);

  for (const ship of state.ships) {
    const v = ship.voyage;
    if (v) {
      const dt = Math.min(hours, v.hours - v.elapsed);
      v.elapsed = Math.min(v.hours, v.elapsed + hours);
      ship.condition = Math.max(0, ship.condition - dt * wearRate(ship));
      if (v.elapsed >= v.hours) {
        ship.port = v.to;
        ship.voyage = null;
        events.push({ type: 'arrived', ship: ship.id, town: v.to, auto: !!ship.route?.active });
      }
    }
    if (ship.route?.active && ship.port && !ship.voyage) runRoute(state, map, ship);
  }
  if (state.rivalsActive) moveRivals(state, map, hours);
}

export function anySailing(state: GameState): boolean {
  return state.ships.some((s) => s.voyage !== null);
}
