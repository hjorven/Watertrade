# Flussreich

Handels- und Aufbauspiel im Browser. Du führst ein Handelshaus an einem großen Flusssystem.

Live: https://hjorven.github.io/Watertrade/

## Spielmodi

- **Kampagne** "Hundert Jahre am Fluss": sechs Kapitel von der Treidelzeit bis zum Motorschiff.
- **Freies Spiel**: ohne Ziele, die Epochen wechseln mit den Spieljahren.
- **Herausforderungen**: fünf kurze Szenarien mit Zeitlimit, die beste Zeit wird gemerkt.
- **Tagesmarkt**: jeden Tag (UTC) ein gleiches Tal für alle, nach 60 Spieltagen zählt das Vermögen, mit Online-Bestenliste.
- **Handelsliga**: ein gemeinsamer Live-Markt für alle Spieler, serverseitig gerechnet.
- **Erfolge** und **Konto**: Name für Bestenlisten, Anmeldung per E-Mail-Link, fünf Cloud-Speicherplätze.

## Entwicklung

```bash
npm install
npm run dev
```

```bash
npm test
npm run build
```

## Deploy

Jeder Push auf `main` baut das Spiel und veröffentlicht es über GitHub Actions auf GitHub Pages.

## Online (Supabase)

Backend: Supabase-Projekt `qkcvqzzaxmoktaqsiujv` (Free Tier, Frankfurt). Schema in `supabase/schema.sql`, einzelne Schritte in `supabase/migrations/`.

- Cloud-Saves: 5 Plätze je Spieler, beliebiges JSON bis 512 KB
- Tagesmarkt: ein Ergebnis pro Spieler und Tag (das beste zählt), Bestenliste
- Handelsliga: gemeinsamer Markt, Preise und Ladung rechnet der Server (`league_join`, `league_travel`, `league_trade`), Live-Updates über Realtime, Markterholung alle 10 Minuten per `pg_cron`

Client-Code: `src/online/`. Alle Funktionen liefern `{ ok, data }` oder `{ ok: false, error, offline }` und werfen nie.

Lokal mit Server spielen:

```bash
cp .env.example .env
npm run dev
```
