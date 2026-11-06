import { EPOCHS, epochOfYear } from '../data/ships.ts';
import { year } from './calendar.ts';
import { day, type GameState } from './state.ts';

/**
 * Epochen im freien Spiel (Plan 5.8): Die neue Zeit kommt, sobald das Tal so weit ist,
 * spätestens aber im Jahr aus EPOCHS (Treidelzeit, ab Jahr 5 Dampf, ab Jahr 10 Motor).
 *
 * - Dampf: eine Stadt hat 2000 Einwohner, und der Spieler hat Werkzeug verkauft.
 * - Motor: mindestens ein Jahr Dampfzeit, eine Großstadt mit 4500 Einwohnern und viel Kohle verkauft.
 *
 * In der Kampagne steht die Epoche fest (epochAuto = false), dort gilt nichts davon.
 */

export interface EpochCondition {
  /** kurzer Text für die Anzeige, z. B. "Eine Stadt mit 2000 Einwohnern" */
  label: string;
  value: number;
  target: number;
}

export interface EpochRule {
  epoch: number;
  /** höchste Einwohnerzahl einer Stadt im Tal */
  population: number;
  /** Ware, die der Spieler insgesamt verkauft oder geliefert haben muss */
  good: string;
  goodName: string;
  amount: number;
  /** Tage, die die vorige Epoche mindestens gedauert haben muss */
  minDays: number;
}

export const EPOCH_RULES: EpochRule[] = [
  { epoch: 2, population: 2000, good: 'werkzeug', goodName: 'Werkzeug', amount: 40, minDays: 0 },
  { epoch: 3, population: 4500, good: 'kohle', goodName: 'Kohle', amount: 300, minDays: 120 },
];

/**
 * Treidelgeld ab der Motorzeit im freien Spiel: Die Treidelpfade verfallen, Pferde und Treidler kosten
 * je Fahrstunde bergauf. Die Kampagne hat feste Epochen und eigene Balance, dort gilt es nicht.
 */
export const TOW_FEE_EPOCH = 3;
export const TOW_FEE_PER_HOUR = 3;

/** Taler Treidelgeld für eine Fahrt mit diesen Stunden bergauf */
export function towFee(state: GameState, propulsion: string, upstreamHours: number): number {
  if (!state.epochAuto || propulsion !== 'tow' || state.epoch < TOW_FEE_EPOCH || upstreamHours <= 0) return 0;
  return Math.round(upstreamHours * TOW_FEE_PER_HOUR);
}

/** Tonnen einer Ware, die der Spieler bisher in allen Städten verkauft oder geliefert hat */
export function soldTotal(state: GameState, good: string): number {
  let n = 0;
  for (const town of Object.values(state.stats.delivered)) n += town[good] ?? 0;
  return n;
}

function maxPopulation(state: GameState): number {
  let max = 0;
  for (const t of Object.values(state.towns)) max = Math.max(max, t.population);
  return max;
}

export interface EpochProgress {
  /** nächste Epoche oder null, wenn die letzte erreicht ist */
  next: { number: number; name: string; latestYear: number } | null;
  conditions: EpochCondition[];
}

/** Stand auf dem Weg zur nächsten Epoche, für Anzeige und Prüfung */
export function epochProgress(state: GameState): EpochProgress {
  const rule = EPOCH_RULES.find((r) => r.epoch === state.epoch + 1);
  const def = EPOCHS.find((e) => e.number === state.epoch + 1);
  if (!rule || !def) return { next: null, conditions: [] };
  const conditions: EpochCondition[] = [
    { label: `Eine Stadt mit ${rule.population} Einwohnern`, value: Math.round(maxPopulation(state)), target: rule.population },
    { label: `${rule.amount} t ${rule.goodName} verkauft`, value: Math.floor(soldTotal(state, rule.good)), target: rule.amount },
  ];
  if (rule.minDays > 0) {
    const name = EPOCHS[state.epoch - 1].name;
    const since = Math.max(0, day(state) - (state.epochDay ?? 0));
    conditions.push({ label: `${rule.minDays} Tage ${name}`, value: Math.min(since, rule.minDays), target: rule.minDays });
  }
  return { next: { number: def.number, name: def.name, latestYear: def.from }, conditions };
}

/** Epoche, die im freien Spiel gerade gelten sollte (nie kleiner als die aktuelle) */
export function dueEpoch(state: GameState): number {
  if (!state.epochAuto) return state.epoch;
  const byYear = epochOfYear(year(day(state)));
  if (byYear > state.epoch) return byYear;
  // Fortschritt bringt höchstens eine Epoche auf einmal
  const p = epochProgress(state);
  if (p.next && p.conditions.every((c) => c.value >= c.target)) return p.next.number;
  return state.epoch;
}

/** Text für den Tooltip am Datum */
export function epochProgressText(state: GameState): string {
  const name = EPOCHS[state.epoch - 1].name;
  if (!state.epochAuto) return name;
  const p = epochProgress(state);
  if (!p.next) return `${name}, die letzte Epoche`;
  const parts = p.conditions.map((c) => `${c.label}: ${Math.min(c.value, c.target)}/${c.target}`);
  return `${name}. Nächste Zeit „${p.next.name}“, wenn: ${parts.join(', ')}. Spätestens im Jahr ${p.next.latestYear}.`;
}
