import type { MapDef } from '../data/maps/valley.ts';
import { isIce, waterLevel } from './calendar.ts';
import { captainArrived, tickCaptains } from './captains.ts';
import { tickContracts } from './contracts.ts';
import { eventWaterOffset, tickEvents } from './events.ts';
import { addShip, refreshTavern, runRoute } from './fleet.ts';
import { bookCoal, bookRoute, bookRouteWages } from './routes.ts';
import { tickHouse } from './house.ts';
import { initialRivals, moveRivals, tickRivals } from './rivals.ts';
import { weakenHouse } from './rivalry.ts';
import { EPOCHS, epochOfYear, MIN_FRESH, PERISH, SHIPS } from '../data/ships.ts';
import { dueEpoch, TOW_FEE_EPOCH } from './epochs.ts';
import { YEAR_DAYS, year } from './calendar.ts';
import { addNews, day, shipClass, withStream, type GameEvent, type GameState, type NewsItem } from './state.ts';
import { tickWorks } from './works.ts';
import { observe, tickMarketInfo, tripArrive, tripSail } from './market-info.ts';
import { closeSteamDay, logSteam } from './steam.ts';
import { initialMarket, initialTown, tickTown } from './towns.ts';
import { movingHours, wearFactor, wearRate } from './voyage.ts';
import { voyageProgress } from './navigation.ts';
import { tickWaterworks } from './wasserbau.ts';
import { PROJECT_BY_ID } from '../data/projects.ts';

export * from './state.ts';
export * from './trade.ts';
export * from './voyage.ts';
export * from './navigation.ts';
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
  /** KI-Haus, das geschwächt startet (Kapitel mit Übernahme-Ziel) */
  weakHouse?: string;
  /** Tage nach Jahresbeginn, an dem das Spiel startet (z. B. 30 = erster Sommertag) */
  startDay?: number;
  /** Tagesmarkt: getrennte Zufallsströme je System aus diesem Startwert (siehe withStream) */
  fairSeed?: number;
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
    ...(opts.fairSeed !== undefined ? { fairSeed: opts.fairSeed } : {}),
    ledger: { day: 0, wages: 0, upkeep: 0, production: 0 },
    epoch: opts.epoch ?? 1,
    epochAuto: opts.epoch === undefined,
    works: (opts.works ?? []).map((id) => ({ id, started: 0, done: true })),
    fuelToday: 0,
  };
  const startDays = Math.max(0, (opts.startYear ?? 1) - 1) * YEAR_DAYS + Math.max(0, Math.floor(opts.startDay ?? 0));
  if (startDays > 0) {
    state.hour += startDays * 24;
    state.waterLevel = waterLevel(state.hour / 24 + 1);
    state.ice = isIce(day(state));
  }
  if (state.epochAuto) state.epoch = epochOfYear(year(day(state)));
  state.epochDay = day(state);
  addShip(state, opts.startShip ?? 'treidelkahn', opts.startTown);
  for (const t of opts.extraShips ?? []) addShip(state, t, opts.startTown);
  for (const town of opts.kontore ?? []) state.kontore[town] = { level: 1, stock: {} };
  withStream(state, 'kneipe', 0, () => refreshTavern(state, map));
  if (state.rivalsActive) state.rivals = withStream(state, 'konkurrenz-start', 0, () => initialRivals(state));
  state.priceBook = {};
  state.priceHistory = {};
  observe(state, opts.startTown);
  if (opts.weakHouse) weakenHouse(state, opts.weakHouse);
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
  // ältere Spielstände: selbst gebaute Werke (Baubeginn nach Tag 0) gehören dem Spieler
  for (const w of s.works) {
    if (w.owner || w.started <= 0) continue;
    w.owner = 'spieler';
    w.fee ??= 'normal';
    if (PROJECT_BY_ID.get(w.id)?.kind === 'vertiefung' && w.upkeep === undefined) {
      w.upkeep = true;
      addNews(s, 'haus', `Neu beim Wasserbauamt: ${PROJECT_BY_ID.get(w.id)!.name} wird jetzt gepflegt und kostet täglich Unterhalt. Abschalten im Reiter Wasserbau.`);
    }
  }
  s.fuelToday ??= 0;
  s.priceBook ??= {};
  s.priceHistory ??= {};
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
  // nicht neu anlegen, wenn alle Häuser pleite oder übernommen sind
  if (s.rivalsActive && !s.rivals.length && !s.housesGone?.length) s.rivals = initialRivals(s);
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

/**
 * Tagesmarkt: fn zu einer festen Spielstunde ausführen, damit Zeitpunkte wie idleUntil
 * und der Pegel bei der Routenplanung nicht von der Bildrate abhängen. Ohne fairSeed läuft fn zur aktuellen Stunde.
 */
