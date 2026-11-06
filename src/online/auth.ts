import type { User } from '@supabase/supabase-js';
import { fail, getClient, offline, setStatus, type Result } from './client.ts';

export interface Player {
  id: string;
  anonymous: boolean;
  email: string | null;
}

function toPlayer(u: User): Player {
  return { id: u.id, anonymous: u.is_anonymous ?? !u.email, email: u.email ?? null };
}

/** Aktuell angemeldeter Spieler oder null */
export async function currentPlayer(): Promise<Player | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ? toPlayer(data.session.user) : null;
}

/**
 * Sorgt für eine Sitzung: vorhandene weiterverwenden, sonst anonym anmelden.
 * Muss vor Saves, Tagesmarkt-Einträgen und Liga aufgerufen werden (die Funktionen tun das selbst).
 */
export async function ensureSession(): Promise<Result<Player>> {
  const sb = getClient();
  if (!sb) return offline();
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) {
      setStatus('online');
      return { ok: true, data: toPlayer(data.session.user) };
    }
    setStatus('verbinde');
    const res = await sb.auth.signInAnonymously();
    if (res.error || !res.data.user) {
      setStatus('fehler');
      return fail(res.error ?? 'Anmeldung fehlgeschlagen.');
    }
    setStatus('online');
    return { ok: true, data: toPlayer(res.data.user) };
  } catch (e) {
    setStatus('fehler');
    return fail(e);
  }
}

/**
 * Magic Link: Bei anonymer Sitzung wird die E-Mail an das bestehende Konto gehängt,
 * Spielstände bleiben also erhalten. Ohne Sitzung wird ein Link zum Anmelden verschickt.
 */
export async function signInWithMagicLink(email: string, redirectTo?: string): Promise<Result<null>> {
  const sb = getClient();
  if (!sb) return offline();
  const target = redirectTo ?? (typeof location !== 'undefined' ? location.origin + location.pathname : undefined);
  try {
    const { data } = await sb.auth.getSession();
    if (data.session?.user.is_anonymous) {
      const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: target });
      return error ? fail(error) : { ok: true, data: null };
    }
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: target } });
    return error ? fail(error) : { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function signOut(): Promise<Result<null>> {
  const sb = getClient();
  if (!sb) return offline();
  try {
    const { error } = await sb.auth.signOut();
    return error ? fail(error) : { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

/** Anzeigename für Bestenlisten, 3 bis 20 Zeichen, eindeutig */
export async function setUsername(name: string): Promise<Result<string>> {
  const sb = getClient();
  if (!sb) return offline();
  const clean = name.trim();
  if (clean.length < 3 || clean.length > 20) return { ok: false, error: 'Name muss 3 bis 20 Zeichen haben.', offline: false };
  const session = await ensureSession();
  if (!session.ok) return session;
  const { error } = await sb.from('profiles').update({ username: clean }).eq('id', session.data.id);
  if (error) return error.code === '23505' ? { ok: false, error: 'Der Name ist schon vergeben.', offline: false } : fail(error);
  return { ok: true, data: clean };
}

/** Eigener Anzeigename, null wenn noch keiner gesetzt ist */
export async function getUsername(): Promise<Result<string | null>> {
  const sb = getClient();
  if (!sb) return offline();
  try {
    const { data } = await sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) return { ok: true, data: null };
    const { data: row, error } = await sb.from('profiles').select('username').eq('id', id).maybeSingle();
    if (error) return fail(error);
    return { ok: true, data: (row as { username: string | null } | null)?.username ?? null };
  } catch (e) {
    return fail(e);
  }
}
