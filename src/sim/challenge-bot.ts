/**
 * Prüf-Bot für Herausforderungen: spielt eine Herausforderung wie ein zielstrebiger Spieler
 * und meldet, ob und wann alle Ziele erreicht sind. Damit lässt sich jede Herausforderung
 * auf Machbarkeit testen, ohne selbst zu spielen.
 *
 * Der Bot ist bewusst einfach gehalten (kein Vorausplanen über mehrere Fahrten). Was er schafft,
 * schafft ein aufmerksamer Spieler sicher auch.
 */
import { BUILDINGS, betriebUpkeep, KONTOR_PRICE, KONTOR_SLOTS, type BuildingType } from '../data/buildings.ts';
import type { Goal } from '../data/campaign.ts';
import type { Challenge } from '../data/challenges.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { PROJECT_BY_ID } from '../data/projects.ts';
import { SHIPS } from '../data/ships.ts';
import { challengeGame } from './challenge.ts';
import { acceptContract, deliverContract, MAX_ACCEPTED } from './contracts.ts';
import { buyCost, price, sellRevenue } from './economy.ts';
import { buyShip, dismantleRaft, hasYard, hireCaptain, repair, setRoute, shipAllowed } from './fleet.ts';
import { advance, buy, capacityOf, cargoLoad, day, depart, effectiveType, kontorBuy, kontorSell, planRoute, sell, type GameState, type Ship } from './game.ts';
import { goalDone, goalProgress } from './goals.ts';
import { betriebeIn, buildBetrieb, buildingAllowed, buildKontor } from './house.ts';
import { needs } from './towns.ts';
import { wearRate } from './voyage.ts';
import { startProject } from './works.ts';

export interface BotOptions {
  /** Kontore und Betriebe bauen */
  build?: boolean;
  /** höchstens so viele Schiffe kaufen */
  maxShips?: number;
}

export interface ChallengeRun {
  won: boolean;
  /** Spieltage bis zum Sieg oder bis zum Ende der Frist */
  days: number;
  goals: { text: string; value: number; target: number; done: boolean }[];
  ships: number;
  money: number;
}

interface Trade {
  good: string;
  from: string;
  to: string;
  amount: number;
  /** Gewinn plus Zielbonus je Stunde */
  score: number;
  hours: number;
}

const base = (g: string) => GOOD_BY_ID.get(g)!.base;

/** Tonnen einer Ware, die eigene Schiffe gerade in eine Stadt bringen */
function inTransit(state: GameState, town: string, good: string): number {
  return state.ships.reduce((s, x) => s + (x.voyage?.to === town ? (x.cargo[good]?.amount ?? 0) : 0), 0);
}

/** Wert, den das Liefern von `amount` t einer Ware nach `to` für die offenen Ziele hat */
function goalBonus(state: GameState, map: MapDef, goals: Goal[], open: boolean[], good: string, to: string, amount: number): number {
  let bonus = 0;
  const weight = base(good) * 2 + 20;
  goals.forEach((g, i) => {
    if (!open[i]) return;
    if (g.type === 'deliver' && g.town === to && g.good === good) {
      const p = goalProgress(state, g);
      const left = p.target - p.value - inTransit(state, to, good);
      bonus += Math.max(0, Math.min(amount, left)) * weight;
    } else if (g.type === 'share' && g.good === good) {
      const p = goalProgress(state, g);
      const left = p.target - p.value + 20;
      bonus += Math.max(0, Math.min(amount, left)) * base(good) * 1.5;
    } else if (g.type === 'townLevel' && g.town === to) {
      const def = map.towns.find((t) => t.id === to)!;
      const m = state.markets[to][good];
      // nur, was dort fehlt: Bedarf der Stadt, bis der Bestand gut über dem Zielbestand liegt
      const room = m ? m.target * 1.05 - m.stock - inTransit(state, to, good) : 0;
      if (m && needs(def, state.towns[to])[good]) bonus += Math.max(0, Math.min(amount, room)) * base(good);
    }
  });
  for (const c of state.contracts) {
    if (c.accepted && c.town === to && c.good === good) {
      const left = c.amount - c.delivered - inTransit(state, to, good);
      bonus += Math.max(0, Math.min(amount, left)) * (c.reward / c.amount);
    }
  }
  return bonus;
}

