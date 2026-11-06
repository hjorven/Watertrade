import type { GameState } from './game.ts';

export type GameMode = 'kampagne' | 'frei' | 'herausforderung' | 'tagesmarkt';

export const SAVE_VERSION = 4;
/** Ältere Stände, die sich mit upgradeState() weiterspielen lassen */
const READABLE = [3, 4];

export interface SaveGame {
  version: number;
  savedAt: string; // ISO-Zeit
  mode: GameMode;
  /** Kapitel oder Herausforderung */
  chapter?: string;
  completedGoals: number[];
  /** Spielstunde beim Start, für Zeitlimits */
  startHour?: number;
  /** Tagesmarkt: Kalendertag (UTC) */
  dailyDay?: string;
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
