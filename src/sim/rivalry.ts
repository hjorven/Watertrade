import { KONTOR_PRICE } from '../data/buildings.ts';
import { GOOD_BY_ID, GOODS } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { RIVAL_BY_ID } from '../data/rivals.ts';
import { SHIPS } from '../data/ships.ts';
import { available, buyCost } from './economy.ts';
import { MAX_RIVAL_SHIPS, preferredShip, rivalWorth } from './rivals.ts';
import {
  addNews,
  addToSlot,
  day,
  fail,
  type Auction,
  type GameState,
  type NewsItem,
  type Pact,
  type RivalState,
  type Ship,
  type TradeResult,
} from './state.ts';

/**
 * Die Handelshäuser als Gegenspieler (Plan 5.7 und 6.6):
 * - Sie reagieren, wenn der Spieler in ihrem Revier verkauft: erst Preise drücken, dann die Lieferstadt leerkaufen.
 * - Gebietsabkommen: Beide Seiten lassen je eine Ware in Ruhe. Bruch hat Folgen.
 * - Ein Haus, das zu lange in Schulden steckt, geht in Konkurs, seine Kontore werden versteigert.
 * - Anteile: Wer mehr als die Hälfte hält, übernimmt das Haus mit Schiffen, Kontoren und Kasse.
 *
 * Alles hier ist deterministisch (kein Zugriff auf den Zufallsstrom), damit der übrige Spielverlauf
 * mit demselben Startwert gleich bleibt.
 */

/** Verärgerung, ab der ein Haus zurückschlägt */
export const ANGER_RETALIATE = 40;
/** Ab dieser Verärgerung kauft das Haus die Lieferstadt leer statt nur Preise zu drücken */
export const ANGER_BUYOUT = 75;
/** Ab dieser Verärgerung gibt es weder Abkommen noch Anteile */
export const ANGER_REFUSE = 60;
const ANGER_DECAY = 3;
const RETALIATION_DAYS = 20;
/** Rücklage, die ein Haus für Vergeltung nicht antastet */
export const RETALIATION_RESERVE = 1500;

export const PACT_DAYS = 120;
/** Tonnen, die man trotz Abkommen noch verkaufen darf (Restposten) */
export const PACT_TOLERANCE = 10;
const PACT_BAN_DAYS = 60;
/** Nach einer Kündigung verhandelt das Haus so lange nicht neu */
export const PACT_COOLDOWN_DAYS = 30;

/** Ein Haus geht pleite nach so vielen Tagen in Folge mit Schulden */
export const BANKRUPT_DAYS = 30;
export const AUCTION_DAYS = 10;
export const LOT_MIN = Math.round(KONTOR_PRICE * 0.6);

export const SHARE_BLOCK = 10;
/** Ab mehr als diesem Anteil gehört das Haus dem Spieler */
export const TAKEOVER_SHARE = 50;

