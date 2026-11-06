import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SegmentDef, TownDef } from '../data/maps/valley.ts';
import { houseModel, type HouseType } from './houses.ts';
import { boxGeo, cylGeo, DECAL_MATERIAL, KIT_MATERIAL, Kit } from './kit.ts';
import { barrel, C, crate, type Anim } from './landmarks.ts';
import { Landscape, mulberry32, RIVER_HALF_WIDTH } from './landscape.ts';
import { DEFAULT_STYLE, TOWN_STYLES, type StyleCtx, type TownStyle } from './townstyles.ts';

export interface TownPlacement {
  def: TownDef;
  center: THREE.Vector3;
  mooring: THREE.Vector3; // Liegeplatz des Kahns am Steg
  radius: number;
  /** Bauplätze am Ufer: 0–3 Kontore, danach Betriebe */
  lots: Lot[];
  /** Plätze in zweiter Reihe für Stadthaus und Stiftungen des Spielers (render/civic.ts) */
  civic: Lot[];
}

export interface Lot {
  pos: THREE.Vector3;
  facing: number; // Drehung um y, Front zum Fluss
}

/** Kontorplätze nah am Steg, Betriebe weiter das Ufer entlang */
const LOT_ALONG = [-5.5, 5.5, -11, 11, -17, 17, -23, 23, -29, 29, -35, 35, -41, 41, -47, 47];
/** 4 Kontore, 6 Betriebe und einer für den Zusatzbauplatz durch hohes Ansehen */
const LOT_COUNT = 11;
export const KONTOR_LOTS = 4;

/** Stadthaus, Kirche, Schule, Armenhaus: in Ringen um den Marktplatz */
export const CIVIC_COUNT = 4;
const CIVIC_RINGS = [8.5, 11, 13.5, 16, 18.5];
const CIVIC_ANGLES = 16;
/** Abstand der Plätze zur Mitte der Hauptstraßen */
const CIVIC_ROAD_GAP = 2.6;

/** Uferlinie: so weit jenseits der nominellen Flussbreite trifft das Wasser die Böschung */
const SHORE = 1.05;

export function placeTown(land: Landscape, def: TownDef): TownPlacement {
  const p = land.pointAt(def.river, def.riverT);
  const n = land.normalAt(def.river, def.riverT).multiplyScalar(def.side);
  const hw = land.halfWidth(def.river);
  const radius = 5 + def.houses * 0.42;
  let center = p.clone().addScaledVector(n, hw + 3 + radius);
  // Läuft ein Kanal durch die Stadtmitte, rückt die Stadt am Ufer entlang zur Seite
  if (land.nearCanal(center.x, center.z, radius * 0.8)) {
    const tan = land.tangentAt(def.river, def.riverT);
    for (const shift of [0.9, -0.9, 1.3, -1.3, 1.7, -1.7]) {
      const c = center.clone().addScaledVector(tan, shift * radius);
      if (!land.nearCanal(c.x, c.z, radius * 0.8) && land.inWorld(c.x, c.z, radius)) {
        center = c;
        break;
      }
    }
  }
  const mooring = p.clone().addScaledVector(n, Math.max(0.6, hw - 1.3));
  const len = land.curve(def.river).getLength();
  // Plätze, die über das Flussende oder den Kartenrand hinausragen würden, entfallen; dafür rücken weiter entfernte nach
  const lots: Lot[] = [];
  for (const along of LOT_ALONG) {
    if (lots.length >= LOT_COUNT) break;
    const t = def.riverT + along / len;
    if (t <= 0.015 || t >= 0.985) continue;
    const q = land.pointAt(def.river, t);
    const qn = land.normalAt(def.river, t).multiplyScalar(def.side);
    let off = hw + 5;
    let pos = q.clone().addScaledVector(qn, off);
    // in Kurven nicht ins Wasser bauen
    for (let i = 0; i < 6 && land.riverDistance(pos.x, pos.z).d < RIVER_HALF_WIDTH + 3.2; i++) {
      off += 1;
      pos = q.clone().addScaledVector(qn, off);
    }
    if (!land.inWorld(pos.x, pos.z, 4.5) || land.nearCanal(pos.x, pos.z, 3)) continue;
    pos.y = land.heightAt(pos.x, pos.z);
    lots.push({ pos, facing: Math.atan2(qn.x, qn.z) + Math.PI });
  }
  // Ringe um den Marktplatz: auf festem Grund, nicht am Steilhang, nicht am Kartenrand, mit Abstand zu den Uferplätzen.
  // Die Front zeigt zum Platz.
  const tangent = land.tangentAt(def.river, def.riverT);
  const civic: Lot[] = [];
  for (const ring of CIVIC_RINGS) {
    for (let i = 0; i < CIVIC_ANGLES && civic.length < CIVIC_COUNT; i++) {
      // abwechselnd links und rechts vom Weg zum Steg, damit die Bauten sich verteilen
      const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      // um einen halben Schritt versetzt, damit kein Platz auf einer Hauptachse liegt
      const a = Math.atan2(-n.z, -n.x) + Math.PI / 2 + ((k + 0.5) * 2 * Math.PI) / CIVIC_ANGLES;
      const pos = new THREE.Vector3(center.x + Math.cos(a) * ring, 0, center.z + Math.sin(a) * ring);
      if (!land.inWorld(pos.x, pos.z, 4.5) || land.nearCanal(pos.x, pos.z, 3)) continue;
      // nicht auf die Straßen: Weg zum Steg (v = 0), Querstraße (u = 0), Uferstraße hinter den Kontoren
      const du = (pos.x - center.x) * n.x + (pos.z - center.z) * n.z;
      const dv = (pos.x - center.x) * tangent.x + (pos.z - center.z) * tangent.z;
      if (Math.abs(du) < CIVIC_ROAD_GAP || Math.abs(dv) < CIVIC_ROAD_GAP) continue;
      if (radius > 10 && Math.abs(du - (SHORE + 4.8 - radius)) < CIVIC_ROAD_GAP) continue;
      // nicht schräg am Hang: Ecken des Bauplatzes etwa auf einer Höhe
      const h0 = land.heightAt(pos.x, pos.z);
      if ([[1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8]].some(([x, z]) => Math.abs(land.heightAt(pos.x + x, pos.z + z) - h0) > 1.2)) continue;
      if (land.riverDistance(pos.x, pos.z).d < RIVER_HALF_WIDTH + 6) continue;
      if (land.heightAt(pos.x, pos.z) > 8.5) continue;
      if ([...lots, ...civic].some((l) => Math.hypot(l.pos.x - pos.x, l.pos.z - pos.z) < 6)) continue;
      pos.y = land.heightAt(pos.x, pos.z);
      civic.push({ pos, facing: Math.atan2(center.x - pos.x, center.z - pos.z) });
    }
  }
  return { def, center, mooring, radius, lots, civic };
}

