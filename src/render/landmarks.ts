import * as THREE from 'three';
import { boxGeo, coneGeo, cylGeo, dodecaGeo, gableGeo, hipGeo, icoGeo, Kit, torusGeo } from './kit.ts';

/**
 * Wahrzeichen und Kleinteile der Städte, gebaut in lokalen Koordinaten (Front nach +z, Boden bei y = 0).
 * Statisches landet im Baukasten der Stadt, Drehendes (Mühlenflügel, Seilscheibe) wird als eigenes Mesh angehängt.
 */

export interface Anim {
  obj: THREE.Object3D;
  speed: number;
}

export interface TownCtx {
  kit: Kit;
  group: THREE.Group;
  anims: Anim[];
  smoke: THREE.Vector3[];
  rand: () => number;
  /** Leuchtende Teile (Glut, Laterne) */
  glow: Kit;
}

export const C = {
  stone: 0x9d9384,
  stoneDark: 0x7a7266,
  stoneLight: 0xbdb3a2,
  plaster: 0xeee4cf,
  timber: 0x5a3a22,
  wood: 0x8a5e38,
  woodLight: 0xb08a5a,
  woodDark: 0x4a3020,
  slate: 0x4f5560,
  tile: 0xa8432f,
  shingle: 0x6a5040,
  window: 0x2c3a46,
  iron: 0x3a3d42,
  rope: 0x7a6a50,
  straw: 0xd9b860,
  salt: 0xf4f2ee,
  coal: 0x3a3632,
  white: 0xf2efe6,
  red: 0xb03a2a,
};

/** Drehendes Teil: wird um seine lokale z-Achse gedreht */
export function spinner(ctx: TownCtx, build: (k: Kit) => void, local: THREE.Vector3, speed: number): void {
  const k = new Kit();
  build(k);
  const mesh = k.mesh();
  const pivot = new THREE.Group();
  // Lage im Weltsystem aus dem aktuellen Bezugssystem des Stadt-Baukastens
  const origin = ctx.kit.local(local.x, local.y, local.z);
  const ahead = ctx.kit.local(local.x, local.y, local.z + 1).sub(origin);
  pivot.position.copy(origin);
  pivot.rotation.y = Math.atan2(ahead.x, ahead.z);
  const spin = new THREE.Group();
  spin.add(mesh);
  pivot.add(spin);
  ctx.group.add(pivot);
  ctx.anims.push({ obj: spin, speed });
}

export function smokeAt(ctx: TownCtx, x: number, y: number, z: number): void {
  ctx.smoke.push(ctx.kit.local(x, y, z));
}

// --- Kleinteile ---

export function barrel(k: Kit, x: number, z: number, y = 0): void {
  k.add(cylGeo(0.22, 0.22, 0.5, 8), C.wood, { x, y, z });
  k.add(cylGeo(0.235, 0.235, 0.05, 8), C.iron, { x, y: y + 0.1, z });
  k.add(cylGeo(0.235, 0.235, 0.05, 8), C.iron, { x, y: y + 0.36, z });
}

export function crate(k: Kit, x: number, z: number, s = 0.5, y = 0, color = 0x9a7a4a, ry = 0): void {
  k.add(boxGeo(s, s, s), color, { x, y, z, ry });
  k.add(boxGeo(s + 0.02, 0.05, s + 0.02), C.woodDark, { x, y: y + s * 0.5, z, ry });
}

export function logPile(k: Kit, x: number, z: number, n = 6, ry = 0, len = 2.2, color = 0x8a5a33): void {
  k.at({ x, z, ry }, () => {
    let i = 0;
    for (let row = 0; i < n; row++) {
      for (let c = 0; c < 4 - row && i < n; c++, i++) {
        k.add(cylGeo(0.17, 0.17, len, 7), i % 2 ? color : 0x9a6a3c, { x: (c - (3 - row) / 2) * 0.35, y: 0.17 + row * 0.3, rx: Math.PI / 2, z: -len / 2 });
      }
    }
  });
}