/** Kosten einer Fahrt ohne Zoll: Diesel, Kohle und die spätere Reparatur des Verschleißes */
function runningCost(ship: Ship, hours: number): number {
  const cls = SHIPS[ship.type];
  // Kohle ist abseits der Gruben meist knapp: lieber mit dem anderthalbfachen Grundpreis rechnen; Diesel etwas über Grundpreis
  const fuel = (cls.diesel ?? 0) * hours * base('diesel') * 1.3 + (cls.coal ?? 0) * hours * base('kohle') * 1.6;
  return fuel + hours * wearRate(ship) * cls.price * 0.5;
}

/** Bester Handel ab `from` für ein Schiff, mit Gewinn und Zielbonus */
function bestTrade(state: GameState, map: MapDef, goals: Goal[], open: boolean[], ship: Ship, from: string): Trade | null {
  const here = state.markets[from];
  const cap = capacityOf(ship) - cargoLoad(ship);
  const type = effectiveType(state, { ...ship, cargo: {} });
  // was eine Stadt zum Wachsen braucht, wird dort nicht wieder weggekauft
  const keepHere = new Set<string>();
  goals.forEach((g, i) => {
    if (open[i] && g.type === 'townLevel' && g.town === from) for (const x of Object.keys(needs(map.towns.find((t) => t.id === from)!, state.towns[from]))) keepHere.add(x);
  });
  let best: Trade | null = null;
  for (const town of map.towns) {
    if (town.id === from) continue;
    const plan = planRoute(state, map, from, town.id, type);
    if (!plan.ok) continue;
    const hours = plan.voyage.hours;
    // Zoll, Diesel, Kohle und Verschleiß gehen vom Gewinn ab
    const toll = (plan.voyage.toll ?? 0) + runningCost(ship, hours);
    const there = state.markets[town.id];
    for (const [goodId, m] of Object.entries(here)) {
      const dest = there[goodId];
      if (!dest || keepHere.has(goodId)) continue;
      const max = Math.min(cap, Math.floor(m.stock));
      for (let amount = 5; amount <= max; amount += 5) {
        const cost = buyCost(base(goodId), m, amount);
        if (cost + toll > state.money) break;
        const profit = sellRevenue(base(goodId), dest, amount) - cost - toll;
        const score = (profit + goalBonus(state, map, goals, open, goodId, town.id, amount)) / hours;
        if (!best || score > best.score) best = { good: goodId, from, to: town.id, amount, score, hours };
      }
    }
  }
  return best;
}

function sellAll(state: GameState, ship: Ship): void {
  for (const c of state.contracts) if (c.accepted && c.town === ship.port) deliverContract(state, ship.id, c.id);
  for (const good of Object.keys(ship.cargo)) sell(state, ship.id, good, Infinity);
}

/** Ein Schiff im Hafen: verkaufen, reparieren, nächsten Handel oder Leerfahrt wählen */
function handleShip(state: GameState, map: MapDef, goals: Goal[], open: boolean[], ship: Ship, rafts: Set<number>): void {
  if (ship.type === 'floss') {
    handleRaft(state, map, goals, open, ship, rafts);
    return;
  }
  if (ship.route?.active) return;
  sellAll(state, ship);
  if (ship.condition < 0.6 && hasYard(map, ship.port!)) repair(state, map, ship.id);
  const t = bestTrade(state, map, goals, open, ship, ship.port!);
  if (t && t.score > 0) {
    buy(state, ship.id, t.good, t.amount);
    // zu tief für die Fahrt oder zu wenig Geld für Zoll und Kohle: Ladung verringern
    while (cargoLoad(ship) > 0 && !depart(state, map, ship.id, t.to)) sell(state, ship.id, t.good, 5);
    if (!ship.port) return;
  }
  // nichts Lohnendes hier: leer dorthin fahren, wo das beste Geschäft wartet
  const type = effectiveType(state, ship);
  let best: { town: string; score: number } | null = null;
  for (const town of map.towns) {
    if (town.id === ship.port) continue;
    const plan = planRoute(state, map, ship.port!, town.id, type);
    if (!plan.ok) continue;
    const next = bestTrade(state, map, goals, open, ship, town.id);
    if (!next || next.score <= 0) continue;
    const score = (next.score * next.hours - runningCost(ship, plan.voyage.hours) - (plan.voyage.toll ?? 0)) / (next.hours + plan.voyage.hours);
    if (!best || score > best.score) best = { town: town.id, score };
  }
  // nur losfahren, wenn es sich deutlich mehr lohnt als hier auf bessere Preise zu warten
  if (best && best.score > (t?.score ?? 0) * 1.5 + 1) depart(state, map, ship.id, best.town);
}

