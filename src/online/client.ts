import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Verbindungszustand des Online-Teils. Ohne Konfiguration bleibt er dauerhaft "offline". */
export type OnlineStatus = 'offline' | 'verbinde' | 'online' | 'fehler';

export interface OnlineConfig {
  url?: string;
  key?: string;
}

/** Ergebnis jeder Online-Funktion. Es wird nie geworfen, das Spiel läuft offline weiter. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; offline: boolean };

export const OFFLINE_ERROR = 'Offline: kein Server konfiguriert.';

let client: SupabaseClient | null = null;
let initialised = false;
let status: OnlineStatus = 'offline';
const listeners = new Set<(s: OnlineStatus) => void>();

function readEnv(): OnlineConfig {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  return { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_KEY };
}

function isUsable(cfg: OnlineConfig): cfg is Required<OnlineConfig> {
  if (!cfg.url || !cfg.key) return false;
  if (cfg.url.includes('DEINE_PROJECT_REF') || cfg.key.includes('DEIN_KEY')) return false;
  try {
    const u = new URL(cfg.url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Baut den Client. Ohne Aufruf passiert das beim ersten Zugriff mit den Vite-Variablen
 * VITE_SUPABASE_URL und VITE_SUPABASE_KEY. Fehlen sie, bleibt alles offline.
 */
export function initOnline(cfg: OnlineConfig = readEnv()): boolean {
  initialised = true;
  client = null;
  if (!isUsable(cfg)) {
    setStatus('offline');
    return false;
  }
  try {
    client = createClient(cfg.url, cfg.key, {
      auth: { persistSession: typeof localStorage !== 'undefined', autoRefreshToken: true, detectSessionInUrl: true },
    });
    setStatus('verbinde');
    return true;
  } catch {
    client = null;
    setStatus('fehler');
    return false;
  }
}

/** Liefert den Client oder null, wenn offline */
export function getClient(): SupabaseClient | null {
  if (!initialised) initOnline();
  return client;
}

export function isConfigured(): boolean {
  return getClient() !== null;
}

export function getStatus(): OnlineStatus {
  if (!initialised) initOnline();
  return status;
}

export function setStatus(s: OnlineStatus): void {
  if (s === status) return;
  status = s;
  for (const fn of listeners) fn(s);
}

/** Meldet Statuswechsel, gibt eine Abmeldefunktion zurück */
export function onStatusChange(fn: (s: OnlineStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function offline<T>(): Result<T> {
  return { ok: false, error: OFFLINE_ERROR, offline: true };
}

/** Übersetzt Server-Fehler in Meldungen für den Spieler */
const MESSAGES: Record<string, string> = {
  'nicht angemeldet': 'Nicht angemeldet.',
  'ungueltige menge': 'Ungültige Menge.',
  'nicht genug bestand': 'Die Stadt hat nicht genug davon.',
  'nicht genug taler': 'Nicht genug Taler.',
  'nicht genug ladung': 'So viel hast du nicht geladen.',
  'laderaum voll': 'Der Laderaum ist voll.',
  'nicht in dieser stadt': 'Dein Kahn liegt nicht in dieser Stadt.',
  'noch unterwegs': 'Dein Kahn ist noch unterwegs.',
  'nicht in der liga': 'Du bist der Liga noch nicht beigetreten.',
  'unbekannte stadt': 'Diese Stadt gibt es nicht.',
  'unbekannter markt': 'Diese Ware wird hier nicht gehandelt.',
};

export function fail<T>(err: unknown): Result<T> {
  const raw = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k));
  return { ok: false, error: key ? MESSAGES[key] : raw || 'Unbekannter Fehler.', offline: false };
}

/** Nur für Tests: Zustand zurücksetzen */
export function resetOnlineForTests(): void {
  client = null;
  initialised = false;
  status = 'offline';
  listeners.clear();
}