/** Uferplätze und Plätze der zweiten Reihe, die Häuser, Gassen und Wahrzeichen freilassen */
function allLots(place: TownPlacement): Lot[] {
  return [...place.lots, ...place.civic];
}

/** Häuser einer Stadt; wächst Haus für Haus von innen nach außen */
export interface TownView {
  group: THREE.Group;
  setPopulation(pop: number): void;
}

/** Anzahl Häuser bei gegebener Einwohnerzahl */
export function houseCount(def: { houses: number; population: number }, pop: number): number {
  return Math.round(def.houses * Math.sqrt(pop / def.population));
}

interface Road {
  pts: THREE.Vector3[];
  half: number;
}

function distToRoad(x: number, z: number, road: Road): number {
  let best = Infinity;
  for (let i = 0; i < road.pts.length - 1; i++) {
    const a = road.pts[i];
    const b = road.pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l2));
    const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
    if (d < best) best = d;
  }
  return best;
}

function nearestOnRoad(x: number, z: number, road: Road): THREE.Vector3 {
  let best = Infinity;
  const out = new THREE.Vector3();
  for (let i = 0; i < road.pts.length - 1; i++) {
    const a = road.pts[i];
    const b = road.pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l2));
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      out.set(px, 0, pz);
    }
  }
  return out;
}

function pick<T>(list: T[], r: number): T {
  return list[Math.floor(r * list.length) % list.length];
}

function pickWeighted(list: [HouseType, number][], r: number): HouseType {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [t, w] of list) {
    x -= w;
    if (x < 0) return t;
  }
  return list[list.length - 1][0];
}

/** Rauch aus Schornsteinen und Essen, dazu das Drehen von Mühlenflügeln; läuft unabhängig vom Spieltakt */
class TownLife {
  readonly mesh: THREE.InstancedMesh;
  private readonly sources: THREE.Vector3[];
  private readonly anims: Anim[];
  private readonly dummy = new THREE.Object3D();
  private last = -1;
  private time = 0;
  active = 0;
  private static readonly PER = 6;

