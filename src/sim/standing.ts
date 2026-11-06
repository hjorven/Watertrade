/**
 * Ansehen pro Stadt (Plan 5.5) und Geld für Ansehen (Plan 6.5).
 *
 * Ansehen entsteht durch Lieferungen in echte Knappheit, erfüllte Aufträge und Hilfe beim Stadtfest.
 * Es verblasst langsam. Stiftungen, ein eigenes Stadthaus und ein Sitz im Stadtrat geben dauerhaftes
 * Ansehen, kosten aber Unterhalt: ein Geldabfluss für das Spätspiel.
 */
import {
  CONTRACT_GAIN,
  CONTRACT_LOSS,
  COUNCIL,
  DAILY_SALE_CAP,
  FOUNDATION_BY_ID,
  FOUNDATIONS,
  POORHOUSE_SHRINK,
  RANKS,
  SCARCE_GAIN,
  SCARCE_SHARE,
  SCHOOL_GROWTH,
  STANDING_DECAY,
  BOUGHT_FADE,
  ROUNDTRIP_MARGIN,
  TOWNHOUSE,
  type FoundationId,
} from '../data/foundations.ts';
import type { MapDef, TownDef } from '../data/maps/valley.ts';
import { addNews, fail, type GameState, type Leg, type NewsItem, type TownStanding, type TradeResult } from './state.ts';
import { levelOf, type TownTickOptions, type TownTickResult } from './towns.ts';

function fresh(): TownStanding {
  return { earned: 0, today: 0, foundations: [], townhouse: false, council: false, rank: 0 };
}

/** Ansehensdaten einer Stadt, legt sie bei Bedarf an */
export function standingOf(state: GameState, town: string): TownStanding {
  const all = (state.standing ??= {});
  return (all[town] ??= fresh());
}

/** Dauerhaftes Ansehen aus Stiftungen, Stadthaus und Ratssitz */
export function baseStanding(s: TownStanding): number {
  let base = 0;
  for (const f of s.foundations) base += FOUNDATION_BY_ID.get(f as FoundationId)?.standing ?? 0;
  if (s.townhouse) base += TOWNHOUSE.standing;
  if (s.council) base += COUNCIL.standing;
  return base;
}

/** Ansehen 0..100 in einer Stadt */
export function standing(state: GameState, town: string): number {
  const s = state.standing?.[town];
  if (!s) return 0;
  return Math.max(0, Math.min(100, s.earned + baseStanding(s)));
}

export function rankIndex(points: number): number {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (points >= RANKS[i].from) r = i;
  return r;
}

export function rankOf(state: GameState, town: string) {
  return RANKS[rankIndex(standing(state, town))];
}

/** Nachlass beim Einkauf in dieser Stadt */
export function buyDiscount(state: GameState, town: string): number {
  return rankOf(state, town).discount;
}

/** Zusätzliche Bauplätze für Betriebe am Kontor */
export function extraSlots(state: GameState, town: string): number {
  return rankOf(state, town).extraSlots;
}

/** Aufschlag auf die Belohnung neuer Aufträge dieser Stadt */
export function contractBonus(state: GameState, town: string): number {
  const s = state.standing?.[town];
  return rankOf(state, town).contractBonus + (s?.council ? COUNCIL.contractBonus : 0);
}

/** Gewicht, mit dem eine Stadt bei neuen Aufträgen zum Zug kommt */
export function offerWeight(state: GameState, town: string): number {
  const r = rankIndex(standing(state, town));
  return (r >= 2 ? 1 + (r - 1) * 0.25 : 1) * (state.standing?.[town]?.council ? COUNCIL.offerWeight : 1);
}

/** Ansehen gewinnen oder verlieren; das verdiente Ansehen bleibt zwischen 0 und 100 */
export function gainStanding(state: GameState, town: string, amount: number): void {
  if (!amount) return;
  const s = standingOf(state, town);
  s.earned = Math.max(0, Math.min(100, s.earned + amount));
}

