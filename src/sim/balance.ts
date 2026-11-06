/**
 * Testmodus für die Wirtschaft: Ein einfacher Händler-Bot spielt eine Weile,
 * damit sich Preise und Geldfluss prüfen lassen, ohne selbst zu spielen.
 */
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { buyCost, sellRevenue } from './economy.ts';
import { advance, buy, cargoLoad, depart, newGame, planVoyage, sell, shipClass, type GameState } from './game.ts';

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

export function runBalance(map: MapDef, days: number, start = 'oberau'): BalanceReport {
  const state = newGame(map, start);
  const ship = state.ships[0];
  const moneyByDay: number[] = [];
  let trips = 0;
  let lastDay = 1;

  while (state.hour < days * 24) {
    if (ship.port) {
      for (const good of Object.keys(ship.cargo)) sell(state, ship.id, good, Infinity);
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