  constructor(sources: THREE.Vector3[], anims: Anim[]) {
    this.sources = sources;
    this.anims = anims;
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.32, 0),
      new THREE.MeshStandardMaterial({ color: 0xd8d4cc, transparent: true, opacity: 0.5, roughness: 1, flatShading: true, depthWrite: false }),
      Math.max(1, sources.length * TownLife.PER),
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = () => this.tick();
    this.active = sources.length;
  }

  private tick(): void {
    const now = performance.now() / 1000;
    const dt = this.last < 0 ? 0 : Math.min(0.1, now - this.last);
    if (dt === 0 && this.last >= 0) return; // mehrere Durchgänge pro Bild
    this.last = now;
    this.time += dt;
    for (const a of this.anims) a.obj.rotation.z -= dt * a.speed;
    let n = 0;
    for (let s = 0; s < this.active; s++) {
      const src = this.sources[s];
      for (let k = 0; k < TownLife.PER; k++) {
        const a = (this.time * 0.16 + k / TownLife.PER + s * 0.37) % 1;
        this.dummy.position.set(src.x + a * 1.6 + Math.sin(a * 6 + s) * 0.2, src.y + a * 3.4, src.z + a * 0.7);
        this.dummy.scale.setScalar(0.35 + a * 1.4);
        this.dummy.rotation.set(a * 3, a * 2, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n++, this.dummy.matrix);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function buildTown(land: Landscape, place: TownPlacement, seed: number): TownView {
  const g = new THREE.Group();
  const rand = mulberry32(seed);
  const def = place.def;
  const style: TownStyle = TOWN_STYLES[def.id] ?? DEFAULT_STYLE;
  const hw = land.halfWidth(def.river);
  const river0 = land.pointAt(def.river, def.riverT);
  const out = land.normalAt(def.river, def.riverT).multiplyScalar(def.side);
  const along = land.tangentAt(def.river, def.riverT);
  const center = place.center;
  const R = place.radius;
  // dicht gebaut wie eine alte Stadt: kleiner Umkreis, Häuser Wand an Wand an engen Gassen
  const outer = R * 1.3;

  const worldXZ = (u: number, v: number) =>
    new THREE.Vector3(center.x + out.x * u + along.x * v, 0, center.z + out.z * u + along.z * v);
  const at = (u: number, v: number) => {
    const p = worldXZ(u, v);
    p.y = land.heightAt(p.x, p.z);
    return p;
  };
  const onLand = (x: number, z: number, margin: number) => land.riverDistance(x, z).d > RIVER_HALF_WIDTH + margin;

  const kit = new Kit();
  const glow = new Kit();
  const reserved: { x: number; z: number; r: number }[] = [];
  const smoke: THREE.Vector3[] = [];
  const anims: Anim[] = [];

  // --- Straßen: vom Steg durch die Mitte bergwärts, quer über den Platz, hinter den Uferplätzen entlang ---
  const roads: Road[] = [];
  const roadHalf = style.plaza !== null ? 0.7 : 0.6;
  const line = (pts: THREE.Vector3[], half: number) => {
    const fine: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.9));
      for (let k = 0; k < n; k++) fine.push(a.clone().lerp(b, k / n));
    }
    fine.push(pts[pts.length - 1].clone());
    roads.push({ pts: fine, half });
  };
  const shoreU = -(3 + R) + SHORE + 1.4; // Stegwurzel in Stadtkoordinaten
  const wobble = (k: number) => (rand() - 0.5) * k;
  line([worldXZ(shoreU, 0), worldXZ(-R * 0.4, wobble(1)), worldXZ(0, 0), worldXZ(R * 0.6, wobble(2)), worldXZ(R * 1.25, wobble(3))], roadHalf);
  line([worldXZ(wobble(1), -R * 1.15), worldXZ(0, -R * 0.5), worldXZ(0, 0), worldXZ(wobble(1.5), R * 0.5), worldXZ(wobble(2), R * 1.15)], roadHalf * 0.9);
  const behindLots = shoreU + 6.4;
  if (R > 10) line([worldXZ(behindLots, -R), worldXZ(behindLots + 0.6, 0), worldXZ(behindLots, R)], roadHalf * 0.8);

  // Bänder auf dem Gelände; im Wasser und am Steilhang aussetzen
  const ribbon = new Kit();
  const roadPos: number[] = [];
  for (const road of roads) {
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i];
      const b = road.pts[i + 1];
      if (!onLand(a.x, a.z, 1.6) || !onLand(b.x, b.z, 1.6)) continue;
      if (!land.inWorld(a.x, a.z, 1) || !land.inWorld(b.x, b.z, 1)) continue;
      if (land.nearCanal(a.x, a.z, 0.5) || land.nearCanal(b.x, b.z, 0.5)) continue;
      const ha = land.surfaceAt(a.x, a.z);
      const hb = land.surfaceAt(b.x, b.z);
      if (ha > 9 || hb > 9) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * road.half;
      const nz = (dx / l) * road.half;
      const ya = ha + 0.05;
      const yb = hb + 0.05;
      roadPos.push(a.x + nx, ya, a.z + nz, b.x + nx, yb, b.z + nz, b.x - nx, yb, b.z - nz);
      roadPos.push(a.x + nx, ya, a.z + nz, b.x - nx, yb, b.z - nz, a.x - nx, ya, a.z - nz);
    }
  }
  if (roadPos.length) {
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
    ribbon.addMatrix(rg, style.road, new THREE.Matrix4());
  }

  // --- Marktplatz ---
  const plazaRadius = style.plaza !== null ? Math.min(4.6, 2.3 + R * 0.15) : 0;
  if (style.plaza !== null) {
    const c = at(0, 0);
    // Pflaster als Scheibe, die dem Gelände folgt, mit dunklerem Randstein
    const disc = (r0: number, r1: number, rings: number, color: number, lift: number) => {
      const segs = 32;
      const pos: number[] = [];
      const ring = (r: number, j: number) => {
        const a = (j / segs) * Math.PI * 2;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        return [x, land.surfaceAt(x, z) + lift, z];
      };
      for (let i = 0; i < rings; i++) {
        const ra = r0 + ((r1 - r0) * i) / rings;
        const rb = r0 + ((r1 - r0) * (i + 1)) / rings;
        for (let j = 0; j < segs; j++) {
          const a0 = ring(ra, j);
          const a1 = ring(ra, j + 1);
          const b0 = ring(rb, j);
          const b1 = ring(rb, j + 1);
          pos.push(...a0, ...b1, ...b0, ...a0, ...a1, ...b1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      ribbon.addMatrix(geo, color, new THREE.Matrix4());
    };
    disc(0, plazaRadius, 6, style.plaza, 0.06);
    disc(plazaRadius, plazaRadius + 0.3, 1, 0x7f7668, 0.07);
    reserved.push({ x: c.x, z: c.z, r: plazaRadius + 0.6 });
  }

  // --- Anlegestelle ---
  buildHarbor(kit, land, place, style, river0, out, hw, rand);
  // Steg und Uferstraße freihalten
  reserved.push({ x: worldXZ(shoreU, 0).x, z: worldXZ(shoreU, 0).z, r: 2 });

  // --- Wahrzeichen ---
  const freeAt = (x: number, z: number, r: number) => {
    if (!land.inWorld(x, z, r + 1) || land.nearCanal(x, z, r + 0.5)) return false;
    if (!onLand(x, z, 2.4 + r * 0.6)) return false;
    if (allLots(place).some((l) => Math.hypot(l.pos.x - x, l.pos.z - z) < 3.6 + r)) return false;
    if (reserved.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + r)) return false;
    if (roads.some((rd) => distToRoad(x, z, rd) < rd.half + r * 0.75)) return false;
    return land.heightAt(x, z) < 9.5;
  };
  const groundUnder = (x: number, z: number, r: number) => {
    let lo = land.heightAt(x, z);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      lo = Math.min(lo, land.heightAt(x + Math.cos(a) * r * 0.7, z + Math.sin(a) * r * 0.7));
    }
    return lo - 0.05;
  };
  const ctx: StyleCtx = {
    kit,
    group: g,
    anims,
    smoke,
    rand,
    glow,
    radius: R,
    plazaRadius,
    at,
    site(u, v, r, fn, face = 'river') {
      for (let k = 0; k < 48; k++) {
        const ring = k === 0 ? 0 : 0.8 + Math.floor((k - 1) / 8) * 1.1;
        const a = ((k - 1) % 8) * (Math.PI / 4) + Math.floor((k - 1) / 8) * 0.4;
        const p = worldXZ(u + Math.cos(a) * ring, v + Math.sin(a) * ring);
        if (!freeAt(p.x, p.z, r)) continue;
        const y = groundUnder(p.x, p.z, r);
        const ry = face === 'river' ? Math.atan2(-out.x, -out.z) : Math.atan2(center.x - p.x, center.z - p.z);
        kit.at({ x: p.x, y, z: p.z, ry }, fn);
        reserved.push({ x: p.x, z: p.z, r });
        return true;
      }
      return false;
    },
    reserveLocal(x, z, r) {
      const p = kit.local(x, 0, z);
      reserved.push({ x: p.x, z: p.z, r });
    },
  };
  style.decorate(ctx);

  // --- Häuser: Kandidaten in wachsenden Ringen, an den Straßen zuerst ---
  // Enge Gassen im Raster entlang der Hauptachsen, nur wo nichts anderes steht
  const lanes: Road[] = [];
  const laneHalf = 0.36;
  const gap = 2.9;
  const laneOk = (p: THREE.Vector3) =>
    onLand(p.x, p.z, 2) &&
    land.inWorld(p.x, p.z, 1) &&
    !land.nearCanal(p.x, p.z, 0.4) &&
    land.heightAt(p.x, p.z) < 9 &&
    !allLots(place).some((l) => Math.hypot(l.pos.x - p.x, l.pos.z - p.z) < 3.2) &&
    !reserved.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < q.r + 0.3);
  const addLane = (pts: THREE.Vector3[]) => {
    // in zusammenhängende Stücke zerlegen, die frei liegen
    let run: THREE.Vector3[] = [];
    const flush = () => {
      if (run.length > 2) lanes.push({ pts: run, half: laneHalf });
      run = [];
    };
    for (const p of pts) {
      if (laneOk(p)) run.push(p);
      else flush();
    }
    flush();
  };
  const steps = (a: number, b: number) => {
    const out: number[] = [];
    for (let x = a; x <= b; x += 0.8) out.push(x);
    return out;
  };
  for (const k of [-2, -1, 1, 2]) {
    if (Math.abs(k) * gap > outer) continue;
    addLane(steps(-R * 0.45, outer).map((u) => worldXZ(u, k * gap + Math.sin(u * 0.5 + k) * 0.25)));
    addLane(steps(-outer, outer).map((v) => worldXZ(k * gap + Math.sin(v * 0.5 + k) * 0.25, v)));
  }
  const lanePos: number[] = [];
  for (const lane of lanes) {
    for (let i = 0; i < lane.pts.length - 1; i++) {
      const a = lane.pts[i];
      const b = lane.pts[i + 1];
      if (roads.some((rd) => distToRoad(a.x, a.z, rd) < rd.half)) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * laneHalf;
      const nz = (dx / l) * laneHalf;
      const ya = land.surfaceAt(a.x, a.z) + 0.05;
      const yb = land.surfaceAt(b.x, b.z) + 0.05;
      lanePos.push(a.x + nx, ya, a.z + nz, b.x + nx, yb, b.z + nz, b.x - nx, yb, b.z - nz);
      lanePos.push(a.x + nx, ya, a.z + nz, b.x - nx, yb, b.z - nz, a.x - nx, ya, a.z - nz);
    }
  }
  if (lanePos.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lanePos, 3));
    const c = new THREE.Color(style.road).multiplyScalar(0.88);
    ribbon.addMatrix(lg, c.getHex(), new THREE.Matrix4());
  }
  const allWays = [...roads, ...lanes];

  // --- Häuser: Kandidaten in wachsenden Ringen, Wand an Wand an den Gassen ---
  const max = def.houses * 3;
  type Spot = { x: number; z: number; d: number; type: HouseType; rot: number; s: number; sy: number };
  const spots: Spot[] = [];
  let tries = 0;
  while (spots.length < max && tries < 9000) {
    tries++;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * outer * (tries > 6000 ? 1.25 : 1);
    const x = center.x + Math.cos(a) * r;
    const z = center.z + Math.sin(a) * r;
    const type = pickWeighted(style.houses, rand());
    const model = houseModel(type);
    const s = style.scale * (0.88 + rand() * 0.24) * (r < R * 0.6 ? 1.08 : 1);
    const foot = model.radius * s;
    if (!land.inWorld(x, z, foot + 1) || land.nearCanal(x, z, foot + 0.3)) continue;
    if (!onLand(x, z, 2.2 + foot * 0.5)) continue;
    if (land.heightAt(x, z) > 9) continue; // nicht an den Steilhang
    if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < (foot + houseModel(p.type).radius * p.s) * 0.55)) continue;
    if (allLots(place).some((l) => Math.hypot(l.pos.x - x, l.pos.z - z) < 3.4 + foot * 0.8)) continue; // Bauplätze freihalten
    if (reserved.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + foot * 0.85)) continue;
    let nearRoad: Road | null = null;
    let roadDist = Infinity;
    let blocked = false;
    for (const rd of allWays) {
      const d = distToRoad(x, z, rd);
      if (d < rd.half + foot * 0.58) {
        blocked = true;
        break;
      }
      if (d < roadDist) {
        roadDist = d;
        nearRoad = rd;
      }
    }
    if (blocked) continue;
    // Front zur nächsten Gasse oder Straße, sonst zur Mitte
    let rot: number;
    if (nearRoad && roadDist < nearRoad.half + foot + 2.2) {
      const q = nearestOnRoad(x, z, nearRoad);
      rot = Math.atan2(q.x - x, q.z - z);
    } else {
      rot = Math.atan2(center.x - x, center.z - z) + (rand() - 0.5) * 0.5;
    }
    // innen höher gebaut, außen niedrig
    const sy = type === 'scheune' || type === 'huette' ? 1 : 1 + Math.max(0, 1 - r / (R * 0.9)) * 0.45 * (0.6 + rand() * 0.4);
    spots.push({ x, z, d: r + rand() * 1.5, type, rot, s, sy });
  }
  spots.sort((p, q) => p.d - q.d);

  // je Haustyp ein Körper- und ein Dach-Mesh, beide instanziert
  const byType = new Map<HouseType, { body: THREE.InstancedMesh; roof: THREE.InstancedMesh; n: number }>();
  const prefix = new Map<HouseType, number[]>(); // prefix[type][k] = Häuser dieses Typs unter den ersten k
  const counts = new Map<HouseType, number>();
  for (const sp of spots) counts.set(sp.type, (counts.get(sp.type) ?? 0) + 1);
  for (const [type, n] of counts) {
    const m = houseModel(type);
    const body = new THREE.InstancedMesh(m.body, KIT_MATERIAL, n);
    const roof = new THREE.InstancedMesh(m.roof, KIT_MATERIAL, n);
    body.castShadow = roof.castShadow = true;
    body.receiveShadow = roof.receiveShadow = true;
    byType.set(type, { body, roof, n: 0 });
    prefix.set(type, [0]);
    g.add(body, roof);
  }
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const chimneys: THREE.Vector3[] = [];
  spots.forEach((sp) => {
    const entry = byType.get(sp.type)!;
    const m = houseModel(sp.type);
    const y = groundUnder(sp.x, sp.z, m.radius * sp.s);
    dummy.position.set(sp.x, y, sp.z);
    dummy.rotation.set(0, sp.rot, 0);
    dummy.scale.set(sp.s, sp.s * sp.sy, sp.s);
    dummy.updateMatrix();
    entry.body.setMatrixAt(entry.n, dummy.matrix);
    entry.roof.setMatrixAt(entry.n, dummy.matrix);
    entry.body.setColorAt(entry.n, color.setHex(pick(style.wallsFor?.[sp.type] ?? style.walls, rand())));
    entry.roof.setColorAt(entry.n, color.setHex(pick(style.roofsFor?.[sp.type] ?? style.roofs, rand())));
    entry.n++;
    for (const [type, list] of prefix) list.push(list[list.length - 1] + (type === sp.type ? 1 : 0));
    chimneys.push(m.chimney ? m.chimney.clone().applyMatrix4(dummy.matrix) : new THREE.Vector3(NaN, 0, 0));
  });

  // --- Statisches zusammenführen ---
  if (!ribbon.empty) {
    // gemeinsame Ecken verschmelzen, damit die Auflage weich schattiert wird
    const flat = ribbon.geometry();
    flat.deleteAttribute('normal');
    const smooth = mergeVertices(flat, 0.01);
    smooth.computeVertexNormals();
    const roadMesh = new THREE.Mesh(smooth, DECAL_MATERIAL);
    roadMesh.receiveShadow = true;
    g.add(roadMesh);
  }
  if (!kit.empty) g.add(kit.mesh());
  if (!glow.empty) {
    const gm = new THREE.Mesh(
      glow.geometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 1, color: 0xffffff }),
    );
    (gm.material as THREE.MeshStandardMaterial).onBeforeCompile = (shader) => {
      // Glut leuchtet in ihrer eigenen Farbe
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance = vColor.rgb * 0.9;',
      );
    };
    g.add(gm);
  }

  // Rauch: Wahrzeichen immer, dazu einige Wohnhäuser
  const fixedSmoke = smoke.length;
  const houseSmoke: number[] = [];
  chimneys.forEach((c, i) => {
    if (!Number.isNaN(c.x) && i % 5 === 1) houseSmoke.push(i);
  });
  const sources = [...smoke, ...houseSmoke.slice(0, 4).map((i) => chimneys[i])];
  const life = new TownLife(sources, anims);
  g.add(life.mesh);

  const setPopulation = (pop: number) => {
    const n = Math.min(spots.length, houseCount(def, pop));
    for (const [type, e] of byType) {
      const c = prefix.get(type)![n];
      e.body.count = c;
      e.roof.count = c;
    }
    life.active = fixedSmoke + houseSmoke.slice(0, 4).filter((i) => i < n).length;
  };
  setPopulation(def.population);
  // Nur im Dev-Server: Stadtmitten für Screenshot-Skripte
  if (import.meta.env.DEV) {
    const w = globalThis as { __towns?: Record<string, number[]> };
    (w.__towns ??= {})[def.id] = [center.x, center.y, center.z];
  }

  return { group: g, setPopulation };
}

