import * as THREE from 'three';
import { boxGeo, gableGeo, hipGeo, Kit, panelGeo } from './kit.ts';

/**
 * Haustypen für die Städte. Jeder Typ besteht aus einem Körper (Wände, Fenster, Fachwerk, Schornstein)
 * und einem Dach, beide als eigene Geometrie mit Vertexfarben. In der Stadt werden sie instanziert und
 * per Instanzfarbe eingefärbt: Weiß bleibt die Wandfarbe, dunkle Teile bleiben dunkel.
 * Vorderseite zeigt nach +z, Ursprung in der Mitte der Grundfläche.
 */

export type HouseType = 'fachwerk' | 'stein' | 'block' | 'giebel' | 'scheune' | 'huette';

export interface HouseModel {
  body: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  /** Oberkante des Schornsteins (lokal), für Rauch */
  chimney: THREE.Vector3 | null;
  /** Grundfläche für Abstände */
  radius: number;
}

const WALL = 0xffffff;
const TIMBER = 0x4a3020;
const WINDOW = 0x2c3a46;
const SILL = 0xd8d0c0;
const DOOR = 0x553522;
const BASE = 0x8f8676;
const BRICK = 0x8a5040;
const ROOF = 0xffffff;
const RIDGE = 0xc8c8c8;

/** Fenster mit Sims als flache Auflage auf der Wand; Blickrichtung ergibt sich aus der Lage */
function windowAt(k: Kit, x: number, y: number, z: number, w = 0.28, h = 0.32, side = false): void {
  const ry = side ? (x > 0 ? Math.PI / 2 : -Math.PI / 2) : z > 0 ? 0 : Math.PI;
  k.add(panelGeo(w, h), WINDOW, { x, y, z, ry });
  k.add(panelGeo(w + 0.1, 0.05), SILL, { x: x + (side ? Math.sign(x) * 0.01 : 0), y: y - 0.04, z: z + (side ? 0 : Math.sign(z) * 0.01), ry });
}

/** Balken oder Brett als flache Auflage auf einer Wand */
function strip(k: Kit, w: number, h: number, color: number, x: number, y: number, z: number, ry: number, rz = 0): void {
  k.add(panelGeo(w, h), color, { x, y, z, ry, rz });
}

function fachwerk(): HouseModel {
  const w = 2;
  const d = 1.6;
  const h = 1.75;
  const body = new Kit();
  body.add(boxGeo(w + 0.12, 0.3, d + 0.12), BASE, { y: -0.12 });
  body.add(boxGeo(w, h, d), WALL);
  // Fachwerk: Eckständer, Riegel, Streben
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.add(boxGeo(0.12, h, 0.12), TIMBER, { x: sx * (w / 2 - 0.04), z: sz * (d / 2 - 0.04) });
  for (const sz of [-1, 1]) {
    const ry = sz > 0 ? 0 : Math.PI;
    const z = sz * (d / 2 + 0.01);
    for (const y of [h * 0.48, h - 0.08]) strip(body, w, 0.08, TIMBER, 0, y, z, ry);
    strip(body, 0.08, h, TIMBER, 0, 0, z, ry);
    for (const sx of [-1, 1]) strip(body, 0.07, h * 0.62, TIMBER, sx * w * 0.3, 0.05, z + sz * 0.002, ry, sx * 0.75);
  }
  for (const sx of [-1, 1]) strip(body, d, 0.08, TIMBER, sx * (w / 2 + 0.01), h * 0.48, 0, sx * Math.PI / 2);
  strip(body, 0.38, 0.72, DOOR, -w * 0.24, 0, d / 2 + 0.02, 0);
  windowAt(body, w * 0.24, 0.42, d / 2 + 0.02);
  for (const sx of [-1, 1]) {
    windowAt(body, sx * w * 0.24, h * 0.6, d / 2 + 0.02);
    windowAt(body, sx * w * 0.24, h * 0.6, -d / 2 - 0.02);
    windowAt(body, sx * (w / 2 + 0.02), h * 0.6, 0, 0.26, 0.3, true);
  }
  const chimneyTop = new THREE.Vector3(w * 0.28, h + 1.25, -d * 0.12);
  body.add(boxGeo(0.26, 1.3, 0.26), BRICK, { x: chimneyTop.x, y: h - 0.05, z: chimneyTop.z });
  const roof = new Kit();
  roof.add(gableGeo(w + 0.3, d + 0.4, 1.1), ROOF, { y: h });
  roof.add(boxGeo(w + 0.34, 0.08, 0.12), RIDGE, { y: h + 1.06 });
  return { body: body.geometry(), roof: roof.geometry(), chimney: chimneyTop, radius: 1.3 };
}

