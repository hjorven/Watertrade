import * as THREE from 'three';
import type { RiverDef } from '../data/maps/valley.ts';
import type { Season } from '../sim/calendar.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CANAL_BANK, CANAL_BED, CANAL_TOWPATH, CANAL_TRENCH, CanalView } from './canalview.ts';

/** Größe des Dioramas in Welteinheiten (1 Einheit ≈ 0,5 km, nur optisch); Vorgabe für das Tal */
export const WORLD_W = 220;
export const WORLD_D = 140;

/** Ausdehnung einer Karte; fehlt sie in der Karte, gilt das Tal */
export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export const VALLEY_BOUNDS: WorldBounds = { minX: -WORLD_W / 2, maxX: WORLD_W / 2, minZ: -WORLD_D / 2, maxZ: WORLD_D / 2 };

/** Fluss oder Kanal (das Feld `canal` kommt mit der Kanalkarte) */
type RiverLike = RiverDef & { canal?: boolean };

/** Fortschritt des Kanalbaus, wie ihn canalProgress liefert (Stufen 0 bis 3, dann fertig) */
export interface CanalBuild {
  stage: number;
  stageShare: number;
  done: boolean;
}

/** Ein Stützpunkt entlang eines Kanals: Lage, Richtung und Wasserspiegel der Haltung */
export interface CanalPoint {
  x: number;
  z: number;
  /** Richtung (Einheitsvektor) in der Ebene */
  dx: number;
  dz: number;
  /** 0 am Anfang, 1 am Ende */
  s: number;
  /** Höhe des Wasserspiegels dieser Haltung */
  level: number;
  /** Über die Nachbarn gemittelter Spiegel, damit die Böschungen an Schleusen keine Stufe bekommen */
  soft: number;
}

export interface CanalLine {
  river: string;
  halfWidth: number;
  points: CanalPoint[];
  /** Indizes der Punkte, an denen eine Schleuse liegt (Haltungswechsel) */
  locks: number[];
}

/** Halbe Breite des Hauptstroms; schmalere Flüsse werden auf dieses Maß umgerechnet */
export const RIVER_HALF_WIDTH = 3.6;
const BASE_Y = -7;
/** Abstand der Uferlinie (Wasser trifft Böschung) jenseits der nominellen Flussbreite */
const SHORE = 1.05;

type Cat = 'bed' | 'sand' | 'field' | 'fieldAlt' | 'meadow' | 'meadowDark' | 'forest' | 'rock' | 'snow' | 'path';
const CATS: Cat[] = ['bed', 'sand', 'field', 'fieldAlt', 'meadow', 'meadowDark', 'forest', 'rock', 'snow', 'path'];

/** Feste Palette je Jahreszeit: Frühling frisch, Sommer golden, Herbst rostig, Winter verschneit */
const SEASON_PALETTE: Record<Season, Record<Cat, number>> = {
  fruehling: {
    bed: 0x6b6248, sand: 0xd8c38f, field: 0x9cc05a, fieldAlt: 0xd8cf55, meadow: 0x8fc45a, meadowDark: 0x6fa548,
    forest: 0x4f7a3a, rock: 0x9a8f7e, snow: 0xf2efe6, path: 0xb89c6c,
  },
  sommer: {
    bed: 0x6b6248, sand: 0xe0c98f, field: 0xe3bf58, fieldAlt: 0xb39a52, meadow: 0xa8b85a, meadowDark: 0x8aa04a,
    forest: 0x4a7034, rock: 0xa0927c, snow: 0xe9e4da, path: 0xc4a874,
  },
  herbst: {
    bed: 0x6b6248, sand: 0xcdb487, field: 0x9a7448, fieldAlt: 0x6e5338, meadow: 0xb0a65a, meadowDark: 0x97884a,
    forest: 0x7f6a34, rock: 0x948a7a, snow: 0xf2efe6, path: 0xa58a62,
  },
  winter: {
    bed: 0x6b6248, sand: 0xd7d9d4, field: 0xe6e8e4, fieldAlt: 0xe1e4e0, meadow: 0xe9ece8, meadowDark: 0xdfe4e2,
    forest: 0xc2ccc4, rock: 0xb4b6b2, snow: 0xf7f8f6, path: 0xcfccc2,
  },
};

/** Kronenfarben: Nadelbäume bleiben grün, Laubbäume färben sich */
const CONIFER: Record<Season, number[]> = {
  fruehling: [0x3f6b34, 0x4c7d3a, 0x2f5a2e],
  sommer: [0x365f2e, 0x41702f, 0x2a5228],
  herbst: [0x3a6232, 0x45703a, 0x2f5a2e],
  winter: [0x6f8a78, 0x7e9786, 0x5f7a68],
};
const BROADLEAF: Record<Season, number[]> = {
  fruehling: [0x86c04f, 0x9bd060, 0x74b049, 0xa6c86a],
  sommer: [0x5f9a3c, 0x6fa842, 0x538a36, 0x7aa64a],
  herbst: [0xd08a2e, 0xc2562a, 0xe0b040, 0xa8682a],
  winter: [0x8a7a68, 0x9a8a78, 0x7a6a5a, 0x8f8070],
};
const BIRCH: Record<Season, number[]> = {
  fruehling: [0xa8d468, 0xb8dc78],
  sommer: [0x8cbc52, 0x9cc65e],
  herbst: [0xe8c440, 0xf0d060],
  winter: [0xa89a88, 0xb0a492],
};
const BUSH: Record<Season, number[]> = {
  fruehling: [0x5f9a3c, 0x6faa44, 0x7cb850],
  sommer: [0x4f8434, 0x5a8f3a, 0x67983e],
  herbst: [0xa0582a, 0x8a6a30, 0xb07a34],
  winter: [0x7a6c5c, 0x6e6252, 0x857868],
};
const REED: Record<Season, number[]> = {
  fruehling: [0x7aa84a, 0x8ab654],
  sommer: [0x8a9a48, 0x9aa850],
  herbst: [0xb09a5a, 0xa48a4a],
  winter: [0xc8bc9a, 0xbcae8a],
};
const ROCK: Record<Season, number[]> = {
  fruehling: [0x8f877a, 0x9a9284, 0x7f786c],
  sommer: [0x948b7c, 0xa09684, 0x847c6e],
  herbst: [0x8a8274, 0x958c7c, 0x7a7266],
  winter: [0xb8bab6, 0xc4c6c2, 0xaeb0ac],
};

const PLINTH = 0x5a3d26;

const WATER: Record<Season, number> = { fruehling: 0x4a8aa0, sommer: 0x3f86a3, herbst: 0x3d7a8e, winter: 0x5f8596 };

/** Deterministischer Zufall, damit die Landschaft bei jedem Start gleich aussieht */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weiches Rauschen aus überlagerten Sinuswellen, reicht für sanfte Hügel */
function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.051 + 1.3) * Math.cos(z * 0.063 - 0.7) * 0.5 +
    Math.sin(x * 0.13 - z * 0.09 + 2.1) * 0.3 +
    Math.sin(x * 0.29 + z * 0.31) * 0.12 +
    Math.cos(x * 0.61 - z * 0.53) * 0.06
  );
}