/** Steg aus Holz mit Querkopf oder (in der Hafenstadt) eine gemauerte Kaimauer */
function buildHarbor(
  kit: Kit,
  land: Landscape,
  place: TownPlacement,
  style: TownStyle,
  river0: THREE.Vector3,
  out: THREE.Vector3,
  hw: number,
  rand: () => number,
): void {
  const def = place.def;
  const ry = Math.atan2(out.x, out.z); // lokal +z zeigt vom Fluss weg
  const deck = 0.32;
  if (style.harbor === 'kai') {
    const len = land.curve(def.river).getLength();
    const steps = 30;
    const span = 34;
    for (let i = 0; i < steps; i++) {
      const v0 = -span / 2 + (span * i) / steps;
      const v1 = v0 + span / steps;
      const t0 = def.riverT + v0 / len;
      const t1 = def.riverT + v1 / len;
      if (t0 < 0.01 || t1 > 0.995) continue;
      const tm = (t0 + t1) / 2;
      const p = land.pointAt(def.river, tm);
      const n = land.normalAt(def.river, tm).multiplyScalar(def.side);
      const segLen = land.pointAt(def.river, t0).distanceTo(land.pointAt(def.river, t1)) + 0.08;
      const rot = Math.atan2(n.x, n.z);
      const front = hw + 0.45;
      kit.at({ x: p.x + n.x * front, z: p.z + n.z * front, ry: rot }, () => {
        kit.add(boxGeo(segLen, 2.2, 2.6), C.stone, { y: -1.6, z: 1.3 });
        kit.add(boxGeo(segLen, 0.12, 0.35), C.stoneLight, { y: 0.6, z: 0.15 });
        kit.add(boxGeo(segLen, 0.08, 2.3), 0xa89e8c, { y: 0.56, z: 1.5 });
        if (i % 4 === 0) kit.add(cylGeo(0.12, 0.15, 0.35, 6), C.iron, { y: 0.6, z: 0.4 });
        if (i % 7 === 3) {
          barrel(kit, 0.3, 1.6, 0.6);
          crate(kit, -0.4, 1.9, 0.45, 0.6);
        }
      });
    }
    // zwei Hafenkräne auf der Kaimauer
    for (const v of [-8.3, 8.3]) {
      const t = def.riverT + v / len;
      const p = land.pointAt(def.river, t);
      const n = land.normalAt(def.river, t).multiplyScalar(def.side);
      kit.at({ x: p.x + n.x * (hw + 1.7), y: 0.6, z: p.z + n.z * (hw + 1.7), ry: Math.atan2(-n.x, -n.z) + Math.PI }, () => {
        kit.add(boxGeo(1.6, 1.5, 1.6), C.wood);
        kit.add(boxGeo(1.8, 0.1, 1.8), C.shingle, { y: 1.5 });
        kit.add(boxGeo(0.22, 3.2, 0.22), C.timber, { y: 1.2 });
        kit.add(boxGeo(0.18, 0.18, 3.0), C.timber, { y: 4.0, z: -1.1, rx: 0.35 });
        kit.add(boxGeo(0.03, 1.6, 0.03), C.rope, { y: 2.4, z: -2.45 });
        crate(kit, 0, -2.45, 0.45, 2.0);
      });
    }
    return;
  }

  // Holzsteg: Querkopf längs des Ufers, Zugang zum Land, Pfähle, Poller
  kit.at({ x: river0.x, z: river0.z, ry }, () => {
    const head = hw + 1.35;
    const rootZ = hw + SHORE + 2.2;
    const headLen = 6.5;
    // Bohlen mit Fugen
    for (let x = -headLen / 2; x < headLen / 2 - 0.01; x += 0.42) {
      kit.add(boxGeo(0.38, 0.1, 1.3), rand() < 0.5 ? C.woodLight : 0xa07a4c, { x: x + 0.21, y: deck, z: head });
    }
    for (let z = head + 0.65; z < rootZ; z += 0.42) kit.add(boxGeo(1.25, 0.1, 0.38), rand() < 0.5 ? C.woodLight : 0xa07a4c, { y: deck, z: z + 0.21 });
    for (const sz of [-0.62, 0.62]) for (let x = -headLen / 2 + 0.2; x <= headLen / 2; x += 1.5) kit.add(cylGeo(0.09, 0.1, 2.4, 6), C.woodDark, { x, y: -1.85, z: head + sz });
    for (const sx of [-0.62, 0.62]) for (let z = head + 1.4; z < rootZ - 0.4; z += 1.4) kit.add(cylGeo(0.09, 0.1, 2.4, 6), C.woodDark, { x: sx, y: -1.85, z });
    kit.add(boxGeo(headLen, 0.12, 0.12), C.woodDark, { y: deck - 0.1, z: head - 0.66 });
    for (const x of [-2.6, 0, 2.6]) {
      kit.add(cylGeo(0.1, 0.12, 0.3, 6), C.woodDark, { x, y: deck + 0.1, z: head - 0.45 });
      kit.add(cylGeo(0.13, 0.13, 0.05, 6), C.woodDark, { x, y: deck + 0.4, z: head - 0.45 });
    }
    // Ladung an der Stegwurzel
    crate(kit, 1.4, rootZ - 0.3, 0.5, Math.max(deck, 0.2), 0x9a7a4a, 0.3);
    barrel(kit, -1.3, rootZ - 0.2, 0.2);
    barrel(kit, -1.7, rootZ + 0.2, 0.2);
    // Laterne am Steg
    kit.add(boxGeo(0.08, 1.6, 0.08), C.woodDark, { x: headLen / 2 - 0.3, y: deck, z: head + 0.45 });
    kit.add(boxGeo(0.22, 0.28, 0.22), 0x3a3020, { x: headLen / 2 - 0.3, y: deck + 1.55, z: head + 0.45 });
  });
}