/** Ein Stadtfest läuft gerade in dieser Stadt */
function festIn(state: GameState, town: string): boolean {
  return state.events.some((e) => e.kind === 'stadtfest' && e.town === town);
}

/**
 * Verkauf an den Markt: Tonnen, die eine echte Knappheit lindern, bringen Ansehen.
 * Knapp ist eine Ware, solange weniger als die Hälfte des Zielbestands auf dem Markt liegt.
 * Beim Stadtfest zählen Bier und Brot bis zum vollen Zielbestand und doppelt.
 */
export function noteSale(state: GameState, town: string, good: string, amount: number, stockBefore: number, target: number): number {
  if (amount <= 0 || !state.towns[town]) return 0;
  const fest = festIn(state, town) && (good === 'bier' || good === 'brot');
  const limit = target * (fest ? 1 : SCARCE_SHARE);
  // Wer die Knappheit selbst erzeugt hat (hier leer gekauft), bekommt für das Zurückverkaufen nichts
  const own = recentlyBought(state, town, good);
  const scarce = Math.max(0, Math.min(amount, limit - stockBefore) - own);
  if (scarce <= 0) return 0;
  const s = standingOf(state, town);
  const gain = Math.min(scarce * SCARCE_GAIN * (fest ? 2 : 1), Math.max(0, DAILY_SALE_CAP - s.today));
  s.today += gain;
  gainStanding(state, town, gain);
  return gain;
}

/** Tonnen dieser Ware, die der Spieler hier zuletzt selbst gekauft hat */
export function recentlyBought(state: GameState, town: string, good: string): number {
  return state.standing?.[town]?.bought?.[good] ?? 0;
}

/** Einkauf am Markt merken */
export function noteBuy(state: GameState, town: string, good: string, amount: number): void {
  if (amount <= 0) return;
  const b = (standingOf(state, town).bought ??= {});
  b[good] = (b[good] ?? 0) + amount;
}

/** Verkauf zieht von der gemerkten eigenen Ware ab */
export function consumeBought(state: GameState, town: string, good: string, amount: number): void {
  const b = state.standing?.[town]?.bought;
  if (!b?.[good]) return;
  b[good] = Math.max(0, b[good] - amount);
  if (b[good] < 0.5) delete b[good];
}

/**
 * Höchster Verkaufsfaktor für Ware, die hier gerade erst gekauft wurde: knapp unter dem günstigsten
 * möglichen Einkauf (Händlerblut und Ansehen eingerechnet). So bringt Kaufen und sofort Zurückverkaufen
 * nie Gewinn, auch nicht mit Kontor und Händler.
 */
export function roundtripCap(state: GameState, town: string, haendlerRebate: number): number {
  return (1 - haendlerRebate) * (1 - buyDiscount(state, town)) * ROUNDTRIP_MARGIN;
}

/** Erfüllter Auftrag */
export function noteContractDone(state: GameState, town: string, amount: number): void {
  gainStanding(state, town, Math.min(CONTRACT_GAIN.max, CONTRACT_GAIN.base + Math.floor(amount / 10) * CONTRACT_GAIN.per10t));
}

/** Verpasste Frist */
export function noteContractFailed(state: GameState, town: string): void {
  gainStanding(state, town, -CONTRACT_LOSS);
}

/** Wirkung der Stiftungen auf die Stadt, für tickTown */
export function townOptions(state: GameState, town: string, d: number): TownTickOptions {
  const s = state.standing?.[town];
  const opts: TownTickOptions = { day: d };
  if (!s) return opts;
  let bonus = 0;
  for (const f of s.foundations) bonus += FOUNDATION_BY_ID.get(f as FoundationId)?.satisfaction ?? 0;
  if (bonus) opts.bonus = bonus;
  if (s.foundations.includes('schule')) opts.growth = SCHOOL_GROWTH;
  if (s.foundations.includes('armenhaus')) opts.shrink = POORHOUSE_SHRINK;
  return opts;
}

