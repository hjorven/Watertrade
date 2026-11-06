import * as THREE from 'three';
import type { Lot, TownPlacement } from './towns.ts';
import { CIVIC_COUNT, KONTOR_LOTS } from './towns.ts';
import { civicGreen, civicModel, CIVIC_ORDER } from './civic.ts';

/** Kontore und eigene Betriebe als kleine Modelle auf den Uferplätzen der Städte */

const mats = new Map<number, THREE.MeshStandardMaterial>();
const mat = (color: number, flat = false): THREE.MeshStandardMaterial => {
  const key = color * 2 + (flat ? 1 : 0);
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.88, flatShading: flat });
    mats.set(key, m);
  }
  return m;
};

export const PLAYER_COLOR = 0xa8322a;
const STONE = 0x9a8f80;
const WALL = 0xe9dcc0;
const TIMBER = 0x6b4628;
const ROOF = 0x7f3a2a;
const DARK = 0x3d2a1c;

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Satteldach als dreiseitiges Prisma */
function roof(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2 - 0.15, 0);
  shape.lineTo(d / 2 + 0.15, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w + 0.3, bevelEnabled: false });
  geo.translate(0, 0, -(w + 0.3) / 2);
  geo.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat(color, true));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Haus mit Sockel, Wänden und Dach; Front zeigt nach +z */
function house(w: number, h: number, d: number, wall = WALL, roofColor = ROOF, x = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w + 0.2, 1.6, d + 0.2, STONE, 0, -1.4, 0));
  g.add(box(w, h, d, wall, 0, 0.2, 0));
  g.add(roof(w, h * 0.55 + 0.3, d, roofColor, 0, h + 0.2, 0));
  // Fachwerkbalken an der Front
  for (const bx of [-w / 2 + 0.05, w / 2 - 0.05]) g.add(box(0.12, h, 0.06, TIMBER, bx, 0.2, d / 2 + 0.01));
  g.add(box(w, 0.1, 0.06, TIMBER, 0, 0.2 + h * 0.55, d / 2 + 0.01));
  g.add(box(0.5, 0.85, 0.05, DARK, 0, 0.2, d / 2 + 0.03));
  g.position.set(x, 0, z);
  return g;
}

function flag(color: number, height: number, x: number, z: number): { group: THREE.Group; cloth: THREE.Mesh } {
  const g = new THREE.Group();
  g.add(box(0.07, height, 0.07, DARK, 0, 0, 0));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5, 6, 1), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 }));
  cloth.geometry.translate(0.45, 0, 0);
  cloth.position.set(0.03, height - 0.3, 0);
  cloth.castShadow = true;
  g.add(cloth);
  g.position.set(x, 0, z);
  return { group: g, cloth };
}

function barrel(x: number, z: number, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8), mat(0x7a5530));
  m.position.set(x, y + 0.25, z);
  m.castShadow = true;
  return m;
}

function logPile(x: number, z: number, n = 6, color = 0x8a5a33): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.16, 0.16, 1.8, 7).rotateX(Math.PI / 2);
  let i = 0;
  for (let row = 0; i < n; row++) {
    for (let k = 0; k < 3 - row && i < n; k++, i++) {
      const m = new THREE.Mesh(geo, mat(color));
      m.position.set((k - (2 - row) / 2) * 0.33, 0.16 + row * 0.28, 0);
      m.castShadow = true;
      g.add(m);
    }
  }
  g.position.set(x, 0, z);
  return g;
}

function chimney(x: number, z: number, h: number, base: number, color = 0x8a5040): { mesh: THREE.Mesh; top: THREE.Vector3 } {
  const m = box(0.4, h, 0.4, color, x, base, z);
  return { mesh: m, top: new THREE.Vector3(x, base + h, z) };
}

interface Built {
  group: THREE.Group;
  smoke: THREE.Vector3[]; // lokale Rauchquellen
  spinners: THREE.Object3D[]; // drehen sich, wenn der Betrieb läuft
  cloths: THREE.Mesh[];
}

function built(group: THREE.Group): Built {
  return { group, smoke: [], spinners: [], cloths: [] };
}

