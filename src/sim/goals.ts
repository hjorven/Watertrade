import type { Goal } from '../data/campaign.ts';
import type { GameState } from './game.ts';
import { canalStagesDone } from './canal.ts';
import { playerWorth } from './house.ts';
import { rivalWorth } from './rivals.ts';
import { steamDays } from './steam.ts';
import { levelOf } from './towns.ts';

/** Fortschritt eines Ziels: aktueller Wert und Zielwert */
export function goalProgress(state: GameState, goal: Goal): { value: number; target: number } {
  switch (goal.type) {
    case 'profit':
      return { value: state.firstProfitDone ? 1 : 0, target: 1 };
    case 'money':
      // Schulden bei der Stadtbank zählen dagegen, sonst ließe sich das Ziel mit einem Kredit erfüllen
      return { value: state.money - (state.finance?.loans ?? []).reduce((s, l) => s + l.remaining, 0), target: goal.amount };
    case 'ships': {
      const n = state.ships.filter((s) => !goal.shipType || s.type === goal.shipType).length;
      return { value: n, target: goal.count };
    }
    case 'townLevel':
      return { value: levelOf(state.towns[goal.town].population), target: goal.level };
    case 'supply':
      return { value: Math.floor(state.towns[goal.town].satisfaction * 100), target: goal.percent };
    case 'steamDays':
      return { value: steamDays(state), target: goal.days };
    case 'deliver':
      return { value: netDelivered(state, goal.town, goal.good), target: goal.amount };
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
    case 'share': {
      // eigene Tonnen gegen die nötige Menge: so viel, dass der eigene Anteil mindestens percent erreicht
      const mine = soldBy(state, goal.good);
      const theirs = state.stats.rivalSold?.[goal.good] ?? 0;
      const p = Math.min(99, Math.max(1, goal.percent)) / 100;
      return { value: mine, target: Math.max(goal.min, Math.ceil((theirs * p) / (1 - p))) };
    }
    case 'allTowns': {
      const n = Object.values(state.towns).filter((t) => levelOf(t.population) >= goal.level).length;
      return { value: n, target: Object.keys(state.towns).length };
    }
    case 'takeover':
      return { value: (state.housesGone ?? []).filter((h) => h.how === 'uebernahme').length, target: goal.count };
    case 'canalStage':
      return { value: canalStagesDone(state), target: goal.stage };
  }
}

/**
 * In eine Stadt gebrachte Tonnen: dort verkauft, abzüglich dessen, was kurz vorher dort gekauft wurde.
 * Sonst ließe sich ein Lieferziel im Hafen durch Kaufen und sofortiges Zurückverkaufen erfüllen.
 */
export function netDelivered(state: GameState, town: string, good: string): number {
  const sold = state.stats.delivered[town]?.[good] ?? 0;
  return Math.max(0, sold - (state.stats.resold?.[town]?.[good] ?? 0));
}

/** Vom Spieler insgesamt an andere Orte gebrachte und dort verkaufte Tonnen einer Ware */
export function soldBy(state: GameState, good: string): number {
  return Object.keys(state.stats.delivered).reduce((sum, town) => sum + netDelivered(state, town, good), 0);
}

export function goalDone(state: GameState, goal: Goal): boolean {
  const p = goalProgress(state, goal);
  return p.value >= p.target;
}

/**
 * Erfüllte Ziele aus einem Spielstand wiederherstellen. Neuere Stände merken sich die Zieltexte,
 * so passen sie auch nach einer Überarbeitung des Kapitels. Ältere Stände kennen nur Nummern:
 * Dann zählt ein Ziel nur, wenn es jetzt erfüllt ist, sonst hakt eine alte Nummer das falsche Ziel ab.
 */
export function restoreCompleted(state: GameState, goals: Goal[], indices: number[], texts?: string[]): Set<number> {
  const out = new Set<number>();
  goals.forEach((g, i) => {
    if (texts ? texts.includes(g.text) : indices.includes(i) && goalDone(state, g)) out.add(i);
  });
  return out;
}