function stein(): HouseModel {
  const w = 2.2;
  const d = 1.8;
  const h = 2.3;
  const body = new Kit();
  body.add(boxGeo(w + 0.1, 0.55, d + 0.1), BASE, { y: -0.2 });
  body.add(boxGeo(w, h, d), WALL);
  body.add(boxGeo(w + 0.06, 0.08, d + 0.06), SILL, { y: h * 0.5 });
  body.add(boxGeo(w + 0.08, 0.12, d + 0.08), SILL, { y: h - 0.1 });
  strip(body, 0.44, 0.82, DOOR, 0, 0, d / 2 + 0.02, 0);
  body.add(boxGeo(0.56, 0.1, 0.08), SILL, { y: 0.82, z: d / 2 + 0.03 });
  for (const sx of [-1, 1]) {
    windowAt(body, sx * w * 0.32, 0.55, d / 2 + 0.02, 0.26, 0.38);
    windowAt(body, sx * w * 0.32, 0.55, -d / 2 - 0.02, 0.26, 0.38);
    windowAt(body, sx * (w / 2 + 0.02), h * 0.62, 0, 0.26, 0.38, true);
  }
  for (const x of [-w * 0.32, 0, w * 0.32]) {
    windowAt(body, x, h * 0.62, d / 2 + 0.02, 0.26, 0.4);
    windowAt(body, x, h * 0.62, -d / 2 - 0.02, 0.26, 0.4);
  }
  const chimneyTop = new THREE.Vector3(-w * 0.32, h + 1.1, 0);
  for (const sx of [-1, 1]) body.add(boxGeo(0.3, 1.15, 0.3), BASE, { x: sx * w * 0.32, y: h - 0.05 });
  const roof = new Kit();
  roof.add(hipGeo(w + 0.3, d + 0.3, 0.95), ROOF, { y: h });
  return { body: body.geometry(), roof: roof.geometry(), chimney: chimneyTop, radius: 1.45 };
}

function block(): HouseModel {
  const w = 1.9;
  const d = 1.5;
  const h = 1.15;
  const body = new Kit();
  body.add(boxGeo(w + 0.1, 0.2, d + 0.1), BASE, { y: -0.1 });
  body.add(boxGeo(w, h, d), WALL);
  // Balkenlagen und überstehende Balkenköpfe
  for (let y = 0.2; y < h; y += 0.22) {
    body.add(boxGeo(w + 0.02, 0.04, d + 0.02), 0x8a8a8a, { y });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.add(boxGeo(0.14, 0.14, 0.14), 0xd0c8b8, { x: sx * (w / 2 + 0.05), y: y - 0.05, z: sz * (d / 2 + 0.05) });
  }
  strip(body, 0.36, 0.7, DOOR, 0.3, 0, d / 2 + 0.02, 0);
  windowAt(body, -0.45, 0.45, d / 2 + 0.03, 0.3, 0.26);
  windowAt(body, w / 2 + 0.03, 0.45, -0.2, 0.28, 0.26, true);
  const chimneyTop = new THREE.Vector3(-w / 2 - 0.1, h + 1.15, -0.1);
  body.add(boxGeo(0.38, h + 1.15, 0.38), BASE, { x: chimneyTop.x, z: chimneyTop.z });
  const roof = new Kit();
  roof.add(gableGeo(w + 0.55, d + 0.7, 0.8), ROOF, { y: h - 0.02 });
  return { body: body.geometry(), roof: roof.geometry(), chimney: chimneyTop, radius: 1.3 };
}

