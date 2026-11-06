/**
 * Dampfertage für Kapitel 4: Jeder eigene Kohledampfer, der an einem Tag lange genug unter Dampf
 * gefahren ist, bringt einen Dampfertag. Drei Dampfer, die 30 Tage fahren, sind 90 Dampfertage.
 * Wer viele Dampfer am Laufen hält, braucht viel Kohle, mehr als die Märkte im Tal hergeben.
 */
import type { GameState } from './state.ts';

/** So viele Fahrstunden braucht ein Dampfer an einem Tag, damit der Tag zählt */
export const STEAM_MIN_HOURS = 4;

/** Fahrstunden eines Kohledampfers mitschreiben (aus dem Fahrtschritt) */
export function logSteam(state: GameState, shipId: number, hours: number): void {
  if (hours <= 0) return;
  const today = (state.stats.steamToday ??= {});
  today[shipId] = (today[shipId] ?? 0) + hours;
}

/** Tagesabschluss: Dampfer, die heute lange genug gefahren sind, bringen je einen Dampfertag */
export function closeSteamDay(state: GameState): void {
  const today = state.stats.steamToday;
  if (!today) return;
  const n = Object.values(today).filter((h) => h >= STEAM_MIN_HOURS - 1e-6).length;
  state.stats.steamDays = (state.stats.steamDays ?? 0) + n;
  state.stats.steamToday = {};
}

/** Bisher gesammelte Dampfertage */
export function steamDays(state: GameState): number {
  return state.stats.steamDays ?? 0;
}
