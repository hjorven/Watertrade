import type { MapDef } from '../data/maps/valley.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import { PROJECT_BY_ID } from '../data/projects.ts';
import { SHIPS } from '../data/ships.ts';
import { season, type Season } from './calendar.ts';
import { segmentDepth } from './river.ts';
import {
  addNews,
  addToSlot,
  capacityOf,
  cargoLoad,
  effectiveDraft,
  fail,
  getShip,
  type GameEvent,
  type GameState,
  type Ship,
  type TradeResult,
  type Voyage,
} from './state.ts';
import { planVoyage, TIGHT_DEPTH, voyagePosition, wearRate, WEAR_PER_HOUR } from './voyage.ts';
import { effectiveSegments } from './works.ts';

/**
 * Fahren und Risiko (Plan 5.2):
 * - Nachtfahrt: nachts halbe Fahrt, außer auf Abschnitten mit Leuchtfeuer
 * - Grundberührung: bei knapper Tiefe kann ein Schiff auf Grund laufen (Verschleiß und ein halber Tag Verzug)
 * - Leichtern: in einer Stadt mit eigenem Kontor Ladung auf ein anderes, flacheres Schiff umladen
 */

/* ---------- Nacht ---------- */

/** Dunkle Stunden je Jahreszeit: [Einbruch der Nacht, Morgengrauen] */
export const NIGHT_HOURS: Record<Season, [number, number]> = {
  fruehling: [21, 5],
  sommer: [22, 4],
  herbst: [20, 6],
  winter: [18, 7],
};

/** Nachts ohne Leuchtfeuer: halbe Fahrt */
export const NIGHT_SPEED = 0.5;

/** Motorschiffe haben Scheinwerfer und fahren nachts mit drei Vierteln */
export const NIGHT_SPEED_LAMP = 0.75;

/** Ist es zur Spielstunde `hour` (Stunden seit Spielbeginn) dunkel? */
export function isNight(hour: number): boolean {
  const d = Math.floor(hour / 24) + 1;
  const h = ((hour % 24) + 24) % 24;
  const [dusk, dawn] = NIGHT_HOURS[season(d)];
  return h >= dusk || h < dawn;
}

/** Abschnitte mit fertigem Leuchtfeuer (Wasserbau, Projektart 'leuchtfeuer') */
export function litSegments(state: GameState): string[] {
  const out: string[] = [];
  for (const w of state.works ?? []) {
    if (!w.done) continue;
    const p = PROJECT_BY_ID.get(w.id);
    if (p && (p.kind as string) === 'leuchtfeuer') out.push(p.seg);
  }
  return out;
}

/** Fahrt bei Dunkelheit ohne Leuchtfeuer, je nach Antrieb */
export function nightSpeed(type: string): number {
  return SHIPS[type]?.propulsion === 'motor' ? NIGHT_SPEED_LAMP : NIGHT_SPEED;
}

/**
 * Anteil der vollen Fahrt auf einem Abschnitt zur Stunde `hour`: tagsüber und unter Leuchtfeuern 1, nachts weniger.
 * `lit` kann vorab berechnet übergeben werden, damit Schleifen nicht jedes Mal die Bauwerke durchsuchen.
 */
export function progressFactor(state: GameState, type: string, seg: string, hour: number, lit = litSegments(state)): number {
  if (!isNight(hour) || lit.includes(seg)) return 1;
  return nightSpeed(type);
}

/**
 * Fahrt vorwärts rechnen: höchstens `budget` echte Stunden ab `hour`, höchstens bis zum Fortschritt `stopAt`.
 * Gerechnet wird in Stücken bis zur nächsten vollen Stunde oder zum Ende des Abschnitts,
 * weil sich Nacht und Leuchtfeuer nur dort ändern. So stimmen Fahrt und Ankunftsschätzung genau überein.
 */
