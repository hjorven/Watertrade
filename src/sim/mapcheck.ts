/**
 * Spielbarkeitsprüfung für Karten, vor allem für Zufallsflüsse (Plan 6.8).
 *
 * 1. Aufbau: alle Städte verbunden, jede Ware hat Erzeuger und Abnehmer, Werften erreichbar.
 * 2. Lage: keine Stadt im Wasser, am Rand oder in einer anderen Stadt.
 * 3. Balance-Bot: Der Händler-Bot aus balance.ts spielt vom Starthafen aus. Er muss in der
 *    vorgegebenen Zeit genug verdienen, darf aber auch nicht ins Unermessliche wachsen.
 */
import { GOODS } from '../data/goods.ts';
import { generateCandidate, layoutProblems } from '../data/maps/random.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { SHIPS } from '../data/ships.ts';
import { RIVAL_MAX_WORTH_2Y, rivalPeak, runBalance } from './balance.ts';
import { findRoute } from './river.ts';

/** So lange spielt der Bot zur Prüfung */
export const CHECK_DAYS = 90;
/**
 * Mindestgeld nach CHECK_DAYS Tagen (Start mit 500 Talern und einem Treidelkahn).
 * Im Tal der zwei Flüsse hat der Bot nach 90 Tagen rund 10.400 Taler; die Hälfte muss jede Karte bringen.
 */
export const CHECK_MIN_MONEY = 5000;
/** Höchstgeld nach CHECK_DAYS Tagen: deutlich mehr als im Tal wäre eine Goldader, die das Spiel zu leicht macht */
export const CHECK_MAX_MONEY = 25000;
/** Mindestzahl Fahrten des Bots (im Tal rund 130): sonst liegt er meist nur im Hafen */
export const CHECK_MIN_TRIPS = 40;
/** So lange spielt die Konkurrenz allein, ehe ihr reichstes Haus gemessen wird (zwei Spieljahre) */
export const RIVAL_CHECK_DAYS = 240;
/** So viele Kandidaten erzeugt der Generator höchstens, bis einer besteht */
export const MAX_ATTEMPTS = 24;

export interface MapReport {
  ok: boolean;
  problems: string[];
  /** Ergebnis des Bots (fehlt, wenn schon der Aufbau scheitert) */
  money?: number;
  trips?: number;
}

/** Starthafen im freien Spiel */
export function startOf(map: MapDef): string {
  return map.start ?? map.towns[0].id;
}

/** Aufbau prüfen: Wege, Warenkreislauf, Werften */
export function structureProblems(map: MapDef): string[] {
  const out: string[] = [];
  const ids = new Set(map.towns.map((t) => t.id));
  if (ids.size !== map.towns.length) out.push('Stadt-Ids sind nicht eindeutig');
  if (new Set(map.segments.map((s) => s.id)).size !== map.segments.length) out.push('Abschnitt-Ids sind nicht eindeutig');
  for (const s of map.segments) if (!ids.has(s.from) || !ids.has(s.to)) out.push(`Abschnitt ${s.id} führt zu einer unbekannten Stadt`);
  const start = startOf(map);
  if (!ids.has(start)) out.push(`Starthafen ${start} fehlt`);

  // Bei Normalwasser kommt eine Plätte überall hin, ein Treidelkahn vom Start aus zu mindestens zwei Häfen
  const plaette = SHIPS.plaette;
  for (const t of map.towns) {
    if (t.id !== start && !findRoute(map.segments, start, t.id, plaette, 0)) out.push(`${t.name} ist vom Start aus nicht erreichbar`);
  }
  const kahnReach = map.towns.filter((t) => t.id !== start && findRoute(map.segments, start, t.id, SHIPS.treidelkahn, 0)).length;
  if (kahnReach < 2) out.push('Der Treidelkahn erreicht vom Start aus zu wenige Häfen');

  // Werft für Kähne und Dampfer
  const yards = map.towns.filter((t) => t.shipyard.includes('treidelkahn'));
  if (!yards.length) out.push('Keine Werft für Treidelkähne');
  for (const t of map.towns) for (const s of t.shipyard) if (!SHIPS[s]) out.push(`${t.name} baut unbekannten Schiffstyp ${s}`);

  // Warenkreislauf: was hergestellt wird, braucht Abnehmer; was gebraucht wird, einen Erzeuger
  for (const g of GOODS) {
    const made = map.towns.some((t) => (t.produces[g.id] ?? 0) > 0 || t.industries.some((i) => g.id in i.outputs));
    const used = map.towns.some((t) => (t.consumes[g.id] ?? 0) > 0 || t.industries.some((i) => g.id in i.inputs));
    if (made && !used) out.push(`${g.name} wird hergestellt, aber nirgends gebraucht`);
    if (used && !made) out.push(`${g.name} wird gebraucht, aber nirgends hergestellt`);
  }
  for (const t of map.towns) {
    const sells = Object.keys(t.produces).length + t.industries.length;
    if (!sells) out.push(`${t.name} hat nichts zu verkaufen`);
  }
  return out;
}

/** Den Balance-Bot vom Starthafen aus spielen lassen */
export function botCheck(map: MapDef, days = CHECK_DAYS): { problems: string[]; money: number; trips: number } {
  const r = runBalance(map, days, startOf(map), { rivals: true, seed: map.seed ?? 1 });
  const problems: string[] = [];
  if (r.money < CHECK_MIN_MONEY) problems.push(`Der Bot verdient in ${days} Tagen nur ${Math.round(r.money)} Taler`);
  if (r.money > CHECK_MAX_MONEY) problems.push(`Der Bot verdient in ${days} Tagen ${Math.round(r.money)} Taler, zu leicht`);
  if (r.trips < CHECK_MIN_TRIPS) problems.push(`Der Bot fährt in ${days} Tagen nur ${r.trips}-mal`);
  // die Konkurrenz darf auf keiner Karte übermächtig werden
  const rival = rivalPeak(map, RIVAL_CHECK_DAYS, map.seed ?? 20260601, startOf(map));
  if (rival.worth >= RIVAL_MAX_WORTH_2Y) problems.push(`Ein Haus der Konkurrenz hat nach zwei Jahren ${Math.round(rival.worth)} Taler`);
  return { problems, money: r.money, trips: r.trips };
}

/** Vollständige Prüfung einer Karte */
export function checkMap(map: MapDef): MapReport {
  const problems = [...structureProblems(map), ...layoutProblems(map)];
  if (problems.length) return { ok: false, problems };
  const bot = botCheck(map);
  return { ok: bot.problems.length === 0, problems: bot.problems, money: bot.money, trips: bot.trips };
}

export interface RandomMapResult {
  map: MapDef;
  /** Anzahl erzeugter Kandidaten bis zur ersten spielbaren Karte */
  attempts: number;
  report: MapReport;
}

/**
 * Zufallskarte zu einem Startwert: Kandidaten erzeugen, bis einer die Prüfung besteht.
 * Gleicher Startwert ergibt immer dieselbe Karte. Besteht keiner, kommt der beste Kandidat zurück
 * (report.ok ist dann false).
 */
export function playableRandomMap(seed: number): RandomMapResult {
  let best: RandomMapResult | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const map = generateCandidate(seed, attempt);
    if (!map) continue;
    const report = checkMap(map);
    const result = { map, attempts: attempt + 1, report };
    if (report.ok) return result;
    if (!best || report.problems.length < best.report.problems.length) best = result;
  }
  if (best) return best;
  throw new Error(`Keine Karte zum Startwert ${seed}`);
}
