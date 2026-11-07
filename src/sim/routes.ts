import { GOOD_BY_ID } from '../data/goods.ts';
import { day, type GameState, type RouteStop, type Ship, type TradeRoute } from './state.ts';

/** Zeitraum der Routenauswertung in Tagen */
export const ROUTE_BOOK_DAYS = 30;
/** So oft versucht der Kapitän nachzukaufen, wenn die Mindestladung fehlt (Stunden) */
export const LOAD_RETRY_HOURS = 6;
/** Länger wartet kein Kapitän auf Ladung, dann legt er trotzdem ab (Stunden) */
export const MAX_LOAD_WAIT_HOURS = 5 * 24;
/** Wird dieser Halt beim aktuellen Pegel übersprungen? */
export function stopSkipped(state: GameState, s: RouteStop): boolean {
  if (s.levelMin !== undefined && state.waterLevel < s.levelMin) return true;
  if (s.levelMax !== undefined && state.waterLevel > s.levelMax) return true;
  return false;
}

export const fmtLevel = (m: number) => `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(1).replace('.', ',')} m`;

/** Kurzer Text zu den Bedingungen eines Halts, leer wenn es keine gibt */
export function conditionText(s: RouteStop): string {
  const parts: string[] = [];
  if (s.minLoad) parts.push(`ablegen erst ab ${Math.round(s.minLoad * 100)} % Ladung`);
  if (s.levelMin !== undefined) parts.push(`überspringen bei Pegel unter ${fmtLevel(s.levelMin)}`);
  if (s.levelMax !== undefined) parts.push(`überspringen bei Pegel über ${fmtLevel(s.levelMax)}`);
  return parts.join(', ');
}

/* ---------- Routenbuch ---------- */

/**
 * Wert, an dem der Gewinn einer Route gemessen wird: Bargeld plus Einstandswert der Ware an Bord
 * und in allen Kontoren, dazu die Kohle im Bunker zum Grundpreis. Kaufen, Bunkern und Umladen ins
 * Kontor ändern ihn kaum, erst der Verkauf über oder unter Einstand und der Zoll. Verbrannte Kohle
 * bucht `step` mit bookCoal, so zählt nur, was die Route wirklich verdient.
 */
export function bookValue(state: GameState, ship: Ship): number {
  let v = state.money + (ship.bunker ?? 0) * coalPrice();
  for (const slot of Object.values(ship.cargo)) v += slot.cost;
  for (const k of Object.values(state.kontore)) for (const slot of Object.values(k.stock)) v += slot.cost;
  return v;
}

/** Grundpreis der Kohle je t, mit dem Bunkerkohle bewertet wird */
export function coalPrice(): number {
  return GOOD_BY_ID.get('kohle')?.base ?? 0;
}

/** Unterwegs verbrannte Bunkerkohle der Route anlasten */
export function bookCoal(state: GameState, r: TradeRoute, tons: number): void {
  bookRoute(state, r, -tons * coalPrice());
}

/** Betrag auf den heutigen Tag der Route buchen und Einträge älter als 30 Tage entfernen */
export function bookRoute(state: GameState, r: TradeRoute, taler: number): void {
  const today = day(state);
  r.bookSince ??= today;
  if (!Number.isFinite(taler) || Math.abs(taler) < 1e-6) return;
  const book = (r.book ??= []);
  const last = book[book.length - 1];
  if (last && last.day === today) last.taler += taler;
  else book.push({ day: today, taler });
  const oldest = today - ROUTE_BOOK_DAYS + 1;
  while (book.length && book[0].day < oldest) book.shift();
}

/** Tageslohn der Kapitäne auf laufenden Routen buchen (einmal am Tag, wenn die Löhne fällig werden) */
export function bookRouteWages(state: GameState): void {
  for (const ship of state.ships) {
    if (ship.route?.active && ship.captain) bookRoute(state, ship.route, -ship.captain.wage);
  }
}

export interface RouteProfit {
  /** Gewinn in den letzten Tagen (höchstens 30) */
  total: number;
  /** Anzahl der ausgewerteten Tage */
  days: number;
  /** Gewinn pro Tag im Schnitt */
  perDay: number;
  /** Gewinn je Tag, ältester zuerst, Länge = days */
  series: number[];
}

export function routeProfit(state: GameState, r: TradeRoute): RouteProfit {
  const today = day(state);
  const since = r.bookSince ?? today;
  const days = Math.max(1, Math.min(ROUTE_BOOK_DAYS, today - since + 1));
  const first = today - days + 1;
  const series = Array.from({ length: days }, () => 0);
  for (const e of r.book ?? []) if (e.day >= first && e.day <= today) series[e.day - first] += e.taler;
  const total = series.reduce((a, b) => a + b, 0);
  return { total, days, perDay: total / days, series };
}

/** Routenbuch zurücksetzen, etwa wenn die Route neu geplant wird */
export function resetBook(r: TradeRoute): void {
  r.book = [];
  r.bookSince = undefined;
}