/** Ganzzahl-Hash nach [0, 1) */
function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Wertrauschen mit weicher Interpolation, Ergebnis in [0, 1] */
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function fbm(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x, z) * amp;
    norm += amp;
    amp *= 0.5;
    x = x * 2.03 + 17.1;
    z = z * 2.03 - 9.7;
  }
  return sum / norm;
}

/** Gratrauschen: scharfe Kämme für Bergrücken, Ergebnis in [0, 1] */
function ridged(x: number, z: number): number {
  let sum = 0;
  let amp = 0.6;
  for (let i = 0; i < 3; i++) {
    const n = 1 - Math.abs(vnoise(x, z) * 2 - 1);
    sum += n * n * amp;
    amp *= 0.45;
    x = x * 2.1 + 5.3;
    z = z * 2.1 + 11.9;
  }
  return Math.min(1, sum / 0.93);
}

interface RiverSample {
  p: THREE.Vector3;
  /** Ufernormale rechts in Fließrichtung */
  n: THREE.Vector3;
  river: RiverDef;
  t: number;
  /** Flusssystem (Hauptfluss samt Nebenflüssen), für die Wasserscheide zwischen getrennten Tälern */
  system: number;
}

const SAMPLE_CELL = 12;

interface Decor {
  mesh: THREE.InstancedMesh;
  table: Record<Season, number[]>;
  shade: number[];
}

export class Landscape {
  readonly group = new THREE.Group();
  readonly curves = new Map<string, THREE.CatmullRomCurve3>();
  private readonly rivers: RiverDef[];
  private readonly samples: RiverSample[] = [];
  private ripples!: THREE.InstancedMesh;
  private water!: THREE.Mesh;
  private shore!: THREE.Mesh;
  private waterY = -0.05;
  private terrainCats!: Uint8Array;
  /** Höhen des Geländenetzes, für surfaceAt */
  private grid: { heights: Float32Array; segX: number; segZ: number } | null = null;
  private terrainShade!: Float32Array;
  private terrainColors!: THREE.BufferAttribute;
  private readonly decor: Decor[] = [];
  private ice!: THREE.InstancedMesh;
  private readonly iceState: { river: string; t: number; offset: number; rot: number; size: number }[] = [];
  private iceAmount = 0;
  private iceDrift = false;
  private paletteKey = '';
  private readonly rippleState: { river: string; t: number; offset: number; speed: number; len: number }[] = [];
  private readonly dummy = new THREE.Object3D();

  private readonly townSpots: { pos: THREE.Vector3; radius: number; fields: boolean }[] = [];

  /** Ausdehnung der Kartenplatte */
  readonly bounds: WorldBounds;
  /** Breite (x) und Tiefe (z) der Platte, Mittelpunkt */
  readonly width: number;
  readonly depth: number;
  readonly centerX: number;
  readonly centerZ: number;
  /** Gemauerte Kanäle mit ihren Haltungen */
  readonly canals: CanalLine[] = [];
  /** Flussproben in Zellen, damit riverInfo nicht alle Proben durchgehen muss */
  private readonly cells = new Map<number, RiverSample[]>();
  private maxHalfWidth = RIVER_HALF_WIDTH;
  private readonly canalBox = new Map<string, WorldBounds>();
  private canalView: CanalView | null = null;

  constructor(rivers: RiverDef[], bounds: WorldBounds = VALLEY_BOUNDS) {
    this.rivers = rivers.filter((r) => !(r as RiverLike).canal);
    this.bounds = bounds;
    this.width = bounds.maxX - bounds.minX;
    this.depth = bounds.maxZ - bounds.minZ;
    this.centerX = (bounds.minX + bounds.maxX) / 2;
    this.centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const systems = new Map<string, number>();
    for (const r of rivers) {
      const pts = r.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
      if (r.joins) pts.push(this.curves.get(r.joins.river)!.getPointAt(r.joins.t));
      // Kanäle sind gerade gemauert, Flüsse schwingen weich
      const curve = new THREE.CatmullRomCurve3(pts, false, (r as RiverLike).canal ? 'centripetal' : 'catmullrom', 0.5);
      this.curves.set(r.id, curve);
      if ((r as RiverLike).canal) continue;
      const system = r.joins ? (systems.get(r.joins.river) ?? systems.size) : systems.size;
      systems.set(r.id, system);
      this.maxHalfWidth = Math.max(this.maxHalfWidth, r.halfWidth);
      const n = Math.round(curve.getLength() * 1.6);
      curve.getSpacedPoints(n).forEach((p, i) => {
        const tan = curve.getTangentAt(i / n);
        const sample = { p, n: new THREE.Vector3(-tan.z, 0, tan.x).normalize(), river: r, t: i / n, system };
        this.samples.push(sample);
        const key = this.cellKey(Math.floor(p.x / SAMPLE_CELL), Math.floor(p.z / SAMPLE_CELL));
        const list = this.cells.get(key);
        if (list) list.push(sample);
        else this.cells.set(key, [sample]);
      });
    }
    for (const r of rivers) {
      if (!(r as RiverLike).canal) continue;
      const line = this.layoutCanal(r);
      this.canals.push(line);
      const m = 14;
      this.canalBox.set(r.id, {
        minX: Math.min(...line.points.map((p) => p.x)) - m,
        maxX: Math.max(...line.points.map((p) => p.x)) + m,
        minZ: Math.min(...line.points.map((p) => p.z)) - m,
        maxZ: Math.max(...line.points.map((p) => p.z)) + m,
      });
    }
  }

  /** Liegt der Punkt mit Abstand `margin` innerhalb der Kartenplatte? */
  inWorld(x: number, z: number, margin = 0): boolean {
    const b = this.bounds;
    return x > b.minX + margin && x < b.maxX - margin && z > b.minZ + margin && z < b.maxZ - margin;
  }

  private cellKey(ix: number, iz: number): number {
    return (ix + 512) * 1024 + (iz + 512);
  }

