/**
 * Testmodus für die Wirtschaft: Ein einfacher Händler-Bot spielt eine Weile,
 * damit sich Preise und Geldfluss prüfen lassen, ohne selbst zu spielen.
 */
import { BUILDINGS, betriebUpkeep, KONTOR_PRICE, KONTOR_SLOTS, type BuildingType } from '../data/buildings.ts';
import type { Chapter } from '../data/campaign.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { buyCost, price, SELL_FACTOR, sellRevenue } from './economy.ts';
import { MIN_FRESH, PERISH, SHIPS } from '../data/ships.ts';
import { hasYard, repair, timberPlan } from './fleet.ts';
import { bestRaftPlan } from './rafting.ts';
import { goalDone } from './goals.ts';
import { PROJECT_BY_ID } from '../data/projects.ts';
import { startProject } from './works.ts';
import { steamDays } from './steam.ts';
import { advance, buy, bunkerPlan, buyShip, cargoLoad, day, depart, dismantleRaft, kontorBuy, kontorSell, newGame, planVoyage, sell, shipClass, type GameState } from './game.ts';
import { betriebeIn, buildBetrieb, buildingAllowed, buildKontor, dailyUpkeep, playerWorth, sellBetrieb } from './house.ts';
import { rivalWorth } from './rivals.ts';
import { netFlow } from './towns.ts';

export interface BalanceReport {
  days: number;
  money: number;
  trips: number;
  moneyByDay: number[];
}

