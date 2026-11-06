import * as THREE from 'three';
import type { SegmentDef } from '../data/maps/valley.ts';
import { PROJECTS, type ProjectDef } from '../data/projects.ts';
import type { Landscape } from './landscape.ts';
import { boxGeo, coneGeo, cylGeo, Kit } from './kit.ts';
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

const lamp = new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffc04a, emissiveIntensity: 1.2 });
const COL = { stone: 0x9d9384, plaster: 0xeee4cf, roof: 0x8f3a2a, wood: 0x8a5e38, dark: 0x3a2a1c, red: 0xb8322a, white: 0xf2efe6, iron: 0x3a3d42 };

/** Pegelhaus: Wärterhäuschen am Ufer, Steg und eine rot-weiß geteilte Pegellatte im Wasser */
function gauge(land: Landscape, seg: SegmentDef, f: number): THREE.Group {
  const g = new THREE.Group();
  const { p, n, hw, heading } = frame(land, seg, f);
  const k = new Kit();
  const hx = p.x + n.x * (hw + 2.4);
  const hz = p.z + n.z * (hw + 2.4);
  // Häuschen auf dem Ufer, Höhe aus dem Geländenetz
  k.at({ x: hx, y: Math.max(0.1, land.surfaceAt(hx, hz)), z: hz, ry: heading }, () => {
    k.add(boxGeo(1.5, 1.1, 1.3), COL.plaster);
    k.add(coneGeo(1.15, 0.8, 4), COL.roof, { y: 1.1, ry: Math.PI / 4 });
    k.add(boxGeo(0.35, 0.6, 0.05), COL.dark, { z: -0.66 });
    k.add(boxGeo(0.06, 1.4, 0.06), COL.dark, { x: 0.9, z: -0.5 });
    k.add(boxGeo(0.5, 0.3, 0.03), COL.white, { x: 0.9, y: 1.15, z: -0.5 });
  });
  // Steg vom Ufer zur Latte und die Latte selbst, in Abschnitten von 0,3 m
  // Steg auf Uferhöhe, damit er bei hohem Ufer nicht im Gelände verschwindet
  const walkY = Math.max(0.3, land.surfaceAt(p.x + n.x * (hw + 1.2), p.z + n.z * (hw + 1.2)));
  k.at({ x: p.x + n.x * (hw + 0.4), y: 0, z: p.z + n.z * (hw + 0.4), ry: heading }, () => {
    k.add(boxGeo(0.5, 0.08, 2.0), COL.wood, { y: walkY });
    for (const dz of [-0.8, 0.8]) k.add(boxGeo(0.1, walkY + 0.5, 0.1), COL.dark, { x: 0.2, y: -0.5, z: dz });
  });
  k.at({ x: p.x + n.x * (hw - 0.6), y: 0, z: p.z + n.z * (hw - 0.6), ry: heading }, () => {
    k.add(boxGeo(0.08, 2.9, 0.08), COL.dark, { y: -0.9, z: 0.06 });
    for (let i = 0; i < 8; i++) k.add(boxGeo(0.18, 0.3, 0.06), i % 2 ? COL.red : COL.white, { y: -0.6 + i * 0.3 });
  });
  g.add(k.mesh());
  return g;
}

/** Leuchtfeuer: rot-weißer Turm auf einem Steinsockel am Ufer mit leuchtender Laterne */
function beacon(land: Landscape, seg: SegmentDef, f: number, side: number): THREE.Group {
  const g = new THREE.Group();
  const { p, n, hw } = frame(land, seg, f);
  const x = p.x + n.x * side * (hw + 2.7);
  const z = p.z + n.z * side * (hw + 2.7);
  const k = new Kit();
  k.add(cylGeo(1.3, 1.5, 0.9, 10), COL.stone, { y: -0.4 });
  for (let i = 0; i < 4; i++) {
    const r0 = 0.85 - i * 0.09;
    k.add(cylGeo(r0 - 0.09, r0, 1.1, 10), i % 2 ? COL.red : COL.white, { y: 0.5 + i * 1.1 });
  }
  k.add(cylGeo(0.75, 0.75, 0.12, 10), COL.iron, { y: 4.9 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.add(boxGeo(0.04, 0.35, 0.04), COL.iron, { x: Math.cos(a) * 0.7, y: 5.0, z: Math.sin(a) * 0.7 });
  }
  k.add(coneGeo(0.6, 0.7, 10), COL.red, { y: 5.75 });
  // Tür zur Landseite, weg vom Fluss
  k.at({ ry: Math.atan2(n.x * side, n.z * side) }, () => k.add(boxGeo(0.4, 0.8, 0.06), COL.dark, { z: 0.82, y: 0.45 }));
  const tower = k.mesh();
  const light = new THREE.Mesh(cylGeo(0.4, 0.4, 0.7, 8), lamp);
  light.position.y = 5.05;
  g.add(tower, light);
  g.position.set(x, Math.max(0.1, land.surfaceAt(x, z)), z);
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
  private readonly projects: ProjectDef[];

  constructor(scene: THREE.Scene, land: Landscape, segments: SegmentDef[], oldBridges: Map<string, THREE.Object3D>, projects: ProjectDef[] = PROJECTS) {
    this.land = land;
    this.segments = segments;
    this.oldBridges = oldBridges;
    this.projects = projects;
    scene.add(this.root);
  }

  sync(works: { id: string; done: boolean }[]): void {
    const key = works.map((w) => `${w.id}:${w.done}`).join(',');
    if (key === this.key) return;
    this.key = key;
    this.root.clear();
    for (const b of this.oldBridges.values()) b.visible = true;
    for (const w of works) {
      const p = this.projects.find((x) => x.id === w.id);
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
        case 'pegel':
          this.root.add(gauge(this.land, seg, 0.3));
          break;
        case 'leuchtfeuer':
          this.root.add(beacon(this.land, seg, 0.5, -1));
          break;
      }
    }
  }
}
