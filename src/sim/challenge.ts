import type { Challenge, ChallengeEvent } from '../data/challenges.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { dayOfYear, isIce, waterLevel } from './calendar.ts';
import { eventWaterOffset } from './events.ts';
import { newGame } from './game.ts';
import { day, type GameState, type WorldEvent } from './state.ts';

/**
 * Spielstand für eine Herausforderung: dieselben Startwerte wie ein Kapitel, dazu die Sonderregeln
 * (Starttag im Jahr, feste Ereignisse wie Dürre oder Zoll, Höchstzahl an Schiffen).
 * Main, Tests und der Prüf-Bot bauen den Spielstand alle hierüber, damit sie dasselbe spielen.
 */
export function challengeGame(map: MapDef, c: Challenge, seed: number): GameState {
  const state = newGame(map, {
    startTown: c.startTown,
    money: c.money,
    startShip: c.startShip,
    allowedShips: c.allowedShips,
    rivals: c.rivals ?? false,
    seed,
    epoch: c.epoch ?? 1,
    startYear: c.startYear,
    extraShips: c.extraShips,
    kontore: c.kontore,
    works: c.works,
  });
  if (c.startDayOfYear) shiftStart(state, c.startDayOfYear);
  if (c.shipLimit !== undefined) state.shipLimit = c.shipLimit;
  for (const e of c.events ?? []) addFixedEvents(state, map, e);
  for (const x of c.stock ?? []) {
    for (const town of x.town === 'alle' ? map.towns.map((t) => t.id) : [x.town]) {
      const m = state.markets[town]?.[x.good];
      if (m) m.stock = x.amount;
    }
  }
  state.waterLevel = waterLevel(state.hour / 24 + 1) + eventWaterOffset(state);
  return state;
}

/** Spielbeginn auf einen Tag im Jahr verschieben (0 = erster Frühlingstag) */
function shiftStart(state: GameState, doy: number): void {
  const skip = (doy - dayOfYear(day(state)) + 120) % 120;
  if (!skip) return;
  const hours = skip * 24;
  state.hour += hours;
  state.ice = isIce(day(state));
  // die Konkurrenz legt zur selben Zeit ab wie sonst auch
  for (const r of state.rivals) for (const s of r.ships) s.idleUntil += hours;
}

/** Feste Ereignisse der Herausforderung: laufen ab Spielbeginn so viele Tage */
function addFixedEvents(state: GameState, map: MapDef, e: ChallengeEvent): void {
  const from = day(state);
  const base = (): WorldEvent => ({ id: state.nextId++, kind: e.kind, from, until: from + e.days - 1, value: e.value });
  if (e.kind === 'zoll' || e.kind === 'bruecke') {
    const segs = e.seg === 'alle' ? map.segments.map((s) => s.id) : [e.seg!];
    for (const seg of segs) state.events.push({ ...base(), seg });
    return;
  }
  if (e.kind === 'seuche' || e.kind === 'stadtfest') {
    for (const town of e.towns ?? []) {
      const m = state.markets[town];
      const target = Object.values(m)[0]?.target ?? 60;
      // wie bei zufälligen Ereignissen: die gesuchte Ware wird auf dem Markt gehandelt
      if (e.kind === 'seuche') m.arznei ??= { good: 'arznei', stock: 0, target };
      else for (const g of ['bier', 'brot']) m[g] ??= { good: g, stock: target * 0.5, target };
      state.events.push({ ...base(), town });
    }
    return;
  }
  state.events.push(base());
}
