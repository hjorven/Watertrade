/**
 * Neue Waren aus Plan 7, soweit sie mehr brauchen als einen Eintrag in den Stadtdaten:
 * - Diesel kommt erst mit der Motorzeit (Epoche 3) in die Märkte.
 * - Baustellen des Wasserbaus verbrauchen Ziegel aus dem Markt der nächsten Stadt.
 * - Alte Spielstände bekommen die Märkte für neue Waren nachgetragen.
 */
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { PROJECT_BY_ID } from '../data/projects.ts';
import { addNews, type GameState, type NewsItem } from './state.ts';
import { initialMarket, marketTarget, needs, STOCK_CAP, tradedGoods } from './towns.ts';

export interface EpochGood {
  good: string;
  epoch: number;
  /** Tonnen pro Tag, die in diesen Städten ankommen (Tanklager am Seehafen) */
  produces: Record<string, number>;
  /** Tonnen pro Tag, die diese Städte selbst verbrauchen (Motoren in Mühlen und Werkstätten) */
  consumes: Record<string, number>;
  /** Meldung im Flussboten, wenn die Ware zum ersten Mal gehandelt wird */
  news: string;
}

export const EPOCH_GOODS: EpochGood[] = [
  {
    good: 'diesel',
    epoch: 3,
    // Städte, die es auf einer Karte nicht gibt, werden übersprungen (Nordhafen und Rußheim nur auf der Karte "Zwei Täler")
    produces: { niedermuend: 10, nordhafen: 8 },
    consumes: { muehlheim: 1.5, kesselbrueck: 1.5, altenfurt: 1, russheim: 1.5 },
    news: 'Tankschiffe von der Küste bringen Diesel in die Seehäfen. Auch die größeren Städte flussaufwärts handeln jetzt damit.',
  },
];

/**
 * Wo eine Epochenware auf dieser Karte erzeugt und verbraucht wird. Kennt die Karte keine der eingetragenen Städte
 * (Zufallskarten), liefert die größte Stadt an, und die drei nächstgrößeren verbrauchen.
 */
export function epochPlaces(eg: EpochGood, map: MapDef): { produces: Record<string, number>; consumes: Record<string, number> } {
  const ids = new Set(map.towns.map((t) => t.id));
  if (Object.keys(eg.produces).some((id) => ids.has(id))) return { produces: eg.produces, consumes: eg.consumes };
  const big = [...map.towns].sort((a, b) => b.population - a.population || a.id.localeCompare(b.id));
  const make = Object.values(eg.produces);
  const use = Object.values(eg.consumes);
  const produces: Record<string, number> = {};
  const consumes: Record<string, number> = {};
  if (big[0] && make.length) produces[big[0].id] = Math.max(...make);
  big.slice(1, 1 + use.length).slice(0, 3).forEach((t, i) => (consumes[t.id] = use[i]));
  return { produces, consumes };
}

/** Ist diese Ware in der aktuellen Epoche schon im Handel? */
export function goodAvailable(state: GameState, good: string): boolean {
  return (GOOD_BY_ID.get(good)?.epoch ?? 1) <= state.epoch;
}

/** Täglich: Waren der neuen Epoche in die Märkte bringen, erzeugen und verbrauchen */
export function tickSupply(state: GameState, map: MapDef): NewsItem[] {
  const out: NewsItem[] = [];
  for (const eg of EPOCH_GOODS) {
    if (state.epoch < eg.epoch) continue;
    let opened = false;
    const places = epochPlaces(eg, map);
    for (const def of map.towns) {
      const make = places.produces[def.id] ?? 0;
      const use = places.consumes[def.id] ?? 0;
      if (!make && !use) continue;
      const market = state.markets[def.id];
      const target = marketTarget(def, state.towns[def.id]);
      let m = market[eg.good];
      if (!m) {
        m = market[eg.good] = { good: eg.good, stock: target * (make ? 1.6 : 0.7), target };
        opened = true;
      }
      if (make) m.stock = Math.min(target * STOCK_CAP, m.stock + make);
      // wie bei der Bevölkerung: bei Knappheit wird weniger verbraucht
      if (use) m.stock = Math.max(0, m.stock - use * Math.min(1.5, m.stock / Math.max(1, m.target)));
    }
    if (opened) out.push(addNews(state, 'ereignis', eg.news));
  }
  return out;
}