/** Floß: Holz laden, talwärts treiben lassen, am Ziel verkaufen und zerlegen */
function handleRaft(state: GameState, map: MapDef, goals: Goal[], open: boolean[], ship: Ship, rafts: Set<number>): void {
  if (rafts.has(ship.id)) {
    for (const good of Object.keys(ship.cargo)) sell(state, ship.id, good, Infinity);
    if (cargoLoad(ship) === 0) dismantleRaft(state, ship.id);
    return;
  }
  const t = bestTrade(state, map, goals, open, ship, ship.port!);
  if (t && t.score > 0) buy(state, ship.id, t.good, t.amount);
  const dest = t?.to ?? farthestDownstream(state, map, ship);
  if (dest) {
    while (cargoLoad(ship) > 0 && !depart(state, map, ship.id, dest)) sell(state, ship.id, t!.good, 5);
    if (!ship.port || depart(state, map, ship.id, dest)) rafts.add(ship.id);
  }
}

function farthestDownstream(state: GameState, map: MapDef, ship: Ship): string | null {
  let best: { town: string; h: number } | null = null;
  for (const town of map.towns) {
    if (town.id === ship.port) continue;
    const p = planRoute(state, map, ship.port!, town.id, effectiveType(state, ship));
    if (p.ok && (!best || p.voyage.hours > best.h)) best = { town: town.id, h: p.voyage.hours };
  }
  return best?.town ?? null;
}

/** Schiffstyp, den der Bot als Nächstes kauft, mit Werftstadt */
function nextShip(state: GameState, map: MapDef, goals: Goal[], open: boolean[]): { type: string; town: string } | null {
  const wanted = goals.find((g, i) => open[i] && g.type === 'ships' && g.shipType);
  let best: { type: string; town: string; value: number } | null = null;
  for (const cls of Object.values(SHIPS)) {
    if (cls.timber || !shipAllowed(state, cls.id)) continue;
    if (wanted && wanted.type === 'ships' && cls.id !== wanted.shipType) continue;
    const town = map.towns.find((t) => t.shipyard.includes(cls.id));
    if (!town) continue;
    // Ladung mal Fahrt je Taler, Schlepper nur auf dem Hauptstrom brauchbar
    let value = (cls.capacity * cls.speed * (cls.id === 'schleppverband' ? 0.5 : 1)) / cls.price;
    // ein Schiff, das die Zielstädte gerade nicht erreicht, hilft wenig
    const targets = goals.filter((g, i) => open[i] && (g.type === 'deliver' || g.type === 'townLevel')).map((g) => (g as { town: string }).town);
    if (targets.some((to) => to !== town.id && !planRoute(state, map, town.id, to, cls).ok)) value *= 0.1;
    if (!best || value > best.value) best = { type: cls.id, town: town.id, value };
  }
  return best;
}

/** Lokaler Marktpreis in einer Stadt, sonst Grundpreis */
function localPrice(state: GameState, town: string) {
  return (g: string) => {
    const m = state.markets[town][g];
    return m ? price(base(g), m.stock, m.target) : base(g);
  };
}

