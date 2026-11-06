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

/**
 * Öffentliche Verbindungsdaten des Watertrade-Servers (Supabase-Projekt „Flussreich“). Der Publishable Key ist für den Browser gedacht,
 * die Daten schützt Row Level Security. Vite-Variablen haben Vorrang, im Testlauf bleibt alles offline.
 */
export const DEFAULT_ONLINE: Required<OnlineConfig> = {
  url: 'https://qkcvqzzaxmoktaqsiujv.supabase.co',
  key: 'sb_publishable_GGtXWtbiTHxS2ussD2egxw_RvzhgPfO',
};

function readEnv(): OnlineConfig {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  if (env.MODE === 'test' || env.VITEST) return { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_KEY };
  return { url: env.VITE_SUPABASE_URL || DEFAULT_ONLINE.url, key: env.VITE_SUPABASE_KEY || DEFAULT_ONLINE.key };
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
      realtime: { reconnectAfterMs: realtimeBackoff },
    });
    realtimeGaveUp = false;
    setStatus('verbinde');
    return true;
  } catch {
    client = null;
    setStatus('fehler');
    return false;
  }
}

/** Nach so vielen gescheiterten Websocket-Verbindungen gibt Realtime auf, statt endlos neu zu verbinden */
export const REALTIME_MAX_FAILURES = 4;
const REALTIME_DELAYS = [1000, 3000, 8000];

let realtimeGaveUp = false;
const giveUpListeners = new Set<() => void>();

/** Wartezeit vor dem nächsten Verbindungsversuch, nach REALTIME_MAX_FAILURES wird abgebrochen */
export function realtimeBackoff(tries: number): number {
  if (tries >= REALTIME_MAX_FAILURES) queueMicrotask(giveUpRealtime);
  return REALTIME_DELAYS[Math.min(tries, REALTIME_DELAYS.length) - 1] ?? REALTIME_DELAYS[0];
}

/** Realtime abschalten: alle Kanäle schließen, Websocket trennen, Zuhörer informieren */
export function giveUpRealtime(): void {
  if (realtimeGaveUp || !client) return;
  realtimeGaveUp = true;
  const sb = client;
  void sb.removeAllChannels().finally(() => sb.realtime.disconnect());
  setStatus('fehler');
  for (const fn of giveUpListeners) fn();
}

/** Meldet, wenn Realtime wegen fehlender Verbindung aufgegeben hat. Gibt eine Abmeldefunktion zurück. */
export function onRealtimeGiveUp(fn: () => void): () => void {
  giveUpListeners.add(fn);
  return () => giveUpListeners.delete(fn);
}

/** Hat Realtime aufgegeben? Ein neues Abo versucht es dann erneut. */
export function realtimeGaveUpAlready(): boolean {
  return realtimeGaveUp;
}

/** Vor einem neuen Abo aufrufen, damit nach einem Abbruch wieder versucht wird */
export function resetRealtimeGiveUp(): void {
  realtimeGaveUp = false;
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
  'zu viele aktionen': 'Langsamer bitte: höchstens 40 Aktionen pro Minute.',
  'unbekanntes schiff': 'Dieses Schiff gibt es in der Liga nicht.',
  'schon dein schiff': 'Das ist schon dein Schiff.',
  'ladung passt nicht': 'Deine Ladung passt nicht in das neue Schiff. Erst verkaufen.',
  'saison vorbei': 'Die Saison ist vorbei. Die neue beginnt in wenigen Minuten.',
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
  giveUpListeners.clear();
  realtimeGaveUp = false;
}