/** Kontor: Speicherhaus mit Ladeluke und Flagge, größer mit jeder Stufe, ab Stufe 3 mit Tretkran */
export function kontorModel(level: number, color: number): Built {
  const g = new THREE.Group();
  const b = built(g);
  const w = 3.6 + level * 0.6;
  const h = 2.2 + level * 0.6;
  g.add(house(w, h, 2.8, 0xd8c4a0, color));
  // Ladeluken übereinander und Balken mit Rolle
  for (let i = 1; i < level + 1; i++) g.add(box(0.6, 0.6, 0.05, DARK, w * 0.25, 0.2 + i * 0.9, 1.43));
  g.add(box(0.12, 0.12, 0.9, TIMBER, w * 0.25, h + 0.1, 1.6));
  // Kisten und Fässer vor dem Haus
  g.add(box(0.5, 0.5, 0.5, 0x9a7a4a, -w * 0.3, 0, 2));
  g.add(box(0.45, 0.45, 0.45, 0x8a6a3a, -w * 0.3 + 0.55, 0, 2.1));
  g.add(barrel(-w * 0.3 + 0.2, 2.6));
  if (level >= 2) g.add(house(2, h * 0.75, 2.2, WALL, color, -w / 2 - 1.1, -0.3));
  if (level >= 3) {
    // Tretkran am Ufer
    const crane = new THREE.Group();
    crane.add(box(0.25, 3.2, 0.25, TIMBER, 0, 0, 0));
    const jib = box(2.6, 0.18, 0.18, TIMBER, 1.1, 3.0, 0);
    crane.add(jib);
    crane.add(box(0.03, 1.6, 0.03, DARK, 2.3, 1.5, 0));
    crane.add(box(0.4, 0.4, 0.4, 0x9a7a4a, 2.3, 1.1, 0));
    crane.position.set(w / 2 + 0.8, 0, 2.8);
    crane.rotation.y = -Math.PI / 2;
    g.add(crane);
  }
  const f = flag(color, h + 2.6, -w / 2 + 0.2, 1.3);
  g.add(f.group);
  b.cloths.push(f.cloth);
  return b;
}