  /**
   * Haltungen eines Kanals: Der Wasserspiegel folgt dem Gelände in Stufen von Schleuse zu Schleuse,
   * steigt bis zum Scheitel und fällt danach wieder. Tiefer als das Gelände wird eingeschnitten,
   * höher wird ein Damm aufgeschüttet.
   */
  private layoutCanal(r: RiverDef): CanalLine {
    const curve = this.curves.get(r.id)!;
    const n = Math.max(8, Math.round(curve.getLength()));
    const raw: { x: number; z: number; dx: number; dz: number; s: number; ground: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const p = curve.getPointAt(s);
      const tan = curve.getTangentAt(s);
      const info = this.riverInfo(p.x, p.z);
      raw.push({ x: p.x, z: p.z, dx: tan.x, dz: tan.z, s, ground: this.heightFrom(p.x, p.z, info.d, info.t, info.ridge) });
    }
    // Gelände geglättet, dann vom Anfang her nur steigend und vom Ende her nur steigend: das ergibt den Scheitel
    const smooth = raw.map((_, i) => {
      let sum = 0;
      let w = 0;
      for (let k = -4; k <= 4; k++) {
        const j = Math.min(n, Math.max(0, i + k));
        sum += raw[j].ground;
        w++;
      }
      return sum / w;
    });
    const LOW = 1.1;
    const STEP = 1.4;
    const LOCKS = 7; // je Seite, zusammen 14 wie in den Kartendaten
    const want = smooth.map((g) => Math.min(LOW + STEP * LOCKS, Math.max(LOW, g - 1.2)));
    const up: number[] = [];
    const down: number[] = new Array(want.length);
    want.forEach((w, i) => up.push(Math.max(w, i ? up[i - 1] : 0)));
    for (let i = want.length - 1; i >= 0; i--) down[i] = Math.max(want[i], i < want.length - 1 ? down[i + 1] : 0);
    const points: CanalPoint[] = raw.map((q, i) => {
      const lift = Math.round((Math.min(up[i], down[i]) - LOW) / STEP);
      return { x: q.x, z: q.z, dx: q.dx, dz: q.dz, s: q.s, level: LOW + Math.max(0, lift) * STEP, soft: 0 };
    });
    // Zu kurze Haltungen (unter 6 Punkten) mit der vorigen zusammenlegen, damit Schleusen nicht aufeinander kleben
    let start = 0;
    for (let i = 1; i <= points.length; i++) {
      if (i < points.length && points[i].level === points[start].level) continue;
      if (i - start < 6 && start > 0) for (let k = start; k < i; k++) points[k].level = points[start - 1].level;
      start = i;
    }
    const locks: number[] = [];
    for (let i = 1; i < points.length; i++) if (points[i].level !== points[i - 1].level) locks.push(i);
    points.forEach((p, i) => {
      let sum = 0;
      let w = 0;
      for (let k = -6; k <= 6; k++) {
        const q = points[Math.min(points.length - 1, Math.max(0, i + k))];
        sum += q.level;
        w++;
      }
      p.soft = sum / w;
    });
    return { river: r.id, halfWidth: r.halfWidth, points, locks };
  }