/** Deterministische Zahl 0..1 aus Tag und Schlüssel */
function chance(d: number, key: string): number {
  let h = 2166136261 ^ d;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const goodName = (id: string) => GOOD_BY_ID.get(id)?.name ?? id;
const houseName = (id: string) => RIVAL_BY_ID.get(id)?.name ?? id;
const townName = (map: MapDef, id: string) => map.towns.find((t) => t.id === id)?.name ?? id;

/** Vom Spieler insgesamt verkaufte Tonnen einer Ware (alle Städte, auch Auftragslieferungen) */
export function soldTotal(state: GameState, good: string): number {
  let n = 0;
  for (const town of Object.values(state.stats.delivered)) n += town[good] ?? 0;
  return n;
}

export function findRival(state: GameState, id: string): RivalState | undefined {
  return state.rivals.find((r) => r.id === id);
}

export function pactWith(state: GameState, house: string): Pact | undefined {
  return state.pacts?.find((p) => p.house === house);
}

/** Lässt dieses Haus die Ware wegen eines Abkommens liegen? */
export function houseAvoids(state: GameState, house: string, good: string): boolean {
  return !!state.pacts?.some((p) => p.house === house && p.houseGood === good);
}

export type Mood = 'freundlich' | 'neutral' | 'verärgert' | 'feindselig';

export function moodOf(r: RivalState): Mood {
  const a = r.anger ?? 0;
  if (a >= ANGER_BUYOUT) return 'feindselig';
  if (a >= ANGER_RETALIATE) return 'verärgert';
  if ((r.shares ?? 0) >= 20 || a < 5) return 'freundlich';
  return 'neutral';
}

/* ---------- Reaktion auf den Spieler ---------- */

/** Stadt, in der der Spieler die Ware bisher am meisten verkauft hat */
function playerOutlet(state: GameState, good: string): string | null {
  let best: string | null = null;
  let most = 0;
  for (const [town, goods] of Object.entries(state.stats.delivered)) {
    const n = goods[good] ?? 0;
    if (n > most && state.markets[town]?.[good]) {
      most = n;
      best = town;
    }
  }
  return best;
}

/** Stadt, aus der die Ware kommt: größte Erzeugung, sonst größter Bestand */
function supplyTown(state: GameState, map: MapDef, good: string): string | null {
  let best: string | null = null;
  let score = 0;
  for (const t of map.towns) {
    const m = state.markets[t.id]?.[good];
    if (!m) continue;
    const s = (t.produces[good] ?? 0) * 100 + m.stock;
    if (s > score) {
      score = s;
      best = t.id;
    }
  }
  return best;
}

function startRetaliation(state: GameState, map: MapDef, r: RivalState, good: string, hard: boolean, days = RETALIATION_DAYS): NewsItem | null {
  const name = houseName(r.id);
  const d = day(state);
  if (hard) {
    const town = supplyTown(state, map, good);
    if (!town) return null;
    r.retaliation = { kind: 'leerkaufen', good, town, until: d + days - 1 };
    return addNews(state, 'konkurrenz', `${name} schlägt zurück: In ${townName(map, town)} wird ${goodName(good)} aufgekauft, so viel zu kriegen ist.`);
  }
  const town = playerOutlet(state, good) ?? supplyTown(state, map, good);
  if (!town) return null;
  r.retaliation = { kind: 'unterbieten', good, town, until: d + days - 1 };
  return addNews(state, 'konkurrenz', `${name} betrachtet ${goodName(good)} als eigenes Revier und drückt in ${townName(map, town)} mit billiger Ware die Preise.`);
}

/** Was ein Haus täglich für Vergeltung ausgibt: ein kleiner Teil der Rücklagen über der Reserve */
export function retaliationBudget(r: RivalState): number {
  return Math.max(0, (r.money - RETALIATION_RESERVE) * 0.03);
}

/**
 * Ein Tag Vergeltung: Ware in den Markt werfen oder den Markt leerkaufen. Kostet das Haus Geld,
 * aber nie mehr als das Tagesbudget. Ist das Geld alle, gibt das Haus auf (Rückgabe false).
 */
function applyRetaliation(state: GameState, r: RivalState): boolean {
  const v = r.retaliation;
  if (!v) return true;
  const good = GOOD_BY_ID.get(v.good);
  const m = state.markets[v.town]?.[v.good];
  if (!good || !m) return false;
  const budget = retaliationBudget(r);
  if (budget < 20) return false;
  const want = 12 + 6 * state.epoch;
  if (v.kind === 'unterbieten') {
    if (m.stock >= m.target * 1.8) return true; // Markt ist schon übervoll
    // Die Ware kommt billig von anderswo; Verlust je Tonne rund ein Fünftel des Grundpreises
    const lossPerT = good.base * 0.2;
    const amount = Math.min(want, Math.floor(budget / lossPerT));
    if (amount <= 0) return false;
    m.stock += amount;
    r.money -= Math.round(amount * lossPerT);
    // zählt wie ein Verkauf der Konkurrenz (Marktanteil in Herausforderungen)
    const sold = (state.stats.rivalSold ??= {});
    sold[v.good] = (sold[v.good] ?? 0) + amount;
  } else {
    let amount = Math.min(available(m) - 3, want);
    if (amount <= 0) return true;
    // Verlust: Kaufpreis minus das, was das Haus später anderswo zurückholt
    const loss = (n: number) => buyCost(good.base, m, n) - n * good.base * 0.9;
    while (amount > 0 && loss(amount) > budget) amount = Math.floor(amount * 0.7);
    if (amount <= 0) return false;
    r.money -= Math.round(Math.max(0, loss(amount)));
    m.stock -= amount;
  }
  return true;
}

function tickReaction(state: GameState, map: MapDef, r: RivalState, news: NewsItem[]): void {
  const def = RIVAL_BY_ID.get(r.id);
  if (!def) return;
  const d = day(state);
  const pact = pactWith(state, r.id);
  const seen = (r.seen ??= {});
  let anger = r.anger ?? 0;
  let worst = '';
  let worstValue = 0;
  for (const g of def.turf) {
    const total = soldTotal(state, g);
    const before = seen[g] ?? total;
    seen[g] = total;
    if (pact?.playerGood === g) continue; // darüber wacht das Abkommen
    const value = Math.max(0, total - before) * (GOOD_BY_ID.get(g)?.base ?? 10);
    if (value > worstValue) {
      worstValue = value;
      worst = g;
    }
    let add = Math.min(20, value / 40);
    if ((r.shares ?? 0) >= 25) add /= 2; // Teilhaber schont man
    anger += add;
  }
  anger = Math.max(0, Math.min(100, anger - ANGER_DECAY));
  r.anger = anger;

  if (r.retaliation && d > r.retaliation.until) {
    news.push(addNews(state, 'konkurrenz', `${def.name} hat genug Geld verbrannt und lässt den ${goodName(r.retaliation.good)}handel wieder laufen.`));
    r.retaliation = null;
    r.anger = Math.min(r.anger, 20); // erst einmal Ruhe
  }
  if (!r.retaliation && r.anger >= ANGER_RETALIATE && worst && retaliationBudget(r) >= 100) {
    const item = startRetaliation(state, map, r, worst, r.anger >= ANGER_BUYOUT);
    if (item) {
      news.push(item);
      r.anger -= 30;
    }
  }
  if (r.retaliation && !applyRetaliation(state, r)) {
    news.push(addNews(state, 'konkurrenz', `${def.name} kann sich den Preiskampf um ${goodName(r.retaliation.good)} nicht mehr leisten und gibt auf.`));
    r.retaliation = null;
    r.anger = Math.min(r.anger, 20);
  }
}

/* ---------- Gebietsabkommen ---------- */

export function canOfferPact(state: GameState, house: string, playerGood: string, houseGood: string): string | null {
  const r = findRival(state, house);
  const def = RIVAL_BY_ID.get(house);
  if (!r || !def) return 'Dieses Haus gibt es nicht mehr.';
  if (pactWith(state, house)) return `Mit ${def.name} gibt es schon ein Abkommen.`;
  if ((r.noPactUntil ?? 0) >= day(state)) return `${def.name} verhandelt nach deiner Kündigung erst ab Tag ${r.noPactUntil! + 1} wieder.`;
  if ((state.pactBanUntil ?? 0) >= day(state)) return 'Nach deinem Vertragsbruch traut dir am Fluss niemand. Warte bis Tag ' + (state.pactBanUntil! + 1) + '.';
  if ((r.anger ?? 0) >= ANGER_REFUSE) return `${def.name} ist zu verärgert, um mit dir zu verhandeln.`;
  if (!def.turf.includes(playerGood)) return `${goodName(playerGood)} gehört nicht zum Revier von ${def.name}.`;
  if (!GOOD_BY_ID.has(houseGood)) return 'Unbekannte Ware.';
  if (def.turf.includes(houseGood)) return `${goodName(houseGood)} gehört zum Kerngeschäft von ${def.name}, das geben sie nicht her.`;
  return null;
}

/**
 * Das naheliegende Abkommen mit einem Haus: Du lässt die Revierware liegen, von der du am meisten verkaufst,
 * das Haus im Gegenzug deine wichtigste Ware außerhalb seines Reviers.
 */
export function suggestedPact(state: GameState, house: string): { playerGood: string; houseGood: string } | null {
  const def = RIVAL_BY_ID.get(house);
  if (!def || !def.turf.length) return null;
  const bySold = (a: string, b: string) => soldTotal(state, b) - soldTotal(state, a);
  const playerGood = [...def.turf].sort(bySold)[0];
  const others = GOODS.map((g) => g.id).filter((g) => !def.turf.includes(g));
  if (!others.length) return null;
  const houseGood = [...others].sort(bySold)[0];
  return { playerGood, houseGood };
}

/** Abkommen anbieten: Der Spieler lässt `playerGood` liegen, das Haus `houseGood` */
export function offerPact(state: GameState, map: MapDef, house: string, playerGood: string, houseGood: string): TradeResult {
  const why = canOfferPact(state, house, playerGood, houseGood);
  if (why) return fail(why);
  const r = findRival(state, house)!;
  const d = day(state);
  (state.pacts ??= []).push({ house, playerGood, houseGood, from: d, until: d + PACT_DAYS - 1, baseline: soldTotal(state, playerGood) });
  r.anger = Math.max(0, (r.anger ?? 0) - 25);
  if (r.retaliation?.good === playerGood) r.retaliation = null;
  addNews(state, 'haus', `Abkommen mit ${houseName(house)}: Du lässt ${goodName(playerGood)} in Ruhe, sie lassen ${goodName(houseGood)} in Ruhe. Es gilt bis Tag ${d + PACT_DAYS - 1}.`);
  void map;
  return {
    ok: true,
    message: `Handschlag. ${PACT_DAYS} Tage lang lässt du ${goodName(playerGood)} in Ruhe, ${houseName(house)} lässt ${goodName(houseGood)} in Ruhe.`,
    amount: 0,
    taler: 0,
  };
}

/** Abkommen ordentlich kündigen: kein Bruch, aber das Haus ist verstimmt */
export function endPact(state: GameState, house: string): TradeResult {
  const p = pactWith(state, house);
  if (!p) return fail('Kein Abkommen mit diesem Haus.');
  state.pacts = state.pacts!.filter((x) => x !== p);
  const r = findRival(state, house);
  if (r) {
    r.anger = Math.min(100, (r.anger ?? 0) + 15);
    r.noPactUntil = day(state) + PACT_COOLDOWN_DAYS;
  }
  addNews(state, 'haus', `Du kündigst das Abkommen mit ${houseName(house)}.`);
  return { ok: true, message: `Abkommen mit ${houseName(house)} gekündigt. Sie sind verstimmt.`, amount: 0, taler: 0 };
}

/** Vertragsstrafe bei Bruch, steigt mit der Epoche */
export function pactPenalty(state: GameState): number {
  return 250 * state.epoch;
}

/** Wie viele Tonnen der Spieler seit Abschluss schon verkauft hat */
export function pactUsed(state: GameState, p: Pact): number {
  return Math.max(0, soldTotal(state, p.playerGood) - p.baseline);
}

function tickPacts(state: GameState, map: MapDef, news: NewsItem[]): void {
  const d = day(state);
  for (const p of [...(state.pacts ?? [])]) {
    const r = findRival(state, p.house);
    const name = houseName(p.house);
    const drop = () => (state.pacts = state.pacts!.filter((x) => x !== p));
    if (!r) {
      drop();
      continue;
    }
    // Der Spieler bricht das Abkommen
    if (pactUsed(state, p) > PACT_TOLERANCE) {
      drop();
      const fine = pactPenalty(state);
      state.money -= fine;
      r.money += fine;
      r.anger = 100;
      state.pactBanUntil = d + PACT_BAN_DAYS;
      news.push(addNews(state, 'konkurrenz', `Vertragsbruch! Du hast ${goodName(p.playerGood)} verkauft, obwohl du ${name} zugesagt hattest, es in Ruhe zu lassen. Das Gericht verlangt ${fine} Taler, und am ganzen Fluss traut dir ${PACT_BAN_DAYS} Tage lang niemand.`));
      if (retaliationBudget(r) >= 100) {
        const item = startRetaliation(state, map, r, p.playerGood, true, 30);
        if (item) news.push(item);
      }
      continue;
    }
    // Das Haus bricht das Abkommen, wenn es knapp bei Kasse ist
    const def = RIVAL_BY_ID.get(p.house);
    if (def && r.money < 0 && chance(d, `bruch-${p.house}`) < (1 - def.honor) * 0.15) {
      drop();
      const fine = pactPenalty(state);
      r.money -= fine;
      state.money += fine;
      news.push(addNews(state, 'konkurrenz', `${name} bricht das Abkommen und handelt wieder mit ${goodName(p.houseGood)}. Das Gericht spricht dir ${fine} Taler zu. Du bist an deine Zusage nicht mehr gebunden.`));
      continue;
    }
    if (d > p.until) {
      drop();
      news.push(addNews(state, 'haus', `Das Abkommen mit ${name} ist ausgelaufen. ${goodName(p.playerGood)} und ${goodName(p.houseGood)} sind wieder frei.`));
    }
  }
}

/* ---------- Konkurs und Versteigerung ---------- */

function fall(state: GameState, r: RivalState, how: 'konkurs' | 'uebernahme'): void {
  state.rivals = state.rivals.filter((x) => x !== r);
  (state.housesGone ??= []).push({ id: r.id, how, day: day(state) });
  if (state.pacts) state.pacts = state.pacts.filter((p) => p.house !== r.id);
  // Gebote eines verschwundenen Hauses verfallen
  for (const lot of state.auction?.lots ?? []) {
    if (lot.bidder === r.id) {
      lot.bidder = null;
      lot.bid = 0;
    }
  }
}

function bankrupt(state: GameState, map: MapDef, r: RivalState, news: NewsItem[]): void {
  const name = houseName(r.id);
  // Bauwerke eines Hauses im Konkurs fallen an die Allgemeinheit (ohne owner = öffentlich, Aufbau des Wasserbau-Threads)
  for (const w of state.works as Array<{ owner?: string; partner?: { kind: string; id: string } }>) {
    if (w.owner === r.id) delete w.owner;
    if (w.partner?.kind === 'haus' && w.partner.id === r.id) w.partner = undefined;
  }
  const lost = r.shares ?? 0;
  fall(state, r, 'konkurs');
  const towns = r.kontore;
  let text = `${name} ist pleite. Die Schiffe gehen an die Gläubiger.`;
  if (towns.length) {
    const d = day(state);
    const a: Auction = (state.auction ??= { house: name, until: d + AUCTION_DAYS - 1, lots: [] });
    if (a.house !== name) a.house = `${a.house} und ${name}`;
    a.until = Math.max(a.until, d + AUCTION_DAYS - 1);
    for (const t of towns) if (!a.lots.some((l) => l.town === t)) a.lots.push({ town: t, min: LOT_MIN, bid: 0, bidder: null });
    text += ` Die Kontore in ${towns.map((t) => townName(map, t)).join(', ')} werden bis Tag ${a.until} versteigert.`;
  }
  if (lost) text += ` Deine ${lost} % Anteile sind wertlos.`;
  news.push(addNews(state, 'konkurrenz', text));
}

function tickBankruptcy(state: GameState, map: MapDef, r: RivalState, news: NewsItem[]): void {
  r.debtDays = r.money < 0 ? (r.debtDays ?? 0) + 1 : 0;
  const deep = r.money < -2500 * state.epoch;
  if (deep || (r.debtDays >= BANKRUPT_DAYS && r.ships.length <= 1)) {
    bankrupt(state, map, r, news);
    return;
  }
  if (r.debtDays === 10) news.push(addNews(state, 'konkurrenz', `Am Kai erzählt man, ${houseName(r.id)} könne die Löhne nicht mehr zahlen.`));
}

/** Nächstes Mindestgebot für ein Los */
export function nextBid(lot: { min: number; bid: number }): number {
  return lot.bid ? Math.ceil((lot.bid * 1.1) / 10) * 10 : lot.min;
}

export function canBid(state: GameState, town: string): string | null {
  const lot = state.auction?.lots.find((l) => l.town === town);
  if (!lot) return 'Dieses Kontor wird nicht versteigert.';
  if (state.kontore[town]) return 'Hier hast du schon ein Kontor.';
  if (lot.bidder === 'player') return 'Du bietest schon am höchsten.';
  if (state.money < nextBid(lot)) return `Du brauchst ${nextBid(lot)} Taler in der Kasse.`;
  return null;
}

/** Gebot abgeben. Das Geld wird hinterlegt und bei Überbietung zurückgezahlt. */
export function placeBid(state: GameState, town: string): TradeResult {
  const why = canBid(state, town);
  if (why) return fail(why);
  const lot = state.auction!.lots.find((l) => l.town === town)!;
  const bid = nextBid(lot);
  state.money -= bid;
  lot.bid = bid;
  lot.bidder = 'player';
  return { ok: true, message: `Gebot über ${bid} Taler hinterlegt.`, amount: 0, taler: bid };
}

function tickAuction(state: GameState, map: MapDef, news: NewsItem[]): void {
  const a = state.auction;
  if (!a) return;
  const d = day(state);
  if (d > a.until) {
    for (const lot of a.lots) {
      const where = townName(map, lot.town);
      if (lot.bidder === 'player') {
        if (state.kontore[lot.town]) state.money += lot.bid;
        else state.kontore[lot.town] = { level: 1, stock: {} };
        news.push(addNews(state, 'haus', `Zuschlag: Das Kontor in ${where} gehört dir, für ${lot.bid} Taler.`));
        continue;
      }
      const r = lot.bidder ? findRival(state, lot.bidder) : undefined;
      if (r && !r.kontore.includes(lot.town)) {
        r.money -= lot.bid;
        r.kontore.push(lot.town);
        news.push(addNews(state, 'konkurrenz', `${houseName(r.id)} ersteigert das Kontor in ${where} für ${lot.bid} Taler.`));
      } else {
        news.push(addNews(state, 'konkurrenz', `Für das Kontor in ${where} fand sich kein Käufer. Es steht leer.`));
      }
    }
    state.auction = null;
    return;
  }
  // Die Häuser bieten mit, wenn sie Geld haben
  for (const lot of a.lots) {
    const next = nextBid(lot);
    if (next > KONTOR_PRICE * 1.6) continue;
    for (const r of state.rivals) {
      if (lot.bidder === r.id || r.kontore.includes(lot.town) || r.kontore.length >= 4) continue;
      if (r.money < next + 1500) continue;
      if (chance(d, `gebot-${lot.town}-${r.id}`) > 0.35) continue;
      if (lot.bidder === 'player') {
        state.money += lot.bid; // überboten: Geld zurück
        news.push(addNews(state, 'konkurrenz', `${houseName(r.id)} überbietet dich beim Kontor in ${townName(map, lot.town)}: ${next} Taler.`));
      }
      lot.bid = next;
      lot.bidder = r.id;
      break;
    }
  }
}

/* ---------- Anteile und Übernahme ---------- */

/** Preis für den nächsten Block von 10 %: steigt mit jedem gekauften Block */
export function sharePrice(r: RivalState): number {
  const worth = Math.max(2000, rivalWorth(r));
  return Math.round(worth * (SHARE_BLOCK / 100) * (1 + (r.shares ?? 0) / 100));
}

/** Rücknahmepreis für einen Block */
export function shareSaleValue(r: RivalState): number {
  return Math.round(Math.max(0, rivalWorth(r)) * (SHARE_BLOCK / 100) * 0.9);
}

/** Wert aller Anteile des Spielers, zählt zum Vermögen */
export function sharesWorth(state: GameState): number {
  let w = 0;
  for (const r of state.rivals) if (r.shares) w += (Math.max(0, rivalWorth(r)) * r.shares) / 100;
  return Math.round(w);
}

/**
 * Bei der Übernahme werden die übrigen Teilhaber zum Zeitwert ausgezahlt.
 * So kostet ein Haus insgesamt mehr, als es wert ist, und die Kasse lässt sich nicht billig plündern.
 */
export function buyoutCost(r: RivalState): number {
  return Math.round((Math.max(0, rivalWorth(r)) * (100 - (r.shares ?? 0) - SHARE_BLOCK)) / 100);
}

/** Kosten des nächsten Kaufs: ein Block, beim letzten Block samt Auszahlung der übrigen Teilhaber */
export function nextShareCost(r: RivalState): number {
  const last = (r.shares ?? 0) + SHARE_BLOCK > TAKEOVER_SHARE;
  return sharePrice(r) + (last ? buyoutCost(r) : 0);
}

export function canBuyShares(state: GameState, house: string): string | null {
  const r = findRival(state, house);
  if (!r) return 'Dieses Haus gibt es nicht mehr.';
  if ((r.anger ?? 0) >= ANGER_REFUSE && r.money >= 0) return `${houseName(house)} verkauft dir keine Anteile, solange sie so verärgert sind.`;
  const cost = nextShareCost(r);
  if (state.money < cost) return `Das kostet ${cost} Taler.`;
  // übernommene Schulden müssen aus der Kasse bezahlbar sein
  if (cost !== sharePrice(r) && state.money - cost + r.money < 0) return `Du müsstest ${Math.round(-r.money)} Taler Schulden übernehmen, dafür reicht die Kasse nicht.`;
  return null;
}

export function buyShares(state: GameState, map: MapDef, house: string): TradeResult {
  const why = canBuyShares(state, house);
  if (why) return fail(why);
  const r = findRival(state, house)!;
  const cost = nextShareCost(r);
  state.money -= cost;
  r.shares = (r.shares ?? 0) + SHARE_BLOCK;
  if (r.shares > TAKEOVER_SHARE) {
    takeOver(state, map, r);
    return { ok: true, message: `Mit ${r.shares} % gehört dir ${houseName(house)}. Schiffe, Kontore und Kasse sind jetzt deine.`, amount: 0, taler: cost };
  }
  return { ok: true, message: `${SHARE_BLOCK} % von ${houseName(house)} gekauft, du hältst jetzt ${r.shares} %.`, amount: 0, taler: cost };
}

/**
 * Gesamtpreis einer Übernahme in einem Zug: alle Anteilsblöcke bis über die Hälfte samt Auszahlung
 * der übrigen Teilhaber. Ohne Kasse und Schulden des Hauses, die mit übergehen.
 */
export function takeoverCost(r: RivalState): number {
  const probe: RivalState = { ...r };
  let cost = 0;
  for (;;) {
    cost += nextShareCost(probe);
    const next = (probe.shares ?? 0) + SHARE_BLOCK;
    if (next > TAKEOVER_SHARE) return cost;
    probe.shares = next;
  }
}

export function canTakeOver(state: GameState, house: string): string | null {
  const r = findRival(state, house);
  if (!r) return 'Dieses Haus gibt es nicht mehr.';
  if ((r.anger ?? 0) >= ANGER_REFUSE && r.money >= 0) return `${houseName(house)} verhandelt nicht mit dir, solange sie so verärgert sind.`;
  const cost = takeoverCost(r);
  if (state.money < cost) return `Das kostet ${cost} Taler.`;
  if (state.money - cost + r.money < 0) return `Du müsstest ${Math.round(-r.money)} Taler Schulden übernehmen, dafür reicht die Kasse nicht.`;
  return null;
}

/** Ein Haus in einem Zug kaufen (die Anteilsblöcke bleiben nur die Rechengrundlage für den Preis) */
export function buyHouse(state: GameState, map: MapDef, house: string): TradeResult {
  const why = canTakeOver(state, house);
  if (why) return fail(why);
  let paid = 0;
  for (;;) {
    const res = buyShares(state, map, house);
    if (!res.ok) return res;
    paid += res.taler;
    if (!findRival(state, house)) return { ok: true, message: `${houseName(house)} gehört jetzt dir. Schiffe, Kontore und Kasse sind deine.`, amount: 0, taler: paid };
  }
}

/** Das Haus geht mit allem, was es hat, an den Spieler */
export function takeOver(state: GameState, map: MapDef, r: RivalState): void {
  const name = houseName(r.id);
  for (const rs of r.ships) {
    const cargo: Ship['cargo'] = {};
    if (rs.cargo) addToSlot(cargo, rs.cargo.good, rs.cargo.amount, rs.cargo.cost);
    state.ships.push({
      id: state.nextShipId++,
      type: rs.type,
      name: rs.name,
      port: rs.port,
      voyage: rs.voyage,
      cargo,
      condition: 0.8,
      upgrades: [],
      captain: null,
      route: null,
      bunker: SHIPS[rs.type]?.bunker ?? 0,
    });
  }
  const kontore = r.kontore.filter((t) => !state.kontore[t]);
  for (const t of kontore) state.kontore[t] = { level: 1, stock: {} };
  state.money += r.money;
  // Wasserbauten des Hauses gehen mit über
  // (Aufbau aus dem Wasserbau-Thread: owner 'spieler' = Spielerbau, partner = Mitbauer)
  for (const w of state.works as Array<{ owner?: string; fee?: string; partner?: { kind: string; id: string } }>) {
    if (w.owner === r.id) {
      w.owner = 'spieler';
      w.fee ??= 'normal';
    }
    if (w.partner?.kind === 'haus' && w.partner.id === r.id) w.partner = undefined;
  }
  fall(state, r, 'uebernahme');
  const parts = [r.ships.length === 1 ? 'ein Schiff' : `${r.ships.length} Schiffe`];
  if (kontore.length) parts.push(`Kontore in ${kontore.map((t) => townName(map, t)).join(', ')}`);
  parts.push(r.money >= 0 ? `${Math.round(r.money)} Taler aus der Kasse` : `${Math.round(-r.money)} Taler Schulden`);
  addNews(state, 'haus', `Übernahme: ${name} gehört jetzt deinem Haus. Du übernimmst ${parts.join(', ')}.`);
}

function tickDividend(state: GameState, r: RivalState, news: NewsItem[]): void {
  if (!r.shares || day(state) % 30 !== 0 || r.money <= 3000) return;
  const pay = Math.round((r.money - 3000) * 0.05 * (r.shares / 100));
  if (pay <= 0) return;
  r.money -= pay;
  state.money += pay;
  news.push(addNews(state, 'haus', `${houseName(r.id)} schüttet ${pay} Taler an dich aus, für deine ${r.shares} % Anteile.`));
}

/* ---------- Sichtbare Pläne ---------- */

function tickPlans(state: GameState, r: RivalState, news: NewsItem[]): void {
  const def = RIVAL_BY_ID.get(r.id);
  if (!def) return;
  const type = preferredShip(def.preferredShip, state.epoch);
  const need = def.expandAt * state.epoch + SHIPS[type].price;
  if (r.ships.length >= MAX_RIVAL_SHIPS + state.epoch - 1) return;
  if (r.planned === r.ships.length) return;
  if (r.money > need * 0.75 && r.money <= need) {
    r.planned = r.ships.length;
    news.push(addNews(state, 'konkurrenz', `${def.name} legt Geld für ein weiteres Schiff zurück (${SHIPS[type].name}).`));
  }
}

/** Täglich, am Ende von tickRivals */
export function tickRivalry(state: GameState, map: MapDef): NewsItem[] {
  const news: NewsItem[] = [];
  tickPacts(state, map, news);
  for (const r of [...state.rivals]) {
    tickReaction(state, map, r, news);
    tickDividend(state, r, news);
    tickPlans(state, r, news);
    tickBankruptcy(state, map, r, news);
  }
  tickAuction(state, map, news);
  return news;
}

/** Ein Haus zum Kapitelbeginn schwächen: wenig Geld, nur ein Schiff, Gerüchte am Kai */
export function weakenHouse(state: GameState, house: string): void {
  const r = findRival(state, house);
  if (!r) return;
  r.money = 300;
  r.ships = r.ships.slice(0, 1);
  const def = RIVAL_BY_ID.get(house)!;
  if (def.builds && !r.kontore.length) r.kontore.push(def.home);
  addNews(state, 'konkurrenz', `${def.name} steht schlecht da. Die Familie sucht Geldgeber und würde Anteile verkaufen.`);
}