function margin(b: BuildingType, priceOf: (g: string) => number): number {
  const out = Object.entries(b.outputs).reduce((s, [g, n]) => s + n * priceOf(g), 0);
  const inp = Object.entries(b.inputs).reduce((s, [g, n]) => s + n * priceOf(g), 0);
  return out - inp - b.wage - betriebUpkeep(b);
}

/** Einmal am Tag: Betriebe versorgen, Kontorlager verkaufen, neu bauen */
function manageHouse(state: GameState, map: MapDef, goals: Goal[], open: boolean[], opts: BotOptions): void {
  for (const b of state.betriebe) {
    const t = BUILDINGS.find((x) => x.id === b.type)!;
    b.active = margin(t, localPrice(state, b.town)) + betriebUpkeep(t) > 0 && state.money > 200;
    if (!b.active) continue;
    for (const [g, n] of Object.entries(t.inputs)) {
      const have = state.kontore[b.town].stock[g]?.amount ?? 0;
      if (have < n) kontorBuy(state, b.town, g, Math.ceil(n * 2 - have));
    }
  }
  for (const [town, k] of Object.entries(state.kontore)) {
    const inputs = new Set(betriebeIn(state, town).flatMap((b) => Object.keys(BUILDINGS.find((x) => x.id === b.type)!.inputs)));
    for (const [g, slot] of Object.entries(k.stock)) {
      if (inputs.has(g) || slot.amount < 1) continue;
      // Ware für ein Lieferziel bleibt liegen, die holt ein Schiff ab
      if (goals.some((x, i) => open[i] && x.type === 'deliver' && x.good === g && x.town !== town)) continue;
      kontorSell(state, town, g, Math.floor(slot.amount));
    }
  }
  const needKontore = goals.find((g, i) => open[i] && g.type === 'kontore');
  if (!opts.build && !needKontore && !goals.some((g, i) => open[i] && g.type === 'betriebe')) return;
  // nicht weiterbauen, solange Betriebe aus Geldmangel ruhen
  if (state.betriebe.some((b) => !b.active)) return;
  const reserve = 1000;
  let best: { town: string; type: BuildingType; days: number } | null = null;
  for (const t of map.towns) {
    const k = state.kontore[t.id];
    if (needKontore && k) continue;
    if (k && betriebeIn(state, t.id).length >= KONTOR_SLOTS[k.level]) continue;
    const market = state.markets[t.id];
    for (const b of BUILDINGS) {
      if (!buildingAllowed(map, t.id, b.id)) continue;
      if (![...Object.keys(b.inputs), ...Object.keys(b.outputs)].every((g) => market[g])) continue;
      if (betriebeIn(state, t.id).filter((x) => x.type === b.id).length >= 2) continue;
      const m = Math.max(1, margin(b, localPrice(state, t.id)));
      const days = (b.price + (k ? 0 : KONTOR_PRICE)) / m;
      if (days < 80 && (!best || days < best.days)) best = { town: t.id, type: b, days };
    }
  }
  if (!best) return;
  const cost = best.type.price + (state.kontore[best.town] ? 0 : KONTOR_PRICE);
  if (state.money < cost + reserve) return;
  if (!state.kontore[best.town]) buildKontor(state, best.town);
  buildBetrieb(state, map, best.town, best.type.id);
}

/** Einem Schiff einen Kapitän und eine Route zwischen zwei Städten geben */
function assignRoute(state: GameState, map: MapDef, goals: Goal[], open: boolean[]): void {
  for (const ship of state.ships) {
    if (!ship.port || ship.voyage || ship.route?.active || ship.type === 'floss') continue;
    const cap = state.tavern[ship.port]?.find((c) => c.hire < state.money - 300);
    if (!cap) continue;
    const t = bestTrade(state, map, goals, open, { ...ship, cargo: {} }, ship.port);
    if (!t || t.score <= 0) continue;
    if (!hireCaptain(state, ship.id, cap.id).ok) continue;
    sellAll(state, ship);
    setRoute(state, ship.id, {
      stops: [
        { town: t.from, orders: [{ kind: 'kaufen', good: t.good, amount: 0, limit: Math.ceil(base(t.good) * 1.2) }] },
        { town: t.to, orders: [{ kind: 'verkaufen', good: t.good, amount: 0, limit: 0 }] },
      ],
      next: 0,
      active: true,
    });
    return;
  }
}