export function sail(
  state: GameState,
  type: string,
  v: Voyage,
  hour: number,
  budget: number,
  stopAt = v.hours,
  lit = litSegments(state),
): { progress: number; real: number } {
  const end = Math.min(v.hours, stopAt);
  let done = v.elapsed;
  let real = 0;
  let li = 0;
  let legEnd = v.legs[0]?.hours ?? 0;
  while (li < v.legs.length - 1 && done >= legEnd - 1e-9) legEnd += v.legs[++li].hours;
  for (let guard = 0; done < end - 1e-9 && real < budget - 1e-9 && guard < 100000; guard++) {
    const f = progressFactor(state, type, v.legs[li].seg, hour, lit);
    const nextHour = Math.floor(hour + 1e-9) + 1;
    const piece = Math.min(nextHour - hour, budget - real, (Math.min(legEnd, end) - done) / f);
    done += piece * f;
    real += piece;
    hour += piece;
    while (li < v.legs.length - 1 && done >= legEnd - 1e-9) legEnd += v.legs[++li].hours;
  }
  return { progress: Math.max(0, done - v.elapsed), real };
}

/**
 * Tatsächliche restliche Dauer einer Fahrt in Stunden ab `startHour`, mit Nacht und Stillstand nach Grundberührung.
 * Der Fahrtplan rechnet in Stunden voller Fahrt; nachts kommt das Schiff langsamer voran.
 */
export function realHours(state: GameState, type: string, v: Voyage, startHour = state.hour): number {
  const wait = Math.max(0, v.aground ?? 0);
  return wait + sail(state, type, v, startHour + wait, Infinity).real;
}

/** Echte Stunden bis zur Ankunft eines Schiffs, das gerade unterwegs ist (0 im Hafen) */
export function hoursToArrival(state: GameState, ship: { type: string; voyage: Voyage | null }): number {
  return ship.voyage ? realHours(state, ship.type, ship.voyage) : 0;
}

/* ---------- Grundberührung ---------- */

/** Stillstand nach einer Grundberührung: ein halber Tag */
export const AGROUND_HOURS = 12;

/** Verlorener Zustand bei einer Grundberührung (vor Beschlag und Kapitän) */
export const GROUNDING_WEAR = 0.03;

/** Wahrscheinlichkeit einer Grundberührung auf einem Abschnitt bei `clearance` m Wasser unter dem Kiel */
export function groundingChance(clearance: number, opts: { careful?: boolean; dark?: boolean } = {}): number {
  if (clearance >= TIGHT_DEPTH || clearance < 0) return 0;
  // 15 % knapp unter 20 cm, bis 60 % bei fast null Abstand
  let p = 0.15 + 0.45 * (1 - clearance / TIGHT_DEPTH);
  if (opts.dark) p *= 1.5;
  if (opts.careful) p *= 0.5;
  return Math.min(0.9, p);
}

export interface GroundingRisk {
  seg: string;
  /** Wasser unter dem Kiel in m */
  clearance: number;
  chance: number;
}

/** Abschnitte einer geplanten Fahrt mit knapper Tiefe (bei heutigem Pegel und jetziger Ladung) */
export function groundingRisks(state: GameState, map: MapDef, ship: Ship, v: Voyage): GroundingRisk[] {
  const segs = effectiveSegments(state, map);
  const draft = effectiveDraft(ship);
  const out: GroundingRisk[] = [];
  for (const leg of v.legs) {
    const seg = segs.find((s) => s.id === leg.seg);
    if (!seg) continue;
    const clearance = segmentDepth(seg, state.waterLevel) - draft;
    const chance = groundingChance(clearance, { careful: ship.captain?.trait === 'vorsichtig' });
    if (chance > 0) out.push({ seg: leg.seg, clearance, chance });
  }
  return out;
}

/** Gesamtwahrscheinlichkeit, auf der Fahrt mindestens einmal auf Grund zu laufen */
export function totalChance(risks: GroundingRisk[]): number {
  return 1 - risks.reduce((p, r) => p * (1 - r.chance), 1);
}

