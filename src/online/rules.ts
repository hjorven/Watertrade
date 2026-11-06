// Reine Regeln und Helfer ohne Supabase, damit das Spiel sie ohne den Online-Teil laden kann.

/** Liga-Regeln, gleich wie in supabase/schema.sql */
export const LEAGUE_CAPACITY = 40;
export const LEAGUE_TRAVEL_SECONDS = 45;
export const LEAGUE_START_GOLD = 300;

/** Plätze für Cloud-Spielstände */
export const SLOT_COUNT = 5;

/** Heutiger Tag als YYYY-MM-DD in UTC, damit alle Spieler denselben Tagesmarkt haben */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Startwert für den Zufallsgenerator des Tagesmarkts, für alle Spieler gleich */
export function dailySeed(day: string = todayUtc()): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Ist der Kahn angekommen? Gibt die verbleibenden Sekunden zurück (0 = angekommen) */
export function secondsUntilArrival(p: { arrivesAt: string }, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((Date.parse(p.arrivesAt) - now.getTime()) / 1000));
}

// --- Handelsliga 5.10: Schiffe, Ereignisse, Saisons ---
// Gleiche Zahlen wie supabase/migrations/20261106210000_liga_saisons.sql. Der Server rechnet verbindlich,
// der Client nutzt sie nur für Anzeige und Knöpfe.

export interface LeagueShip {
  id: string;
  name: string;
  /** Kaufpreis; beim Wechsel gibt es den halben Preis des alten Schiffs zurück */
  price: number;
  capacity: number;
  travelSeconds: number;
  /** Reisezeit während eines Hochwassers */
  floodSeconds: number;
  text: string;
}

export const LEAGUE_SHIPS: LeagueShip[] = [
  {
    id: 'treidelkahn',
    name: 'Treidelkahn',
    price: 0,
    capacity: LEAGUE_CAPACITY,
    travelSeconds: LEAGUE_TRAVEL_SECONDS,
    floodSeconds: 75,
    text: 'Das Startschiff. Solide, aber bei Hochwasser kommen die Pferde am Treidelpfad nur schwer voran.',
  },
  {
    id: 'plaette',
    name: 'Plätte',
    price: 280,
    capacity: 30,
    travelSeconds: 25,
    floodSeconds: 30,
    text: 'Klein und flink. Liegt flach im Wasser und fährt auch bei Hochwasser fast ungebremst.',
  },
  {
    id: 'segelkahn',
    name: 'Segelkahn',
    price: 950,
    capacity: 60,
    travelSeconds: 40,
    floodSeconds: 100,
    text: 'Viel Laderaum. Bei Hochwasser muss vor jeder Brücke der Mast gelegt werden, dann ist er der langsamste.',
  },
];

export const LEAGUE_SHIP_BY_ID = new Map(LEAGUE_SHIPS.map((s) => [s.id, s]));

export function leagueShip(id: string | undefined): LeagueShip {
  return LEAGUE_SHIP_BY_ID.get(id ?? '') ?? LEAGUE_SHIPS[0]!;
}

/** Wiederverkaufswert, zählt zum Vermögen */
export function leagueShipValue(id: string): number {
  return Math.floor(leagueShip(id).price / 2);
}

/** Was der Wechsel von einem Schiff zum anderen kostet */
export function leagueShipCost(from: string, to: string): number {
  return leagueShip(to).price - leagueShipValue(from);
}

/** Ratenbegrenzung auf dem Server: Handel, Reisen und Schiffskauf zusammen */
export const LEAGUE_ACTIONS_PER_MINUTE = 40;
export const LEAGUE_SEASON_DAYS = 14;

export type LeagueEventKind = 'hochwasser' | 'zollstreit' | 'markttag';

export interface LeagueEvent {
  id: number;
  kind: LeagueEventKind;
  /** null bei Hochwasser, das gilt im ganzen Tal */
  townId: string | null;
  startsAt: string;
  endsAt: string;
}

export function isEventActive(e: LeagueEvent, now: Date = new Date()): boolean {
  const t = now.getTime();
  return Date.parse(e.startsAt) <= t && Date.parse(e.endsAt) > t;
}

export function isFlooding(events: LeagueEvent[], now: Date = new Date()): boolean {
  return events.some((e) => e.kind === 'hochwasser' && isEventActive(e, now));
}

/** Preisfaktor in Prozent für Käufe (buy) oder Verkäufe in einer Stadt, wie league_event_percent() */
export function leagueEventPercent(events: LeagueEvent[], townId: string, buy: boolean, now: Date = new Date()): number {
  const e = events
    .filter((x) => x.townId === townId && isEventActive(x, now))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
  if (!e) return 100;
  if (e.kind === 'zollstreit') return buy ? 115 : 85;
  if (e.kind === 'markttag') return buy ? 100 : 120;
  return 100;
}

/** Kaufbetrag mit Aufschlag, aufgerundet wie auf dem Server */
export function leagueBuyTotal(sum: number, percent: number): number {
  return Math.ceil((sum * percent) / 100);
}

/** Verkaufserlös mit Auf- oder Abschlag, abgerundet wie auf dem Server */
export function leagueSellTotal(sum: number, percent: number): number {
  return Math.floor((sum * percent) / 100);
}

/** Reisezeit in Sekunden für ein Schiff, bei Hochwasser länger */
export function leagueTravelSeconds(shipId: string, flood: boolean): number {
  const s = leagueShip(shipId);
  return flood ? s.floodSeconds : s.travelSeconds;
}

/** Anteil der laufenden Fahrt in 0..1 */
export function travelProgress(p: { departedAt?: string; arrivesAt: string }, now: Date = new Date()): number {
  const end = Date.parse(p.arrivesAt);
  const start = p.departedAt ? Date.parse(p.departedAt) : end - LEAGUE_TRAVEL_SECONDS * 1000;
  if (!(end > start)) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

/** Überschrift und Erklärung eines Ereignisses für den Liga-Bildschirm */
export function leagueEventText(e: LeagueEvent, townName: (id: string) => string): { title: string; text: string } {
  const town = e.townId ? townName(e.townId) : '';
  switch (e.kind) {
    case 'hochwasser':
      return { title: 'Hochwasser im ganzen Tal', text: 'Alle Fahrten dauern länger. Die Plätte kommt am besten durch, der Segelkahn muss vor jeder Brücke den Mast legen.' };
    case 'zollstreit':
      return { title: `Zollstreit in ${town}`, text: `In ${town} kostet jeder Kauf 15 % mehr und jeder Verkauf bringt 15 % weniger.` };
    case 'markttag':
      return { title: `Markttag in ${town}`, text: `In ${town} bringt jeder Verkauf 20 % mehr.` };
  }
}

/** Restzeit als kurzer Text, z. B. "3 Tage 4 Std", "2 Std 5 Min", "12 Min" */
export function remainingText(ms: number): string {
  const min = Math.max(0, Math.ceil(ms / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d} ${d === 1 ? 'Tag' : 'Tage'} ${h} Std`;
  if (h > 0) return `${h} Std ${m} Min`;
  return `${m} Min`;
}