/**
 * Ziegel je Bautag nach Art des Wasserbaus. Ausbaggern braucht keine, unbekannte Arten (Pegel, Leuchtfeuer) wenig.
 * Die Mengen liegen über dem, was das Umland einer Stadt am Tag nachliefert, damit Lieferungen spürbar helfen.
 */
export const BRICKS_PER_DAY: Record<string, number> = { schleuse: 8, bruecke: 7, kanal: 8, vertiefung: 0 };
export const BRICKS_DEFAULT = 2;
/** Ohne Ziegel ruht die Baustelle, aber höchstens um diesen Anteil der Bauzeit */
export const BRICK_DELAY_MAX = 0.5;

/** Stadt, deren Markt eine Baustelle mit Ziegeln versorgt: die am Abschnitt mit Ziegelhandel, sonst die untere */
export function siteTown(state: GameState, map: MapDef, projectId: string): string | null {
  const p = PROJECT_BY_ID.get(projectId);
  const seg = p && map.segments.find((s) => s.id === p.seg);
  if (!seg) return null;
  const ends = [seg.from, seg.to].filter((t) => state.markets[t]);
  const withBricks = ends.filter((t) => state.markets[t].ziegel);
  if (withBricks.length) return withBricks.sort((a, b) => state.markets[b].ziegel.stock - state.markets[a].ziegel.stock)[0];
  return ends[ends.length - 1] ?? null;
}

export function bricksPerDay(projectId: string): number {
  const p = PROJECT_BY_ID.get(projectId);
  if (!p) return 0;
  return BRICKS_PER_DAY[p.kind] ?? BRICKS_DEFAULT;
}

/**
 * Täglich: Jede Baustelle nimmt ihre Ziegel vom Markt der Stadt am Abschnitt, so viele da sind.
 * Was fehlt, sammelt sich als Rückstand; je voller Tag Rückstand ruht der Bau einen Tag
 * (bis zur Grenze BRICK_DELAY_MAX). Wer Ziegel liefert, baut schneller.
 */
export function tickBuildSites(state: GameState, map: MapDef): NewsItem[] {
  const out: NewsItem[] = [];
  const sites = new Set<string>();
  for (const w of state.works ?? []) {
    if (w.done) continue;
    const p = PROJECT_BY_ID.get(w.id);
    const need = bricksPerDay(w.id);
    const town = siteTown(state, map, w.id);
    if (!p || !need || !town) continue;
    sites.add(town);
    const def = map.towns.find((t) => t.id === town)!;
    // eine Baustelle schafft Nachfrage, auch wo bisher niemand Ziegel handelt
    const m = (state.markets[town].ziegel ??= { good: 'ziegel', stock: 0, target: marketTarget(def, state.towns[town]) });
    const got = Math.min(need, Math.max(0, m.stock));
    m.stock -= got;
    const cap = Math.ceil(p.days * BRICK_DELAY_MAX);
    if ((w.brickDelay ?? 0) >= cap) continue;
    w.brickShort = (w.brickShort ?? 0) + (need - got) / need;
    while (w.brickShort >= 1 && (w.brickDelay ?? 0) < cap) {
      if (!w.brickDelay) out.push(addNews(state, 'haus', `${p.name}: Die Baustelle wartet auf Ziegel aus ${def.name}. Jede Lieferung dorthin beschleunigt den Bau.`));
      w.brickShort -= 1;
      w.brickDelay = (w.brickDelay ?? 0) + 1;
      w.started += 1;
    }
  }
  // Ziegelmärkte, die nur für eine Baustelle entstanden sind, schließen danach wieder
  for (const def of map.towns) {
    if (sites.has(def.id) || !state.markets[def.id]?.ziegel) continue;
    if (tradedGoods(def).includes('ziegel') || needs(def, state.towns[def.id]).ziegel) continue;
    delete state.markets[def.id].ziegel;
  }
  return out;
}

/** Alte Spielstände: Märkte für Waren nachtragen, die eine Stadt inzwischen handelt */
export function addMissingMarkets(state: GameState, map: MapDef): void {
  for (const def of map.towns) {
    const market = state.markets[def.id];
    const town = state.towns[def.id];
    if (!market || !town) continue;
    const fresh = initialMarket(def, town);
    for (const [g, m] of Object.entries(fresh)) market[g] ??= m;
  }
  // Diesel legt tickSupply am nächsten Tag an, wenn der Spielstand schon in der Motorzeit ist
}
