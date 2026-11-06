import { fail, getClient, offline, type Result } from './client.ts';
import { ensureSession } from './auth.ts';
import { todayUtc } from './rules.ts';

export { dailySeed, todayUtc } from './rules.ts';

export interface DailyEntry {
  rank: number;
  username: string;
  wealth: number;
  mine: boolean;
}

export interface DailyBegin {
  /** true: erster Versuch des Tages, wird gewertet. false: nur Übungsrunde. */
  scored: boolean;
  /** schon eingetragenes Ergebnis des Tages, sonst null */
  wealth: number | null;
}

/**
 * Meldet den Beginn eines Tagesmarkts beim Server. Nur der erste Versuch je Tag wird gewertet,
 * das merkt sich der Server, nicht der Spielstand.
 */
export async function beginDaily(day: string = todayUtc()): Promise<Result<DailyBegin>> {
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  try {
    const { data, error } = await sb.rpc('daily_begin', { p_day: day });
    if (error) return fail(error);
    const d = (data ?? {}) as { scored?: boolean; wealth?: number | null };
    return { ok: true, data: { scored: d.scored === true, wealth: typeof d.wealth === 'number' ? d.wealth : null } };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Trägt das Ergebnis des gewerteten Versuchs ein. Es zählt nur das erste Ergebnis je Tag,
 * ein späteres wird nicht angenommen (accepted = false, wealth = das gespeicherte Ergebnis).
 */
export async function submitDaily(wealth: number, day: string = todayUtc()): Promise<Result<{ wealth: number; accepted: boolean }>> {
  if (!Number.isFinite(wealth) || wealth < 0) return { ok: false, error: 'Ungültiges Vermögen.', offline: false };
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  const value = Math.floor(wealth);
  try {
    const { data, error } = await sb.rpc('daily_submit', { p_day: day, p_wealth: value });
    if (error) return fail(error);
    const d = (data ?? {}) as { accepted?: boolean; wealth?: number | null };
    return { ok: true, data: { wealth: typeof d.wealth === 'number' ? d.wealth : value, accepted: d.accepted === true } };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Eigener Stand eines Tages: Versuch begonnen, eingetragenes Ergebnis. Legt keine Anmeldung an;
 * ohne bestehende Sitzung gilt der Tag als unberührt.
 */
export async function myDaily(day: string = todayUtc()): Promise<Result<{ started: boolean; wealth: number | null }>> {
  const sb = getClient();
  if (!sb) return offline();
  try {
    const me = await sb.auth.getSession();
    const id = me.data.session?.user.id;
    if (!id) return { ok: true, data: { started: false, wealth: null } };
    const [attempt, result] = await Promise.all([
      sb.from('daily_attempts').select('day').eq('day', day).eq('user_id', id).maybeSingle(),
      sb.from('daily_results').select('wealth').eq('day', day).eq('user_id', id).maybeSingle(),
    ]);
    if (attempt.error) return fail(attempt.error);
    if (result.error) return fail(result.error);
    const wealth = (result.data as { wealth: number } | null)?.wealth ?? null;
    return { ok: true, data: { started: !!attempt.data || wealth !== null, wealth } };
  } catch (e) {
    return fail(e);
  }
}

/** Bestenliste eines Tages, Lesen geht auch ohne Anmeldung */
export async function topDaily(day: string = todayUtc(), limit = 10): Promise<Result<DailyEntry[]>> {
  const sb = getClient();
  if (!sb) return offline();
  try {
    const [{ data, error }, me] = await Promise.all([
      sb
        .from('daily_results')
        .select('wealth, user_id, profiles(username)')
        .eq('day', day)
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

/** Name aus der eingebetteten Profilzeile, sonst ein kurzer Platzhalter */
export function displayName(profile: unknown, userId: string): string {
  const p = Array.isArray(profile) ? profile[0] : profile;
  const name = p && typeof p === 'object' && 'username' in p ? (p as { username: string | null }).username : null;
  return name ?? `Händler ${userId.slice(0, 4).toUpperCase()}`;
}
