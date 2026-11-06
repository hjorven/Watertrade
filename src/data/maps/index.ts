/**
 * Alle Karten des Spiels. Ein Spielstand merkt sich seine Karte in `state.map`;
 * fehlt das Feld (ältere Stände), spielt er im Tal der zwei Flüsse.
 */
import { playableRandomMap, type RandomMapResult } from '../../sim/mapcheck.ts';
import { randomMapId, seedOfMapId } from './random.ts';
import { VALLEY, type MapDef } from './valley.ts';

/** Feste Karten; weitere Karten tragen sich hier mit ihrer Id ein */
export const MAPS: MapDef[] = [VALLEY];

const randomCache = new Map<number, RandomMapResult>();

/** Zufallskarte mit Prüfbericht des Balance-Bots (siehe sim/mapcheck.ts) */
export function randomMapResult(seed: number): RandomMapResult {
  let r = randomCache.get(seed);
  if (!r) {
    r = playableRandomMap(seed);
    randomCache.set(seed, r);
  }
  return r;
}

/** Spielbare Zufallskarte zu einem Startwert */
export function randomMap(seed: number): MapDef {
  return randomMapResult(seed).map;
}

/** Karte nach Id: feste Karte, Zufallskarte ('zufall-<seed>') oder das Tal */
export function mapById(id?: string): MapDef {
  if (!id) return VALLEY;
  const fixed = MAPS.find((m) => m.id === id);
  if (fixed) return fixed;
  const seed = seedOfMapId(id);
  return seed === null ? VALLEY : randomMap(seed);
}

/** Id der Karte eines Spielstands, ohne die Karte zu erzeugen */
export function mapIdOf(state: { map?: { id: string } }): string {
  return state.map?.id ?? VALLEY.id!;
}

/** Karte eines Spielstands: die mitgespeicherte Zufallskarte, sonst nach Id */
export function mapFor(state: { map?: { id: string; def?: MapDef } }): MapDef {
  return state.map?.def ?? mapById(state.map?.id);
}

/** Passt ein Spielstand zu einer Karte: jede Stadt und jeder Hafen seiner Schiffe liegt auf ihr */
export function stateFitsMap(state: { towns: Record<string, unknown>; ships: { port: string | null }[] }, map: MapDef): boolean {
  const ids = new Set(map.towns.map((t) => t.id));
  return Object.keys(state.towns).every((id) => ids.has(id)) && map.towns.every((t) => t.id in state.towns) && state.ships.every((s) => s.port === null || ids.has(s.port));
}

export { randomMapId };
