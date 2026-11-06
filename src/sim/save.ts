import type { GameState } from './game.ts';

export const SAVE_VERSION = 4;
/** Ältere Stände, die sich mit upgradeState() weiterspielen lassen */
const READABLE = [3, 4];

export interface SaveGame {
  version: number;
  savedAt: string; // ISO-Zeit
  mode: 'kampagne' | 'frei';
  chapter?: string;
  completedGoals: number[];
  state: GameState;
}

export function serialize(save: SaveGame): string {
  // Infinity kommt im Spielstand nicht vor, JSON reicht
  return JSON.stringify(save);
}

export function deserialize(text: string): SaveGame | null {
  try {
    const data = JSON.parse(text) as SaveGame;
    if (!READABLE.includes(data.version)) return null;
    const s = data.state;
    if (!s || typeof s.money !== 'number' || !Array.isArray(s.ships) || !s.markets || !s.towns) return null;
    return data;
  } catch {
    return null;
  }
}
