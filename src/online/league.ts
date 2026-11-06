import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  REALTIME_MAX_FAILURES,
  fail,
  getClient,
  giveUpRealtime,
  offline,
  onRealtimeGiveUp,
  resetRealtimeGiveUp,
  setStatus,
  type Result,
} from './client.ts';
import { ensureSession } from './auth.ts';
import { displayName } from './daily.ts';

/** Liga-Regeln, gleich wie in supabase/schema.sql */
export const LEAGUE_CAPACITY = 40;
export const LEAGUE_TRAVEL_SECONDS = 45;
export const LEAGUE_START_GOLD = 300;

export interface LeagueMarketRow {
  townId: string;
  goodId: string;
  basePrice: number;
  stock: number;
  targetStock: number;
  restStock: number;
  updatedAt: string;
}

export interface LeaguePlayer {
  userId: string;
  gold: number;
  cargo: Record<string, number>;
  townId: string;
  arrivesAt: string;
  wealth: number;
}

export interface LeagueTradeResult {
  stock: number;
  taler: number;
  gold: number;
  cargo: Record<string, number>;
  wealth: number;
}

export interface LeagueRankEntry {
  rank: number;
  username: string;
  wealth: number;
  mine: boolean;
}

interface MarketRow {
  town_id: string;
  good_id: string;
  base_price: number;
  stock: number;
  target_stock: number;
  rest_stock: number;
  updated_at: string;
}

interface PlayerRow {
  user_id: string;
  gold: number;
  cargo: Record<string, number> | null;
  town_id: string;
  arrives_at: string;
  wealth: number;
}

export function toMarket(r: MarketRow): LeagueMarketRow {
  return {
    townId: r.town_id,
    goodId: r.good_id,
    basePrice: r.base_price,
    stock: r.stock,
    targetStock: r.target_stock,
    restStock: r.rest_stock,
    updatedAt: r.updated_at,
  };
}

function toPlayer(r: PlayerRow): LeaguePlayer {
  return { userId: r.user_id, gold: r.gold, cargo: r.cargo ?? {}, townId: r.town_id, arrivesAt: r.arrives_at, wealth: r.wealth };
}

/** Ist der Kahn angekommen? Gibt die verbleibenden Sekunden zurück (0 = angekommen) */
export function secondsUntilArrival(p: LeaguePlayer, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((Date.parse(p.arrivesAt) - now.getTime()) / 1000));
}

/** Ganzer Liga-Markt, Lesen geht auch ohne Anmeldung */
export async function getLeagueMarket(): Promise<Result<LeagueMarketRow[]>> {
  const sb = getClient();
  if (!sb) return offline();
  try {
    const { data, error } = await sb.from('league_market').select('*').order('town_id').order('good_id');
    if (error) return fail(error);
    return { ok: true, data: (data as MarketRow[]).map(toMarket) };
  } catch (e) {
    return fail(e);
  }
}

/** Tritt der Liga bei (mehrfach aufrufen ist harmlos) und liefert den eigenen Stand */
export async function joinLeague(): Promise<Result<LeaguePlayer>> {
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  try {
    const { data, error } = await sb.rpc('league_join');
    if (error) return fail(error);
    return { ok: true, data: toPlayer(data as PlayerRow) };
  } catch (e) {
    return fail(e);
  }
}

/** Fährt in eine andere Stadt, die Reise dauert LEAGUE_TRAVEL_SECONDS */
export async function leagueTravel(townId: string): Promise<Result<LeaguePlayer>> {
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  try {
    const { data, error } = await sb.rpc('league_travel', { p_town: townId });
    if (error) return fail(error);
    return { ok: true, data: toPlayer(data as PlayerRow) };
  } catch (e) {
    return fail(e);
  }
}

/** Handel: amount > 0 verkauft an die Stadt, amount < 0 kauft. Preis rechnet der Server. */
export async function leagueTrade(townId: string, goodId: string, amount: number): Promise<Result<LeagueTradeResult>> {
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 200) {
    return { ok: false, error: 'Ungültige Menge.', offline: false };
  }
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  try {
    const { data, error } = await sb.rpc('league_trade', { p_town: townId, p_good: goodId, p_amount: amount });
    if (error) return fail(error);
    return { ok: true, data: data as LeagueTradeResult };
  } catch (e) {
    return fail(e);
  }
}

/** Rangliste der Liga nach Vermögen */
export async function leagueRanking(limit = 10): Promise<Result<LeagueRankEntry[]>> {
  const sb = getClient();
  if (!sb) return offline();
  try {
    const [{ data, error }, me] = await Promise.all([
      sb
        .from('league_players')
        .select('user_id, wealth, profiles(username)')
        .order('wealth', { ascending: false })
        .limit(Math.max(1, Math.min(100, limit))),
      sb.auth.getSession(),
    ]);
    if (error) return fail(error);
    const myId = me.data.session?.user.id;
    return {
      ok: true,
      data: (data ?? []).map((r, i) => ({
        rank: i + 1,
        username: displayName(r.profiles, r.user_id),
        wealth: r.wealth,
        mine: r.user_id === myId,
      })),
    };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Realtime-Abo auf den Liga-Markt. Ruft onChange bei jeder Bestandsänderung auf.
 * Ist der Server nicht erreichbar, bricht der Client nach REALTIME_MAX_FAILURES
 * Verbindungsversuchen ab (statt endlos neu zu verbinden) und ruft onGiveUp auf.
 * Gibt eine Abmeldefunktion zurück, offline eine, die nichts tut.
 */
export function subscribeLeagueMarket(
  onChange: (row: LeagueMarketRow) => void,
  onGiveUp?: () => void,
): () => void {
  const sb = getClient();
  if (!sb) return () => {};
  resetRealtimeGiveUp();
  let closed = false;
  let failures = 0;
  const stopListening = onRealtimeGiveUp(() => {
    closed = true;
    stopListening();
    onGiveUp?.();
  });
  const channel: RealtimeChannel = sb
    .channel('league_market')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'league_market' }, (payload) => {
      const row = payload.new as MarketRow | undefined;
      if (row && 'town_id' in row) onChange(toMarket(row));
    })
    .subscribe((state) => {
      if (state === 'SUBSCRIBED') {
        failures = 0;
        setStatus('online');
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        if (++failures >= REALTIME_MAX_FAILURES) giveUpRealtime();
      }
    });
  return () => {
    stopListening();
    if (closed) return;
    closed = true;
    void sb.removeChannel(channel);
  };
}
