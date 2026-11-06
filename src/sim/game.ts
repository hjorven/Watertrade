import type { MapDef } from '../data/maps/valley.ts';
import { isIce, waterLevel } from './calendar.ts';
import { tickContracts } from './contracts.ts';
import { eventWaterOffset, tickEvents } from './events.ts';
import { addShip, refreshTavern, runRoute } from './fleet.ts';
import { tickHouse } from './house.ts';
import { initialRivals, moveRivals, tickRivals } from './rivals.ts';
import { EPOCHS, epochOfYear, MIN_FRESH, PERISH, SHIPS } from '../data/ships.ts';
import { dueEpoch, TOW_FEE_EPOCH } from './epochs.ts';
import { YEAR_DAYS, year } from './calendar.ts';
import { addNews, day, shipClass, type GameEvent, type GameState, type NewsItem } from './state.ts';
import { tickWorks } from './works.ts';
import { initialMarket, initialTown, tickTown } from './towns.ts';
import { wearFactor, wearRate } from './voyage.ts';

export * from './state.ts';
export * from './trade.ts';
export * from './voyage.ts';
export { addShip, buyShip, dismantleRaft, RAFT_TIMBER, shipAllowed, timberPlan } from './fleet.ts';
export { effectiveSegments } from './works.ts';

export interface NewGameOptions {
  startTown: string;
  startShip?: string;
  money?: number;
  allowedShips?: string[];
  /** Konkurrenz ab Spielbeginn (Standard: an) */
  rivals?: boolean;
  seed?: number;
  /** feste Epoche (Kampagne); ohne Angabe folgt sie den Spieljahren */
  epoch?: number;
  /** zusätzliche Startschiffe */
  extraShips?: string[];
  /** Kontore zu Spielbeginn */
  kontore?: string[];
  /** fertige Wasserbauten zu Spielbeginn */
  works?: string[];
  /** Spielbeginn im Jahr (für spätere Kapitel) */
  startYear?: number;
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
    epoch: opts.epoch ?? 1,
    epochAuto: opts.epoch === undefined,
    works: (opts.works ?? []).map((id) => ({ id, started: 0, done: true })),
    fuelToday: 0,
  };
  if (opts.startYear && opts.startYear > 1) {
    state.hour += (opts.startYear - 1) * YEAR_DAYS * 24;
    state.waterLevel = waterLevel(state.hour / 24 + 1);
    state.ice = isIce(day(state));
  }
  if (state.epochAuto) state.epoch = epochOfYear(year(day(state)));
  state.epochDay = day(state);
  addShip(state, opts.startShip ?? 'treidelkahn', opts.startTown);
  for (const t of opts.extraShips ?? []) addShip(state, t, opts.startTown);
  for (const town of opts.kontore ?? []) state.kontore[town] = { level: 1, stock: {} };
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
  s.works ??= [];
  s.fuelToday ??= 0;
  if (s.epoch === undefined) {
    s.epochAuto = true;
    s.epoch = epochOfYear(year(day(s)));
  }
  // ältere Spielstände: die Epoche begann spätestens mit ihrem Jahr
  s.epochDay ??= Math.min(day(s), (EPOCHS[s.epoch - 1].from - 1) * YEAR_DAYS + 1);
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
    // ältere Spielstände: Dampfer bekommen einen vollen Bunker, damit keiner in einem Hafen ohne Kohle festsitzt
    ship.bunker ??= SHIPS[ship.type]?.bunker ?? 0;
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
    pushNews(events, tickWorks(state, map), true);
    if (state.epochAuto) {
      const e = dueEpoch(state);
      if (e > state.epoch) {
        state.epoch = e;
        state.epochDay = d;
        const name = EPOCHS.find((x) => x.number === e)!.name;
        pushNews(events, [addNews(state, 'ereignis', `Eine neue Zeit beginnt: ${name}. Die Werften bauen neue Schiffe.`)], true);
        if (e >= TOW_FEE_EPOCH) pushNews(events, [addNews(state, 'ereignis', 'Die Treidelpfade verfallen. Wer bergauf treidelt, zahlt jetzt Treidelgeld.')], true);
        events.push({ type: 'epoch', epoch: e });
      }
    }
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
      const cls = shipClass(ship);
      ship.condition = Math.max(0, ship.condition - dt * wearRate(ship, wearFactor(state, map, ship)));
      // Diesel wird unterwegs bezahlt, Kohle kommt aus dem Bunker (beim Ablegen gekauft)
      const fuel = (cls.fuel ?? 0) * dt;
      state.money -= fuel;
      state.fuelToday += fuel;
      if (cls.coal) ship.bunker = Math.max(0, (ship.bunker ?? 0) - cls.coal * dt);
      // ohne Kühlraum verdirbt Fisch, Brot und Bier unterwegs
      if (!cls.fresh) {
        for (const [g, slot] of Object.entries(ship.cargo)) {
          const rate = PERISH[g];
          if (rate) slot.fresh = Math.max(MIN_FRESH, (slot.fresh ?? 1) - (rate * dt) / 24);
        }
      }
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
