import type { MapDef, SegmentDef } from '../data/maps/valley.ts';
import { PROJECT_BY_ID, PROJECTS, type ProjectDef } from '../data/projects.ts';
import { addNews, day, fail, type GameState, type NewsItem, type TradeResult, type WorkPartner } from './state.ts';

/** Abschnitte mit allen fertigen Wasserbauten */
const cache = new WeakMap<MapDef, { key: string; segs: SegmentDef[] }>();

export function effectiveSegments(state: GameState, map: MapDef): SegmentDef[] {
  const finished = (state.works ?? []).filter((w) => w.done);
  const gated = map.segments.some((s) => s.requires);
  if (!finished.length && !gated) return map.segments;
  // Verlandung mindert die zusätzliche Tiefe; im Schlüssel auf Prozent gerundet, damit der Zwischenspeicher hält
  const silt = new Map(finished.map((w) => [w.id, Math.round(Math.min(1, Math.max(0, w.silt ?? 0)) * 100) / 100]));
  const done = finished.map((w) => w.id);
  const key = finished.map((w) => (silt.get(w.id) ? `${w.id}~${silt.get(w.id)}` : w.id)).join(',');
  const hit = cache.get(map);
  if (hit && hit.key === key) return hit.segs;
  // Abschnitte wie ein Kanal existieren erst, wenn ihr Bauvorhaben fertig ist
  const segs = map.segments.filter((seg) => !seg.requires || done.includes(seg.requires)).map((seg) => {
    const s: SegmentDef = { ...seg };
    for (const id of done) {
      const p = PROJECT_BY_ID.get(id);
      if (!p || p.seg !== seg.id) continue;
      if (p.effect.depth) s.baseDepth += p.effect.depth * (1 - (silt.get(id) ?? 0));
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

/** Bauvorhaben beginnen. Mit Partner (Gemeinschaftsbau) zahlt der Spieler nur seinen Anteil. */
export function startProject(state: GameState, id: string, partner?: WorkPartner): TradeResult {
  const p = PROJECT_BY_ID.get(id);
  if (!p) return fail('Unbekanntes Bauvorhaben.');
  if (p.epoch > state.epoch) return fail('Dafür fehlt noch die Technik.');
  if (state.works.some((w) => w.id === id)) return fail('Schon in Arbeit.');
  const cost = partner ? Math.round(p.cost * (1 - partner.share)) : p.cost;
  if (state.money < cost) return fail(`${p.name} kostet ${cost} Taler.`);
  state.money -= cost;
  state.works.push({ id, started: day(state), done: false, owner: 'spieler', fee: 'normal', upkeep: p.kind === 'vertiefung', partner });
  addNews(state, 'haus', `Baubeginn: ${p.name}. Fertig in ${p.days} Tagen.`);
  return { ok: true, message: `${p.name}: Die Arbeiten beginnen.`, amount: 0, taler: cost };
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

/**
 * Städte, die von den Ausgangsstädten über vorhandene Abschnitte erreichbar sind (ohne Rücksicht
 * auf Wasserstand oder Schiffstyp). Auf Karten ohne gesperrte Abschnitte (z. B. ein Kanal, der erst
 * gebaut wird) hängt alles zusammen, dann kommen alle Städte zurück.
 */
export function connectedTowns(state: GameState, map: MapDef, from: Iterable<string>): Set<string> {
  if (!map.segments.some((s) => s.requires)) return new Set(map.towns.map((t) => t.id));
  const segs = effectiveSegments(state, map);
  const seen = new Set<string>(from);
  const queue = [...seen];
  while (queue.length) {
    const node = queue.pop()!;
    for (const s of segs) {
      const next = s.from === node ? s.to : s.to === node ? s.from : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Häfen, an denen der Spieler etwas hat: Schiffe (auch Fahrtziele) und Kontore */
export function playerTowns(state: GameState): string[] {
  const out = new Set<string>(Object.keys(state.kontore));
  for (const s of state.ships) {
    if (s.port) out.add(s.port);
    if (s.voyage) out.add(s.voyage.to);
  }
  return [...out];
}
