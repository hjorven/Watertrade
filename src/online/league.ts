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
import type { LeagueEvent, LeagueEventKind } from './rules.ts';

export { LEAGUE_CAPACITY, LEAGUE_START_GOLD, LEAGUE_TRAVEL_SECONDS, secondsUntilArrival } from './rules.ts';
export type { LeagueEvent, LeagueEventKind } from './rules.ts';

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
  /** Abfahrt der laufenden oder letzten Fahrt, fehlt bei Servern vor der Saison-Migration */
  departedAt?: string;
  /** Schiffstyp, siehe LEAGUE_SHIPS */
  ship: string;
  wealth: number;
}

export interface LeagueSeason {
  id: number;
  startsAt: string;
  endsAt: string;
}

export interface LeagueHallEntry {
  seasonId: number;
  rank: number;
  username: string;
  wealth: number;
  players: number;
  mine: boolean;
}

/** Saison, laufende und angekündigte Ereignisse und Ruhmeshalle */
export interface LeagueInfo {
  season: LeagueSeason | null;
  events: LeagueEvent[];
  hall: LeagueHallEntry[];
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
  departed_at?: string | null;
  ship?: string | null;
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

export function toPlayer(r: PlayerRow): LeaguePlayer {
  return {
    userId: r.user_id,
    gold: r.gold,
    cargo: r.cargo ?? {},
    townId: r.town_id,
    arrivesAt: r.arrives_at,
    ...(r.departed_at ? { departedAt: r.departed_at } : {}),
    ship: r.ship ?? 'treidelkahn',
    wealth: r.wealth,
  };
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

/** Wechselt das Schiff. Das alte geht für den halben Preis zurück, die Ladung muss ins neue passen. */
export async function leagueBuyShip(shipId: string): Promise<Result<LeaguePlayer>> {
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  try {
    const { data, error } = await sb.rpc('league_buy_ship', { p_ship: shipId });
    if (error) return fail(error);
    return { ok: true, data: toPlayer(data as PlayerRow) };
  } catch (e) {
    return fail(e);
  }
}

interface EventRow {
  id: number;
  kind: LeagueEventKind;
  town_id: string | null;
  starts_at: string;
  ends_at: string;
}

interface HallRow {
  season_id: number;
  rank: number;
  user_id: string | null;
  username: string | null;
  wealth: number;
  players: number;
}

export function toEvent(r: EventRow): LeagueEvent {
  return { id: r.id, kind: r.kind, townId: r.town_id, startsAt: r.starts_at, endsAt: r.ends_at };
}

/**
 * Saison, Ereignisse (noch nicht beendet) und die Ruhmeshalle der letzten Saisons.
 * Fehlt etwas auf dem Server (ältere Datenbank), bleibt der Teil leer statt zu scheitern.
 */
export async function getLeagueInfo(hallSeasons = 5): Promise<Result<LeagueInfo>> {
  const sb = getClient();
  if (!sb) return offline();
  try {
    const [season, events, hall, me] = await Promise.all([
      sb.from('league_seasons').select('id, starts_at, ends_at').order('id', { ascending: false }).limit(1).maybeSingle(),
      sb.from('league_events').select('id, kind, town_id, starts_at, ends_at').gt('ends_at', new Date().toISOString()).order('starts_at'),
      sb
        .from('league_hall_of_fame')
        .select('season_id, rank, user_id, username, wealth, players')
        .order('season_id', { ascending: false })
        .order('rank')
        .limit(Math.max(1, Math.min(20, hallSeasons)) * 3),
      sb.auth.getSession(),
    ]);
    if (season.error && events.error && hall.error) return fail(season.error);
    const myId = me.data.session?.user.id;
    const s = season.data as { id: number; starts_at: string; ends_at: string } | null;
    return {
      ok: true,
      data: {
        season: s ? { id: s.id, startsAt: s.starts_at, endsAt: s.ends_at } : null,
        events: ((events.data ?? []) as EventRow[]).map(toEvent),
        hall: ((hall.data ?? []) as HallRow[]).map((r) => ({
          seasonId: r.season_id,
          rank: r.rank,
          username: r.username ?? (r.user_id ? displayName(null, r.user_id) : 'Unbekannt'),
          wealth: r.wealth,
          players: r.players,
          mine: !!myId && r.user_id === myId,
        })),
      },
    };
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
