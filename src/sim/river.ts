export interface Segment {
  id: string;
  from: string; // oberer Knoten
  to: string; // unterer Knoten (flussabwärts)
  length: number; // km
  current: number; // Strömung in km/h
  baseDepth: number; // Tiefe bei Normalwasser in m
  bridgeHeight?: number; // Durchfahrtshöhe bei Normalwasser in m
  freezes?: boolean; // friert im Winter zu
}

/** Lage am Fluss: Wasserstand relativ zum Normalwasser in m und ob Eis auf den Nebenflüssen liegt */
export interface Conditions {
  level: number;
  ice?: boolean;
}

const asCond = (c: number | Conditions): Conditions => (typeof c === 'number' ? { level: c } : c);

/** Hochwasser macht die Strömung schneller */
export function effectiveCurrent(seg: Segment, c: number | Conditions): number {
  const { level } = asCond(c);
  return seg.current * (1 + Math.max(0, level) * 0.35);
}

export type Propulsion = 'drift' | 'tow' | 'sail';

export interface ShipType {
  id: string;
  name: string;
  propulsion: Propulsion; // treiben, treideln/staken, segeln
  speed: number; // Eigengeschwindigkeit in km/h (Segel: bei gutem Wind)
  draft: number; // Tiefgang in m
  height: number; // Höhe über Wasser in m
  capacity: number; // Ladung in Tonnen
  canGoUpstream: boolean; // Floß: false
}

/** Mindestgeschwindigkeit über Grund, darunter gilt ein Abschnitt als nicht befahrbar */
const MIN_GROUND_SPEED = 0.5;

export type BlockReason = 'nurTalwaerts' | 'tiefgang' | 'bruecke' | 'stroemung' | 'eis';

export const BLOCK_TEXT: Record<BlockReason, string> = {
  eis: 'zugefroren',
  nurTalwaerts: 'fährt nur talwärts',
  tiefgang: 'zu seicht für den Tiefgang',
  bruecke: 'passt nicht unter die Brücke',
  stroemung: 'kommt gegen die Strömung nicht an',
};

/** Warum ein Schiff einen Abschnitt nicht befahren kann, oder null */
export function blockReason(
  seg: Segment,
  ship: ShipType,
  downstream: boolean,
  conditions: number | Conditions,
): BlockReason | null {
  const c = asCond(conditions);
  if (c.ice && seg.freezes) return 'eis';
  if (!downstream && !ship.canGoUpstream) return 'nurTalwaerts';
  if (seg.baseDepth + c.level < ship.draft) return 'tiefgang';
  // Hochwasser verringert die Durchfahrtshöhe unter Brücken
  if (seg.bridgeHeight !== undefined && seg.bridgeHeight - c.level < ship.height) return 'bruecke';
  if (groundSpeed(seg, ship, downstream, c) <= MIN_GROUND_SPEED) return 'stroemung';
  return null;
}

/** Fahrzeit in Stunden oder null, wenn der Abschnitt nicht befahrbar ist */
export function travelTime(
  seg: Segment,
  ship: ShipType,
  downstream: boolean,
  conditions: number | Conditions, // Wasserstand als Abweichung vom Normalwasser in m, z. B. -0.8 im Sommer
): number | null {
  if (blockReason(seg, ship, downstream, conditions)) return null;
  return seg.length / groundSpeed(seg, ship, downstream, conditions);
}

/** Segelschiffe hängen vom Wind ab (0 = Flaute, 1 = guter Wind), alle anderen nicht */
export function withWind<T extends ShipType>(ship: T, wind: number): T {
  if (ship.propulsion !== 'sail') return ship;
  // auch bei Flaute bleibt etwas Fahrt durch Staken und Treiben
  return { ...ship, speed: Math.max(1.5, ship.speed * wind) };
}

/** Wind des Tages, deterministisch aus der Tagesnummer, zwischen 0.25 und 1.25 */
export function windOfDay(day: number): number {
  const x = Math.sin(day * 12.9898 + 78.233) * 43758.5453;
  const r = x - Math.floor(x);
  const y = Math.sin(day * 0.45) * 0.5 + 0.5; // Wetterlagen über mehrere Tage
  return 0.25 + (r * 0.4 + y * 0.6);
}

/** Geschwindigkeit über Grund in km/h */
export function groundSpeed(seg: Segment, ship: ShipType, downstream: boolean, conditions: number | Conditions = 0): number {
  const current = effectiveCurrent(seg, conditions);
  return downstream ? ship.speed + current : ship.speed - current;
}

/**
 * Weg durch das Netz ohne Rücksicht auf Sperren (nach Länge), um Sperrgründe zu erklären.
 * Gibt je Abschnitt Richtung und Grund zurück.
 */
export function explainBlock(
  segments: Segment[],
  start: string,
  goal: string,
  ship: ShipType,
  conditions: number | Conditions,
): { seg: Segment; reason: BlockReason }[] {
  const anyShip: ShipType = { ...ship, propulsion: 'tow', speed: 1000, draft: 0, height: 0, canGoUpstream: true };
  const route = findRoute(
    segments.map((s) => ({ ...s, current: 0 })),
    start,
    goal,
    anyShip,
    0,
  );
  if (!route) return [];
  const out: { seg: Segment; reason: BlockReason }[] = [];
  let node = start;
  for (const id of route.path) {
    const seg = segments.find((s) => s.id === id)!;
    const downstream = seg.from === node;
    const reason = blockReason(seg, ship, downstream, conditions);
    if (reason) out.push({ seg, reason });
    node = downstream ? seg.to : seg.from;
  }
  return out;
}

/** Schnellste Route (Dijkstra) als Liste von Abschnitts-IDs */
export function findRoute(
  segments: Segment[],
  start: string,
  goal: string,
  ship: ShipType,
  conditions: number | Conditions,
): { path: string[]; hours: number } | null {
  type Edge = { to: string; hours: number; seg: string };
  const adj = new Map<string, Edge[]>();

  const add = (a: string, b: string, hours: number | null, seg: string) => {
    if (hours === null) return;
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, hours, seg });
  };

  for (const s of segments) {
    add(s.from, s.to, travelTime(s, ship, true, conditions), s.id);
    add(s.to, s.from, travelTime(s, ship, false, conditions), s.id);
  }

  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, { node: string; seg: string }>();
  const open = new Set<string>([start]);
  const done = new Set<string>();

  while (open.size > 0) {
    let node = '';
    let best = Infinity;
    for (const n of open) {
      const d = dist.get(n)!;
      if (d < best) {
        best = d;
        node = n;
      }
    }
    open.delete(node);
    done.add(node);
    if (node === goal) break;

    for (const e of adj.get(node) ?? []) {
      if (done.has(e.to)) continue;
      const nd = best + e.hours;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { node, seg: e.seg });
        open.add(e.to);
      }
    }
  }

  if (!dist.has(goal)) return null;

  const path: string[] = [];
  let cur = goal;
  while (cur !== start) {
    const p = prev.get(cur)!;
    path.unshift(p.seg);
    cur = p.node;
  }
  return { path, hours: dist.get(goal)! };
}