/**
 * Spielt eine Herausforderung bis zum Sieg oder bis die Frist abläuft.
 * Ziele rasten ein wie im Spiel: Einmal erfüllt bleibt erfüllt.
 */
export function playChallenge(map: MapDef, c: Challenge, seed: number, opts: BotOptions = {}): ChallengeRun {
  const state = challengeGame(map, c, seed);
  const goals = c.goals;
  const done = goals.map(() => false);
  const open = () => done.map((d) => !d);
  const startDay = day(state);
  const limit = c.deadlineDays ?? 360;
  const maxShips = opts.maxShips ?? 6;
  const rafts = new Set<number>();
  let lastDay = startDay;
  let won = false;
  const check = () => {
    goals.forEach((g, i) => {
      if (!done[i] && goalDone(state, g)) done[i] = true;
    });
    return done.every(Boolean);
  };
  while (day(state) - startDay < limit) {
    const o = open();
    for (const ship of [...state.ships]) if (ship.port && !ship.voyage) handleShip(state, map, goals, o, ship, rafts);
    advance(state, map, 1);
    if (check()) {
      won = true;
      break;
    }
    const d = day(state);
    if (d === lastDay) continue;
    lastDay = d;
    const od = open();
    manageHouse(state, map, goals, od, opts);
    const daysLeft = limit - (d - startDay);
    // Aufträge annehmen, wenn sie ein Ziel sind
    if (goals.some((g, i) => od[i] && g.type === 'contracts')) {
      for (const k of state.contracts) {
        if (k.accepted || state.contracts.filter((x) => x.accepted).length >= MAX_ACCEPTED) continue;
        // nur, was sich sicher beschaffen lässt: genug Ware an einem Ort und Geld für den Einkauf
        const source = map.towns.some((t) => t.id !== k.town && (state.markets[t.id][k.good]?.stock ?? 0) > k.amount + 10);
        const affordable = state.money > k.amount * base(k.good) * 1.5 + 300;
        if (source && affordable && k.amount <= 40 * state.ships.length && k.deadline - d > 10) acceptContract(state, k.id);
      }
    }
    // Wasserbau
    for (const g of goals) {
      if (g.type !== 'project' || state.works.some((w) => w.id === g.id)) continue;
      const p = PROJECT_BY_ID.get(g.id)!;
      if (state.money >= p.cost + 200) startProject(state, g.id);
    }
    if (goals.some((g, i) => od[i] && g.type === 'routes')) assignRoute(state, map, goals, od);
    // Schiffe zukaufen, solange genug Zeit bleibt, dass sie sich lohnen
    const shipGoal = goals.some((g, i) => od[i] && g.type === 'ships');
    const moneyOnly = goals.every((g, i) => !od[i] || g.type === 'money');
    const projectSaving = goals.some((g, i) => od[i] && g.type === 'project');
    const growth = !moneyOnly && !projectSaving && daysLeft > Math.min(45, limit * 0.4);
    if (state.ships.filter((s) => s.type !== 'floss').length < maxShips && (shipGoal || growth || (moneyOnly && daysLeft > 90))) {
      const next = nextShip(state, map, goals, od);
      const reserve = shipGoal ? 300 : 1200;
      if (next && state.money >= SHIPS[next.type].price + reserve) buyShip(state, map, next.town, next.type);
    }
    // Flöße für Floßziele
    if (goals.some((g, i) => od[i] && g.type === 'rafts') && shipAllowed(state, 'floss')) {
      const floating = state.ships.filter((s) => s.type === 'floss').length;
      for (const t of map.towns.filter((x) => x.shipyard.includes('floss'))) if (floating < 3 && state.money > 120) buyShip(state, map, t.id, 'floss');
    }
  }
  check();
  return {
    won,
    days: day(state) - startDay,
    goals: goals.map((g, i) => ({ text: g.text, ...goalProgress(state, g), done: done[i] })),
    ships: state.ships.length,
    money: Math.round(state.money),
  };
}
