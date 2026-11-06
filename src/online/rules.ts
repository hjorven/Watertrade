// Reine Regeln und Helfer ohne Supabase, damit das Spiel sie ohne den Online-Teil laden kann.

/** Liga-Regeln, gleich wie in supabase/schema.sql */
export const LEAGUE_CAPACITY = 40;
export const LEAGUE_TRAVEL_SECONDS = 45;
export const LEAGUE_START_GOLD = 300;

/** Plätze für Cloud-Spielstände */
export const SLOT_COUNT = 5;

/** Heutiger Tag als YYYY-MM-DD in UTC, damit alle Spieler denselben Tagesmarkt haben */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Startwert für den Zufallsgenerator des Tagesmarkts, für alle Spieler gleich */
export function dailySeed(day: string = todayUtc()): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Ist der Kahn angekommen? Gibt die verbleibenden Sekunden zurück (0 = angekommen) */
export function secondsUntilArrival(p: { arrivesAt: string }, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((Date.parse(p.arrivesAt) - now.getTime()) / 1000));
}
