import type { MapDef, SegmentDef } from '../data/maps/valley.ts';
import { PROJECT_BY_ID, PROJECTS, type ProjectDef } from '../data/projects.ts';
import { addNews, day, fail, type GameState, type NewsItem, type TradeResult } from './state.ts';

/** Abschnitte mit allen fertigen Wasserbauten */
const cache = new WeakMap<MapDef, { key: string; segs: SegmentDef[] }>();

export function effectiveSegments(state: GameState, map: MapDef): SegmentDef[] {
  const done = (state.works ?? []).filter((w) => w.done).map((w) => w.id);
  if (!done.length) return map.segments;
  const key = done.join(',');
  const hit = cache.get(map);
  if (hit && hit.key === key) return hit.segs;
  const segs = map.segments.map((seg) => {
    const s: SegmentDef = { ...seg };
    for (const id of done) {
      const p = PROJECT_BY_ID.get(id);
      if (!p || p.seg !== seg.id) continue;
      if (p.effect.depth) s.baseDepth += p.effect.depth;
      if (p.effect.current) s.current = Math.max(0.3, s.current + p.effect.current);
      if (p.effect.bridgeHeight !== undefined) s.bridgeHeight = p.effect.bridgeHeight;
      if (p.effect.iceFree) s.freezes = false;
    }
    return s;
  });
  cache.set(map, { key, segs });
  return segs;
}

export function projectState(state: GameState, id: string): 'offen' | 'bau' | 'fertig' {
  const w = state.works.find((x) => x.id === id);
  return !w ? 'offen' : w.done ? 'fertig' : 'bau';
}

export function availableProjects(state: GameState): ProjectDef[] {
  return PROJECTS.filter((p) => p.epoch <= state.epoch);
}

export function startProject(state: GameState, id: string): TradeResult {
  const p = PROJECT_BY_ID.get(id);
  if (!p) return fail('Unbekanntes Bauvorhaben.');
  if (p.epoch > state.epoch) return fail('Dafür fehlt noch die Technik.');
  if (state.works.some((w) => w.id === id)) return fail('Schon in Arbeit.');
  if (state.money < p.cost) return fail(`${p.name} kostet ${p.cost} Taler.`);
  state.money -= p.cost;
  state.works.push({ id, started: day(state), done: false });
  addNews(state, 'haus', `Baubeginn: ${p.name}. Fertig in ${p.days} Tagen.`);
  return { ok: true, message: `${p.name}: Die Arbeiten beginnen.`, amount: 0, taler: p.cost };
}

export function daysLeft(state: GameState, id: string): number {
  const w = state.works.find((x) => x.id === id);
  const p = PROJECT_BY_ID.get(id);
  if (!w || !p || w.done) return 0;
  return Math.max(0, w.started + p.days - day(state));
}

/** Täglich: Baustellen fertigstellen */
export function tickWorks(state: GameState, map: MapDef): NewsItem[] {
  const out: NewsItem[] = [];
  for (const w of state.works) {
    if (w.done) continue;
    const p = PROJECT_BY_ID.get(w.id);
    if (!p || day(state) < w.started + p.days) continue;
    w.done = true;
    const seg = map.segments.find((s) => s.id === p.seg);
    void seg;
    out.push(addNews(state, 'ereignis', `Eingeweiht: ${p.name}. ${p.text}`));
  }
  return out;
}

/** Anzahl fertiger Pegelstationen: eine kündigt Hochwasser und Dürre an, ab zwei mit genauem Tag und Pegel */
export function gaugeCount(state: GameState): number {
  return (state.works ?? []).filter((w) => w.done && PROJECT_BY_ID.get(w.id)?.effect.gauge).length;
}

/** Abschnitte mit fertigem Leuchtfeuer, für die Nachtfahrt */
export function litSegments(state: GameState): string[] {
  return (state.works ?? []).filter((w) => w.done && PROJECT_BY_ID.get(w.id)?.effect.light).map((w) => PROJECT_BY_ID.get(w.id)!.seg);
}