function atHour<T>(state: GameState, hour: number, fn: () => T): T {
  if (state.fairSeed === undefined) return fn();
  const real = state.hour;
  const level = state.waterLevel;
  state.hour = hour;
  // Pegel zur festen Stunde, die Routenplanung der Konkurrenz hängt davon ab
  state.waterLevel = waterLevel(hour / 24 + 1) + eventWaterOffset(state);
  try {
    return fn();
  } finally {
    state.hour = real;
    state.waterLevel = level;
  }
}

function step(state: GameState, map: MapDef, hours: number, events: GameEvent[]): void {
  const before = day(state);
  const hourBefore = state.hour;
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
    closeSteamDay(state);
    tickHouse(state);
    // gleich nach der Lohnzahlung buchen, bevor Kapitäne gehen oder abgeworben werden
    bookRouteWages(state);
    pushNews(events, tickCaptains(state, map), true);
    pushNews(events, tickWorks(state, map), true);
    pushNews(events, tickWaterworks(state, map), false);
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
    pushNews(events, withStream(state, 'ereignisse', d, () => tickEvents(state, map)), true);
    pushNews(events, withStream(state, 'auftraege', d, () => tickContracts(state, map)), false);
    if (state.rivalsActive) {
      pushNews(events, atHour(state, (d - 1) * 24, () => withStream(state, 'konkurrenz', d, () => tickRivals(state, map))), false);
    }
    if (d % TAVERN_DAYS === 0) withStream(state, 'kneipe', d, () => refreshTavern(state, map));
    pushNews(events, tickMarketInfo(state, map), false);
    state.ice = isIce(d);
    events.push({ type: 'newDay', day: d });
  }
  state.waterLevel = waterLevel(state.hour / 24 + 1) + eventWaterOffset(state);

  for (const ship of state.ships) {
    const v = ship.voyage;
    if (v) {
      const before = v.elapsed;
      // Fortschritt in Stunden voller Fahrt: nachts ohne Leuchtfeuer langsamer, nach Grundberührung Stillstand
      const moved = voyageProgress(state, map, ship, hours, events);
      v.elapsed = Math.min(v.hours, v.elapsed + moved.progress);
      // Verbrauch und Verschleiß nur in Fahrstunden, nicht während des Ladens und Löschens
      const dt = movingHours(v, before, v.elapsed);
      const cls = shipClass(ship);
      ship.condition = Math.max(0, ship.condition - dt * wearRate(ship, wearFactor(state, map, ship)));
      // Diesel wird unterwegs bezahlt, Kohle kommt aus dem Bunker (beim Ablegen gekauft)
      const fuel = (cls.fuel ?? 0) * dt;
      state.money -= fuel;
      state.fuelToday += fuel;
      tripSail(ship, dt, fuel, moved.real);
      if (ship.route?.active) bookRoute(state, ship.route, -fuel);
      if (cls.coal) {
        const burnt = Math.min(ship.bunker ?? 0, cls.coal * dt);
        ship.bunker = Math.max(0, (ship.bunker ?? 0) - cls.coal * dt);
        if (ship.route?.active) bookCoal(state, ship.route, burnt);
        logSteam(state, ship.id, dt);
      }
      // ohne Kühlraum verdirbt Fisch, Brot und Bier unterwegs
      if (!cls.fresh) {
        for (const [g, slot] of Object.entries(ship.cargo)) {
          const rate = PERISH[g];
          if (rate) slot.fresh = Math.max(MIN_FRESH, (slot.fresh ?? 1) - (rate * hours) / 24);
        }
      }
      if (v.elapsed >= v.hours - 1e-6) {
        ship.port = v.to;
        ship.voyage = null;
        tripArrive(state, ship);
        pushNews(events, captainArrived(state, map, ship, v), true);
        events.push({ type: 'arrived', ship: ship.id, town: v.to, auto: !!ship.route?.active });
      }
    }
    if (ship.route?.active && ship.port && !ship.voyage) runRoute(state, map, ship);
  }
  if (state.rivalsActive) {
    if (state.fairSeed === undefined) moveRivals(state, map, hours);
    else {
      // Tagesmarkt: Konkurrenz rückt in ganzen Stunden vor, damit Bildrate und Zeitraffer
      // ihre Entscheidungen nicht verschieben. Die Anzeige rechnet den Stundenbruchteil dazu.
      // gleiche Rundung wie day(), damit Tageswechsel und volle Stunde im selben Schritt liegen
      const from = Math.floor(hourBefore) + 1;
      const to = Math.floor(state.hour);
      for (let h = from; h <= to; h++) atHour(state, h, () => withStream(state, 'konkurrenz-fahrt', h, () => moveRivals(state, map, 1)));
    }
  }
}

export function anySailing(state: GameState): boolean {
  return state.ships.some((s) => s.voyage !== null);
}
