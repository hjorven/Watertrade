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

/** Trägt das Tagesergebnis ein. Pro Tag zählt das beste Ergebnis, schlechtere werden ignoriert. */
export async function submitDaily(wealth: number, day: string = todayUtc()): Promise<Result<{ wealth: number; improved: boolean }>> {
  if (!Number.isFinite(wealth) || wealth < 0) return { ok: false, error: 'Ungültiges Vermögen.', offline: false };
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  const value = Math.floor(wealth);
  try {
    const { data: old, error: readError } = await sb
      .from('daily_results')
      .select('wealth')
      .eq('day', day)
      .eq('user_id', session.data.id)
      .maybeSingle();
    if (readError) return fail(readError);
    if (old && old.wealth >= value) return { ok: true, data: { wealth: old.wealth, improved: false } };
    const { error } = await sb
      .from('daily_results')
      .upsert({ day, user_id: session.data.id, wealth: value }, { onConflict: 'day,user_id' });
    if (error) return fail(error);
    return { ok: true, data: { wealth: value, improved: true } };
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
