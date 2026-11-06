/**
 * Testmodus für die Wirtschaft: Ein einfacher Händler-Bot spielt eine Weile,
 * damit sich Preise und Geldfluss prüfen lassen, ohne selbst zu spielen.
 */
import { BUILDINGS, betriebUpkeep, KONTOR_PRICE, KONTOR_SLOTS, type BuildingType } from '../data/buildings.ts';
import type { Chapter } from '../data/campaign.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { buyCost, price, sellRevenue } from './economy.ts';
import { hasYard, repair } from './fleet.ts';
import { advance, buy, cargoLoad, day, depart, kontorBuy, kontorSell, newGame, planVoyage, sell, shipClass, type GameState } from './game.ts';
import { betriebeIn, buildBetrieb, buildingAllowed, buildKontor, dailyUpkeep, playerWorth, sellBetrieb } from './house.ts';
import { rivalWorth } from './rivals.ts';

export interface BalanceReport {
  days: number;
  money: number;
  trips: number;
  moneyByDay: number[];
}

/** Bester Handel für ein Schiff im Hafen: Ware, Ziel und erwarteter Gewinn pro Stunde */
function bestTrade(state: GameState, map: MapDef, shipId: number) {
  const ship = state.ships.find((s) => s.id === shipId)!;
  const here = state.markets[ship.port!];
  const cap = shipClass(ship).capacity;
  let best: { good: string; to: string; amount: number; perHour: number } | null = null;
  for (const town of map.towns) {
    if (town.id === ship.port) continue;
    const plan = planVoyage(state, map, shipId, town.id);
    if (!plan || !plan.ok) continue;
    const there = state.markets[town.id];
    for (const [goodId, m] of Object.entries(here)) {
      const dest = there[goodId];
      if (!dest) continue;
      const base = GOOD_BY_ID.get(goodId)!.base;
      const max = Math.min(cap, Math.floor(m.stock));
      // verschiedene Mengen probieren, große Mengen drücken den Preis am Ziel
      for (let amount = 5; amount <= max; amount += 5) {
        const cost = buyCost(base, m, amount);
        if (cost > state.money) break;
        const perHour = (sellRevenue(base, dest, amount) - cost) / plan.voyage.hours;
        if (!best || perHour > best.perHour) best = { good: goodId, to: town.id, amount, perHour };
      }
    }
  }
  return best;
}

/* ---------- Zielwerte der Balance (Phase 2) ---------- */

/** Ein Rohstoffbetrieb darf sich zum Grundpreis nicht schneller abzahlen */
export const RAW_PAYBACK_MIN_DAYS = 25;
/** Das Vermögensziel von Kapitel 2 soll ein guter Spieler frühestens nach so vielen Tagen schaffen (Median über mehrere Startwerte) */
export const K2_MIN_DAYS = 150;
/** Kein Haus der Konkurrenz soll im freien Spiel nach zwei Jahren reicher sein */
export const RIVAL_MAX_WORTH_2Y = 500_000;

/** Wert einer Warenmenge, standardmäßig zum Grundpreis */
type PriceOf = (good: string) => number;
const basePrice: PriceOf = (g) => GOOD_BY_ID.get(g)!.base;

/** Gewinn eines Betriebs am Tag bei voller Arbeit: Erzeugnisse minus Rohware, Lohn und Unterhalt */
export function dailyMargin(b: BuildingType, priceOf: PriceOf = basePrice): number {
  const out = Object.entries(b.outputs).reduce((s, [g, n]) => s + n * priceOf(g), 0);
  const inp = Object.entries(b.inputs).reduce((s, [g, n]) => s + n * priceOf(g), 0);
  return out - inp - b.wage - betriebUpkeep(b);
}

/** Tage, bis ein Betrieb seinen Kaufpreis eingespielt hat (Infinity, wenn er nie Gewinn macht) */
export function paybackDays(b: BuildingType, priceOf: PriceOf = basePrice): number {
  const m = dailyMargin(b, priceOf);
  return m > 0 ? b.price / m : Infinity;
}

/** Abzahlung aller Betriebe zum Grundpreis, für Tests und den Testmodus */
export function paybackTable(): { id: string; name: string; raw: boolean; price: number; margin: number; days: number }[] {
  return BUILDINGS.map((b) => ({ id: b.id, name: b.name, raw: !!b.rawFrom, price: b.price, margin: Math.round(dailyMargin(b)), days: Math.round(paybackDays(b) * 10) / 10 }));
}