/** Eigene Betriebe, jeder mit einem erkennbaren Merkmal */
export function betriebModel(type: string, color: number): Built {
  const g = new THREE.Group();
  const b = built(g);
  const sign = (x: number, y: number, z: number) => g.add(box(0.7, 0.35, 0.06, color, x, y, z));
  switch (type) {
    case 'muehle': {
      // Bockwindmühle mit drehenden Flügeln
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 3.6, 8), mat(WALL, true));
      tower.position.y = 1.6;
      tower.castShadow = true;
      g.add(tower, box(2, 0.8, 2, STONE, 0, -0.6, 0));
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 8), mat(ROOF, true));
      cap.position.y = 4;
      g.add(cap);
      const hub = new THREE.Group();
      hub.position.set(0, 3.5, 1.15);
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        arm.rotation.z = (i * Math.PI) / 2;
        arm.add(box(0.1, 2.6, 0.06, TIMBER, 0, 0, 0));
        arm.add(box(0.55, 2.0, 0.03, 0xf0e8d8, 0.33, 0.55, 0.02));
        hub.add(arm);
      }
      g.add(hub);
      b.spinners.push(hub);
      sign(0, 0.4, 1.3);
      break;
    }
    case 'holzfaeller':
      g.add(house(2, 1.4, 1.8, 0x8a6a45, 0x5e4630));
      g.add(logPile(2.2, 0.5, 6), logPile(2.2, -1.2, 5, 0x7a4a2a));
      for (const [x, z] of [[-2, 1.5], [-2.6, 0.2], [-1.5, -1.5]]) g.add(box(0.35, 0.3, 0.35, 0x7a5530, x, 0, z));
      sign(0, 0.9, 0.95);
      break;
    case 'saegewerk': {
      g.add(house(3.2, 1.8, 2.2, 0x9a7a55, 0x5e4630));
      g.add(logPile(-2.6, 0.6, 6));
      g.add(box(1.6, 0.2, 0.9, 0xc8a878, 2.4, 0, 0.8), box(1.6, 0.2, 0.9, 0xc8a878, 2.4, 0.2, 0.8));
      // Wasserrad an der Seite
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 6, 12), mat(TIMBER));
      wheel.position.set(0, 0.9, 1.4);
      for (let i = 0; i < 4; i++) {
        const s = box(0.08, 1.8, 0.1, TIMBER, 0, -0.9, 0);
        s.rotation.z = (i * Math.PI) / 4;
        s.position.set(0, 0, 0);
        wheel.add(s);
      }
      g.add(wheel);
      b.spinners.push(wheel);
      sign(-1, 1.2, 1.15);
      break;
    }
    case 'bauernhof':
      g.add(house(3.2, 1.6, 2.2, 0xa0563a, 0x5e4630));
      g.add(house(1.8, 1.4, 1.6, WALL, ROOF, -2.8, 0.3));
      for (let i = 0; i < 4; i++) g.add(box(4.5, 0.06, 0.45, i % 2 ? 0xd9b65a : 0xc79f45, 0.5, -0.1, -2.2 - i * 0.55));
      sign(0, 0.9, 1.15);
      break;
    case 'fischerei':
      g.add(house(2.2, 1.3, 1.8));
      for (const x of [1.8, 2.8]) {
        g.add(box(0.08, 1.4, 0.08, TIMBER, x, 0, 1.2), box(0.08, 1.4, 0.08, TIMBER, x, 0, -0.6));
        g.add(box(0.05, 0.9, 1.7, 0x4a5a4a, x, 0.4, 0.3));
      }
      sign(0, 0.8, 0.95);
      break;
    case 'schaeferei': {
      g.add(house(2.2, 1.3, 1.8, WALL, 0x6b5a3a, -1.6, 0));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.add(box(0.08, 0.5, 0.08, TIMBER, 1.6 + Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6));
      }
      for (const [x, z] of [[1.2, 0.3], [2, -0.5], [1.7, 0.8], [2.2, 0.4], [1.1, -0.6]]) {
        const sheep = box(0.45, 0.3, 0.28, 0xf2eee4, x, 0.12, z);
        sheep.rotation.y = x * 3;
        g.add(sheep, box(0.14, 0.14, 0.14, 0x3a3a3a, x + 0.25, 0.32, z));
      }
      sign(-1.6, 0.8, 0.95);
      break;
    }
    case 'grube': {
      g.add(box(2.4, 1.8, 1.6, 0x6e655a, 0, 0, -0.6));
      g.add(box(1, 1.1, 0.2, 0x1a1410, 0, 0, 0.25));
      g.add(box(1.4, 0.15, 0.3, TIMBER, 0, 1.1, 0.3));
      const heap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1, 7), mat(0x5a5048, true));
      heap.position.set(2.1, 0.4, 0.3);
      g.add(heap);
      g.add(box(0.7, 0.35, 0.45, 0x4a3a2a, -1.6, 0.1, 1));
      // Förderrad
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 5, 10), mat(DARK));
      wheel.position.set(0, 2.6, -0.6);
      g.add(wheel, box(0.1, 2.2, 0.1, DARK, -0.6, 0, -0.6), box(0.1, 2.2, 0.1, DARK, 0.6, 0, -0.6));
      b.spinners.push(wheel);
      sign(0.9, 0.8, 0.4);
      break;
    }
    case 'koehlerei': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3a332c, true));
      dome.position.set(0.8, -0.2, 0);
      g.add(dome, house(1.6, 1.2, 1.4, 0x8a6a45, 0x5e4630, -1.8, 0));
      g.add(logPile(0.8, 1.8, 5));
      b.smoke.push(new THREE.Vector3(0.8, 1.1, 0));
      sign(-1.8, 0.7, 0.75);
      break;
    }
    case 'saline': {
      g.add(house(3.4, 1.5, 2, 0xb8aa95, 0x6b5a4a));
      for (const [x, z] of [[2.5, 1.2], [2.9, 0], [2.3, -1]]) {
        const pile = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.6, 7), mat(0xf4f2ee, true));
        pile.position.set(x, 0.3, z);
        g.add(pile);
      }
      const c = chimney(-1, -0.3, 1.4, 1.5);
      g.add(c.mesh);
      b.smoke.push(c.top);
      sign(0, 0.9, 1.05);
      break;
    }
    case 'glashuette': {
      g.add(house(3, 1.6, 2.2, 0xd0c0a8, 0x6a5a6a));
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 2.6, 8), mat(0x8a5040, true));
      cone.position.set(1.9, 1.3, -0.4);
      g.add(cone);
      b.smoke.push(new THREE.Vector3(1.9, 2.7, -0.4));
      sign(-0.6, 1, 1.15);
      break;
    }
    case 'schmiede': {
      g.add(house(2.6, 1.5, 2, 0x8a7a68, 0x4a3a32));
      const c = chimney(0.8, -0.4, 1.6, 1.7, 0x6a3a2a);
      g.add(c.mesh);
      b.smoke.push(c.top);
      const glow = box(0.6, 0.5, 0.05, 0xff8a3a, -0.8, 0.4, 1.03);
      (glow.material as THREE.MeshStandardMaterial) = new THREE.MeshStandardMaterial({ color: 0xff8a3a, emissive: 0xff5a1a, emissiveIntensity: 0.8 });
      g.add(glow, box(0.4, 0.4, 0.25, 0x333333, 1.8, 0, 1.2));
      sign(0.6, 0.9, 1.05);
      break;
    }
    case 'tischlerei':
      g.add(house(2.8, 1.6, 2));
      g.add(box(1.4, 0.12, 0.8, 0xc8a878, 2.4, 0, 0.6), box(1.4, 0.12, 0.8, 0xc8a878, 2.4, 0.12, 0.6), box(1.4, 0.12, 0.8, 0xc8a878, 2.4, 0.24, 0.6));
      g.add(box(0.6, 0.5, 0.4, 0x8a5a3a, -2, 0, 1.2));
      sign(0, 0.9, 1.05);
      break;
    case 'weberei':
      g.add(house(4, 1.8, 2, 0xe4d6bc, 0x5a6a7a));
      for (let i = 0; i < 4; i++) g.add(box(0.4, 0.5, 0.05, 0x4a5a6a, -1.5 + i, 0.9, 1.02));
      g.add(box(0.6, 0.6, 0.6, 0xeee6d6, 2.6, 0, 0.8), box(0.6, 0.6, 0.6, 0xe6dccb, 2.6, 0.6, 0.8));
      sign(0, 0.5, 1.05);
      break;
    case 'brauerei': {
      g.add(house(3, 1.7, 2.2, WALL, 0x7a4a2a));
      for (let i = 0; i < 4; i++) g.add(barrel(2.2 + (i % 2) * 0.5, 0.8 - Math.floor(i / 2) * 0.5));
      const c = chimney(-0.8, -0.4, 1.4, 1.8);
      g.add(c.mesh);
      b.smoke.push(c.top);
      sign(0, 1, 1.15);
      break;
    }
    case 'baeckerei': {
      g.add(house(2.6, 1.5, 2, 0xf0e2c4, ROOF));
      const c = chimney(0.7, -0.3, 1.2, 1.6);
      g.add(c.mesh);
      b.smoke.push(c.top);
      g.add(box(0.8, 0.5, 0.6, 0xc87a4a, -1.9, 0, 0.6));
      sign(0, 0.9, 1.05);
      break;
    }
    case 'apotheke':
    default:
      g.add(house(2.2, 1.8, 1.8, 0xf2ecd8, 0x4a6a5a));
      g.add(box(0.5, 0.5, 0.06, 0x6a8f5a, 0.7, 1.1, 0.95));
      sign(-0.4, 1.1, 0.95);
      break;
  }
  return b;
}