export function fence(k: Kit, x0: number, z0: number, x1: number, z1: number, color = C.wood): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 0.9));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    k.add(boxGeo(0.07, 0.55, 0.07), color, { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t });
  }
  for (const y of [0.2, 0.42]) k.add(boxGeo(0.04, 0.05, len), color, { x: (x0 + x1) / 2, y, z: (z0 + z1) / 2, ry });
}

export function haystack(k: Kit, x: number, z: number, s = 1): void {
  k.add(cylGeo(0.55 * s, 0.6 * s, 0.6 * s, 8), C.straw, { x, z });
  k.add(coneGeo(0.62 * s, 0.7 * s, 8), 0xcaa850, { x, y: 0.6 * s, z });
}

export function well(k: Kit, x: number, z: number): void {
  k.at({ x, z }, () => {
    k.add(cylGeo(0.55, 0.6, 0.55, 10), C.stone);
    k.add(cylGeo(0.42, 0.42, 0.06, 10), 0x2f5a6a, { y: 0.5 });
    for (const sx of [-1, 1]) k.add(boxGeo(0.08, 1.3, 0.08), C.timber, { x: sx * 0.5, y: 0.4 });
    k.add(gableGeo(1.3, 0.9, 0.45), C.shingle, { y: 1.6 });
    k.add(cylGeo(0.05, 0.05, 1.0, 5), C.woodDark, { y: 1.35, rz: Math.PI / 2, x: 0.5 });
  });
}

export function smallTree(k: Kit, x: number, z: number, s = 1, crown = 0x5f9a3c): void {
  k.add(cylGeo(0.1 * s, 0.14 * s, 1.0 * s, 5), 0x5b3b22, { x, z });
  k.add(icoGeo(0.7 * s), crown, { x, y: 1.3 * s, z });
  k.add(icoGeo(0.5 * s), crown, { x: x + 0.35 * s, y: 1.05 * s, z: z + 0.2 * s });
}

export function rowboat(k: Kit, x: number, z: number, ry: number, color = 0x6a4a2e, upside = false): void {
  k.at({ x, z, ry, y: upside ? 0.05 : 0 }, () => {
    k.add(boxGeo(1.6, 0.25, 0.6), color);
    k.add(coneGeo(0.3, 0.45, 4), color, { x: 0.95, y: 0.125, rz: -Math.PI / 2, rx: Math.PI / 4, sy: 1, sz: 0.7 });
    if (!upside) k.add(boxGeo(1.4, 0.04, 0.5), 0x2f5a6a, { y: 0.2 });
    else k.add(boxGeo(1.5, 0.05, 0.1), C.woodDark, { y: 0.25 });
  });
}

// --- Wahrzeichen ---