/** Fester Würfel aus Schiff, Stunde und Abschnitt: verbraucht keinen Zufall aus dem gemeinsamen Strom */
export function dice(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h = Math.imul(h ^ (p | 0), 16777619);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Bei Einfahrt in einen neuen Abschnitt würfeln, ob das Schiff dort auf Grund läuft.
 * Wenn ja, sitzt es etwa in der Mitte des Abschnitts fest.
 */
function rollLeg(state: GameState, map: MapDef, ship: Ship, v: Voyage, index: number, legStart: number): void {
  v.checked = index;
  const leg = v.legs[index];
  const seg = effectiveSegments(state, map).find((s) => s.id === leg.seg);
  if (!seg) return;
  const clearance = segmentDepth(seg, state.waterLevel) - effectiveDraft(ship);
  const dark = isNight(state.hour) && !litSegments(state).includes(leg.seg);
  const chance = groundingChance(clearance, { careful: ship.captain?.trait === 'vorsichtig', dark });
  if (chance <= 0) return;
  if (dice(ship.id, Math.floor(state.hour), index) >= chance) return;
  const where = 0.3 + 0.4 * dice(ship.id, index, Math.floor(state.hour) + 7);
  v.groundAt = legStart + leg.hours * where;
}

/** Grundberührung anwenden: Verschleiß, Stillstand, Meldung */
function applyGrounding(state: GameState, map: MapDef, ship: Ship, at: Voyage, v: Voyage, events: GameEvent[]): void {
  v.groundAt = undefined;
  v.aground = AGROUND_HOURS;
  const loss = GROUNDING_WEAR * (WEAR_PER_HOUR > 0 ? wearRate(ship) / WEAR_PER_HOUR : 1);
  const before = ship.condition;
  ship.condition = Math.max(0, ship.condition - loss);
  // Versicherung: hier reportDamage(state, ship, 'grund', { condition: before - ship.condition }) aufrufen
  const { leg } = voyagePosition(at);
  const name = (id: string) => map.towns.find((t) => t.id === id)?.name ?? id;
  const lost = Math.round((before - ship.condition) * 100);
  const item = addNews(
    state,
    'haus',
    `Die „${ship.name}" ist zwischen ${name(leg.from)} und ${name(leg.to)} auf Grund gelaufen${lost ? `, ${lost} % Zustand verloren` : ''}. Sie kommt in ${AGROUND_HOURS} Stunden wieder frei.`,
  );
  events.push({ type: 'news', item, important: !ship.route?.active });
}

/**
 * Eine Stunde (oder weniger) Fahrt: Fortschritt in Stunden voller Fahrt, der in dieser Zeit geschafft wird.
 * Kümmert sich um Nacht, Stillstand nach Grundberührung und das Würfeln bei Einfahrt in knappe Abschnitte.
 */
export function voyageProgress(state: GameState, map: MapDef, ship: Ship, hours: number, events: GameEvent[]): number {
  const v = ship.voyage;
  if (!v) return 0;
  const lit = litSegments(state);
  let hour = state.hour - hours;
  let left = hours;
  let progress = 0;
  for (let guard = 0; left > 1e-9 && guard < 50; guard++) {
    if ((v.aground ?? 0) > 0) {
      const wait = Math.min(left, v.aground!);
      v.aground = v.aground! - wait > 1e-9 ? v.aground! - wait : undefined;
      left -= wait;
      hour += wait;
      continue;
    }
    const elapsed = v.elapsed + progress;
    if (elapsed >= v.hours - 1e-9) break;
    // Abschnitt, in dem das Schiff gerade fährt; am Ende eines Abschnitts zählt schon der nächste
    let index = 0;
    let legStart = 0;
    while (index < v.legs.length - 1 && elapsed >= legStart + v.legs[index].hours - 1e-9) legStart += v.legs[index++].hours;
    const legEnd = legStart + v.legs[index].hours;
    if (v.checked === undefined || v.checked < index) rollLeg(state, map, ship, v, index, legStart);
    const stopAt = v.groundAt !== undefined ? Math.min(v.groundAt, legEnd) : legEnd;
    const r = sail(state, ship.type, { ...v, elapsed }, hour, left, stopAt, lit);
    progress += r.progress;
    left -= r.real;
    hour += r.real;
    if (v.groundAt !== undefined && v.elapsed + progress >= v.groundAt - 1e-9) applyGrounding(state, map, ship, { ...v, elapsed: v.elapsed + progress }, v, events);
    else if (r.real <= 1e-12 && r.progress <= 1e-12) break;
  }
  return progress;
}

/* ---------- Leichtern ---------- */

/** Umladen von Schiff zu Schiff geht nur mit eigenem Kontor (Kran, Lagerknechte, Steg) */
export function canTransship(state: GameState, town: string | null): boolean {
  return !!town && !!state.kontore[town];
}

/** Eigene Schiffe, die mit `ship` im selben Hafen liegen */
export function shipsAlongside(state: GameState, ship: Ship): Ship[] {
  if (!ship.port) return [];
  return state.ships.filter((s) => s.id !== ship.id && s.port === ship.port && !s.voyage);
}

/** Ladung direkt von einem Schiff auf ein anderes umladen (Leichtern), ohne Platz im Kontorlager zu brauchen */
export function transship(state: GameState, fromId: number, toId: number, goodId: string, wanted: number): TradeResult {
  const from = getShip(state, fromId);
  const to = getShip(state, toId);
  const name = GOOD_BY_ID.get(goodId)?.name ?? goodId;
  if (from.id === to.id) return fail('Das ist dasselbe Schiff.');
  if (!from.port || from.voyage || to.port !== from.port || to.voyage) return fail('Beide Schiffe müssen im selben Hafen liegen.');
  if (!canTransship(state, from.port)) return fail('Umladen geht nur in einer Stadt mit eigenem Kontor.');
  const slot = from.cargo[goodId];
  if (!slot || slot.amount <= 0) return fail(`Kein ${name} an Bord.`);
  const amount = Math.min(Math.floor(wanted), Math.floor(slot.amount), capacityOf(to) - Math.ceil(cargoLoad(to)));
  if (amount <= 0) return fail(`Auf der „${to.name}" ist kein Platz mehr.`);
  const costShare = Math.round((slot.cost * amount) / slot.amount);
  const fresh = slot.fresh ?? 1;
  slot.amount -= amount;
  slot.cost -= costShare;
  if (slot.amount < 0.001) delete from.cargo[goodId];
  addToSlot(to.cargo, goodId, amount, costShare, fresh);
  return { ok: true, message: `${amount} t ${name} von der „${from.name}" auf die „${to.name}" umgeladen.`, amount, taler: 0 };
}

/**
 * Höchste Ladung in t, mit der `ship` jetzt nach `to` fahren kann.
 * null, wenn die Fahrt auch leer nicht geht oder an etwas anderem als dem Tiefgang scheitert.
 */
export function maxLoadFor(state: GameState, map: MapDef, ship: Ship, to: string): number | null {
  const load = Math.floor(cargoLoad(ship));
  const ok = (t: number): boolean => {
    const probe: Ship = { ...ship, cargo: t > 0 ? { _: { amount: t, cost: 0 } } : {} };
    const plan = planVoyage(stateWith(state, probe), map, probe.id, to);
    return !!plan && plan.ok;
  };
  if (ok(load)) return load;
  if (!ok(0)) return null;
  let lo = 0;
  let hi = load;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Flacher Spielstand-Ersatz, in dem `ship` durch `probe` ersetzt ist (nur zum Planen) */
function stateWith(state: GameState, probe: Ship): GameState {
  return { ...state, ships: state.ships.map((s) => (s.id === probe.id ? probe : s)) };
}

/** Tiefgang in m, den `ship` mit `load` t Ladung hätte */
export function draftWith(ship: Ship, load: number): number {
  return effectiveDraft({ ...ship, cargo: load > 0 ? { _: { amount: load, cost: 0 } } : {} });
}

/** Kurzer Text zu Wasser unter dem Kiel, z. B. "12 cm" */
export function clearanceText(m: number): string {
  return `${Math.max(0, Math.round(m * 100))} cm`;
}