/** Rauchwölkchen, die von Schornsteinen aufsteigen */
class Smoke {
  readonly mesh: THREE.InstancedMesh;
  private readonly sources: THREE.Vector3[] = [];
  private readonly puffs: { src: number; age: number }[] = [];
  private readonly dummy = new THREE.Object3D();
  private static readonly MAX = 240;

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.35, 0),
      new THREE.MeshStandardMaterial({ color: 0xd8d4cc, transparent: true, opacity: 0.55, roughness: 1, flatShading: true }),
      Smoke.MAX,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  setSources(world: THREE.Vector3[]): void {
    this.sources.length = 0;
    this.sources.push(...world);
    this.puffs.length = 0;
    world.forEach((_, i) => {
      for (let k = 0; k < 8; k++) this.puffs.push({ src: i, age: k / 8 });
    });
  }

  update(dt: number, wind: number): void {
    let n = 0;
    for (const p of this.puffs) {
      p.age = (p.age + dt * 0.18) % 1;
      if (n >= Smoke.MAX) break;
      const s = this.sources[p.src];
      const a = p.age;
      this.dummy.position.set(s.x + a * 2.2 * wind, s.y + a * 3.2, s.z + a * 0.8 * wind);
      this.dummy.scale.setScalar(0.4 + a * 1.4);
      this.dummy.rotation.set(a * 3, a * 2, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n++, this.dummy.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export interface EstateInfo {
  /** Besitzer der Kontore in der Stadt, in fester Reihenfolge: Spieler zuerst */
  kontore: { color: number; level: number }[];
  betriebe: { type: string; active: boolean }[];
  /** Stadthaus und Stiftungen des Spielers (Ids aus render/civic.ts) */
  civic?: string[];
}

/** Geometrien eines abgerissenen Stadtteils freigeben; Materialien sind geteilt und bleiben, geteilte Fahnentücher auch */
function disposeGeometries(group: THREE.Object3D): void {
  const seen = new Set<THREE.BufferGeometry>();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.shared && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
  });
}

/** Alle Gebäude des Spielers und der Konkurrenz; baut eine Stadt nur neu auf, wenn sich etwas geändert hat */
export class Estates {
  private readonly root = new THREE.Group();
  private readonly towns = new Map<string, { key: string; group: THREE.Group; items: { b: Built; active: boolean }[] }>();
  private readonly smoke = new Smoke();
  private readonly places: Map<string, TownPlacement>;
  private time = 0;

  constructor(scene: THREE.Scene, places: TownPlacement[]) {
    this.places = new Map(places.map((p) => [p.def.id, p]));
    scene.add(this.root, this.smoke.mesh);
  }

  sync(info: Map<string, EstateInfo>): void {
    let dirty = false;
    for (const [town, place] of this.places) {
      const e = info.get(town) ?? { kontore: [], betriebe: [] };
      const key = JSON.stringify(e);
      const cur = this.towns.get(town);
      if (cur?.key === key) continue;
      if (cur) {
        this.root.remove(cur.group);
        disposeGeometries(cur.group);
      }
      dirty = true;
      const group = new THREE.Group();
      const items: { b: Built; active: boolean }[] = [];
      const put = (b: Built, lot: Lot, active: boolean) => {
        b.group.position.copy(lot.pos);
        b.group.rotation.y = lot.facing;
        b.group.scale.setScalar(1.15);
        group.add(b.group);
        items.push({ b, active });
      };
      e.kontore.slice(0, KONTOR_LOTS).forEach((k, i) => put(kontorModel(k.level, k.color), place.lots[i], true));
      const color = PLAYER_COLOR;
      e.betriebe.forEach((x, i) => {
        const lot = place.lots[KONTOR_LOTS + i];
        if (lot) put(betriebModel(x.type, color), lot, x.active);
      });
      // zweite Reihe: jede Art hat ihren festen Platz, freie Plätze bleiben eine kleine Grünfläche
      CIVIC_ORDER.slice(0, CIVIC_COUNT).forEach((kind, i) => {
        const lot = place.civic[i];
        if (!lot) return;
        const b = e.civic?.includes(kind) ? civicModel(kind, color) : null;
        put(b ?? civicGreen(i), lot, true);
      });
      this.root.add(group);
      this.towns.set(town, { key, group, items });
    }
    if (dirty) {
      this.root.updateMatrixWorld(true);
      const sources: THREE.Vector3[] = [];
      for (const t of this.towns.values())
        for (const { b, active } of t.items) if (active) for (const s of b.smoke) sources.push(b.group.localToWorld(s.clone()));
      this.smoke.setSources(sources);
    }
  }

  update(dt: number, wind: number): void {
    this.time += dt;
    for (const t of this.towns.values()) {
      for (const { b, active } of t.items) {
        if (active) for (const s of b.spinners) s.rotation.z += dt * (s instanceof THREE.Mesh ? 1.2 : 0.8);
        for (const c of b.cloths) c.rotation.y = Math.sin(this.time * 2 + c.id) * 0.35;
      }
    }
    this.smoke.update(dt, wind);
  }
}