/** Kirche mit Turm vorn und Spitzhelm; klein = Kapelle */
export function church(ctx: TownCtx, walls: number, roof: number, spire: number, scale = 1): void {
  const k = ctx.kit;
  k.at({ s: scale }, () => {
    k.add(boxGeo(2.9, 0.35, 5.2), C.stoneDark, { y: -0.2, z: -0.7 });
    k.add(boxGeo(2.6, 2.3, 4.8), walls, { z: -0.7 });
    k.add(gableGeo(5.0, 3.0, 1.7), roof, { y: 2.3, z: -0.7, ry: Math.PI / 2 });
    // Chor hinten
    k.add(boxGeo(1.8, 1.8, 1.0), walls, { z: -3.5 });
    k.add(hipGeo(1.2, 2.0, 0.9), roof, { y: 1.8, z: -3.5, ry: Math.PI / 2 });
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        k.add(boxGeo(0.06, 1.0, 0.36), C.window, { x: sx * 1.32, y: 0.8, z: 0.6 - i * 1.4 });
        k.add(coneGeo(0.2, 0.25, 4), C.window, { x: sx * 1.32, y: 1.8, z: 0.6 - i * 1.4, sx: 0.2 });
      }
    }
    // Turm
    k.add(boxGeo(1.6, 4.6, 1.6), walls, { z: 2.1 });
    k.add(boxGeo(1.7, 0.15, 1.7), C.stoneLight, { y: 2.4, z: 2.1 });
    k.add(boxGeo(1.75, 0.18, 1.75), C.stoneLight, { y: 4.5, z: 2.1 });
    for (const [x, z] of [[0, 2.92], [0, 1.28], [0.82, 2.1], [-0.82, 2.1]]) {
      const side = Math.abs(x) > 0.1;
      k.add(boxGeo(side ? 0.06 : 0.36, 0.6, side ? 0.36 : 0.06), C.window, { x, y: 3.5, z });
    }
    k.add(cylGeo(0.32, 0.32, 0.06, 12), C.white, { y: 2.85, z: 2.92, rx: Math.PI / 2 });
    k.add(boxGeo(0.6, 1.1, 0.06), C.woodDark, { z: 2.92 });
    k.add(coneGeo(1.2, 3.6, 4), spire, { y: 4.65, z: 2.1, ry: Math.PI / 4 });
    k.add(boxGeo(0.06, 0.7, 0.06), 0xc8a040, { y: 8.2, z: 2.1 });
    k.add(boxGeo(0.4, 0.06, 0.06), 0xc8a040, { y: 8.6, z: 2.1 });
  });
}

/** Turmwindmühle mit drehenden Flügeln */
export function windmill(ctx: TownCtx): void {
  const k = ctx.kit;
  k.add(cylGeo(1.6, 1.8, 0.4, 10), C.stone, { y: -0.2 });
  k.add(cylGeo(0.95, 1.35, 4.2, 10), C.plaster);
  k.add(cylGeo(1.4, 1.4, 0.12, 10), C.timber, { y: 1.6 });
  k.add(boxGeo(0.45, 0.85, 0.06), C.woodDark, { z: 1.3 });
  k.add(boxGeo(0.3, 0.35, 0.05), C.window, { y: 2.4, z: 1.15, rx: -0.1 });
  k.add(boxGeo(0.3, 0.35, 0.05), C.window, { y: 3.1, x: 0.5, z: 0.95, ry: 0.5 });
  k.add(gableGeo(2.2, 2.0, 1.1), C.shingle, { y: 4.15, ry: Math.PI / 2 });
  k.add(cylGeo(0.07, 0.07, 1.2, 6), C.timber, { y: 3.9, z: 0.4, rx: Math.PI / 2 });
  spinner(
    ctx,
    (s) => {
      s.add(cylGeo(0.22, 0.22, 0.2, 8), C.timber, { rx: Math.PI / 2, z: -0.1 });
      for (let i = 0; i < 4; i++) {
        s.at({ rz: (i * Math.PI) / 2 }, () => {
          s.add(boxGeo(0.12, 3.1, 0.08), C.timber, { y: 0.1 });
          s.add(boxGeo(0.62, 2.4, 0.03), 0xf0e6d2, { x: 0.38, y: 0.75, z: 0.04 });
          for (let j = 0; j < 4; j++) s.add(boxGeo(0.66, 0.04, 0.05), C.timber, { x: 0.38, y: 0.9 + j * 0.65, z: 0.06 });
        });
      }
    },
    new THREE.Vector3(0, 3.9, 1.05),
    0.9,
  );
}

