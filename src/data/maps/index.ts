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

/** Karte eines Spielstands */
export function mapFor(state: { map?: { id: string } }): MapDef {
  return mapById(state.map?.id);
}

export { randomMapId };