/** Schmales, hohes Giebelhaus mit Treppengiebel zur Straße, wie in alten Hafenstädten */
function giebel(): HouseModel {
  const w = 1.4;
  const d = 2.2;
  const h = 2.8;
  const body = new Kit();
  body.add(boxGeo(w + 0.08, 0.3, d + 0.08), BASE, { y: -0.12 });
  body.add(boxGeo(w, h, d), WALL);
  // Treppengiebel vorn und hinten
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const sw = w * (1 - i / 4.4);
      body.add(boxGeo(sw, 0.36, 0.16), WALL, { y: h + i * 0.36, z: sz * (d / 2 - 0.06) });
      body.add(boxGeo(sw + 0.06, 0.05, 0.2), SILL, { y: h + i * 0.36 + 0.34, z: sz * (d / 2 - 0.06) });
    }
  }
  strip(body, 0.4, 0.8, DOOR, -0.25, 0, d / 2 + 0.02, 0);
  windowAt(body, 0.32, 0.5, d / 2 + 0.02, 0.3, 0.4);
  for (const y of [1.2, 1.95]) for (const sx of [-1, 1]) windowAt(body, sx * 0.32, y, d / 2 + 0.02, 0.28, 0.42);
  windowAt(body, 0, h + 0.35, d / 2 + 0.04, 0.24, 0.34);
  strip(body, 0.4, 0.42, 0x3a2a1c, 0, h + 0.35, -d / 2 - 0.04, Math.PI);
  // Lastbalken mit Rolle im Giebel
  body.add(boxGeo(0.08, 0.08, 0.5), TIMBER, { y: h + 0.95, z: d / 2 + 0.15 });
  for (const y of [1.2, 1.95]) windowAt(body, 0, y, -d / 2 - 0.02, 0.3, 0.42);
  const roof = new Kit();
  roof.add(gableGeo(d - 0.1, w + 0.12, 1.45), ROOF, { y: h, ry: Math.PI / 2 });
  return { body: body.geometry(), roof: roof.geometry(), chimney: null, radius: 1.25 };
}

function scheune(): HouseModel {
  const w = 2.8;
  const d = 2;
  const h = 1.3;
  const body = new Kit();
  body.add(boxGeo(w + 0.1, 0.2, d + 0.1), BASE, { y: -0.1 });
  body.add(boxGeo(w, h, d), WALL);
  // senkrechte Bretter
  for (let x = -w / 2 + 0.2; x < w / 2; x += 0.35) {
    strip(body, 0.04, h, 0x8c8c8c, x, 0, d / 2 + 0.01, 0);
    strip(body, 0.04, h, 0x8c8c8c, x, 0, -d / 2 - 0.01, Math.PI);
  }
  strip(body, 0.95, 1.05, 0x4a3020, 0, 0, d / 2 + 0.02, 0);
  body.add(boxGeo(1.0, 0.07, 0.06), 0xb0a090, { y: 0.5, z: d / 2 + 0.05, rz: 0.82 });
  body.add(boxGeo(0.5, 0.35, 0.05), 0x3a2618, { x: w * 0.3, y: h + 0.25, z: d / 2 - 0.1 });
  const roof = new Kit();
  roof.add(gableGeo(w + 0.3, d + 0.4, 1.55), ROOF, { y: h });
  return { body: body.geometry(), roof: roof.geometry(), chimney: null, radius: 1.75 };
}

/** Kleine Kate mit tief heruntergezogenem Dach (Reet oder Schindeln) */
function huette(): HouseModel {
  const w = 1.5;
  const d = 1.2;
  const h = 0.85;
  const body = new Kit();
  body.add(boxGeo(w + 0.1, 0.2, d + 0.1), BASE, { y: -0.1 });
  body.add(boxGeo(w, h, d), WALL);
  strip(body, 0.34, 0.62, DOOR, -0.3, 0, d / 2 + 0.02, 0);
  windowAt(body, 0.35, 0.35, d / 2 + 0.02, 0.26, 0.24);
  windowAt(body, -0.2, 0.35, -d / 2 - 0.02, 0.26, 0.24);
  const chimneyTop = new THREE.Vector3(0.3, h + 1.15, -0.15);
  body.add(boxGeo(0.22, 1.15, 0.22), BRICK, { x: chimneyTop.x, y: h, z: chimneyTop.z });
  const roof = new Kit();
  roof.add(gableGeo(w + 0.35, d + 0.6, 1.25), ROOF, { y: h - 0.08 });
  return { body: body.geometry(), roof: roof.geometry(), chimney: chimneyTop, radius: 1.05 };
}

const BUILDERS: Record<HouseType, () => HouseModel> = { fachwerk, stein, block, giebel, scheune, huette };
const cache = new Map<HouseType, HouseModel>();

export function houseModel(type: HouseType): HouseModel {
  let m = cache.get(type);
  if (!m) {
    m = BUILDERS[type]();
    cache.set(type, m);
  }
  return m;
}