/** Reichstes Haus der Konkurrenz nach `days` Tagen freiem Spiel, ohne dass der Spieler eingreift */
export function rivalPeak(map: MapDef, days: number, seed = 20260601): { worth: number; house: string } {
  const state = newGame(map, { startTown: 'oberau', rivals: true, seed });
  advance(state, map, days * 24);
  let best = { worth: -Infinity, house: '' };
  for (const r of state.rivals) {
    const w = rivalWorth(r);
    if (w > best.worth) best = { worth: w, house: r.id };
  }
  return best;
}

export function runBalance(map: MapDef, days: number, start = 'oberau', opts: { rivals?: boolean; seed?: number } = {}): BalanceReport {
  const state = newGame(map, { startTown: start, rivals: opts.rivals ?? true, seed: opts.seed });
  const ship = state.ships[0];
  const moneyByDay: number[] = [];
  let trips = 0;
  let lastDay = 1;

  while (state.hour < days * 24) {
    if (ship.port) {
      for (const good of Object.keys(ship.cargo)) sell(state, ship.id, good, Infinity);
      if (ship.condition < 0.6) repair(state, map, ship.id);
      const t = bestTrade(state, map, ship.id);
      if (t && t.perHour > 0) {
        buy(state, ship.id, t.good, t.amount);
        // bei Niedrigwasser liegt der volle Kahn zu tief: Ladung verringern, bis er fahren kann
        while (cargoLoad(ship) > 0 && !depart(state, map, ship.id, t.to)) sell(state, ship.id, t.good, 5);
        if (!ship.port) trips++;
      }
      if (ship.port) advance(state, map, 24); // nichts Lohnendes: einen Tag warten
    } else {
      advance(state, map, 1);
    }
    const d = Math.floor(state.hour / 24) + 1;
    if (d !== lastDay) {
      moneyByDay.push(state.money);
      lastDay = d;
    }
  }
  return { days, money: state.money, trips, moneyByDay };
}

/* ---------- Ausbau-Bot für Kapitelziele ---------- */

export interface GrowthReport {
  /** Tag, an dem das Vermögen das Ziel erreicht hat, oder null */
  reachedOn: number | null;
  worth: number;
  ships: number;
  betriebe: number;
  /** gebaute Betriebe als Stadt:Typ */
  built: string[];
  worthByDay: number[];
}

export interface GrowthOptions {
  /** Kontore und Betriebe bauen (die "Kontor vollstopfen"-Strategie) */
  build?: boolean;
  seed?: number;
}

/** Lokaler Marktpreis in einer Stadt, sonst Grundpreis */
function localPrice(state: GameState, town: string): PriceOf {
  return (g) => {
    const m = state.markets[town][g];
    const base = GOOD_BY_ID.get(g)!.base;
    return m ? price(base, m.stock, m.target) : base;
  };
}