/** Bester Handel für ein Schiff im Hafen: Ware, Ziel und erwarteter Gewinn pro Stunde */
function bestTrade(state: GameState, map: MapDef, shipId: number, allow: (town: string) => boolean = () => true) {
  const ship = state.ships.find((s) => s.id === shipId)!;
  const here = state.markets[ship.port!];
  const cap = shipClass(ship).capacity;
  let best: { good: string; to: string; amount: number; perHour: number } | null = null;
  for (const town of map.towns) {
    if (town.id === ship.port || !allow(town.id)) continue;
    const plan = planVoyage(state, map, shipId, town.id);
    if (!plan || !plan.ok) continue;
    const there = state.markets[town.id];
    // Dampfer: Kohle für die Fahrt mitrechnen (Kontorkohle kostet nichts mehr, Marktkohle zum Marktpreis)
    const coal = bunkerPlan(state, ship, plan.voyage.hours, plan.voyage.toll ?? 0);
    if (coal.problem) continue;
    // verbrannte Kohle zum Preis, den Nachkaufen kostet (auch wenn sie schon im Bunker liegt)
    const coalMarket = state.markets[ship.port!].kohle;
    const paid = Math.max(0, coal.need - coal.fromKontor);
    const coalCost = paid * (coalMarket ? price(GOOD_BY_ID.get('kohle')!.base, coalMarket.stock, coalMarket.target) : GOOD_BY_ID.get('kohle')!.base);
    for (const [goodId, m] of Object.entries(here)) {
      const dest = there[goodId];
      if (!dest) continue;
      const base = GOOD_BY_ID.get(goodId)!.base;
      const max = Math.min(cap, Math.floor(m.stock));
      // verschiedene Mengen probieren, große Mengen drücken den Preis am Ziel
      for (let amount = 5; amount <= max; amount += 5) {
        const cost = buyCost(base, m, amount);
        if (cost > state.money) break;
        if (cost + coal.cost > state.money) break;
        // verderbliche Ware kommt ohne Kühlraum mit weniger Wert an
        const fresh = shipClass(ship).fresh ? 1 : Math.max(MIN_FRESH, 1 - ((PERISH[goodId] ?? 0) * plan.voyage.hours) / 24);
        const perHour = (sellRevenue(base, dest, amount, SELL_FACTOR * fresh) - cost - coalCost) / plan.voyage.hours;
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
  /** Waren, die im Kontor bleiben (z. B. Kohle für die eigenen Dampfer) */
  keep?: string[];
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
    for (const [g, slot] of Object.entries(k.stock)) if (!inputs.has(g) && !opts.keep?.includes(g) && slot.amount >= 1) kontorSell(state, town, g, Math.floor(slot.amount));
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

/* ---------- Kapitel-Bots (Kampagne) ---------- */

export interface ChapterRun {
  /** Tag, an dem jedes Ziel erfüllt war (Index wie in chapter.goals), null = nie */
  goalDays: (number | null)[];
  /** Tag, an dem alle Ziele erfüllt waren, oder null */
  doneOn: number | null;
}

/** Ziele eines Kapitels täglich prüfen, bis alle erfüllt sind (erfüllte Ziele bleiben erfüllt wie im Spiel) */
function trackGoals(state: GameState, chapter: Chapter, startDay: number, goalDays: (number | null)[]): boolean {
  chapter.goals.forEach((g, i) => {
    if (goalDays[i] === null && goalDone(state, g)) goalDays[i] = day(state) - startDay;
  });
  return goalDays.every((d) => d !== null);
}

/**
 * Kapitel 1 wie ein Spieler, der den Hinweisen folgt: Flöße aus Oberau talwärts, der Treidelkahn
 * bringt Getreide nach Oberau und handelt, ab genug Geld kommt ein zweiter Kahn, und knappe Waren
 * fahren nach Oberau, bis die Stadt gut versorgt ist.
 */
export function runChapterOne(map: MapDef, chapter: Chapter, maxDays: number, seed = 1): ChapterRun {
  const state = newGame(map, {
    startTown: chapter.startTown,
    money: chapter.money,
    startShip: chapter.startShip,
    allowedShips: chapter.allowedShips,
    rivals: chapter.rivals ?? false,
    seed,
  });
  const home = chapter.startTown;
  const homeDef = map.towns.find((t) => t.id === home)!;
  const grainGoal = chapter.goals.find((g) => g.type === 'deliver');
  const grain = grainGoal?.type === 'deliver' ? grainGoal.amount : 0;
  const startDay = day(state);
  const goalDays: (number | null)[] = chapter.goals.map(() => null);
  let lastDay = startDay;
  while (day(state) - startDay < maxDays) {
    // ein Floß zur Zeit; das erste gleich zu Beginn wie im Hinweis, später nur bei billigem Holz und Geld übrig für den Kahn
    let raft = state.ships.find((s) => s.type === 'floss');
    if (!raft && (state.stats.rafts === 0 || (state.money > 800 && (timberPlan(state, home, 'floss').cost || Infinity) < 200))) raft = buyShip(state, map, home, 'floss').ship;
    if (raft?.port === home) {
      const plan = bestRaftPlan(state, map, raft);
      if (plan?.good && cargoLoad(raft) === 0) buy(state, raft.id, plan.good, plan.amount);
      if (plan) depart(state, map, raft.id, plan.to);
    } else if (raft?.port) {
      for (const good of Object.keys(raft.cargo)) sell(state, raft.id, good, Infinity);
      dismantleRaft(state, raft.id);
    }
    const kahne = state.ships.filter((s) => s.type === 'treidelkahn');
    const yard = kahne.find((s) => s.port && map.towns.find((t) => t.id === s.port)?.shipyard.includes('treidelkahn'));
    if (kahne.length < 2 && yard && state.money > SHIPS.treidelkahn.price + 400) buyShip(state, map, yard.port!, 'treidelkahn');
    const grainLeft = grain - (state.stats.delivered[home]?.getreide ?? 0);
    for (const ship of state.ships) {
      if (ship.type === 'floss' || !ship.port) continue;
      for (const good of Object.keys(ship.cargo)) sell(state, ship.id, good, Infinity);
      if (ship.condition < 0.6 && hasYard(map, ship.port)) repair(state, map, ship.id);
      // Getreide bergwärts, bis Oberau genug hat
      if (grainLeft > 0 && state.markets[ship.port].getreide && ship.port !== home && state.money > 200) {
        buy(state, ship.id, 'getreide', Math.min(shipClass(ship).capacity, grainLeft, Math.floor(state.money / 12)));
        if (cargoLoad(ship) > 0 && depart(state, map, ship.id, home)) continue;
        for (const good of Object.keys(ship.cargo)) sell(state, ship.id, good, Infinity);
      }
      // der erste Kahn versorgt Oberau mit dem, was dort knapp ist, solange es nicht viel Verlust bringt; der zweite nur mit viel Geld
      const supplier = ship === state.ships.find((s) => s.type !== 'floss') ? 1000 : 4000;
      if (ship.port !== home && state.money > supplier) {
        const there = state.markets[home];
        const cap = shipClass(ship).capacity;
        // alles, was Oberau fehlt und hier zu haben ist, bis der Laderaum voll ist
        for (const [g, m] of Object.entries(there)) {
          const here = state.markets[ship.port][g];
          if (!here || m.stock > m.target * 1.2 || netFlow(homeDef, g, state.towns[home]) >= 0) continue;
          const base = GOOD_BY_ID.get(g)!.base;
          const room = cap - cargoLoad(ship);
          const amount = Math.min(room, Math.floor(here.stock) - 5, Math.ceil(m.target * 1.4 - m.stock));
          if (amount < 3 || buyCost(base, here, amount) > state.money - 300) continue;
          if (sellRevenue(base, m, amount) - buyCost(base, here, amount) > -100) buy(state, ship.id, g, amount);
        }
        if (cargoLoad(ship) > 0) {
          if (depart(state, map, ship.id, home)) continue;
          for (const good of Object.keys(ship.cargo)) sell(state, ship.id, good, Infinity);
        }
      }
      const t = bestTrade(state, map, ship.id);
      if (t && t.perHour > 0) {
        buy(state, ship.id, t.good, t.amount);
        while (cargoLoad(ship) > 0 && !depart(state, map, ship.id, t.to)) sell(state, ship.id, t.good, 5);
      } else if (state.money < 300 && ship.port !== home && ship.port !== 'muehlheim') {
        // ohne Geld und ohne Geschäft: leer zur Kornkammer fahren, dort ist Ware billig
        depart(state, map, ship.id, 'muehlheim');
      }
    }
    advance(state, map, 1);
    const d = day(state);
    if (d !== lastDay) {
      lastDay = d;
      if (trackGoals(state, chapter, startDay, goalDays)) break;
    }
  }
  const doneOn = goalDays.every((d) => d !== null) ? Math.max(...(goalDays as number[])) : null;
  return { goalDays, doneOn };
}

/**
 * Kapitel 4 wie ein Spieler, der die Ziele der Reihe nach angeht: erst mit Kahn und Plätte Geld verdienen
 * und lohnende Betriebe bauen, dann die Schleuse, dann Raddampfer bis zur Zielzahl. Sind alle Dampfer da,
 * fahren sie auch bei kleinem Verlust, damit die Dampfertage zusammenkommen.
 * Kohle bunkern sie wie im Spiel beim Ablegen, zuerst aus dem eigenen Kontor.
 */
export function runSteamChapter(map: MapDef, chapter: Chapter, maxDays: number, seed = 1): ChapterRun & { coalPrice: number[] } {
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
    seed,
  });
  const goal = chapter.goals.find((g) => g.type === 'steamDays');
  const fleet = chapter.goals.find((g) => g.type === 'ships' && g.shipType === 'raddampfer');
  const want = fleet?.type === 'ships' ? fleet.count : 0;
  const startDay = day(state);
  const goalDays: (number | null)[] = chapter.goals.map(() => null);
  const coalPrice: number[] = [];
  let lastDay = startDay;
  while (day(state) - startDay < maxDays) {
    const lock = chapter.goals.find((g) => g.type === 'project');
    const lockId = lock?.type === 'project' ? lock.id : null;
    const lockStarted = !lockId || state.works.some((w) => w.id === lockId);
    if (!lockStarted && state.money > (PROJECT_BY_ID.get(lockId!)?.cost ?? 0) + 4000) startProject(state, lockId!);
    // eigene Kohle: Kontor mit zwei Meilern in der Kohlenstadt, sobald die Schleuse gebaut wird
    const pit = map.towns.find((t) => buildingAllowed(map, t.id, 'koehlerei'));
    if (lockStarted && pit && betriebeIn(state, pit.id).filter((b) => b.type === 'koehlerei').length < 2 && state.money > 4000) {
      if (!state.kontore[pit.id]) buildKontor(state, pit.id);
      buildBetrieb(state, map, pit.id, 'koehlerei');
    }
    const steamers = state.ships.filter((s) => s.type === 'raddampfer').length;
    const yard = state.ships.find((s) => s.port && map.towns.find((t) => t.id === s.port)?.shipyard.includes('raddampfer'));
    if (lockStarted && steamers < want && yard && state.money > SHIPS.raddampfer.price + 4000) buyShip(state, map, yard.port!, 'raddampfer');
    const fleetReady = steamers >= want;
    for (const ship of state.ships) {
      if (!ship.port) continue;
      for (const good of Object.keys(ship.cargo)) sell(state, ship.id, good, Infinity);
      if (ship.condition < 0.6 && hasYard(map, ship.port)) repair(state, map, ship.id);
      // Dampfer fahren nur Häfen mit Kohle an (Markt oder eigenes Kontor), sonst bleiben sie liegen
      const coalOk = (town: string) => !shipClass(ship).coal || !!state.markets[town].kohle || (state.kontore[town]?.stock.kohle?.amount ?? 0) > 20;
      const minGain = fleetReady && shipClass(ship).coal ? -10 : 0;
      const t = bestTrade(state, map, ship.id, coalOk);
      if (t && t.perHour > minGain) {
        buy(state, ship.id, t.good, t.amount);
        while (cargoLoad(ship) > 0 && !depart(state, map, ship.id, t.to)) sell(state, ship.id, t.good, 5);
      } else if (fleetReady && shipClass(ship).coal && steamDays(state) < (goal?.type === 'steamDays' ? goal.days : 0)) {
        // für die Dampfertage leer zum nächsten Hafen mit Kohle weiterfahren
        const next = map.towns
          .filter((x) => x.id !== ship.port && coalOk(x.id))
          .map((x) => ({ id: x.id, plan: planVoyage(state, map, ship.id, x.id) }))
          .filter((x) => x.plan?.ok)
          .sort((a, b) => (a.plan as { voyage: { hours: number } }).voyage.hours - (b.plan as { voyage: { hours: number } }).voyage.hours)[0];
        if (next) depart(state, map, ship.id, next.id);
      }
    }
    advance(state, map, 1);
    const d = day(state);
    if (d !== lastDay) {
      lastDay = d;
      manageHouse(state, map, { build: !lockStarted, keep: ['kohle'] });
      const m = state.markets.niedermuend.kohle;
      coalPrice.push(m ? price(GOOD_BY_ID.get('kohle')!.base, m.stock, m.target) : 0);
      if ((globalThis as any).DBG && (d - startDay) % 25 === 0) console.log('D', d - startDay, Math.round(state.money), Math.round(playerWorth(state)), state.ships.map((s) => `${s.type}@${s.port ?? '~'}`).join(' '), state.stats.steamDays ?? 0, state.betriebe.map((b) => b.town + ':' + b.type).join(','));
      if (trackGoals(state, chapter, startDay, goalDays)) break;
    }
  }
  const doneOn = goalDays.every((d) => d !== null) ? Math.max(...(goalDays as number[])) : null;
  return { goalDays, doneOn, coalPrice };
}
