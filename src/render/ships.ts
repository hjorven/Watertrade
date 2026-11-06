import * as THREE from 'three';
import type { ShipClass } from '../data/ships.ts';
import { boxGeo, cylGeo, gableGeo, KIT_MATERIAL, Kit, torusGeo } from './kit.ts';
import { Landscape, RIVER_HALF_WIDTH } from './landscape.ts';

const CRATE_SLOTS = 8;

const matCache = new Map<string, THREE.MeshStandardMaterial>();
const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
  const key = `${color}:${JSON.stringify(extra)}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
    matCache.set(key, m);
  }
  return m;
};

/** Rumpf aus einem Grundriss mit spitzem Bug, nach oben extrudiert */
function hullGeometry(length: number, width: number, depth: number, bow = 0.25): THREE.ExtrudeGeometry {
  const l = length / 2;
  const w = width / 2;
  const b = length * bow;
  const shape = new THREE.Shape();
  shape.moveTo(-l, -w);
  shape.lineTo(l - b, -w);
  shape.quadraticCurveTo(l - b * 0.3, -w * 0.5, l, 0);
  shape.quadraticCurveTo(l - b * 0.3, w * 0.5, l - b, w);
  shape.lineTo(-l, w);
  shape.quadraticCurveTo(-l - 0.25, 0, -l, -w);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -depth * 0.45, 0);
  return geo;
}

/** Rumpf mit Scheuerleiste und Reling auf der Oberkante */
function hull(k: Kit, length: number, width: number, depth: number, bow: number, color: number, rim = 0x3a2616, x = 0): void {
  const top = depth * 0.55;
  k.addMatrix(hullGeometry(length, width, depth, bow), color, new THREE.Matrix4().makeTranslation(x, 0, 0));
  k.addMatrix(hullGeometry(length + 0.06, width + 0.06, 0.07, bow), rim, new THREE.Matrix4().makeTranslation(x, top - 0.02, 0));
  k.addMatrix(hullGeometry(length + 0.04, width + 0.04, 0.06, bow), rim, new THREE.Matrix4().makeTranslation(x, 0.02, 0));
}

/** Stab zwischen zwei Punkten (Takelage, Streben) */
function strut(k: Kit, a: THREE.Vector3, b: THREE.Vector3, thick: number, color: number): void {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = new THREE.Matrix4().compose(
    a.clone().add(b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
    new THREE.Vector3(thick, len, thick),
  );
  k.addMatrix(boxGeo(1, 1, 1).clone().translate(0, -0.5, 0), color, m);
}

function windows(k: Kit, x0: number, x1: number, y: number, z: number, n: number, color = 0x2a3a44, w = 0.16, h = 0.14): void {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    for (const sz of [-1, 1]) k.add(boxGeo(w, h, 0.03), color, { x, y, z: sz * z });
  }
}

function railing(k: Kit, x0: number, x1: number, y: number, z: number, color = 0xf2ede2): void {
  const n = Math.max(2, Math.round((x1 - x0) / 0.35));
  for (const sz of [-1, 1]) {
    for (let i = 0; i <= n; i++) k.add(boxGeo(0.03, 0.22, 0.03), color, { x: x0 + ((x1 - x0) * i) / n, y, z: sz * z });
    k.add(boxGeo(x1 - x0, 0.03, 0.03), color, { x: (x0 + x1) / 2, y: y + 0.22, z: sz * z });
  }
}

function lifebuoy(k: Kit, x: number, y: number, z: number): void {
  k.add(torusGeo(0.11, 0.035, 4, 10), 0xe8e2d6, { x, y, z });
  k.add(torusGeo(0.112, 0.037, 4, 10), 0xc0392b, { x, y, z, rz: Math.PI / 4, sx: 1, sy: 0.4, sz: 1 });
}

function funnelGeo(k: Kit, x: number, height: number, color: number): THREE.Vector3 {
  k.add(cylGeo(0.16, 0.2, height, 10), color, { x, y: 0.4 });
  k.add(cylGeo(0.17, 0.17, 0.14, 10), 0x1e1e1e, { x, y: 0.4 + height - 0.17 });
  k.add(cylGeo(0.22, 0.22, 0.06, 10), color, { x, y: 0.4 + height * 0.35 });
  return new THREE.Vector3(x, 0.4 + height + 0.05, 0);
}

const PADDLE_BOX = new THREE.CylinderGeometry(0.5, 0.5, 0.26, 12, 1, false, 0, Math.PI);

interface Model {
  root: THREE.Group;
  crates: THREE.Mesh[];
  mastTop: THREE.Object3D | null;
  sail: THREE.Mesh | null;
  /** Schaufelräder, drehen sich in Fahrt */
  wheels?: THREE.Object3D[];
  /** Schornsteinmündung für Rauch */
  chimney?: THREE.Object3D;
}

/** Feste Teile je Schiffstyp, einmal gebaut und von allen Schiffen dieses Typs geteilt */
interface Static {
  geo: THREE.BufferGeometry;
  mastTop?: THREE.Vector3;
  chimney?: THREE.Vector3;
  crates: { x0: number; dx: number; y: number };
  sail?: { x: number; y: number };
  wheels?: { x: number; y: number; z: number }[];
}
const statics = new Map<string, Static>();

/** Schaufelrad: Ring mit Schaufeln, dreht um die Querachse */
const wheelGeo = (() => {
  let g: THREE.BufferGeometry | null = null;
  return () => {
    if (g) return g;
    const k = new Kit();
    k.add(torusGeo(0.42, 0.04, 5, 14), 0x3a2a1a);
    k.add(torusGeo(0.18, 0.03, 4, 10), 0x3a2a1a);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.add(boxGeo(0.06, 0.4, 0.22), 0x7a3a2a, { x: Math.cos(a) * 0.3, y: Math.sin(a) * 0.3 - 0.2, rz: a });
      k.add(boxGeo(0.03, 0.42, 0.03), 0x3a2a1a, { y: -0.21, rz: a + Math.PI / 2 });
    }
    g = k.geometry();
    return g;
  };
})();

function buildStatic(type: ShipClass): Static {
  const k = new Kit();
  const WOOD = 0x7a4b2a;
  const DARK = 0x4e2f1a;
  const DECK = 0xb08a5a;
  const ROPE = 0x5a4a38;

  if (type.id === 'floss') {
    // Stämme nebeneinander, Querhölzer, Hütte mit Dach, Steuerruder an beiden Enden
    for (let i = 0; i < 7; i++) {
      k.add(cylGeo(0.16, 0.16, 3.6 + (i % 2) * 0.3, 7), i % 2 ? 0x8a5a33 : 0x9a6a3c, { x: (i % 3) * 0.1 - 0.1 - 1.8, z: -0.96 + i * 0.32, rz: -Math.PI / 2 });
      k.add(cylGeo(0.12, 0.12, 0.02, 7), 0xc8a070, { x: 1.85 + (i % 3) * 0.1, z: -0.96 + i * 0.32, rz: -Math.PI / 2 });
    }
    for (const x of [-1.3, 0.2, 1.4]) k.add(boxGeo(0.14, 0.1, 2.3), DARK, { x, y: 0.12 });
    k.add(boxGeo(0.7, 0.45, 0.7), 0x6a4a2e, { x: -1.25, y: 0.15 });
    k.add(gableGeo(0.85, 0.9, 0.35), 0x5a4636, { x: -1.25, y: 0.6 });
    k.add(boxGeo(0.18, 0.28, 0.03), DARK, { x: -1.25, y: 0.15, z: 0.36 });
    k.add(boxGeo(1.9, 0.05, 0.1), DARK, { x: -2.5, y: 0.25 });
    k.add(boxGeo(0.4, 0.05, 0.25), DARK, { x: -3.3, y: 0.2 });
    k.add(boxGeo(1.5, 0.05, 0.1), DARK, { x: 2.3, y: 0.25, ry: 0.1 });
    k.add(boxGeo(0.06, 0.6, 0.06), DARK, { x: -1.7, y: 0.15 });
    return { geo: k.geometry(), crates: { x0: -0.7, dx: 0.45, y: 0.16 } };
  }

  if (type.id === 'plaette') {
    // Langer, flacher Kahn ohne Mast, mit Stakstange und Plane am Heck
    hull(k, 3.8, 1.0, 0.35, 0.18, WOOD);
    k.add(boxGeo(3.3, 0.04, 0.85), DECK, { y: 0.16 });
    for (const x of [-0.9, 0.3, 1.2]) k.add(boxGeo(0.1, 0.06, 0.9), DARK, { x, y: 0.18 });
    k.add(cylGeo(0.03, 0.03, 2.6, 5), DARK, { x: -1.5, y: 0.1, z: 0.3, rz: 0.5 });
    k.add(gableGeo(0.7, 0.8, 0.4), 0xd8c8a0, { x: -1.45, y: 0.2 });
    k.add(boxGeo(0.3, 0.12, 0.08), DARK, { x: -2.05, y: 0.05 });
    return { geo: k.geometry(), crates: { x0: -0.8, dx: 0.42, y: 0.22 }, mastTop: new THREE.Vector3(1.2, 0.8, 0) };
  }

  if (type.id === 'segelkahn') {
    hull(k, 4.6, 1.5, 0.7, 0.25, 0x5e3b22);
    k.add(boxGeo(3.4, 0.1, 1.52), 0x2f5f7a, { x: -0.2, y: 0.25 });
    k.add(boxGeo(3.8, 0.05, 1.3), DECK, { y: 0.36 });
    // Kajüte mit Fenstern und Dach
    k.add(boxGeo(0.8, 0.5, 1.1), DARK, { x: -1.7, y: 0.4 });
    k.add(boxGeo(0.95, 0.07, 1.25), 0x2f5f7a, { x: -1.7, y: 0.9 });
    windows(k, -2.0, -1.4, 0.62, 0.56, 2, 0xe8d8a0, 0.14, 0.12);
    k.add(cylGeo(0.04, 0.04, 0.3, 5), 0x2a2a2a, { x: -1.9, y: 0.95, z: 0.3 });
    // Mast, Rah, Bugspriet und Wanten
    k.add(cylGeo(0.06, 0.08, 4.2, 6), DARK, { x: 0.9, y: 0.3 });
    k.add(cylGeo(0.04, 0.04, 2.6, 5), DARK, { x: 0.95, y: 4.1, rx: Math.PI / 2, z: -1.3 });
    k.add(cylGeo(0.03, 0.05, 1.4, 5), DARK, { x: 2.4, y: 0.35, rz: -1.25 });
    const top = new THREE.Vector3(0.9, 4.4, 0);
    strut(k, top, new THREE.Vector3(3.0, 0.62, 0), 0.025, ROPE);
    strut(k, top, new THREE.Vector3(-2.2, 0.4, 0), 0.025, ROPE);
    for (const sz of [-1, 1]) for (const dx of [-0.25, 0.25]) strut(k, top, new THREE.Vector3(0.9 + dx, 0.38, sz * 0.74), 0.02, ROPE);
    // Ruder mit Pinne
    k.add(boxGeo(0.12, 0.8, 0.06), DARK, { x: -2.45, y: -0.35 });
    k.add(boxGeo(0.7, 0.05, 0.05), DARK, { x: -2.15, y: 0.5 });
    return { geo: k.geometry(), crates: { x0: -1.0, dx: 0.42, y: 0.42 }, sail: { x: 0.95, y: 4.1 } };
  }

  if (type.id === 'raddampfer') {
    // weißer Aufbau mit Fensterreihe, Oberdeck mit Reling, rote Wasserlinie, Radkästen
    hull(k, 5, 1.4, 0.6, 0.22, 0x2b2b30, 0xd8d2c0);
    k.add(boxGeo(4.2, 0.1, 1.42), 0x9a2a22, { x: -0.2, y: -0.1 });
    k.add(boxGeo(4.3, 0.05, 1.2), DECK, { y: 0.31 });
    k.add(boxGeo(1.6, 0.5, 1.0), 0xf2ede2, { x: -1.2, y: 0.35 });
    windows(k, -1.9, -0.5, 0.62, 0.51, 5, 0x2a3a44, 0.14, 0.15);
    k.add(boxGeo(1.8, 0.05, 1.2), 0xd8d2c0, { x: -1.2, y: 0.85 });
    railing(k, -2.05, -0.35, 0.9, 0.58);
    k.add(boxGeo(0.6, 0.35, 0.8), 0xf2ede2, { x: -0.9, y: 0.9 });
    k.add(boxGeo(0.62, 0.1, 0.82), 0x2a3a44, { x: -0.9, y: 1.1 });
    k.add(boxGeo(0.7, 0.05, 0.9), 0x9a2a22, { x: -0.9, y: 1.25 });
    lifebuoy(k, -1.6, 0.6, 0.53);
    lifebuoy(k, -1.6, 0.6, -0.53);
    for (const side of [-1, 1]) {
      k.add(PADDLE_BOX, 0xf2ede2, { x: 0.2, y: 0.3, z: side * 0.84, rx: Math.PI / 2 });
      k.add(boxGeo(1.0, 0.08, 0.3), 0x9a2a22, { x: 0.2, y: 0.78, z: side * 0.84 });
    }
    k.add(cylGeo(0.025, 0.025, 1.2, 5), DARK, { x: 2.2, y: 0.3 });
    const chimney = funnelGeo(k, 0.2, 1.7, 0xc9a23a);
    return { geo: k.geometry(), crates: { x0: 1.0, dx: 0.3, y: 0.36 }, chimney, wheels: [{ x: 0.2, y: 0.25, z: -0.82 }, { x: 0.2, y: 0.25, z: 0.82 }] };
  }

  if (type.id === 'schleppverband') {
    // Schlepper vorn mit Fendern, zwei Leichter mit Lukensüll dahinter an der Leine
    hull(k, 2, 1.0, 0.6, 0.3, 0x2f3a2f, 0x1a1a1a, 2.4);
    k.add(boxGeo(1.6, 0.05, 0.85), DECK, { x: 2.3, y: 0.31 });
    k.add(boxGeo(0.7, 0.5, 0.7), 0xe8e0cc, { x: 2.2, y: 0.33 });
    k.add(boxGeo(0.72, 0.12, 0.72), 0x2a3a44, { x: 2.2, y: 0.62 });
    k.add(boxGeo(0.8, 0.05, 0.8), 0x2f3a2f, { x: 2.2, y: 0.83 });
    for (const sz of [-1, 1]) k.add(torusGeo(0.1, 0.04, 4, 8), 0x1a1a1a, { x: 2.8, y: 0.15, z: sz * 0.5, ry: Math.PI / 2 });
    k.add(torusGeo(0.12, 0.05, 4, 8), 0x1a1a1a, { x: 3.4, y: 0.15, rx: Math.PI / 2, ry: Math.PI / 2 });
    const chimney = funnelGeo(k, 2.65, 1.1, 0x2a2a2a);
    for (const x of [0.3, -2.2]) {
      k.add(boxGeo(2.2, 0.55, 1.1), WOOD, { x, y: -0.22 });
      k.add(boxGeo(2.25, 0.08, 1.15), DARK, { x, y: 0.3 });
      k.add(boxGeo(1.7, 0.14, 0.8), 0x5a4a3a, { x, y: 0.3 });
      k.add(boxGeo(0.1, 0.25, 0.1), DARK, { x: x + 1.0, y: 0.34 });
    }
    k.add(boxGeo(0.4, 0.03, 0.03), DARK, { x: -0.95, y: 0.4 });
    strut(k, new THREE.Vector3(1.5, 0.42, 0), new THREE.Vector3(1.9, 0.5, 0), 0.03, ROPE);
    return { geo: k.geometry(), crates: { x0: -2.9, dx: 0.44, y: 0.3 }, chimney };
  }

  if (type.id === 'motorschiff' || type.id === 'kuehlschiff') {
    const cool = type.id === 'kuehlschiff';
    hull(k, 5.2, 1.3, 0.6, 0.18, cool ? 0xe8ecef : 0x2c4a6a, 0x1e1e1e);
    k.add(boxGeo(4.4, 0.08, 1.32), cool ? 0x3a7aa8 : 0xd8d2c0, { x: -0.2, y: 0.18 });
    k.add(boxGeo(4.6, 0.05, 1.12), 0x8a8a82, { y: 0.3 });
    // Steuerhaus achtern mit Fensterband, Dach, Signalmast
    k.add(boxGeo(0.8, 0.6, 1.0), 0xf4f1ea, { x: -2.0, y: 0.35 });
    k.add(boxGeo(0.82, 0.16, 1.02), 0x2a3a44, { x: -2.0, y: 0.74 });
    k.add(boxGeo(0.95, 0.06, 1.12), cool ? 0x3a7aa8 : 0xb03a2a, { x: -2.0, y: 0.95 });
    k.add(boxGeo(0.04, 0.6, 0.04), 0x2a2a2a, { x: -1.8, y: 1.0 });
    k.add(boxGeo(0.3, 0.04, 0.04), 0x2a2a2a, { x: -1.8, y: 1.45 });
    railing(k, -2.55, -1.6, 0.33, 0.55, 0xd8d2c0);
    lifebuoy(k, -2.0, 0.55, 0.52);
    // Bugmast mit Laterne, Anker
    k.add(boxGeo(0.04, 0.8, 0.04), 0x2a2a2a, { x: 2.1, y: 0.32 });
    k.add(boxGeo(0.1, 0.1, 0.1), 0xf0e0a0, { x: 2.1, y: 1.1 });
    k.add(boxGeo(0.06, 0.2, 0.2), 0x2a2a2a, { x: 2.35, y: 0.05, z: 0.5 });
    if (cool) {
      // Kühlraum: weißer Kasten mit Lüftern und Kühlrippen
      k.add(boxGeo(2.6, 0.55, 1.0), 0xf6f8fa, { x: 0.2, y: 0.33 });
      for (let i = 0; i < 9; i++) k.add(boxGeo(0.04, 0.4, 1.02), 0xc8d0d8, { x: -0.9 + i * 0.28, y: 0.4 });
      for (const x of [-0.6, 0.2, 1.0]) k.add(cylGeo(0.12, 0.12, 0.1, 8), 0x6a7a86, { x, y: 0.88 });
    } else {
      // Ladeluke mit Süll, die Kisten stehen darauf
      k.add(boxGeo(2.8, 0.06, 1.0), 0x5a5a52, { x: -0.1, y: 0.3 });
      k.add(boxGeo(2.9, 0.12, 0.06), 0x5a5a52, { x: -0.1, y: 0.3, z: 0.5 });
      k.add(boxGeo(2.9, 0.12, 0.06), 0x5a5a52, { x: -0.1, y: 0.3, z: -0.5 });
    }
    const chimney = funnelGeo(k, -2.3, 0.6, cool ? 0x3a7aa8 : 0xb03a2a);
    return { geo: k.geometry(), crates: { x0: cool ? 1.6 : -0.9, dx: cool ? 0.18 : 0.42, y: 0.32 }, chimney };
  }

  // Treidelkahn: Kajüte mit Fenstern und Ofenrohr, Treidelmast, Ruder mit Pinne
  hull(k, 3.7, 1.24, 0.55, 0.25, WOOD);
  k.add(boxGeo(3.2, 0.05, 1.05), DECK, { y: 0.28 });
  k.add(boxGeo(0.75, 0.55, 0.95), DARK, { x: -1.25, y: 0.32 });
  k.add(boxGeo(0.9, 0.08, 1.1), 0x9a3a2a, { x: -1.25, y: 0.88 });
  windows(k, -1.45, -1.05, 0.6, 0.485, 1, 0xe8d8a0, 0.16, 0.14);
  k.add(boxGeo(0.03, 0.2, 0.16), 0xe8d8a0, { x: -0.87, y: 0.55 });
  k.add(cylGeo(0.035, 0.035, 0.35, 5), 0x2a2a2a, { x: -1.45, y: 0.95, z: -0.25 });
  k.add(cylGeo(0.05, 0.06, 2.2, 6), DARK, { x: 0.95, y: 0.3 });
  k.add(cylGeo(0.07, 0.07, 0.08, 8), 0x3a3a3a, { x: 0.95, y: 2.45, rx: Math.PI / 2 });
  k.add(boxGeo(0.12, 0.7, 0.06), DARK, { x: -1.95, y: -0.3 });
  k.add(boxGeo(0.6, 0.05, 0.05), DARK, { x: -1.7, y: 0.45, ry: 0.2 });
  k.add(boxGeo(0.08, 0.35, 0.08), DARK, { x: 1.75, y: 0.25 });
  return { geo: k.geometry(), crates: { x0: -0.55, dx: 0.36, y: 0.33 }, mastTop: new THREE.Vector3(0.95, 2.4, 0) };
}

function crateGrid(root: THREE.Group, x0: number, dx: number, y: number): THREE.Mesh[] {
  const geo = boxGeo(dx * 0.85, 0.42, 0.42);
  const crates: THREE.Mesh[] = [];
  for (let i = 0; i < CRATE_SLOTS; i++) {
    const col = Math.floor(i / 2);
    const row = i % 2;
    // eigenes Material je Kiste, weil die Farbe die Ware zeigt
    const crate = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    crate.position.set(x0 + col * dx, y, row === 0 ? -0.24 : 0.24);
    crate.castShadow = true;
    crate.visible = false;
    crates.push(crate);
    root.add(crate);
  }
  return crates;
}

function buildModel(type: ShipClass): Model {
  let st = statics.get(type.id);
  if (!st) {
    st = buildStatic(type);
    statics.set(type.id, st);
  }
  const root = new THREE.Group();
  const body = new THREE.Mesh(st.geo, KIT_MATERIAL);
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);
  const crates = crateGrid(root, st.crates.x0, st.crates.dx, st.crates.y);
  let mastTop: THREE.Object3D | null = null;
  if (st.mastTop) {
    mastTop = new THREE.Object3D();
    mastTop.position.copy(st.mastTop);
    root.add(mastTop);
  }
  let chimney: THREE.Object3D | undefined;
  if (st.chimney) {
    chimney = new THREE.Object3D();
    chimney.position.copy(st.chimney);
    root.add(chimney);
  }
  let sail: THREE.Mesh | null = null;
  if (st.sail) {
    // Rahsegel als leicht gewölbte Fläche quer zum Schiff
    const sailGeo = new THREE.PlaneGeometry(2.4, 2.6, 6, 1);
    const pos = sailGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.cos((pos.getX(i) / 1.2) * (Math.PI / 2)) * 0.35);
    sailGeo.computeVertexNormals();
    sailGeo.rotateY(Math.PI / 2);
    sailGeo.translate(0, -1.3, 0); // Drehpunkt an der Rah, damit das Reffen nach oben zieht
    sail = new THREE.Mesh(sailGeo, mat(0xf1e6cc, { side: THREE.DoubleSide, roughness: 1 }));
    sail.position.set(st.sail.x, st.sail.y, 0);
    sail.castShadow = true;
    root.add(sail);
  }
  const wheels = st.wheels?.map((w) => {
    const m = new THREE.Mesh(wheelGeo(), KIT_MATERIAL);
    m.position.set(w.x, w.y, w.z);
    m.castShadow = true;
    root.add(m);
    return m;
  });
  return { root, crates, mastTop, sail, wheels, chimney };
}

const horseGeo = (() => {
  let g: THREE.BufferGeometry | null = null;
  return () => {
    if (g) return g;
    const k = new Kit();
    const coat = 0x6b4a2e;
    const dark = 0x3a2616;
    k.add(boxGeo(0.9, 0.38, 0.32), coat, { y: 0.5 });
    k.add(boxGeo(0.3, 0.42, 0.22), coat, { x: 0.45, y: 0.62, rz: -0.55 });
    k.add(boxGeo(0.36, 0.18, 0.18), coat, { x: 0.72, y: 0.9, rz: 0.35 });
    k.add(boxGeo(0.08, 0.3, 0.06), dark, { x: 0.36, y: 0.85, rz: -0.55 });
    k.add(boxGeo(0.08, 0.35, 0.08), dark, { x: -0.48, y: 0.38, rz: 0.4 });
    for (const [lx, lz] of [[-0.35, -0.1], [-0.35, 0.1], [0.35, -0.1], [0.35, 0.1]]) {
      k.add(boxGeo(0.09, 0.48, 0.09), coat, { x: lx, y: 0.02, z: lz });
      k.add(boxGeo(0.1, 0.07, 0.1), dark, { x: lx, y: 0.0, z: lz });
    }
    // Kummet
    k.add(torusGeo(0.18, 0.05, 4, 10), 0x7a3a22, { x: 0.32, y: 0.72, ry: Math.PI / 2, rz: -0.5 });
    g = k.geometry();
    return g;
  };
})();

function buildHorse(): THREE.Group {
  const horse = new THREE.Group();
  const m = new THREE.Mesh(horseGeo(), KIT_MATERIAL);
  m.castShadow = true;
  horse.add(m);
  horse.scale.setScalar(1.4);
  return horse;
}

/** Ein Schiff in der Szene. Die Position wird von außen über `dock` oder `sail` gesetzt. */
export class ShipView {
  readonly group = new THREE.Group();
  readonly shipId: number;
  private readonly model: Model;
  private readonly horse: THREE.Group | null = null;
  private readonly towLine: THREE.Line | null = null;
  private readonly wake: THREE.Mesh;
  private readonly marker: THREE.Mesh;
  private readonly land: Landscape;
  private readonly type: ShipClass;
  private time = Math.random() * 10;
  /** liegt gerade am Steg */
  docked = false;

  private readonly pennant: THREE.Mesh;
  private readonly puffs: THREE.Mesh[] = [];
  private sailing = false;

  /** shipId < 0: Schiff der Konkurrenz, nicht anwählbar */
  constructor(land: Landscape, type: ShipClass, shipId: number, flagColor = 0xa8322a) {
    this.land = land;
    this.type = type;
    this.shipId = shipId;
    this.model = buildModel(type);
    this.group.add(this.model.root);
    if (shipId >= 0) this.group.userData.shipId = shipId;

    // Wimpel am Heck in der Farbe des Handelshauses
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), mat(0x3a2a1a));
    pole.position.set(-1.75, 0.85, 0);
    this.pennant = new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.36, 0), new THREE.Vector3(-0.75, -0.18, 0)]),
      new THREE.MeshStandardMaterial({ color: flagColor, side: THREE.DoubleSide, roughness: 0.9 }),
    );
    this.pennant.geometry.computeVertexNormals();
    this.pennant.position.set(-1.75, 1.58, 0);
    this.model.root.add(pole, this.pennant);

    // Rauch aus dem Schornstein: ein paar Wölkchen, die aufsteigen und vergehen
    if (this.model.chimney) {
      const puffMat = new THREE.MeshStandardMaterial({ color: type.propulsion === 'steam' ? 0x4a4642 : 0x9a9690, transparent: true, opacity: 0.5, flatShading: true });
      for (let i = 0; i < 6; i++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), puffMat);
        puff.userData.phase = i / 6;
        this.model.root.add(puff);
        this.puffs.push(puff);
      }
    }

    const wakeGeo = new THREE.BufferGeometry();
    wakeGeo.setAttribute('position', new THREE.Float32BufferAttribute([2.2, 0, 0, -5, 0, -2.2, -5, 0, 2.2], 3));
    this.wake = new THREE.Mesh(
      wakeGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
    );
    this.wake.position.y = 0.02;
    this.wake.visible = false;
    this.group.add(this.wake);

    // Auswahlring
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 2.9, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xa8322a, transparent: true, opacity: 0.85 }),
    );
    this.marker.position.y = 0.05;
    this.marker.visible = false;
    this.group.add(this.marker);

    // Schiffe sind die Stars: etwas größer als der Maßstab der Landschaft
    this.group.scale.setScalar(1.6);

    if (type.propulsion === 'tow') {
      this.horse = buildHorse();
      this.horse.visible = false;
      this.towLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0x3a2a1a }),
      );
      this.towLine.visible = false;
    }
  }

  addTo(scene: THREE.Object3D): void {
    scene.add(this.group);
    if (this.horse) scene.add(this.horse);
    if (this.towLine) scene.add(this.towLine);
  }

  removeFrom(scene: THREE.Object3D): void {
    scene.remove(this.group);
    if (this.horse) scene.remove(this.horse);
    if (this.towLine) scene.remove(this.towLine);
  }

  setSelected(on: boolean): void {
    this.marker.visible = on;
  }

  /** Ladung anzeigen: Anteil je Ware in Farben */
  setCargo(load: { color: number; amount: number }[], capacity = this.type.capacity): void {
    const total = load.reduce((s, l) => s + l.amount, 0);
    const filled = total === 0 ? 0 : Math.max(1, Math.min(CRATE_SLOTS, Math.round((total / capacity) * CRATE_SLOTS)));
    const colors: number[] = [];
    for (const l of load) {
      const n = total === 0 ? 0 : Math.round((l.amount / total) * filled);
      for (let i = 0; i < n; i++) colors.push(l.color);
    }
    const fallback = load.find((l) => l.amount > 0)?.color ?? 0x999999;
    while (colors.length < filled) colors.push(fallback);
    this.model.crates.forEach((c, i) => {
      c.visible = i < filled;
      if (c.visible) (c.material as THREE.MeshStandardMaterial).color.setHex(colors[i]);
    });
  }

  /** Liegt am Steg; mehrere Schiffe im selben Hafen liegen hintereinander */
  dock(mooring: THREE.Vector3, river: string, riverT: number, slot: number): void {
    const tan = this.land.tangentAt(river, riverT);
    // Liegeplätze abwechselnd flussauf und flussab; was über den Kartenrand ragen würde, wird übersprungen
    let offset = 0;
    for (let k = 0, found = -1; k < 40 && found < slot; k++) {
      const o = (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * 7;
      if (!this.land.inWorld(mooring.x + tan.x * o, mooring.z + tan.z * o, 4.5)) continue;
      found++;
      offset = o;
    }
    this.group.position.set(mooring.x + tan.x * offset, 0, mooring.z + tan.z * offset);
    this.group.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
    this.docked = true;
    this.sailing = false;
    this.wake.visible = false;
    if (this.horse) this.horse.visible = false;
    if (this.towLine) this.towLine.visible = false;
    if (this.model.sail) this.model.sail.scale.set(1, 0.3, 1); // Segel gerefft
  }

  /** In Fahrt an Position t eines Flusses */
  sail(river: string, t: number, downstream: boolean): void {
    const tan = this.land.tangentAt(river, t);
    const n = this.land.normalAt(river, t);
    const p = this.land.pointAt(river, t);
    const hw = this.land.halfWidth(river);
    // Rechtsverkehr: in Fahrtrichtung rechts halten
    const side = downstream ? 1 : -1;
    const lane = side * Math.min(1.2, hw * 0.35);
    this.group.position.set(p.x + n.x * lane, this.land.waterLevelAt(river, t), p.z + n.z * lane);
    const heading = Math.atan2(-tan.z, tan.x) + (downstream ? 0 : Math.PI);
    this.group.rotation.set(0, heading, 0);
    this.docked = false;
    this.sailing = true;
    this.wake.visible = this.type.propulsion !== 'drift';
    if (this.model.sail) this.model.sail.scale.set(1, 1, 1);

    // Bergwärts ziehen Treidelpferde vom Treidelpfad am Ufer
    const towing = !downstream && this.horse !== null;
    if (this.horse) this.horse.visible = towing;
    if (this.towLine) this.towLine.visible = towing;
    if (towing && this.horse) {
      const len = this.land.curve(river).getLength();
      const ht = Math.max(0, t - 6 / len);
      const hp = this.land.pointAt(river, ht);
      const hn = this.land.normalAt(river, ht);
      // auf dem Treidelpfad, in engen Kurven weiter vom Wasser weg
      // am Kanal geht der Leinpfad direkt an der Ufermauer entlang
      let off = side * (hw + (this.land.canals.some((c) => c.river === river) ? 1.2 : 2.3));
      let hx = hp.x + hn.x * off;
      let hz = hp.z + hn.z * off;
      for (let i = 0; i < 8 && this.land.riverDistance(hx, hz).d < RIVER_HALF_WIDTH + 1.9; i++) {
        off += side * 0.5;
        hx = hp.x + hn.x * off;
        hz = hp.z + hn.z * off;
      }
      this.horse.position.set(hx, this.land.heightAt(hx, hz) + Math.abs(Math.sin(this.time * 6)) * 0.06, hz);
      this.horse.rotation.set(0, heading, 0);
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.model.root.position.y = Math.sin(this.time * 1.7) * 0.04;
    this.model.root.rotation.x = Math.sin(this.time * 1.3) * 0.02;
    this.marker.rotation.y += dt * 0.6;
    this.pennant.rotation.y = Math.sin(this.time * 3.1) * 0.35;
    for (const w of this.model.wheels ?? []) if (this.sailing) w.rotation.z -= dt * 4;
    const c = this.model.chimney;
    if (c) {
      for (const p of this.puffs) {
        const a = (this.time * (this.sailing ? 0.6 : 0.25) + (p.userData.phase as number)) % 1;
        p.position.set(c.position.x - a * (this.sailing ? 1.6 : 0.3), c.position.y + a * 1.4, c.position.z);
        p.scale.setScalar(0.6 + a * 2);
        p.visible = this.sailing || a < 0.5;
      }
    }
    if (this.towLine?.visible && this.horse && this.model.mastTop) {
      this.group.updateMatrixWorld();
      const a = new THREE.Vector3();
      this.model.mastTop.getWorldPosition(a);
      const b = this.horse.position.clone();
      b.y += 1;
      this.towLine.geometry.setFromPoints([a, b]);
    }
  }
}