/** Runder Stadtturm mit Zinnenkranz und spitzem Schieferhelm */
export function tower(ctx: TownCtx): void {
  const k = ctx.kit;
  k.add(cylGeo(1.6, 1.8, 0.5, 10), C.stoneDark, { y: -0.3 });
  k.add(cylGeo(1.35, 1.55, 6.2, 10), C.stone);
  k.add(cylGeo(1.6, 1.6, 0.35, 10), C.stoneLight, { y: 6.1 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.add(boxGeo(0.35, 0.45, 0.25), C.stone, { x: Math.cos(a) * 1.45, y: 6.45, z: Math.sin(a) * 1.45, ry: -a });
  }
  k.add(coneGeo(1.35, 3.0, 10), C.slate, { y: 6.45 });
  k.add(boxGeo(0.05, 0.8, 0.05), 0xc8a040, { y: 9.4 });
  for (const y of [2.2, 4.2]) k.add(boxGeo(0.25, 0.55, 0.08), C.window, { y, z: 1.48 });
  k.add(boxGeo(0.7, 1.2, 0.1), C.woodDark, { z: 1.5 });
}

/** Stück Stadtmauer mit Wehrgang, entlang lokal x */
export function wall(k: Kit, len: number): void {
  k.add(boxGeo(len, 1.7, 0.7), C.stone);
  const n = Math.floor(len / 0.7);
  for (let i = 0; i < n; i += 2) k.add(boxGeo(0.35, 0.35, 0.72), C.stone, { x: -len / 2 + 0.35 + i * 0.7, y: 1.7 });
}

/** Schmiede mit hoher Esse und Glut im Tor */
export function forge(ctx: TownCtx): void {
  const k = ctx.kit;
  k.add(boxGeo(2.6, 1.6, 2.0), C.stoneDark);
  k.add(gableGeo(2.9, 2.4, 1.0), C.slate, { y: 1.6 });
  k.add(boxGeo(0.5, 3.4, 0.5), 0x6a3a2a, { x: 0.8, z: -0.4 });
  smokeAt(ctx, 0.8, 3.5, -0.4);
  ctx.glow.addMatrix(boxGeo(0.7, 0.75, 0.04), 0xff7a2a, k.matrix({ x: -0.5, z: 1.02 }));
  k.add(boxGeo(0.45, 0.4, 0.3), C.iron, { x: 1.5, z: 1.4 });
  k.add(boxGeo(0.25, 0.15, 0.6), C.iron, { x: 1.5, y: 0.4, z: 1.4 });
  barrel(k, -1.6, 1.3);
}

/** Marktstand mit gestreifter Markise */
export function stall(k: Kit, color: number, goods: number): void {
  k.add(boxGeo(1.4, 0.7, 0.7), C.woodLight);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(boxGeo(0.06, 1.5, 0.06), C.woodDark, { x: sx * 0.68, z: sz * 0.33 });
  for (let i = 0; i < 4; i++) k.add(boxGeo(0.36, 0.05, 1.0), i % 2 ? color : C.white, { x: -0.54 + i * 0.36, y: 1.55, z: 0.05, rx: -0.25 });
  for (let i = 0; i < 3; i++) k.add(icoGeo(0.13), goods, { x: -0.4 + i * 0.4, y: 0.82, z: 0.1 });
}

/** Leuchtturm mit roten Bändern und Laterne */
export function lighthouse(ctx: TownCtx): void {
  const k = ctx.kit;
  k.add(cylGeo(1.5, 1.7, 0.6, 10), C.stoneDark, { y: -0.3 });
  for (let i = 0; i < 5; i++) {
    const r0 = 1.15 - i * 0.12;
    k.add(cylGeo(r0 - 0.12, r0, 1.4, 10), i % 2 ? C.red : C.white, { y: 0.2 + i * 1.4 });
  }
  k.add(cylGeo(0.95, 0.95, 0.15, 10), C.iron, { y: 7.2 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.add(boxGeo(0.04, 0.4, 0.04), C.iron, { x: Math.cos(a) * 0.9, y: 7.35, z: Math.sin(a) * 0.9 });
  }
  k.add(coneGeo(0.75, 0.8, 10), C.red, { y: 8.25 });
  k.add(boxGeo(0.4, 0.8, 0.06), C.woodDark, { z: 1.12 });
  ctx.glow.addMatrix(cylGeo(0.5, 0.5, 0.9, 8), 0xffe08a, k.matrix({ y: 7.35 }));
}

/** Hölzerner Hafenkran mit Tretrad */
export function crane(ctx: TownCtx): void {
  const k = ctx.kit;
  k.add(boxGeo(1.8, 1.6, 1.8), C.wood);
  k.add(hipGeo(2.1, 2.1, 0.9), C.shingle, { y: 1.6 });
  k.add(boxGeo(0.25, 3.4, 0.25), C.timber, { y: 1.2 });
  k.add(boxGeo(0.2, 0.2, 3.2), C.timber, { y: 4.3, z: 1.2, rx: -0.35 });
  k.add(boxGeo(0.03, 1.8, 0.03), C.rope, { y: 3.3, z: 2.65 });
  crate(k, 0, 2.65, 0.45, 2.9);
  k.add(torusGeo(0.7, 0.08, 4, 12), C.woodDark, { y: 0.9, x: 0.95, ry: Math.PI / 2 });
}

/** Förderturm mit Seilscheibe über dem Schacht */
export function headframe(ctx: TownCtx): void {
  const k = ctx.kit;
  k.add(boxGeo(3.2, 0.3, 3.2), C.stoneDark, { y: -0.1 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) k.add(boxGeo(0.18, 5.6, 0.18), C.timber, { x: sx * 1.1, z: sz * 1.1, rx: -sz * 0.12, rz: sx * 0.12 });
    k.add(boxGeo(0.1, 0.1, 2.0), C.timber, { x: sx * 0.95, y: 2.5 });
  }
  for (const y of [1.5, 3.3]) for (const sz of [-1, 1]) k.add(boxGeo(2.0, 0.1, 0.1), C.timber, { y, z: sz * 0.95 });
  k.add(boxGeo(1.4, 0.15, 1.4), C.woodDark, { y: 5.4 });
  k.add(boxGeo(1.2, 1.0, 1.2), 0x6e655a, { y: -0.05 });
  k.add(boxGeo(0.7, 0.75, 0.05), 0x15110e, { z: 0.61 });
  // Maschinenhaus mit Seil zur Scheibe
  k.add(boxGeo(2.4, 1.6, 1.8), C.stone, { z: -4.2 });
  k.add(gableGeo(2.7, 2.1, 0.9), C.slate, { y: 1.6, z: -4.2 });
  k.add(boxGeo(0.45, 2.6, 0.45), 0x6a3a2a, { x: 0.8, z: -4.6 });
  smokeAt(ctx, 0.8, 2.7, -4.6);
  k.add(boxGeo(0.03, 0.03, 4.3), C.iron, { y: 3.8, z: -2.0, rx: 0.8 });
  spinner(
    ctx,
    (s) => {
      s.add(torusGeo(0.75, 0.07, 4, 14), C.iron);
      for (let i = 0; i < 4; i++) s.add(boxGeo(0.05, 1.5, 0.05), C.iron, { y: -0.75, rz: (i * Math.PI) / 4 });
    },
    new THREE.Vector3(0, 6.2, 0),
    1.6,
  );
  for (const sx of [-0.9, 0.9]) k.add(boxGeo(0.12, 0.9, 0.12), C.timber, { x: sx * 0.3, y: 5.5 });
}

/** Abraumhalde */
export function spoil(k: Kit, x: number, z: number, s: number): void {
  k.add(coneGeo(1.6 * s, 1.5 * s, 7), 0x5a5048, { x, z });
  k.add(coneGeo(1.0 * s, 1.0 * s, 6), 0x4a423c, { x: x + 0.9 * s, z: z + 0.5 * s });
}

/** Lore auf kurzem Gleisstück, entlang lokal z */
export function rails(k: Kit, len: number, carts: number): void {
  for (const sx of [-0.3, 0.3]) k.add(boxGeo(0.06, 0.06, len), C.iron, { x: sx, y: 0.05 });
  for (let z = -len / 2 + 0.3; z < len / 2; z += 0.6) k.add(boxGeo(0.9, 0.05, 0.15), C.woodDark, { z });
  for (let i = 0; i < carts; i++) {
    const z = -len / 2 + 1 + i * 1.6;
    k.add(boxGeo(0.7, 0.45, 1.0), C.iron, { y: 0.18, z });
    k.add(dodecaGeo(0.3), C.coal, { y: 0.6, z, sy: 0.6 });
  }
}

/** Glasofen: gemauerter Kegel mit Glut und Rauch */
export function kiln(ctx: TownCtx): void {
  const k = ctx.kit;
  k.add(cylGeo(2.2, 2.4, 0.6, 12), C.stoneDark, { y: -0.2 });
  k.add(cylGeo(0.7, 2.0, 5.2, 12), 0x9a5a42);
  k.add(cylGeo(0.75, 0.75, 0.3, 12), 0x6a3a2a, { y: 5.1 });
  smokeAt(ctx, 0, 5.5, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.glow.addMatrix(boxGeo(0.5, 0.55, 0.06), 0xff8a3a, k.matrix({ x: Math.sin(a) * 1.98, y: 0.15, z: Math.cos(a) * 1.98, ry: a }));
  }
}

/** Langer Speicher mit Walmdach */
export function granary(k: Kit, walls: number, roof: number): void {
  k.add(boxGeo(4.6, 0.4, 2.6), C.stoneDark, { y: -0.2 });
  k.add(boxGeo(4.4, 1.9, 2.4), walls);
  for (let i = 0; i < 4; i++) k.add(boxGeo(0.3, 0.3, 0.05), C.window, { x: -1.5 + i, y: 1.35, z: 1.22 });
  k.add(boxGeo(0.8, 1.1, 0.05), C.woodDark, { z: 1.22 });
  k.add(hipGeo(4.8, 2.8, 1.5), roof, { y: 1.9 });
  k.add(gableGeo(0.7, 0.8, 0.4), roof, { y: 2.3, z: 1.0, ry: Math.PI / 2, sx: 1 });
}

/** Gerüst zum Trocknen von Fisch und Netzen */
export function dryingRack(k: Kit): void {
  for (const x of [-1, 0, 1]) k.add(boxGeo(0.08, 1.4, 0.08), C.timber, { x });
  k.add(boxGeo(2.2, 0.06, 0.06), C.timber, { y: 1.3 });
  k.add(boxGeo(2.2, 0.06, 0.06), C.timber, { y: 0.9 });
  for (let i = 0; i < 8; i++) k.add(boxGeo(0.07, 0.3, 0.04), 0x8a8a7a, { x: -0.9 + i * 0.26, y: 0.95 });
  k.add(boxGeo(2.0, 0.8, 0.02), 0x3e4a42, { y: 0.45, z: 0.1 });
}

/** Holzfäller-Lagerplatz: Stapel, Sägebock, Karren */
export function lumberYard(k: Kit): void {
  logPile(k, -1.6, 0, 10, 0, 2.6);
  logPile(k, 1.4, 0.4, 9, 0.2, 2.4, 0x7a4a2a);
  logPile(k, 0, -2.4, 6, Math.PI / 2, 2.0);
  k.add(boxGeo(1.6, 0.12, 0.5), C.woodLight, { x: 0.2, y: 0.6, z: 2.0 });
  for (const sx of [-1, 1]) k.add(boxGeo(0.08, 0.6, 0.5), C.woodDark, { x: 0.2 + sx * 0.6, z: 2.0 });
  // Karren
  k.at({ x: -1.4, z: 2.4, ry: 0.4 }, () => {
    k.add(boxGeo(1.2, 0.3, 0.8), C.wood, { y: 0.35 });
    for (const sz of [-1, 1]) k.add(cylGeo(0.3, 0.3, 0.06, 8), C.woodDark, { y: 0.3, z: sz * 0.45, rx: Math.PI / 2 });
    k.add(boxGeo(1.0, 0.05, 0.05), C.woodDark, { x: 1.0, y: 0.45 });
  });
}
