export interface Segment {
  id: string;
  from: string; // oberer Knoten
  to: string; // unterer Knoten (flussabwärts)
  length: number; // km
  current: number; // Strömung in km/h
  baseDepth: number; // Tiefe bei Normalwasser in m
  bridgeHeight?: number; // Durchfahrtshöhe bei Normalwasser in m
}

export interface ShipType {
  id: string;
  name: string;
  speed: number; // Eigengeschwindigkeit in km/h
  draft: number; // Tiefgang in m
  height: number; // Höhe über Wasser in m
  capacity: number; // Ladung in Tonnen
  canGoUpstream: boolean; // Floß: false
}

/** Mindestgeschwindigkeit über Grund, darunter gilt ein Abschnitt als nicht befahrbar */
const MIN_GROUND_SPEED = 0.5;

/** Fahrzeit in Stunden oder null, wenn der Abschnitt nicht befahrbar ist */
export function travelTime(
  seg: Segment,
  ship: ShipType,
  downstream: boolean,
  waterLevel: number, // Abweichung vom Normalwasser in m, z. B. -0.8 im Sommer
): number | null {
  if (!downstream && !ship.canGoUpstream) return null;

  const depth = seg.baseDepth + waterLevel;
  if (depth < ship.draft) return null;

  // Hochwasser verringert die Durchfahrtshöhe unter Brücken
  if (seg.bridgeHeight !== undefined && seg.bridgeHeight - waterLevel < ship.height) {
    return null;
  }

  const v = groundSpeed(seg, ship, downstream);
  if (v <= MIN_GROUND_SPEED) return null;

  return seg.length / v;
}

/** Geschwindigkeit über Grund in km/h */
export function groundSpeed(seg: Segment, ship: ShipType, downstream: boolean): number {
  return downstream ? ship.speed + seg.current : ship.speed - seg.current;
}

/** Schnellste Route (Dijkstra) als Liste von Abschnitts-IDs */
export function findRoute(
  segments: Segment[],
  start: string,
  goal: string,
  ship: ShipType,
  waterLevel: number,
): { path: string[]; hours: number } | null {
  type Edge = { to: string; hours: number; seg: string };
  const adj = new Map<string, Edge[]>();

  const add = (a: string, b: string, hours: number | null, seg: string) => {
    if (hours === null) return;
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, hours, seg });
  };

  for (const s of segments) {
    add(s.from, s.to, travelTime(s, ship, true, waterLevel), s.id);
    add(s.to, s.from, travelTime(s, ship, false, waterLevel), s.id);
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
