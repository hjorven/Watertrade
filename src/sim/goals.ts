import type { Goal } from '../data/campaign.ts';
import type { GameState } from './game.ts';
import { playerWorth } from './house.ts';
import { rivalWorth } from './rivals.ts';
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
    case 'kontore':
      return { value: Object.keys(state.kontore).length, target: goal.count };
    case 'betriebe':
      return { value: state.betriebe.filter((b) => b.active).length, target: goal.count };
    case 'contracts':
      return { value: state.stats.contracts, target: goal.count };
    case 'worth':
      return { value: playerWorth(state), target: goal.amount };
    case 'rank': {
      const mine = playerWorth(state);
      const place = 1 + state.rivals.filter((r) => rivalWorth(r) > mine).length;
      // umgedreht, damit "Wert >= Ziel" auch hier "erfüllt" heißt
      return { value: place <= goal.place ? 1 : 0, target: 1 };
    }
    case 'project':
      return { value: state.works.some((w) => w.id === goal.id && w.done) ? 1 : 0, target: 1 };
    case 'routes':
      return { value: state.ships.filter((s) => s.route?.active && s.captain).length, target: goal.count };
    case 'allTowns': {
      const n = Object.values(state.towns).filter((t) => levelOf(t.population) >= goal.level).length;
      return { value: n, target: Object.keys(state.towns).length };
    }
    case 'takeover':
      return { value: (state.housesGone ?? []).filter((h) => h.how === 'uebernahme').length, target: goal.count };
  }
}

export function goalDone(state: GameState, goal: Goal): boolean {
  const p = goalProgress(state, goal);
  return p.value >= p.target;
}