/** Nachrichten zu geschlossenen und wieder geöffneten Stadtbetrieben */
export function townNews(state: GameState, def: TownDef, r: TownTickResult): NewsItem[] {
  const news: NewsItem[] = [];
  if (r.closed) news.push(addNews(state, 'stadt', `${def.name} geht es schlecht: Der Betrieb "${r.closed}" schließt. Seine Waren werden knapp.`));
  if (r.reopened) news.push(addNews(state, 'stadt', `${def.name} erholt sich: Der Betrieb "${r.reopened}" arbeitet wieder.`));
  return news;
}

/** Täglicher Unterhalt aller Stiftungen, Stadthäuser und Ratssitze */
export function standingUpkeep(state: GameState): number {
  let sum = 0;
  for (const s of Object.values(state.standing ?? {})) {
    for (const f of s.foundations) sum += FOUNDATION_BY_ID.get(f as FoundationId)?.upkeep ?? 0;
    if (s.townhouse) sum += TOWNHOUSE.upkeep;
    if (s.council) sum += COUNCIL.upkeep;
  }
  return sum;
}

/**
 * Ein Tag: Unterhalt zahlen, verdientes Ansehen verblasst, Aufstiege melden.
 * Läuft nach tickHouse, damit der Unterhalt im Tagesbuch landet.
 */
export function tickStanding(state: GameState, map: MapDef): NewsItem[] {
  const news: NewsItem[] = [];
  if (!state.standing) return news;
  const upkeep = standingUpkeep(state);
  if (upkeep) {
    state.money -= upkeep;
    state.ledger.upkeep += upkeep;
  }
  for (const [town, s] of Object.entries(state.standing)) {
    s.earned = Math.max(0, s.earned * (1 - STANDING_DECAY));
    s.today = 0;
    if (s.bought) {
      for (const g of Object.keys(s.bought)) {
        s.bought[g] *= 1 - BOUGHT_FADE;
        if (s.bought[g] < 0.5) delete s.bought[g];
      }
    }
    const r = rankIndex(standing(state, town));
    const name = map.towns.find((t) => t.id === town)?.name ?? town;
    // Aufstieg nur beim ersten Erreichen melden, Abstieg einmal, wenn der Vorteil wegfällt
    if (r > (s.best ?? s.rank)) news.push(addNews(state, 'stadt', `${name} nennt dich jetzt "${RANKS[r].name}": ${RANKS[r].unlocks}.`));
    else if (r < s.rank) news.push(addNews(state, 'stadt', `Dein Ansehen in ${name} verblasst: nur noch "${RANKS[r].name}".`));
    s.best = Math.max(s.best ?? s.rank, r);
    s.rank = r;
  }
  return news;
}

/* ---------- Geld für Ansehen ---------- */

export function foundationAllowed(state: GameState, town: string, id: string): string | null {
  const f = FOUNDATION_BY_ID.get(id as FoundationId);
  if (!f) return 'Unbekannte Stiftung.';
  if (state.standing?.[town]?.foundations.includes(id)) return `Hier steht schon eine ${f.name}.`;
  const t = state.towns[town];
  if (!t) return 'Unbekannte Stadt.';
  if (levelOf(t.population) < f.minLevel) return `Eine ${f.name} lohnt sich erst in einem Marktflecken.`;
  if (state.money < f.price) return `Die ${f.name} kostet ${f.price} Taler.`;
  return null;
}

/** Eine Stiftung in der Stadt bezahlen */
export function found(state: GameState, town: string, id: string): TradeResult {
  const why = foundationAllowed(state, town, id);
  if (why) return fail(why);
  const f = FOUNDATION_BY_ID.get(id as FoundationId)!;
  state.money -= f.price;
  standingOf(state, town).foundations.push(f.id);
  return { ok: true, message: `${f.name} gestiftet. Die Stadt dankt es dir: +${f.standing} Ansehen.`, amount: 0, taler: f.price };
}