/** Alte Steinbrücke mit zwei Bögen über einen Abschnitt mit Brückenhöhe */
export function buildBridge(land: Landscape, seg: SegmentDef, modern = false): THREE.Group {
  const g = new THREE.Group();
  const t = seg.fromT + (seg.toT - seg.fromT) * 0.3;
  if (modern) return modernBridge(land, seg, t);
  const p = land.pointAt(seg.river, t);
  const tan = land.tangentAt(seg.river, t);
  const hw = land.halfWidth(seg.river);
  const span = hw * 2 + 7;
  // Bauhöhe optisch etwa 1 m = 0,5 Einheiten
  const deckY = (seg.bridgeHeight ?? 4) * 0.5 + 0.4;
  const bottom = -1.6;
  const top = deckY + 0.25;
  const pierW = 1.1;
  const piers = [-hw - 1.2, 0, hw + 1.2];

  // Brückenkörper als Profil mit Bogenöffnungen, in die Tiefe gezogen
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, bottom);
  shape.lineTo(span / 2, bottom);
  shape.lineTo(span / 2, top);
  shape.lineTo(-span / 2, top);
  shape.closePath();
  for (let i = 0; i < piers.length - 1; i++) {
    const x0 = piers[i] + pierW / 2;
    const x1 = piers[i + 1] - pierW / 2;
    const r = (x1 - x0) / 2;
    const spring = Math.min(deckY - 0.5 - r, 1.2);
    const hole = new THREE.Path();
    hole.moveTo(x0, bottom + 0.1);
    hole.lineTo(x1, bottom + 0.1);
    hole.lineTo(x1, spring);
    hole.absarc((x0 + x1) / 2, spring, r, 0, Math.PI, false);
    hole.lineTo(x0, bottom + 0.1);
    shape.holes.push(hole);
  }
  const body = new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: false, curveSegments: 10 });
  body.translate(0, 0, -1.2);

  const kit = new Kit();
  kit.addMatrix(body, 0xb8a588, new THREE.Matrix4());
  // Gesims, Brüstung und Abdeckplatten
  kit.add(boxGeo(span, 0.14, 2.7), 0xc9b89a, { y: deckY - 0.3 });
  for (const sz of [-1, 1]) {
    kit.add(boxGeo(span, 0.5, 0.28), 0xb0a084, { y: top, z: sz * 1.08 });
    kit.add(boxGeo(span + 0.1, 0.08, 0.36), 0xcfc0a4, { y: top + 0.5, z: sz * 1.08 });
  }
  kit.add(boxGeo(span, 0.04, 1.85), 0x9a9080, { y: top });
  // Wellenbrecher vor den Pfeilern
  for (const x of piers.slice(1, -1)) {
    for (const sz of [-1, 1]) {
      kit.add(boxGeo(0.8, deckY + 1.2, 0.8), 0xa8967a, { x, y: bottom, z: sz * 1.25, ry: Math.PI / 4 });
      kit.add(cylGeo(0.02, 0.6, 0.5, 4), 0xa8967a, { x, y: bottom + deckY + 1.2, z: sz * 1.25, ry: Math.PI / 4 });
    }
  }
  // Rampen zu den Ufern
  const theta = Math.atan2(-tan.z, tan.x) + Math.PI / 2;
  for (const sx of [-1, 1]) {
    const lx = sx * (span / 2 + 3);
    const land0 = land.heightAt(p.x + Math.cos(theta) * lx, p.z - Math.sin(theta) * lx);
    const drop = Math.max(0.5, top - Math.max(0.2, land0));
    const runLen = Math.max(2.5, drop * 1.6);
    kit.add(boxGeo(runLen, 0.5, 2.4), 0xa8967a, { x: sx * (span / 2 + runLen / 2 - 0.1), y: top - drop / 2 - 0.45, rz: -sx * Math.atan2(drop, runLen) });
  }
  // Laternen auf der Brüstung
  for (const x of [-span / 2 + 0.6, span / 2 - 0.6]) {
    kit.add(boxGeo(0.1, 1.0, 0.1), C.iron, { x, y: top + 0.55, z: 1.08 });
    kit.add(boxGeo(0.25, 0.3, 0.25), 0x3a3020, { x, y: top + 1.5, z: 1.08 });
  }
  g.add(kit.mesh());
  g.position.set(p.x, 0, p.z);
  // Brücke quer zum Fluss: lokale x-Achse entlang der Ufernormalen
  g.rotation.y = Math.atan2(-tan.z, tan.x) + Math.PI / 2;
  return g;
}

