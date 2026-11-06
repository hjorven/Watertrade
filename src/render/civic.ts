import * as THREE from 'three';
import { boxGeo, coneGeo, cylGeo, gableGeo, hipGeo, Kit } from './kit.ts';
import { C, church, smallTree, type TownCtx } from './landmarks.ts';

/**
 * Prestigebauten des Spielers (Plan 6.5): eigenes Stadthaus und gestiftete Bauten
 * (Armenhaus, Schule, Kirche). Kompakt, damit sie in die zweite Reihe hinter den Kontoren passen
 * (rund 3 Einheiten Platz), Front nach +z, Boden bei y = 0, alles statische in einem Baukasten-Mesh.
 */

export interface CivicModel {
  group: THREE.Group;
  smoke: THREE.Vector3[];
  spinners: THREE.Object3D[];
  cloths: THREE.Mesh[];
}

/** Fahne in Hausfarbe; das Tuch bleibt ein eigenes Mesh, damit es im Wind schwingt */
function banner(k: Kit, model: CivicModel, color: number, x: number, y: number, z: number, h: number): void {
  k.add(boxGeo(0.06, h, 0.06), C.woodDark, { x, y, z });
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.4, 5, 1).translate(0.35, 0, 0),
    new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 }),
  );
  cloth.position.set(x + 0.03, y + h - 0.25, z);
  cloth.castShadow = true;
  model.group.add(cloth);
  model.cloths.push(cloth);
}

function finish(k: Kit, model: CivicModel): CivicModel {
  model.group.add(k.mesh());
  return model;
}

function empty(): CivicModel {
  return { group: new THREE.Group(), smoke: [], spinners: [], cloths: [] };
}

/** Fensterreihe auf der Front (+z) */
function windows(k: Kit, w: number, y: number, z: number, n: number, color = C.window): void {
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5);
    k.add(boxGeo(0.32, 0.45, 0.05), color, { x, y, z });
  }
}

/** Eigenes Stadthaus: zweigeschossiges Bürgerhaus mit Walmdach, Freitreppe, Uhrengiebel und Hausfahne */
export function townhouseModel(color: number): CivicModel {
  const model = empty();
  const k = new Kit();
  const w = 3.0;
  const d = 2.2;
  k.add(boxGeo(w + 0.3, 0.4, d + 0.3), C.stoneDark, { y: -0.3 });
  k.add(boxGeo(w, 1.15, d), C.stoneLight, { y: 0.1 }); // Sockelgeschoss aus Stein
  k.add(boxGeo(w, 1.1, d), C.plaster, { y: 1.25 });
  k.add(boxGeo(w + 0.12, 0.1, d + 0.12), C.stone, { y: 1.22 }); // Gesims
  k.add(hipGeo(w + 0.25, d + 0.25, 1.2), C.slate, { y: 2.35 });
  // Zwerchgiebel mit Uhr über dem Eingang
  k.add(boxGeo(1.0, 0.8, 0.3), C.plaster, { y: 2.35, z: d / 2 - 0.05 });
  k.add(gableGeo(0.4, 1.1, 0.5), C.slate, { y: 3.15, z: d / 2 - 0.05, ry: Math.PI / 2 });
  k.add(cylGeo(0.24, 0.24, 0.05, 12), C.white, { y: 2.75, z: d / 2 + 0.12, rx: Math.PI / 2 });
  k.add(boxGeo(0.03, 0.16, 0.02), C.iron, { y: 2.72, z: d / 2 + 0.16 });
  // Fenster, Tür mit Säulen und Freitreppe
  windows(k, w, 0.45, d / 2 + 0.01, 4);
  windows(k, w, 1.55, d / 2 + 0.01, 4);
  k.add(boxGeo(0.55, 0.85, 0.06), C.woodDark, { y: 0.1, z: d / 2 + 0.03 });
  for (const x of [-0.42, 0.42]) k.add(cylGeo(0.07, 0.08, 1.0, 6), C.white, { x, y: 0.1, z: d / 2 + 0.25 });
  k.add(boxGeo(1.05, 0.08, 0.45), C.stoneLight, { y: 1.1, z: d / 2 + 0.22 });
  for (let i = 0; i < 3; i++) k.add(boxGeo(1.0 - i * 0.12, 0.1, 0.25), C.stone, { y: -0.1 + i * 0.1, z: d / 2 + 0.55 - i * 0.12 });
  // Farbband in Hausfarbe unter der Traufe
  k.add(boxGeo(w + 0.02, 0.14, d + 0.02), color, { y: 2.2 });
  k.add(boxGeo(0.25, 0.7, 0.25), C.stoneDark, { x: w * 0.3, y: 2.6, z: -0.3 }); // Schornstein
  model.smoke.push(new THREE.Vector3(w * 0.3, 3.3, -0.3));
  banner(k, model, color, -w / 2 - 0.25, 0, d / 2 + 0.3, 3.6);
  return finish(k, model);
}