/** Ein Tag Hausverwaltung für den Bot: Rohware kaufen, Erzeugnisse verkaufen, neu bauen */
function manageHouse(state: GameState, map: MapDef, opts: GrowthOptions): void {
  // in der Klemme verkauft ein vernünftiger Spieler den schwächsten Betrieb, statt pleitezugehen
  while (state.money < 0 && state.betriebe.length) {
    const worst = state.betriebe
      .map((b) => ({ b, m: dailyMargin(BUILDINGS.find((x) => x.id === b.type)!, localPrice(state, b.town)) }))
      .sort((a, c) => a.m - c.m)[0];
    sellBetrieb(state, worst.b.id);
  }
  for (const b of state.betriebe) {
    const t = BUILDINGS.find((x) => x.id === b.type)!;
    // ein vernünftiger Spieler lässt Betriebe ruhen, die gerade Verlust machen oder für die das Geld fehlt
    b.active = dailyMargin(t, localPrice(state, b.town)) + betriebUpkeep(t) > 0 && state.money > 300;
    if (!b.active) continue;
    for (const [g, n] of Object.entries(t.inputs)) {
      const have = state.kontore[b.town].stock[g]?.amount ?? 0;
      if (have < n) kontorBuy(state, b.town, g, Math.ceil(n * 2 - have));
    }
  }
  for (const [town, k] of Object.entries(state.kontore)) {
    const inputs = new Set(betriebeIn(state, town).flatMap((b) => Object.keys(BUILDINGS.find((x) => x.id === b.type)!.inputs)));
    for (const [g, slot] of Object.entries(k.stock)) if (!inputs.has(g) && slot.amount >= 1) kontorSell(state, town, g, Math.floor(slot.amount));
  }
  if (!opts.build) return;
  // Rücklage: 15 Tage Löhne und Unterhalt, sonst geht der Bot in einer Flaute pleite
  const reserve = Math.max(600, 15 * (dailyUpkeep(state) + state.betriebe.reduce((s, b) => s + BUILDINGS.find((x) => x.id === b.type)!.wage, 0)));
  // Kontor in der Stadt mit dem besten Betrieb, den man dort bauen kann
  let best: { town: string; type: BuildingType; days: number } | null = null;
  for (const t of map.towns) {
    const k = state.kontore[t.id];
    if (k && betriebeIn(state, t.id).length >= KONTOR_SLOTS[k.level]) continue;
    const market = state.markets[t.id];
    for (const b of BUILDINGS) {
      if (!buildingAllowed(map, t.id, b.id)) continue;
      // nur, was sich vor Ort kaufen und verkaufen lässt, und höchstens zwei gleiche Betriebe je Stadt
      if (![...Object.keys(b.inputs), ...Object.keys(b.outputs)].every((g) => market[g])) continue;
      if (betriebeIn(state, t.id).filter((x) => x.type === b.id).length >= 2) continue;
      const days = paybackDays(b, localPrice(state, t.id)) + (k ? 0 : KONTOR_PRICE / Math.max(1, dailyMargin(b, localPrice(state, t.id))));
      if (days < 60 && (!best || days < best.days)) best = { town: t.id, type: b, days };
    }
  }
  if (!best) return;
  const cost = best.type.price + (state.kontore[best.town] ? 0 : KONTOR_PRICE);
  if (state.money < cost + reserve) return;
  if (!state.kontore[best.town]) buildKontor(state, best.town);
  buildBetrieb(state, map, best.town, best.type.id);
}

/**
 * Spielt ein Kapitel wie ein ehrgeiziger Spieler: Jedes Schiff fährt den besten Handel,
 * auf Wunsch baut der Bot Kontore mit den lohnendsten Betrieben.
 * Gemessen wird, wann das Vermögen das Ziel erreicht.
 */
export function runGrowth(map: MapDef, chapter: Chapter, target: number, maxDays: number, opts: GrowthOptions = {}): GrowthReport {
  const state = newGame(map, {
    startTown: chapter.startTown,
    money: chapter.money,
    startShip: chapter.startShip,
    allowedShips: chapter.allowedShips,
    rivals: chapter.rivals ?? false,
    epoch: chapter.epoch,
    startYear: chapter.startYear,
    extraShips: chapter.extraShips,
    kontore: chapter.kontore,
    works: chapter.works,
    seed: opts.seed,
  });
  const startDay = day(state);
  const worthByDay: number[] = [];
  let reachedOn: number | null = null;
  let lastDay = startDay;
  while (day(state) - startDay < maxDays) {
    for (const ship of state.ships) {
      if (!ship.port) continue;
      for (const good of Object.keys(ship.cargo)) sell(state, ship.id, good, Infinity);
      if (ship.condition < 0.6 && hasYard(map, ship.port)) repair(state, map, ship.id);
      const t = bestTrade(state, map, ship.id);
      if (t && t.perHour > 0) {
        buy(state, ship.id, t.good, t.amount);
        while (cargoLoad(ship) > 0 && !depart(state, map, ship.id, t.to)) sell(state, ship.id, t.good, 5);
      }
    }
    // Schiffe ohne Geschäft warten eine Stunde, damit sich die Märkte bewegen
    advance(state, map, 1);
    const d = day(state);
    if (d !== lastDay) {
      lastDay = d;
      manageHouse(state, map, opts);
      const w = playerWorth(state);
      worthByDay.push(w);
      if (reachedOn === null && w >= target) reachedOn = d - startDay;
      if (reachedOn !== null) break;
    }
  }
  return { reachedOn, worth: playerWorth(state), ships: state.ships.length, betriebe: state.betriebe.length, built: state.betriebe.map((b) => `${b.town}:${b.type}`), worthByDay };
}