/** Hohe Bogenbrücke aus Eisen auf Steinpfeilern, ersetzt die alte Steinbrücke */
function modernBridge(land: Landscape, seg: SegmentDef, t: number): THREE.Group {
  const g = new THREE.Group();
  const p = land.pointAt(seg.river, t);
  const tan = land.tangentAt(seg.river, t);
  const hw = land.halfWidth(seg.river);
  const span = hw * 2 + 9;
  const deckY = (seg.bridgeHeight ?? 11) * 0.5 + 0.4;
  const kit = new Kit();
  const iron = 0x3e4a52;
  kit.add(boxGeo(span, 0.35, 2.2), iron, { y: deckY - 0.17 });
  kit.add(boxGeo(span, 0.04, 1.8), 0x7a7a72, { y: deckY + 0.18 });
  // zwei Bögen als Fachwerk aus kurzen Stäben
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const x = -span / 2 + 1 + ((span - 2) * i) / 16;
      const k = x / (span / 2 - 1);
      pts.push(new THREE.Vector3(x, deckY + 0.2 + (1 - k * k) * 2.4, side * 1));
    }
    kit.addMatrix(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.09, 5), iron, new THREE.Matrix4());
    for (let i = 1; i < 16; i += 1) {
      const h = pts[i].y - deckY;
      kit.add(boxGeo(0.06, h, 0.06), iron, { x: pts[i].x, y: deckY, z: side * 1 });
      if (i % 2 === 0 && i < 16) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = Math.hypot(b.x - a.x, b.y - deckY);
        kit.add(boxGeo(0.04, len, 0.04), iron, { x: (a.x + b.x) / 2, y: deckY + (b.y - deckY) / 2 - len / 2, z: side, rz: -Math.atan2(b.x - a.x, b.y - deckY) });
      }
    }
    kit.add(boxGeo(span, 0.06, 0.06), iron, { y: deckY + 0.7, z: side * 1.05 });
  }
  for (let i = 2; i < 15; i += 2) kit.add(boxGeo(0.06, 0.06, 2.0), iron, { x: -span / 2 + 1 + ((span - 2) * i) / 16, y: deckY + 0.2 + (1 - ((-span / 2 + 1 + ((span - 2) * i) / 16) / (span / 2 - 1)) ** 2) * 2.4 });
  for (const x of [-hw - 2, hw + 2]) {
    kit.add(boxGeo(1.6, deckY + 2, 2.8), 0xb8a588, { x, y: -2 });
    kit.add(boxGeo(1.8, 0.2, 3.0), 0xcfc0a4, { x, y: deckY - 0.35 });
  }
  g.add(kit.mesh());
  g.position.set(p.x, 0, p.z);
  g.rotation.y = Math.atan2(-tan.z, tan.x) + Math.PI / 2;
  return g;
}
