import * as THREE from 'three';
import type { SegmentDef } from '../data/maps/valley.ts';
import { PROJECT_BY_ID } from '../data/projects.ts';
import type { Landscape } from './landscape.ts';
import { buildBridge } from './towns.ts';

/** Wasserbauten in der Landschaft: Baustellen, Schleusen, Kanalmauern, Bojen und die neue Brücke */

const stone = new THREE.MeshStandardMaterial({ color: 0xb3a48c, roughness: 0.95, flatShading: true });
const wood = new THREE.MeshStandardMaterial({ color: 0x6b4628, roughness: 0.9 });
const dark = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });

function frame(land: Landscape, seg: SegmentDef, f: number) {
  const t = seg.fromT + (seg.toT - seg.fromT) * f;
  return {
    t,
    p: land.pointAt(seg.river, t),
    tan: land.tangentAt(seg.river, t),
    n: land.normalAt(seg.river, t),
    hw: land.halfWidth(seg.river),
    heading: Math.atan2(-land.tangentAt(seg.river, t).z, land.tangentAt(seg.river, t).x),
  };
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Mauern an beiden Ufern über einen Teil des Abschnitts */
function walls(land: Landscape, seg: SegmentDef, from: number, to: number): THREE.Group {
  const g = new THREE.Group();
  const steps = Math.max(6, Math.round((to - from) * 60));
  const geo = new THREE.BoxGeometry(2.2, 1.4, 0.5);
  for (let i = 0; i <= steps; i++) {
    const { p, n, hw, heading } = frame(land, seg, from + ((to - from) * i) / steps);
    for (const side of [-1, 1]) {
      const w = mesh(geo, stone, p.x + n.x * side * (hw + 0.2), -0.4, p.z + n.z * side * (hw + 0.2));
      w.rotation.y = heading;
      g.add(w);
    }
  }
  return g;
}

function lock(land: Landscape, seg: SegmentDef, f: number): THREE.Group {
  const g = new THREE.Group();
  const { p, heading, hw } = frame(land, seg, f);
  const inner = new THREE.Group();
  for (const side of [-1, 1]) {
    inner.add(mesh(new THREE.BoxGeometry(6, 1.6, 0.8), stone, 0, -0.2, side * (hw + 0.3)));
    // Schleusenwärterhaus auf einer Seite
  }
  for (const x of [-3, 3]) {
    for (const side of [-1, 1]) {
      const gate = mesh(new THREE.BoxGeometry(0.25, 1.4, hw * 1.05), wood, x, 0.1, side * hw * 0.5);
      gate.rotation.y = side * (x > 0 ? 0.25 : -0.25);
      inner.add(gate);
    }
    inner.add(mesh(new THREE.BoxGeometry(0.2, 0.12, hw * 2 + 1.2), dark, x, 1.05, 0));
  }
  const hut = mesh(new THREE.BoxGeometry(1.4, 1, 1.2), new THREE.MeshStandardMaterial({ color: 0xe9dcc0 }), 0, 0.6, hw + 2.2);
  const roof = mesh(new THREE.ConeGeometry(1.1, 0.7, 4).rotateY(Math.PI / 4), new THREE.MeshStandardMaterial({ color: 0x8f3a2a, flatShading: true }), 0, 1.45, hw + 2.2);
  inner.add(hut, roof);
  inner.rotation.y = heading;
  g.add(inner);
  g.position.set(p.x, 0, p.z);
  return g;
}

function buoys(land: Landscape, seg: SegmentDef): THREE.Group {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xb8322a });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe6 });
  for (let i = 1; i < 9; i++) {
    const { p, n, hw } = frame(land, seg, i / 9);
    const side = i % 2 ? 1 : -1;
    const b = mesh(new THREE.ConeGeometry(0.25, 0.7, 8), side > 0 ? red : white, p.x + n.x * side * hw * 0.7, 0.25, p.z + n.z * side * hw * 0.7);
    g.add(b);
  }
  return g;
}

/** Baustelle: Gerüst, Kran und Materialhaufen am Ufer */
function site(land: Landscape, seg: SegmentDef): THREE.Group {
  const g = new THREE.Group();
  const { p, n, hw, heading } = frame(land, seg, 0.5);
  const inner = new THREE.Group();
  for (const x of [-1, 1]) for (const z of [-0.8, 0.8]) inner.add(mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), wood, x, 1.2, z));
  for (const y of [0.9, 1.8]) inner.add(mesh(new THREE.BoxGeometry(2.2, 0.1, 1.8), wood, 0, y, 0));
  inner.add(mesh(new THREE.BoxGeometry(0.2, 3.6, 0.2), wood, 2, 1.8, 0));
  inner.add(mesh(new THREE.BoxGeometry(3, 0.15, 0.15), wood, 1, 3.5, 0));
  inner.add(mesh(new THREE.BoxGeometry(1.2, 0.6, 0.9), stone, -2.2, 0.3, 0.4));
  inner.add(mesh(new THREE.BoxGeometry(0.9, 0.4, 0.7), stone, -2.1, 0.8, 0.4));
  const flagPole = mesh(new THREE.BoxGeometry(0.05, 1.2, 0.05), dark, 0, 3, 0);
  inner.add(flagPole);
  inner.rotation.y = heading;
  g.add(inner);
  g.position.set(p.x + n.x * (hw + 3.5), 0.2, p.z + n.z * (hw + 3.5));
  return g;
}

export class WaterWorks {
  private readonly root = new THREE.Group();
  private key = '';
  private readonly land: Landscape;
  private readonly segments: SegmentDef[];
  private readonly oldBridges: Map<string, THREE.Object3D>;

  constructor(scene: THREE.Scene, land: Landscape, segments: SegmentDef[], oldBridges: Map<string, THREE.Object3D>) {
    this.land = land;
    this.segments = segments;
    this.oldBridges = oldBridges;
    scene.add(this.root);
  }

  sync(works: { id: string; done: boolean }[]): void {
    const key = works.map((w) => `${w.id}:${w.done}`).join(',');
    if (key === this.key) return;
    this.key = key;
    this.root.clear();
    for (const b of this.oldBridges.values()) b.visible = true;
    for (const w of works) {
      const p = PROJECT_BY_ID.get(w.id);
      const seg = this.segments.find((s) => s.id === p?.seg);
      if (!p || !seg) continue;
      if (!w.done) {
        this.root.add(site(this.land, seg));
        continue;
      }
      switch (p.kind) {
        case 'bruecke': {
          const old = this.oldBridges.get(seg.id);
          if (old) old.visible = false;
          this.root.add(buildBridge(this.land, { ...seg, bridgeHeight: p.effect.bridgeHeight }, true));
          break;
        }
        case 'schleuse':
          for (const f of [0.25, 0.55, 0.85]) this.root.add(lock(this.land, seg, f));
          break;
        case 'kanal':
          this.root.add(walls(this.land, seg, 0.05, 0.95));
          break;
        case 'vertiefung':
          this.root.add(buoys(this.land, seg));
          break;
      }
    }
  }
}
