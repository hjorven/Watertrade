/**
 * Flößerei: Was lohnt sich auf einem Floß? Ein Floß fährt nur talwärts und wird am Ziel zerlegt,
 * also zählt die ganze Fahrt einmal: Ladung kaufen, treiben lassen, Ladung und Floßholz verkaufen.
 */
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { buyCost, sellRevenue } from './economy.ts';
import { RAFT_TIMBER } from './fleet.ts';
import { capacityOf, cargoLoad, type GameState, type Ship } from './state.ts';
import { planVoyage } from './voyage.ts';

export interface RaftPlan {
  /** Ware zum Zuladen, oder null, wenn sich nur das Floßholz lohnt */
  good: string | null;
  amount: number;
  to: string;
  /** erwarteter Gewinn der ganzen Fahrt ohne den Bau (Ladung plus Floßholz am Ziel) */
  profit: number;
}

/** Beste Fahrt für ein Floß im Hafen: Ziel und Ladung mit dem höchsten Gewinn */
export function bestRaftPlan(state: GameState, map: MapDef, raft: Ship): RaftPlan | null {
  if (!raft.port || raft.type !== 'floss') return null;
  const here = state.markets[raft.port];
  const room = capacityOf(raft) - cargoLoad(raft);
  const holzBase = GOOD_BY_ID.get('holz')!.base;
  let best: RaftPlan | null = null;
  for (const town of map.towns) {
    if (town.id === raft.port) continue;
    const plan = planVoyage(state, map, raft.id, town.id);
    if (!plan?.ok) continue;
    const there = state.markets[town.id];
    // was schon an Bord ist, wird am Ziel mit verkauft
    let carried = 0;
    let holzAboard = 0;
    for (const [good, slot] of Object.entries(raft.cargo)) {
      const dest = there[good];
      if (!dest || slot.amount <= 0) continue;
      carried += sellRevenue(GOOD_BY_ID.get(good)!.base, dest, Math.floor(slot.amount));
      if (good === 'holz') holzAboard = Math.floor(slot.amount);
    }
    const consider = (good: string | null, amount: number, gain: number) => {
      // Holz als Ladung drückt auch den Preis fürs Floßholz
      const before = holzAboard + (good === 'holz' ? amount : 0);
      const timber = there.holz ? sellRevenue(holzBase, there.holz, before + RAFT_TIMBER) - sellRevenue(holzBase, there.holz, before) : 0;
      const profit = gain + carried + timber;
      if (!best || profit > best.profit) best = { good, amount, to: town.id, profit };
    };
    consider(null, 0, 0);
    if (room <= 0) continue;
    for (const [good, m] of Object.entries(here)) {
      const dest = there[good];
      if (!dest) continue;
      const base = GOOD_BY_ID.get(good)!.base;
      const max = Math.min(room, Math.floor(m.stock) - 1);
      for (let amount = 5; amount <= max; amount += 5) {
        const cost = buyCost(base, m, amount);
        if (cost > state.money) break;
        consider(good, amount, sellRevenue(base, dest, amount) - cost);
      }
    }
  }
  return best;
}