  /** Nächster Kanalpunkt und Abstand zur Kanalmitte (Infinity ohne Kanal in der Nähe) */
  canalAt(x: number, z: number): { d: number; point: CanalPoint; canal: CanalLine } | null {
    let best: { d: number; point: CanalPoint; canal: CanalLine } | null = null;
    let bestRaw = Infinity;
    for (const c of this.canals) {
      const box = this.canalBox.get(c.river)!;
      if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
      for (let i = 0; i < c.points.length; i++) {
        const p = c.points[i];
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestRaw) {
          bestRaw = d;
          // quer zur Achse messen, sonst wird die Ufermauer zwischen den Stützpunkten wellig
          const along = (x - p.x) * p.dx + (z - p.z) * p.dz;
          const perp = Math.abs((x - p.x) * -p.dz + (z - p.z) * p.dx);
          best = { d: Math.abs(along) < 0.75 ? perp : d, point: p, canal: c };
        }
      }
    }
    return best;
  }

  /**
   * Baufortschritt des Kanals zeigen (aus canalProgress). Ohne Aufruf bleibt der Kanal unsichtbar,
   * nur die Trasse ist im Gelände ausgespart. Günstig: baut nur neu, wenn sich der Fortschritt merklich ändert.
   */
  setCanal(build: CanalBuild): void {
    if (!this.canals.length) return;
    if (!this.canalView) {
      this.canalView = new CanalView(this);
      this.group.add(this.canalView.group);
    }
    this.canalView.set(build);
  }

  /** Höhe des Wasserspiegels an einer Stelle des Flusses oder Kanals (für Schiffe) */
  waterLevelAt(river: string, t: number): number {
    const c = this.canals.find((k) => k.river === river);
    if (!c) return 0;
    const p = c.points[Math.min(c.points.length - 1, Math.max(0, Math.round(t * (c.points.length - 1))))];
    return p.level - 0.15;
  }

  curve(river: string): THREE.CatmullRomCurve3 {
    return this.curves.get(river)!;
  }

  pointAt(river: string, t: number): THREE.Vector3 {
    return this.curve(river).getPointAt(clamp01(t));
  }

  tangentAt(river: string, t: number): THREE.Vector3 {
    return this.curve(river).getTangentAt(clamp01(t));
  }

  /** Baut Gelände, Wasser und Bäume. Stadtflächen werden vom Wald ausgespart, Äcker liegen um Städte mit `fields`. */
  build(townSpots: { pos: THREE.Vector3; radius: number; fields: boolean }[]): void {
    this.townSpots.push(...townSpots);
    this.group.add(this.buildTerrain());
    this.group.add(this.buildWater());
    this.shore = this.buildShore();
    this.group.add(this.shore);
    this.ripples = this.buildRipples();
    this.group.add(this.ripples);
    this.group.add(this.buildTrees());
    this.group.add(this.buildRocks());
    this.group.add(this.buildReeds());
  }

  /**
   * Abstand zum nächsten Fluss, umgerechnet auf die Breite des Hauptstroms (d < RIVER_HALF_WIDTH heißt: im Wasser),
   * und wie weit oben im Tal der Punkt liegt (0 = Gebirge, 1 = Aue).
   */
  riverDistance(x: number, z: number): { d: number; t: number } {
    const r = this.riverInfo(x, z);
    return { d: r.d, t: r.t };
  }

  /** Wie riverDistance, dazu die Uferseite (1 rechts, -1 links in Fließrichtung) */
  private riverInfo(x: number, z: number): { d: number; t: number; side: number; sample: RiverSample; ridge: number } {
    let best = Infinity;
    let bestS = this.samples[0];
    const cx = Math.floor(x / SAMPLE_CELL);
    const cz = Math.floor(z / SAMPLE_CELL);
    // Ringweise nach außen suchen, bis kein näherer Stützpunkt mehr möglich ist
    for (let ring = 0; ring < 64; ring++) {
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        for (let iz = cz - ring; iz <= cz + ring; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
          const list = this.cells.get(this.cellKey(ix, iz));
          if (!list) continue;
          for (const s of list) {
            const dx = s.p.x - x;
            const dz = s.p.z - z;
            const edge = Math.sqrt(dx * dx + dz * dz) - s.river.halfWidth;
            if (edge < best) {
              best = edge;
              bestS = s;
            }
          }
        }
      }
      if (best < ring * SAMPLE_CELL - this.maxHalfWidth) break;
    }
    // Talposition weich gemittelt über alle nahen Stützpunkte: sonst springt sie dort, wo zwei Flussarme
    // gleich weit entfernt sind, und das Gelände bekommt eine Kante (Spalte)
    let wSum = 0;
    let tSum = 0;
    let other = Infinity;
    const reach = Math.ceil((best + 30 + this.maxHalfWidth) / SAMPLE_CELL) + 1;
    for (let ix = cx - reach; ix <= cx + reach; ix++) {
      for (let iz = cz - reach; iz <= cz + reach; iz++) {
        const list = this.cells.get(this.cellKey(ix, iz));
        if (!list) continue;
        for (const s of list) {
          const dx = s.p.x - x;
          const dz = s.p.z - z;
          const edge = Math.sqrt(dx * dx + dz * dz) - s.river.halfWidth;
          const k = edge - best;
          if (k > 30) continue;
          if (s.system !== bestS.system && edge < other) other = edge;
          const w = Math.exp(-k / 6);
          wSum += w;
          tSum += w * (s.river.joins ? 0.25 + s.t * 0.3 : s.t);
        }
      }
    }
    const valley = tSum / wSum;
    const side = (x - bestS.p.x) * bestS.n.x + (z - bestS.p.z) * bestS.n.z >= 0 ? 1 : -1;
    // Wasserscheide zwischen zwei getrennten Flusssystemen: dort ein bewaldeter Rücken statt Hochgebirge
    const ridge = Math.min(1, (other - best) / 30);
    return { d: best + RIVER_HALF_WIDTH, t: valley, side, sample: bestS, ridge };
  }

  heightAt(x: number, z: number): number {
    const r = this.riverInfo(x, z);
    return this.carve(x, z, this.heightFrom(x, z, r.d, r.t, r.ridge), r.d);
  }

  /** Kanal ins Gelände legen: Sohle, Leinpfad auf beiden Seiten, Einschnitt oder Damm zum Gelände hin */
  private carve(x: number, z: number, h: number, d: number): number {
    if (!this.canals.length || d < RIVER_HALF_WIDTH + 1) return h;
    const c = this.canalAt(x, z);
    if (!c) return h;
    const hw = c.canal.halfWidth;
    const inner = hw + 0.35 + CANAL_TOWPATH;
    const slope = 6;
    if (c.d > inner + slope) return h;
    const bank = c.point.level + CANAL_BANK;
    // zum Fluss hin weich auslaufen, damit die Einfahrt nicht als Wand im Ufer steht
    const fade = Math.min(1, (d - RIVER_HALF_WIDTH - 1) / 3);
    let target: number;
    // Graben breiter als das Wasser: so fällt im groben Geländenetz sicher ein Punkt auf die Sohle,
    // den Rand bis zur Mauer deckt der Leinpfad des Kanals ab
    if (c.d < hw + CANAL_TRENCH) target = c.point.level - CANAL_BED;
    else if (c.d < inner) target = bank;
    else {
      // Böschung: von der Haltung zum gemittelten Spiegel, dann weich ins Gelände
      const f = (c.d - inner) / slope;
      const from = bank + (c.point.soft - c.point.level) * Math.min(1, f * 3);
      target = from + (h - from) * f * f * (3 - 2 * f);
    }
    return h + (target - h) * fade;
  }

  private heightFrom(x: number, z: number, d: number, t: number, ridge = 1): number {
    const n = noise(x, z);
    if (d < RIVER_HALF_WIDTH) return -1.4 + (d / RIVER_HALF_WIDTH) * 1.1;
    const bank = Math.min(1, (d - RIVER_HALF_WIDTH) / 3);
    let h = -0.3 + bank * 0.7;
    // Talaue, flussaufwärts schmaler
    const plain = 10 + t * 22;
    if (d > RIVER_HALF_WIDTH + 3) {
      const ramp = Math.min(1, (d - RIVER_HALF_WIDTH - 3) / 5);
      h += Math.max(0, n) * 0.5 + (fbm(x * 0.09, z * 0.09, 3) - 0.5) * 0.7 * ramp;
    }
    if (d > plain) {
      const wall = d - plain;
      const steep = 0.28 + (1 - t) * 0.35; // im Oberlauf steile Hänge
      // Gipfelhöhe, damit der Sockel nicht zur Wand wird; auf der Wasserscheide zweier Täler nur ein Rücken
      const peak = (12 + (1 - t) * 12) * (0.5 + 0.5 * ridge);
      const base = peak * (1 - Math.exp((-wall * steep) / peak));
      // Grate und Kuppen geben den Bergen Form, feines Rauschen bricht die Hänge auf
      const crest = ridged(x * 0.03 + 3.1, z * 0.03 - 1.7);
      const detail = fbm(x * 0.14, z * 0.14, 3) - 0.5;
      h += base * (0.75 + crest * 0.5) + n * (1.2 + wall * 0.04) + detail * (0.6 + wall * 0.05);
    }
    // Keine Pfützen in der Wiese: jenseits der Böschung bleibt das Land über dem Wasser
    if (d > RIVER_HALF_WIDTH + 2) h = Math.max(h, 0.18 + Math.min(1, (d - RIVER_HALF_WIDTH - 2) / 4) * 0.1);
    return h;
  }

  /**
   * Höhe der tatsächlich gezeichneten Geländefläche (lineare Dreiecke statt glatter Funktion).
   * Für Wege und Plätze, die genau auf dem Boden liegen sollen. Vor build() gleich heightAt.
   */
  surfaceAt(x: number, z: number): number {
    const g = this.grid;
    if (!g) return this.heightAt(x, z);
    const sw = this.width / g.segX;
    const sd = this.depth / g.segZ;
    const gx = Math.min(g.segX - 1e-6, Math.max(0, (x - this.bounds.minX) / sw));
    const gz = Math.min(g.segZ - 1e-6, Math.max(0, (z - this.bounds.minZ) / sd));
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const cols = g.segX + 1;
    const ha = g.heights[iz * cols + ix];
    const hb = g.heights[(iz + 1) * cols + ix];
    const hc = g.heights[(iz + 1) * cols + ix + 1];
    const hd = g.heights[iz * cols + ix + 1];
    // gleiche Aufteilung in Dreiecke wie PlaneGeometry: (a, b, d) und (b, c, d)
    if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
    return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
  }

  /** Ufernormale (in der Ebene, rechts in Fließrichtung) bei Position t */
  normalAt(river: string, t: number): THREE.Vector3 {
    const tan = this.tangentAt(river, t);
    return new THREE.Vector3(-tan.z, 0, tan.x).normalize();
  }

  halfWidth(river: string): number {
    return this.rivers.find((r) => r.id === river)?.halfWidth ?? this.canals.find((c) => c.river === river)!.halfWidth;
  }

  /** Liegt der Punkt im Kanal oder auf seinem Leinpfad (plus `margin`)? */
  nearCanal(x: number, z: number, margin = 0): boolean {
    const c = this.canalAt(x, z);
    return !!c && c.d < c.canal.halfWidth + 0.35 + CANAL_TOWPATH + margin;
  }

  /** Flächenverhältnis zum Tal, damit größere Karten gleich dicht bewaldet sind */
  private get areaScale(): number {
    return (this.width * this.depth) / (WORLD_W * WORLD_D);
  }

  private fieldCategory(x: number, z: number, h: number): Cat | null {
    for (let k = 0; k < this.townSpots.length; k++) {
      const s = this.townSpots[k];
      if (!s.fields) continue;
      const dist = Math.hypot(x - s.pos.x, z - s.pos.z);
      // ausgefranster Rand statt eines perfekten Kreises
      const reach = s.radius + 20 + (vnoise(x * 0.15, z * 0.15) - 0.5) * 10;
      if (dist > s.radius + 2 && dist < reach && h < 2.6) {
        // Flickenteppich: schräg liegende Parzellen in vier Nutzungen
        const a = 0.45 + k * 0.7;
        const u = x * Math.cos(a) + z * Math.sin(a);
        const v = -x * Math.sin(a) + z * Math.cos(a);
        const cu = Math.floor(u / 7);
        const cv = Math.floor(v / 3.6);
        // schmale Raine zwischen den Feldern
        if (u / 7 - cu < 0.06) return 'meadowDark';
        const r = hash2(cu + k * 31, cv);
        if (r < 0.38) return 'field';
        if (r < 0.62) return 'fieldAlt';
        if (r < 0.82) return 'meadowDark';
        return 'meadow';
      }
    }
    return null;
  }

  private categoryFor(x: number, z: number, h: number, d: number, side: number, slope: number): Cat {
    if (d < RIVER_HALF_WIDTH) return 'bed';
    const canal = this.canals.length ? this.canalAt(x, z) : null;
    if (canal && d > RIVER_HALF_WIDTH + 1) {
      if (canal.d < canal.canal.halfWidth + CANAL_TRENCH) return 'bed';
      if (canal.d < canal.canal.halfWidth + 0.35 + CANAL_TOWPATH) return 'path';
    }
    if (d < RIVER_HALF_WIDTH + 1.4) return 'sand';
    // Treidelpfad am linken Ufer, dort gehen die Pferde
    if (side < 0 && d > RIVER_HALF_WIDTH + 1.9 && d < RIVER_HALF_WIDTH + 2.8 && h < 3) return 'path';
    const field = this.fieldCategory(x, z, h);
    if (field) return field;
    const snowLine = 21 + (vnoise(x * 0.2, z * 0.2) - 0.5) * 3;
    if (h > snowLine) return 'snow';
    if (h > 13 || (slope > 1.25 && h > 3)) return 'rock';
    if (h > 4) return 'forest';
    return noise(x * 2.3, z * 2.3) > 0.15 ? 'meadowDark' : 'meadow';
  }

  private buildTerrain(): THREE.Group {
    const g = new THREE.Group();
    // gleiche Maschenweite wie im Tal, egal wie groß die Karte ist
    const segX = Math.round((this.width / WORLD_W) * 180);
    const segZ = Math.round((this.depth / WORLD_D) * 115);
    const geo = new THREE.PlaneGeometry(this.width, this.depth, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.centerX, 0, this.centerZ);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    this.terrainCats = new Uint8Array(pos.count);
    this.terrainShade = new Float32Array(pos.count);
    const info: { d: number; side: number }[] = [];
    const heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = this.riverInfo(x, z);
      const h = this.carve(x, z, this.heightFrom(x, z, r.d, r.t, r.ridge), r.d);
      pos.setY(i, h);
      heights[i] = h;
      info.push({ d: r.d, side: r.side });
    }
    this.grid = { heights, segX, segZ };
    // Steigung aus den Nachbarpunkten: steile Hänge werden zu Fels
    const cols = segX + 1;
    const dx = this.width / segX;
    for (let i = 0; i < pos.count; i++) {
      const cx = i % cols;
      const cz = Math.floor(i / cols);
      const hx = heights[cz * cols + Math.min(segX, cx + 1)] - heights[cz * cols + Math.max(0, cx - 1)];
      const hz = heights[Math.min(segZ, cz + 1) * cols + cx] - heights[Math.max(0, cz - 1) * cols + cx];
      const slope = Math.hypot(hx, hz) / (2 * dx);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      this.terrainCats[i] = CATS.indexOf(this.categoryFor(x, z, heights[i], info[i].d, info[i].side, slope));
      // leichte Helligkeitswechsel, damit Wiesen und Wälder nicht wie eine Fläche wirken
      this.terrainShade[i] = 0.9 + fbm(x * 0.25, z * 0.25, 3) * 0.18 + (hash2(cx, cz) - 0.5) * 0.05;
    }
    this.terrainColors = new THREE.BufferAttribute(colors, 3);
    geo.setAttribute('color', this.terrainColors);
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
    );
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    g.add(terrain);
    g.add(this.buildPlinth(segX, segZ));
    return g;
  }

  /** Holzsockel unter dem Diorama mit Erdschichten an den Seiten und gedrechseltem Rahmen */
  private buildPlinth(segX: number, segZ: number): THREE.Group {
    const g = new THREE.Group();
    const earth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    const water = new THREE.MeshStandardMaterial({ color: 0x2f6680, roughness: 0.4, side: THREE.DoubleSide });
    const { minX, maxX, minZ, maxZ } = this.bounds;
    // Erdschichten von unten nach oben: Lehm, Kies, Erde, dunkler Mutterboden
    const layers = [
      { top: -4.6, color: new THREE.Color(0x8a6a48), wobble: 0.6 },
      { top: -3.2, color: new THREE.Color(0xa38a66), wobble: 0.4 },
      { top: -1.2, color: new THREE.Color(0x76563a), wobble: 0.5 },
      { top: 99, color: new THREE.Color(0x4f3826), wobble: 0 },
    ];
    const edge = (ax: number, az: number, bx: number, bz: number, steps: number, ox: number, oz: number) => {
      const verts: number[] = [];
      const cols: number[] = [];
      const waterVerts: number[] = [];
      const boundary = (k: number, x: number, z: number) =>
        k < 0 ? BASE_Y : layers[k].top + Math.sin(x * 0.21 + z * 0.17 + k * 2) * layers[k].wobble;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const x0 = ax + (bx - ax) * t0;
        const z0 = az + (bz - az) * t0;
        const x1 = ax + (bx - ax) * t1;
        const z1 = az + (bz - az) * t1;
        const h0 = this.heightAt(x0, z0);
        const h1 = this.heightAt(x1, z1);
        for (let k = 0; k < layers.length; k++) {
          const lo0 = Math.min(boundary(k - 1, x0, z0), h0);
          const lo1 = Math.min(boundary(k - 1, x1, z1), h1);
          const hi0 = Math.min(boundary(k, x0, z0), h0);
          const hi1 = Math.min(boundary(k, x1, z1), h1);
          if (hi0 <= lo0 && hi1 <= lo1) continue;
          verts.push(x0, lo0, z0, x1, lo1, z1, x1, hi1, z1, x0, lo0, z0, x1, hi1, z1, x0, hi0, z0);
          const c = layers[k].color;
          for (let v = 0; v < 6; v++) cols.push(c.r, c.g, c.b);
        }
        if (h0 < 0 || h1 < 0) {
          const w0 = Math.max(h0, 0);
          const w1 = Math.max(h1, 0);
          const b0 = Math.min(h0, 0);
          const b1 = Math.min(h1, 0);
          waterVerts.push(x0, b0, z0, x1, b1, z1, x1, w1, z1, x0, b0, z0, x1, w1, z1, x0, w0, z0);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, earth));
      if (waterVerts.length) {
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(waterVerts, 3));
        wg.computeVertexNormals();
        const m = new THREE.Mesh(wg, water);
        // minimal nach außen, damit es nicht mit der Erdwand flackert
        m.position.set(ox * 0.03, 0, oz * 0.03);
        g.add(m);
      }
    };
    edge(minX, minZ, maxX, minZ, segX, 0, -1);
    edge(maxX, maxZ, minX, maxZ, segX, 0, 1);
    edge(minX, maxZ, minX, minZ, segZ, -1, 0);
    edge(maxX, minZ, maxX, maxZ, segZ, 1, 0);

    // Rahmen aus dunklem Holz mit Profilleisten und einem Messingschild vorn
    const wood = new THREE.MeshStandardMaterial({ color: PLINTH, roughness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x6e4b2e, roughness: 0.6 });
    const W = this.width;
    const D = this.depth;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 3, 2.4, D + 3), wood);
    frame.position.y = BASE_Y - 1.2;
    frame.receiveShadow = true;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(W + 3.6, 0.35, D + 3.6), trim);
    lip.position.y = BASE_Y - 0.12;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(W + 4.2, 0.6, D + 4.2), wood);
    foot.position.y = BASE_Y - 2.55;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(26, 1.3, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xc09a4e, roughness: 0.35, metalness: 0.6 }),
    );
    plate.position.set(this.centerX, BASE_Y - 1.2, maxZ + 1.56);
    for (const m of [frame, lip, foot]) m.position.set(this.centerX, m.position.y, this.centerZ);
    g.add(frame, lip, foot, plate);
    return g;
  }

  private buildWater(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(this.width, this.depth, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.centerX, 0, this.centerZ);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3f86a3,
      roughness: 0.22,
      metalness: 0.08,
      transparent: true,
      opacity: 0.86,
    });
    const water = new THREE.Mesh(geo, mat);
    water.position.y = -0.05;
    water.receiveShadow = true;
    this.water = water;
    return water;
  }

  /** Heller Saum an der Uferlinie, wo das Wasser auf die Böschung trifft */
  private buildShore(): THREE.Mesh {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const r of this.rivers) {
      const curve = this.curve(r.id);
      const n = Math.round(curve.getLength() * 1.2);
      for (const side of [-1, 1]) {
        let prev = -1;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const p = curve.getPointAt(t);
          const nr = this.normalAt(r.id, t);
          const off = side * (r.halfWidth + SHORE - 0.1);
          const ox = p.x + nr.x * off;
          const oz = p.z + nr.z * off;
          // Saum nur dort, wo die Linie wirklich am Ufer liegt (nicht in der Mündung eines anderen Flusses)
          const inside = this.riverDistance(ox + nr.x * side * 0.9, oz + nr.z * side * 0.9).d < RIVER_HALF_WIDTH;
          if (inside) {
            prev = -1;
            continue;
          }
          const base = pos.length / 3;
          const w = 0.55;
          pos.push(ox - nr.x * side * w * 0.5, 0, oz - nr.z * side * w * 0.5, ox + nr.x * side * w * 0.5, 0, oz + nr.z * side * w * 0.5);
          if (prev >= 0) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
          prev = base;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0xeaf4f2, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.position.y = this.waterY + 0.02;
    mesh.renderOrder = 1;
    return mesh;
  }

  /** Helle Striche auf dem Wasser, die mit der Strömung treiben */
  private buildRipples(): THREE.InstancedMesh {
    const count = 200;
    const geo = new THREE.PlaneGeometry(1, 0.07);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xe8f4f6, transparent: true, opacity: 0.42, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const rand = mulberry32(7);
    const lengths = this.rivers.map((r) => this.curve(r.id).getLength());
    const total = lengths.reduce((a, b) => a + b, 0);
    this.rivers.forEach((r, k) => {
      const n = Math.round((count * lengths[k]) / total);
      for (let i = 0; i < n && this.rippleState.length < count; i++) {
        this.rippleState.push({
          river: r.id,
          t: rand(),
          offset: (rand() * 2 - 1) * (r.halfWidth - 0.8),
          // gleiche Geschwindigkeit in Welteinheiten, also kürzere Flüsse schneller in t
          speed: ((0.8 + rand() * 0.4) * lengths[0]) / lengths[k],
          len: 0.5 + rand() * 1.3,
        });
      }
    });
    mesh.count = this.rippleState.length;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
  }

  /** dt in Sekunden, flowSpeed als Anteil der Flusslänge pro Sekunde */
  update(dt: number, flowSpeed: number): void {
    for (let i = 0; i < this.rippleState.length; i++) {
      const r = this.rippleState[i];
      r.t += dt * flowSpeed * r.speed;
      if (r.t > 1) r.t -= 1;
      const p = this.pointAt(r.river, r.t);
      const n = this.normalAt(r.river, r.t);
      const tan = this.tangentAt(r.river, r.t);
      this.dummy.position.set(p.x + n.x * r.offset, this.waterY + 0.03, p.z + n.z * r.offset);
      this.dummy.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
      // an den Enden ausblenden durch Skalierung, dazu ein langsames Atmen der Länge
      const fade = Math.min(1, r.t * 20, (1 - r.t) * 20);
      const breathe = 0.75 + 0.25 * Math.sin(r.t * 90 + r.offset * 3);
      this.dummy.scale.set(fade * r.len * breathe, 1, fade);
      this.dummy.updateMatrix();
      this.ripples.setMatrixAt(i, this.dummy.matrix);
    }
    this.ripples.instanceMatrix.needsUpdate = true;
    if (this.iceAmount > 0 || this.ice.count > 0) this.updateIce(dt);
  }

  /**
   * Farben der Jahreszeit setzen. `next` und `f` blenden in den letzten Tagen weich in die nächste Jahreszeit über.
   * Schnee bleibt auf den Gipfeln, im Winter liegt er überall.
   */
  setSeason(season: Season, next: Season, f: number): void {
    const key = `${season}-${next}-${f.toFixed(2)}`;
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    const a = new THREE.Color();
    const b = new THREE.Color();
    const colors = this.terrainColors.array as Float32Array;
    const pa = SEASON_PALETTE[season];
    const pb = SEASON_PALETTE[next];
    const mixed = CATS.map((c) => a.setHex(pa[c]).lerp(b.setHex(pb[c]), f).clone());
    for (let i = 0; i < this.terrainCats.length; i++) {
      const c = mixed[this.terrainCats[i]];
      const s = this.terrainShade[i];
      colors[i * 3] = c.r * s;
      colors[i * 3 + 1] = c.g * s;
      colors[i * 3 + 2] = c.b * s;
    }
    this.terrainColors.needsUpdate = true;
    const waterMat = this.water.material as THREE.MeshStandardMaterial;
    waterMat.color.setHex(WATER[season]).lerp(b.setHex(WATER[next]), f);
    this.canalView?.setWaterColor(waterMat.color);

    for (const d of this.decor) {
      const ta = d.table[season];
      const tb = d.table[next];
      for (let i = 0; i < d.mesh.count; i++) {
        const sh = d.shade[i];
        a.setHex(ta[sh % ta.length]).lerp(b.setHex(tb[sh % tb.length]), f);
        d.mesh.setColorAt(i, a);
      }
      if (d.mesh.instanceColor) d.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Wasserstand in m relativ zum Normalwasser, optisch etwas gestaucht */
  setWaterLevel(level: number): void {
    this.waterY = -0.05 + level * 0.35;
    this.water.position.y = this.waterY;
    this.shore.position.y = this.waterY + 0.02;
    this.ice.position.y = this.waterY + 0.05;
  }

  /** Eisschollen auf den Flussabschnitten, die zufrieren */
  buildIce(ranges: { river: string; from: number; to: number }[]): void {
    const rand = mulberry32(23);
    for (const r of ranges) {
      // Kanäle frieren als Ganzes, Schollen treiben dort nicht
      if (this.canals.some((c) => c.river === r.river)) continue;
      const len = this.curve(r.river).getLength() * (r.to - r.from);
      const hw = this.halfWidth(r.river);
      const n = Math.round(len * hw * 0.35);
      for (let i = 0; i < n; i++) {
        this.iceState.push({
          river: r.river,
          t: r.from + rand() * (r.to - r.from),
          offset: (rand() * 2 - 1) * (hw - 0.6),
          rot: rand() * Math.PI,
          size: 0.5 + rand() * 0.9,
        });
      }
    }
    const geo = new THREE.CylinderGeometry(1, 1, 0.12, 6);
    this.ice = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xf1f5f6, roughness: 0.6, flatShading: true }),
      Math.max(1, this.iceState.length),
    );
    this.ice.count = 0;
    this.ice.receiveShadow = true;
    // Schollen werden ständig verschoben, die Hülle aus dem ersten Bild wäre falsch
    this.ice.frustumCulled = false;
    this.group.add(this.ice);
  }

  /** amount 0..1: Anteil der sichtbaren Schollen; drift: Eisgang, die Schollen treiben ab */
  setIce(amount: number, drift: boolean): void {
    this.iceAmount = amount;
    this.iceDrift = drift;
  }

  private updateIce(dt: number): void {
    const n = Math.floor(this.iceState.length * this.iceAmount);
    this.ice.count = n;
    for (let i = 0; i < n; i++) {
      const s = this.iceState[i];
      if (this.iceDrift) s.t = (s.t + dt * 0.004) % 1;
      const p = this.pointAt(s.river, s.t);
      const nrm = this.normalAt(s.river, s.t);
      this.dummy.position.set(p.x + nrm.x * s.offset, 0, p.z + nrm.z * s.offset);
      this.dummy.rotation.set(0, s.rot, 0);
      this.dummy.scale.set(s.size, 1, s.size * 0.8);
      this.dummy.updateMatrix();
      this.ice.setMatrixAt(i, this.dummy.matrix);
    }
    this.ice.instanceMatrix.needsUpdate = true;
  }

  private nearTown(x: number, z: number, fieldsExtra: number, extra: number): boolean {
    return this.townSpots.some((s) => Math.hypot(x - s.pos.x, z - s.pos.z) < s.radius + (s.fields ? fieldsExtra : extra));
  }

  private addDecor(mesh: THREE.InstancedMesh, table: Record<Season, number[]>, shade: number[]): void {
    for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, new THREE.Color(0xffffff));
    this.decor.push({ mesh, table, shade });
  }

  /** Bäume als InstancedMesh, mehr Wald im Oberlauf; dazu Büsche am Waldrand */
  private buildTrees(seed = 11): THREE.Group {
    const rand = mulberry32(seed);
    const spots: { p: THREE.Vector3; t: number }[] = [];
    const bushes: THREE.Vector3[] = [];
    let tries = 0;
    const area = this.areaScale;
    while (spots.length < 1100 * area && tries < 22000 * area) {
      tries++;
      const x = this.centerX + (rand() - 0.5) * (this.width - 4);
      const z = this.centerZ + (rand() - 0.5) * (this.depth - 4);
      const { d, t } = this.riverDistance(x, z);
      if (d < RIVER_HALF_WIDTH + 3.2) continue;
      const h = this.heightAt(x, z);
      if (h > 15.5 || h < 0.2) continue;
      if (this.nearTown(x, z, 22, 4) || this.nearCanal(x, z, 2.5)) continue;
      // Wald in Gruppen: Rauschen entscheidet über Lichtungen
      const clump = fbm(x * 0.06 + 40, z * 0.06, 3);
      // Wahrscheinlichkeit: Oberlauf und Hänge dicht bewaldet
      const p = (0.1 + (1 - t) * 0.5 + Math.min(0.4, h * 0.05)) * (0.4 + clump * 1.3);
      const r = rand();
      if (r > p) {
        // am Waldrand stehen Büsche
        if (r < p + 0.12 && bushes.length < 520 * area && h < 8) bushes.push(new THREE.Vector3(x, h, z));
        continue;
      }
      spots.push({ p: new THREE.Vector3(x, h, z), t });
    }

    // Nadelbäume (gestufte Kegel), Laubbäume (mehrere Kronenballen) und Birken in der Aue
    type Item = { p: THREE.Vector3; s: number; r: number; h: number };
    const conifers: Item[] = [];
    const broad: Item[] = [];
    const birch: Item[] = [];
    for (const { p, t } of spots) {
      const item = { p, s: 0.7 + rand() * 0.6, r: rand() * Math.PI * 2, h: 0.85 + rand() * 0.45 };
      const k = rand();
      if (p.y > 9 || k > 0.25 + t * 0.4) conifers.push(item);
      else if (k < 0.08 + t * 0.06) birch.push(item);
      else broad.push(item);
    }

    const coniferGeo = mergeGeometries([
      new THREE.ConeGeometry(1.0, 1.5, 7, 1, true).translate(0, 1.55, 0),
      new THREE.ConeGeometry(0.8, 1.35, 7, 1, true).translate(0, 2.3, 0),
      new THREE.ConeGeometry(0.55, 1.15, 6, 1, true).translate(0, 3.0, 0),
    ].map(stripUv))!;
    const broadGeo = mergeGeometries([
      new THREE.IcosahedronGeometry(0.95, 0).translate(0, 2.15, 0),
      new THREE.IcosahedronGeometry(0.7, 0).translate(0.55, 1.85, 0.25),
      new THREE.IcosahedronGeometry(0.7, 0).translate(-0.4, 2.0, -0.35),
    ].map(stripUv))!;
    const birchGeo = mergeGeometries([
      new THREE.IcosahedronGeometry(0.6, 0).scale(1, 1.6, 1).translate(0, 2.4, 0),
      new THREE.IcosahedronGeometry(0.45, 0).scale(1, 1.4, 1).translate(0.3, 1.9, 0.1),
    ].map(stripUv))!;
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 1.3, 5, 1, true);
    trunkGeo.translate(0, 0.6, 0);
    const birchTrunkGeo = new THREE.CylinderGeometry(0.08, 0.11, 2.2, 5, 1, true);
    birchTrunkGeo.translate(0, 1.05, 0);
    const crownMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 });
    const trunks = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 1 }),
      conifers.length + broad.length,
    );
    const birchTrunks = new THREE.InstancedMesh(
      birchTrunkGeo,
      new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 1 }),
      Math.max(1, birch.length),
    );
    birchTrunks.count = birch.length;
    let k = 0;
    const g = new THREE.Group();
    const place = (list: Item[], geo: THREE.BufferGeometry, table: Record<Season, number[]>, trunk: THREE.InstancedMesh, counter: () => number) => {
      const mesh = new THREE.InstancedMesh(geo, crownMat(), Math.max(1, list.length));
      mesh.count = list.length;
      const shade: number[] = [];
      list.forEach((it, i) => {
        this.dummy.position.copy(it.p);
        this.dummy.position.y -= 0.1;
        this.dummy.rotation.set(0, it.r, 0);
        this.dummy.scale.set(it.s, it.s * it.h, it.s);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        trunk.setMatrixAt(counter(), this.dummy.matrix);
        shade.push(Math.floor(rand() * 4));
      });
      mesh.castShadow = true;
      this.addDecor(mesh, table, shade);
      g.add(mesh);
    };
    place(conifers, coniferGeo, CONIFER, trunks, () => k++);
    place(broad, broadGeo, BROADLEAF, trunks, () => k++);
    let kb = 0;
    place(birch, birchGeo, BIRCH, birchTrunks, () => kb++);
    trunks.castShadow = true;
    birchTrunks.castShadow = true;
    g.add(trunks, birchTrunks);

    // Büsche: flache Ballen in Gruppen
    const bushGeo = mergeGeometries([
      new THREE.IcosahedronGeometry(0.55, 0).scale(1, 0.7, 1).translate(0, 0.3, 0),
      new THREE.IcosahedronGeometry(0.4, 0).scale(1, 0.75, 1).translate(0.45, 0.22, 0.15),
    ].map(stripUv))!;
    const bushMesh = new THREE.InstancedMesh(bushGeo, crownMat(), Math.max(1, bushes.length));
    bushMesh.count = bushes.length;
    const bshade: number[] = [];
    bushes.forEach((p, i) => {
      const s = 0.7 + rand() * 0.8;
      this.dummy.position.copy(p);
      this.dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      bushMesh.setMatrixAt(i, this.dummy.matrix);
      bshade.push(Math.floor(rand() * 3));
    });
    bushMesh.castShadow = false;
    this.addDecor(bushMesh, BUSH, bshade);
    g.add(bushMesh);
    return g;
  }

  /** Felsbrocken im Gebirge und an den Ufern im Oberlauf */
  private buildRocks(seed = 29): THREE.InstancedMesh {
    const rand = mulberry32(seed);
    const items: { x: number; y: number; z: number; s: number }[] = [];
    let tries = 0;
    const area = this.areaScale;
    while (items.length < 340 * area && tries < 9000 * area) {
      tries++;
      const x = this.centerX + (rand() - 0.5) * (this.width - 4);
      const z = this.centerZ + (rand() - 0.5) * (this.depth - 4);
      const { d, t } = this.riverDistance(x, z);
      if (d < RIVER_HALF_WIDTH + 1.6) continue;
      const h = this.heightAt(x, z);
      if (this.nearTown(x, z, 20, 3) || this.nearCanal(x, z, 1)) continue;
      // Geröll am Gebirge, einzelne Findlinge in der Aue, Blöcke am Ufer des wilden Oberlaufs
      const mountain = h > 7 ? 0.5 : 0;
      const riverside = d < RIVER_HALF_WIDTH + 3.5 && t < 0.35 ? 0.35 : 0;
      const p = 0.02 + mountain + riverside;
      if (rand() > p) continue;
      const s = (h > 7 ? 0.6 + rand() * 1.3 : 0.35 + rand() * 0.6) * (riverside ? 1.2 : 1);
      items.push({ x, y: h - s * 0.25, z, s });
    }
    const mesh = new THREE.InstancedMesh(
      stripUv(new THREE.IcosahedronGeometry(0.75, 0)),
      new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 }),
      Math.max(1, items.length),
    );
    mesh.count = items.length;
    const shade: number[] = [];
    items.forEach((it, i) => {
      this.dummy.position.set(it.x, it.y, it.z);
      this.dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      this.dummy.scale.set(it.s * (0.8 + rand() * 0.5), it.s * (0.55 + rand() * 0.3), it.s * (0.8 + rand() * 0.5));
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      shade.push(Math.floor(rand() * 3));
    });
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.addDecor(mesh, ROCK, shade);
    return mesh;
  }

  /** Schilfbüschel an den ruhigen Ufern des Unterlaufs und am Erzbach */
  private buildReeds(seed = 41): THREE.InstancedMesh {
    const rand = mulberry32(seed);
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = 0.15 + (i % 2) * 0.12;
      const h = 0.8 + (i % 3) * 0.25;
      blades.push(
        new THREE.ConeGeometry(0.05, h, 3, 1, true)
          .translate(0, h / 2, 0)
          .rotateZ((i % 2 ? 1 : -1) * 0.12)
          .translate(Math.cos(a) * r, 0, Math.sin(a) * r),
      );
    }
    const geo = mergeGeometries(blades.map(stripUv))!;
    const items: { x: number; y: number; z: number; r: number; s: number }[] = [];
    for (const r of this.rivers) {
      const curve = this.curve(r.id);
      const n = Math.round(curve.getLength() * 0.9);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const valley = r.joins ? 0.25 + t * 0.3 : t;
        if (valley < 0.3 || rand() > 0.5) continue;
        const side = rand() < 0.5 ? -1 : 1;
        // Gruppen statt gleichmäßiger Reihe
        if (vnoise(t * 40 + side * 7, r.halfWidth) < 0.45) continue;
        const p = curve.getPointAt(t);
        const nr = this.normalAt(r.id, t);
        const off = side * (r.halfWidth + SHORE + (rand() - 0.6) * 0.7);
        const x = p.x + nr.x * off;
        const z = p.z + nr.z * off;
        if (!this.inWorld(x, z, 1) || this.nearTown(x, z, 4, 4)) continue;
        if (this.riverDistance(x, z).d < RIVER_HALF_WIDTH + 0.4) continue;
        items.push({ x, y: Math.max(this.heightAt(x, z), -0.2) - 0.05, z, r: rand() * 6, s: 0.8 + rand() * 0.6 });
      }
    }
    const mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 }),
      Math.max(1, items.length),
    );
    mesh.count = items.length;
    const shade: number[] = [];
    items.forEach((it, i) => {
      this.dummy.position.set(it.x, it.y, it.z);
      this.dummy.rotation.set(0, it.r, 0);
      this.dummy.scale.setScalar(it.s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      shade.push(i % 2);
    });
    this.addDecor(mesh, REED, shade);
    return mesh;
  }
}

/** Für mergeGeometries müssen alle Teile dieselben Attribute haben */
function stripUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  return out;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