/** Schule: lang gestrecktes Haus mit Glockentürmchen und eingezäuntem Hof */
export function schoolModel(color: number): CivicModel {
  const model = empty();
  const k = new Kit();
  const w = 3.2;
  const d = 1.8;
  k.add(boxGeo(w + 0.2, 0.35, d + 0.2), C.stoneDark, { y: -0.25 });
  k.add(boxGeo(w, 1.35, d), C.plaster, { y: 0.1 });
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) k.add(boxGeo(0.1, 1.35, 0.05), C.timber, { x, y: 0.1, z: d / 2 + 0.01 });
  k.add(boxGeo(w, 0.08, 0.05), C.timber, { y: 0.8, z: d / 2 + 0.01 });
  k.add(gableGeo(w + 0.3, d + 0.35, 1.0), C.tile, { y: 1.45 });
  windows(k, w, 0.45, d / 2 + 0.02, 5, 0x3a4c5a);
  k.add(boxGeo(0.5, 0.8, 0.06), C.woodDark, { x: w * 0.35, y: 0.1, z: d / 2 + 0.03 });
  // Glockentürmchen auf dem First
  k.add(boxGeo(0.45, 0.55, 0.45), C.wood, { y: 2.3 });
  k.add(boxGeo(0.3, 0.3, 0.47), C.woodDark, { y: 2.4 });
  k.add(coneGeo(0.42, 0.7, 4), C.slate, { y: 2.85, ry: Math.PI / 4 });
  k.add(cylGeo(0.09, 0.12, 0.18, 8), 0xc8a040, { y: 2.45 });
  // Hof mit Zaun und Baum, Wappentafel in Hausfarbe über der Tür
  k.add(boxGeo(0.5, 0.3, 0.05), color, { x: w * 0.35, y: 1.0, z: d / 2 + 0.04 });
  for (let i = 0; i <= 6; i++) k.add(boxGeo(0.06, 0.45, 0.06), C.wood, { x: -w / 2 + (i * w) / 6, z: d / 2 + 0.9 });
  k.add(boxGeo(w, 0.05, 0.04), C.wood, { y: 0.32, z: d / 2 + 0.9 });
  smallTree(k, -w / 2 + 0.4, d / 2 + 0.5, 0.6);
  return finish(k, model);
}

/** Armenhaus: schlichter Winkelbau mit Gemüsegarten und Brunnen */
export function poorhouseModel(color: number): CivicModel {
  const model = empty();
  const k = new Kit();
  k.add(boxGeo(2.6, 1.1, 1.5), C.plaster, { x: -0.2, z: -0.3 });
  k.add(gableGeo(2.8, 1.8, 0.9), C.shingle, { x: -0.2, y: 1.1, z: -0.3 });
  k.add(boxGeo(1.2, 1.0, 1.4), C.plaster, { x: 1.1, z: 0.65 });
  k.add(gableGeo(1.6, 1.4, 0.8), C.shingle, { x: 1.1, y: 1.0, z: 0.65, ry: Math.PI / 2 });
  windows(k, 2.4, 0.4, 0.46, 3);
  k.add(boxGeo(0.45, 0.75, 0.06), C.woodDark, { x: 1.1, z: 1.36 });
  k.add(boxGeo(0.4, 0.25, 0.05), color, { x: 1.1, y: 0.82, z: 1.37 });
  k.add(boxGeo(0.22, 0.5, 0.22), C.stoneDark, { x: -1.0, y: 1.5, z: -0.5 });
  model.smoke.push(new THREE.Vector3(-1.0, 2.1, -0.5));
  // Beete
  for (let i = 0; i < 3; i++) k.add(boxGeo(0.35, 0.1, 0.9), 0x5a4030, { x: -1.3 + i * 0.5, z: 1.0 });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) k.add(boxGeo(0.14, 0.14, 0.14), 0x6a9a3c, { x: -1.3 + i * 0.5, y: 0.1, z: 0.7 + j * 0.3 });
  // Brunnen
  k.add(cylGeo(0.28, 0.3, 0.35, 8), C.stone, { x: 0.15, z: 1.2 });
  for (const x of [-0.1, 0.4]) k.add(boxGeo(0.05, 0.7, 0.05), C.wood, { x, y: 0.3, z: 1.2 });
  k.add(gableGeo(0.7, 0.5, 0.25), C.shingle, { x: 0.15, y: 1.0, z: 1.2 });
  return finish(k, model);
}

/** Gestiftete Kirche: das Wahrzeichen aus landmarks.ts, verkleinert, mit Wappen in Hausfarbe */
export function chapelModel(color: number): CivicModel {
  const model = empty();
  const k = new Kit();
  const ctx: TownCtx = { kit: k, group: model.group, anims: [], smoke: [], rand: () => 0.5, glow: new Kit() };
  k.at({ z: 0.3 }, () => church(ctx, C.stoneLight, C.slate, C.slate, 0.55));
  k.add(boxGeo(0.35, 0.35, 0.05), color, { y: 1.1, z: 1.98 });
  return finish(k, model);
}

export type CivicKind = 'stadthaus' | 'armenhaus' | 'schule' | 'kirche';

export function civicModel(kind: string, color: number): CivicModel | null {
  switch (kind) {
    case 'stadthaus':
      return townhouseModel(color);
    case 'schule':
      return schoolModel(color);
    case 'armenhaus':
      return poorhouseModel(color);
    case 'kirche':
      return chapelModel(color);
  }
  return null;
}
