import type { Goal } from '../data/campaign.ts';
import type { GameState } from './game.ts';
import { levelOf } from './towns.ts';

/** Fortschritt eines Ziels: aktueller Wert und Zielwert */
export function goalProgress(state: GameState, goal: Goal): { value: number; target: number } {
  switch (goal.type) {
    case 'profit':
      return { value: state.firstProfitDone ? 1 : 0, target: 1 };
    case 'money':
      return { value: state.money, target: goal.amount };
    case 'ships': {
      const n = state.ships.filter((s) => !goal.shipType || s.type === goal.shipType).length;
      return { value: n, target: goal.count };
    }
    case 'townLevel':
      return { value: levelOf(state.towns[goal.town].population), target: goal.level };
    case 'deliver':
      return { value: state.stats.delivered[goal.town]?.[goal.good] ?? 0, target: goal.amount };
    case 'rafts':
      return { value: state.stats.rafts, target: goal.count };
  }
}

export function goalDone(state: GameState, goal: Goal): boolean {
  const p = goalProgress(state, goal);
  return p.value >= p.target;
}
