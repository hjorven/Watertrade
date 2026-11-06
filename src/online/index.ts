// Online-Teil von Flussreich: Supabase-Client, Anmeldung, Cloud-Saves, Tagesmarkt, Handelsliga.
// Alle Funktionen werfen nie. Ohne VITE_SUPABASE_URL/VITE_SUPABASE_KEY liefern sie { ok: false, offline: true }.
export * from './client.ts';
export * from './auth.ts';
export * from './saves.ts';
export * from './daily.ts';
export * from './league.ts';