export function townhouseAllowed(state: GameState, town: string): string | null {
  if (state.standing?.[town]?.townhouse) return 'Du hast hier schon ein Stadthaus.';
  if (rankIndex(standing(state, town)) < TOWNHOUSE.minRank) return `Erst ab "${RANKS[TOWNHOUSE.minRank].name}" verkauft dir die Stadt einen Bauplatz.`;
  if (state.money < TOWNHOUSE.price) return `Das Stadthaus kostet ${TOWNHOUSE.price} Taler.`;
  return null;
}

/** Eigenes Stadthaus bauen: Prestige im Diorama und dauerhaftes Ansehen */
export function buildTownhouse(state: GameState, town: string): TradeResult {
  const why = townhouseAllowed(state, town);
  if (why) return fail(why);
  state.money -= TOWNHOUSE.price;
  standingOf(state, town).townhouse = true;
  return { ok: true, message: `Dein Stadthaus steht. +${TOWNHOUSE.standing} Ansehen.`, amount: 0, taler: TOWNHOUSE.price };
}

export function councilAllowed(state: GameState, town: string): string | null {
  if (state.standing?.[town]?.council) return 'Du sitzt hier schon im Stadtrat.';
  if (rankIndex(standing(state, town)) < COUNCIL.minRank) return `Erst ab "${RANKS[COUNCIL.minRank].name}" wählt dich der Rat.`;
  if (state.money < COUNCIL.price) return `Die Wahl kostet ${COUNCIL.price} Taler an Spenden und Bewirtung.`;
  return null;
}

/** Sitz im Stadtrat erwerben */
export function joinCouncil(state: GameState, town: string): TradeResult {
  const why = councilAllowed(state, town);
  if (why) return fail(why);
  state.money -= COUNCIL.price;
  standingOf(state, town).council = true;
  return { ok: true, message: 'Du sitzt jetzt im Stadtrat: halber Zoll vor der Stadt, mehr und bessere Aufträge.', amount: 0, taler: COUNCIL.price };
}

/** Sitz im Rat aufgeben, spart den Aufwand */
export function leaveCouncil(state: GameState, town: string): TradeResult {
  const s = state.standing?.[town];
  if (!s?.council) return fail('Du sitzt hier nicht im Rat.');
  s.council = false;
  return { ok: true, message: 'Du hast deinen Sitz im Stadtrat aufgegeben.', amount: 0, taler: 0 };
}

/**
 * Zoll für den Spieler: Auf Abschnitten, die an eine Stadt mit eigenem Ratssitz grenzen,
 * zahlt er nur die Hälfte.
 */
export function playerToll(state: GameState, map: MapDef, legs: Leg[], tollOn: (seg: string) => number): number {
  let toll = 0;
  for (const leg of legs) {
    const t = tollOn(leg.seg);
    if (!t) continue;
    const seg = map.segments.find((s) => s.id === leg.seg);
    const council = !!seg && (state.standing?.[seg.from]?.council || state.standing?.[seg.to]?.council);
    toll += council ? Math.round(t * COUNCIL.tollShare) : t;
  }
  return toll;
}

/** Wert von Stadthäusern für das Handelsregister (Stiftungen und Ratssitze sind verschenkt) */
export function standingWorth(state: GameState): number {
  let w = 0;
  for (const s of Object.values(state.standing ?? {})) if (s.townhouse) w += TOWNHOUSE.price * 0.5;
  return w;
}

/** Alle Stiftungen, die in einer Stadt noch fehlen */
export function missingFoundations(state: GameState, town: string) {
  const have = state.standing?.[town]?.foundations ?? [];
  return FOUNDATIONS.filter((f) => !have.includes(f.id));
}
