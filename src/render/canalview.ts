import * as THREE from 'three';
import { boxGeo, cylGeo, DECAL_MATERIAL, dodecaGeo, gableGeo, Kit, vary } from './kit.ts';
import type { CanalBuild, CanalLine, Landscape } from './landscape.ts';

/** Maße des Kanalbetts, gemeinsam für Gelände und Mauerwerk */
export const CANAL_BED = 0.9;
export const CANAL_BANK = 0.75;
/** Breite des Leinpfads neben der Ufermauer */
export const CANAL_TOWPATH = 1.6;
/** So weit über die Wasserkante hinaus ist der Graben im Gelände ausgehoben */
export const CANAL_TRENCH = 1.3;
const WALL = 0.35;

const COL = {
  stone: 0xa49a88,
  stoneDark: 0x857c6c,
  coping: 0xc8bfae,
  wood: 0x6a4a2e,
  woodLight: 0x9a7a52,
  earth: 0x7a5a3a,
  earthLight: 0x94744c,
  cleared: 0x9a9064,
  towpath: 0xb39a6e,
  stake: 0xd8cdb0,
  flag: 0xb03a2a,
  roof: 0x9a3a28,
  plaster: 0xeee4cf,
  water: 0x3f86a3,
};

/**
 * Der Scheitelkanal als Baustelle und fertiges Bauwerk:
 * Stufe 0 abgesteckte Trasse, Stufe 1 und 2 der Graben (von beiden Enden her ausgehoben),
 * Stufe 3 Ufermauern und Schleusenkammern, fertig mit Wasser, Toren und Schleusenwärterhäusern.
 */
export class CanalView {
  readonly group = new THREE.Group();
  private key = '';
  private readonly water = new THREE.MeshStandardMaterial({
    color: COL.water,
    roughness: 0.22,
    metalness: 0.08,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
  });
  /** Deckel über dem noch nicht ausgehobenen Graben */
  private readonly lidMaterial = DECAL_MATERIAL.clone();

  private readonly land: Landscape;

  constructor(land: Landscape) {
    this.land = land;
    this.lidMaterial.side = THREE.DoubleSide;
  }

  set(build: CanalBuild): void {
    // in Zehnteln, damit nicht jeder Spieltag neu gebaut wird
    const key = build.done ? 'done' : `${build.stage}-${Math.floor(build.stageShare * 10)}`;
    if (key === this.key) return;
    this.key = key;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    }
    for (const line of this.land.canals) this.buildLine(line, build);
  }

  private buildLine(line: CanalLine, b: CanalBuild): void {
    const { points, halfWidth: hw } = line;
    const n = points.length;
    const share = Math.min(1, Math.max(0, b.stageShare));
    const stakes = b.done || b.stage >= 3 ? 0 : b.stage === 0 ? share : 1;
    const dig = b.done || b.stage >= 3 ? 1 : b.stage < 1 ? 0 : (b.stage - 1 + share) / 2;
    const walls = b.done ? 1 : b.stage >= 3 ? share : 0;
    // von beiden Enden her: Altenfurt und Tuchingen haben je eine Baustelle
    const fromEnds = (s: number, f: number) => f >= 1 || s < f / 2 || s > 1 - f / 2;
    const kit = new Kit();
    const lid: number[] = [];
    const lidCol: number[] = [];
    const water: number[] = [];
    const rand = mulberry(n * 7 + 3);
    const inRiver = (i: number) => this.land.riverDistance(points[i].x, points[i].z).d < 5.2;
    const towpath = hw + WALL + CANAL_TOWPATH;

    const quad = (out: number[], i: number, off: number, y0: number, y1: number) => {
      const a = points[i];
      const c = points[i + 1];
      const ax = -a.dz * off;
      const az = a.dx * off;
      const cx = -c.dz * off;
      const cz = c.dx * off;
      out.push(
        a.x - ax, y0, a.z - az, c.x - cx, y1, c.z - cz, c.x + cx, y1, c.z + cz,
        a.x - ax, y0, a.z - az, c.x + cx, y1, c.z + cz, a.x + ax, y0, a.z + az,
      );
    };

    for (let i = 0; i < n - 1; i++) {
      const a = points[i];
      const c = points[i + 1];
      const s = (a.s + c.s) / 2;
      if (inRiver(i) || inRiver(i + 1)) continue;
      const heading = Math.atan2(-a.dz, a.dx);
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const mx = (a.x + c.x) / 2;
      const mz = (a.z + c.z) / 2;
      const top = Math.max(a.level, c.level) + CANAL_BANK;

      // Noch nicht ausgehoben: Deckel auf Höhe des Leinpfads (gerodeter Streifen)
      if (!fromEnds(s, dig)) {
        quad(lid, i, hw + CANAL_TRENCH + 0.6, a.level + CANAL_BANK + 0.02, c.level + CANAL_BANK + 0.02);
        const col = new THREE.Color(vary(COL.cleared, 0.05, rand()));
        for (let k = 0; k < 6; k++) lidCol.push(col.r, col.g, col.b);
      }

      // Pflöcke mit roten Fähnchen entlang der Trasse
      if (stakes > 0 && i % 3 === 0 && fromEnds(s, stakes)) {
        for (const side of [-1, 1]) {
          const off = side * (hw + 0.6);
          const x = a.x - a.dz * off;
          const z = a.z + a.dx * off;
          const y = this.land.heightAt(x, z);
          kit.add(boxGeo(0.09, 0.75, 0.09), COL.stake, { x, y: y - 0.05, z });
          if (i % 9 === 0) kit.add(boxGeo(0.02, 0.16, 0.22), COL.flag, { x, y: y + 0.52, z, ry: heading });
        }
      }

      // Aushub in Haufen neben dem Graben, solange noch gegraben wird
      if (b.stage >= 1 && !b.done && b.stage < 3 && fromEnds(s, dig) && i % 4 === 0) {
        const side = i % 8 === 0 ? 1 : -1;
        const off = side * (towpath + 1.3 + rand() * 0.8);
        const x = mx - a.dz * off;
        const z = mz + a.dx * off;
        const sc = 0.8 + rand() * 0.5;
        kit.add(dodecaGeo(0.9), vary(COL.earth, 0.12, rand()), { x, y: this.land.heightAt(x, z) - 0.2, z, sx: sc * 1.3, sy: sc * 0.55, sz: sc, ry: rand() * 3 });
      }

      // Ufermauern mit Deckplatten
      if (walls > 0 && fromEnds(s, walls)) {
        const bottom = Math.min(a.level, c.level) - CANAL_BED;
        const h = top + 0.1 - bottom;
        for (const side of [-1, 1]) {
          const off = side * (hw + WALL / 2);
          const x = mx - a.dz * off;
          const z = mz + a.dx * off;
          kit.add(boxGeo(len + 0.06, h, WALL), vary(COL.stone, 0.06, rand()), { x, y: bottom, z, ry: heading });
          kit.add(boxGeo(len + 0.06, 0.1, WALL + 0.16), COL.coping, { x, y: top + 0.1, z, ry: heading });
        }
        // Leinpfad von der Mauer bis zum Grabenrand, deckt den ausgehobenen Streifen ab
        for (const side of [-1, 1]) {
          const w = CANAL_TRENCH + 0.5 - WALL;
          const off = side * (hw + WALL + w / 2);
          const x = mx - a.dz * off;
          const z = mz + a.dx * off;
          kit.add(boxGeo(len + 0.06, top - bottom, w), vary(COL.towpath, 0.04, rand()), { x, y: bottom, z, ry: heading });
        }
      }

      if (b.done) quad(water, i, hw + 0.02, a.level - 0.15, c.level - 0.15);
    }

    // Arbeitsstellen an den Grabenspitzen: Dreibock mit Seil, Schubkarren, Bretterrampe
    if (b.stage >= 1 && b.stage < 3 && !b.done && dig < 1) {
      for (const s of [dig / 2, 1 - dig / 2]) {
        const i = Math.min(n - 2, Math.max(0, Math.round(s * (n - 1))));
        if (inRiver(i)) continue;
        const p = points[i];
        const heading = Math.atan2(-p.dz, p.dx);
        const y = p.level + CANAL_BANK;
        kit.at({ x: p.x, y, z: p.z, ry: heading }, () => {
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2;
            kit.add(cylGeo(0.05, 0.06, 2.6, 5), COL.wood, { x: Math.cos(a) * 0.7, z: Math.sin(a) * 0.7, rz: Math.cos(a) * 0.27, rx: -Math.sin(a) * 0.27 });
          }
          kit.add(cylGeo(0.015, 0.015, 1.6, 4), 0x6a5a40, { y: 0.9 });
          kit.add(boxGeo(0.5, 0.35, 0.5), COL.woodLight, { y: 0.55 });
          for (const side of [-1, 1]) {
            kit.at({ x: -1.2 + side * 0.4, z: side * (hw + 1.1) }, () => {
              kit.add(boxGeo(0.7, 0.25, 0.42), COL.wood, { y: 0.2, ry: 0.3 * side });
              kit.add(cylGeo(0.13, 0.13, 0.06, 8), 0x3a3d42, { x: 0.4, y: 0.13, rx: Math.PI / 2, ry: 0.3 * side });
            });
          }
          kit.add(boxGeo(2.4, 0.06, 0.5), COL.woodLight, { x: 1.6, y: -0.55, rz: 0.4 });
        });
      }
    }

    // Schleusen: Tore aus Holz, Waagebalken auf dem Leinpfad, ein Wärterhaus an jeder zweiten
    if (walls > 0) {
      line.locks.forEach((li, k) => {
        const p = points[li];
        if (!fromEnds(p.s, walls) || inRiver(li)) return;
        const heading = Math.atan2(-p.dz, p.dx);
        const lo = Math.min(points[li - 1].level, p.level);
        const hi = Math.max(points[li - 1].level, p.level);
        const up = p.level > points[li - 1].level ? 1 : -1;
        kit.at({ x: p.x, y: 0, z: p.z, ry: heading }, () => {
          // Schwelle als Quermauer, darüber die Torflügel des oberen und unteren Haupts
          kit.add(boxGeo(0.5, hi - CANAL_BED - (lo - CANAL_BED) + 0.05, hw * 2 + 0.1), COL.stoneDark, { y: lo - CANAL_BED });
          for (const gx of [0.3, -up * 4.2]) {
            const gateLow = gx === 0.3 ? hi - CANAL_BED : lo - CANAL_BED;
            const gateH = hi + CANAL_BANK - gateLow;
            if (!b.done && walls < 1) continue;
            for (const side of [-1, 1]) {
              kit.add(boxGeo(0.14, gateH, hw), COL.wood, { x: gx + side * 0.1 * up, y: gateLow, z: side * hw * 0.5, ry: side * up * 0.18 });
              kit.add(boxGeo(1.8, 0.1, 0.1), COL.woodLight, { x: gx - up * 0.9, y: hi + CANAL_BANK + 0.25, z: side * (hw + WALL + 0.25) });
            }
          }
          // Seitenmauern der Kammer etwas höher, damit die Schleuse von weitem erkennbar ist
          for (const side of [-1, 1]) {
            kit.add(boxGeo(5, 0.22, WALL + 0.3), COL.stoneDark, { x: -up * 2, y: hi + CANAL_BANK + 0.08, z: side * (hw + WALL / 2) });
            for (const px of [-up * 0.4, -up * 3.6]) kit.add(cylGeo(0.12, 0.14, 0.4, 6), 0x3a3632, { x: px, y: hi + CANAL_BANK + 0.2, z: side * (hw + WALL + 0.45) });
          }
          if (b.done && k % 2 === 0) {
            const side = k % 4 === 0 ? 1 : -1;
            kit.at({ x: -up * 2, y: hi + CANAL_BANK, z: side * (towpath + 1.6), ry: side > 0 ? 0 : Math.PI }, () => {
              kit.add(boxGeo(2.2, 1.3, 1.6), COL.plaster);
              kit.add(gableGeo(2.5, 1.95, 0.95), COL.roof, { y: 1.3 });
              kit.add(boxGeo(0.4, 0.7, 0.03), 0x4a3020, { y: 0, z: -0.81 });
              kit.add(boxGeo(0.42, 0.42, 0.03), 0x2c3a46, { x: 0.6, y: 0.55, z: -0.81 });
              kit.add(boxGeo(0.25, 0.6, 0.25), 0x8a3a2a, { x: 0.6, y: 1.6 });
            });
          }
        });
      });
    }

    // Baubuden an beiden Enden, solange gebaut wird
    if (!b.done && (b.stage > 0 || share > 0)) {
      for (const i of [Math.min(n - 1, 8), Math.max(0, n - 9)]) {
        const p = points[i];
        if (inRiver(i)) continue;
        const off = towpath + 3.2;
        const x = p.x - p.dz * off;
        const z = p.z + p.dx * off;
        const y = this.land.heightAt(x, z);
        kit.at({ x, y, z, ry: Math.atan2(-p.dz, p.dx) }, () => {
          kit.add(boxGeo(2.4, 1.1, 1.5), COL.woodLight);
          kit.add(gableGeo(2.6, 1.8, 0.6), COL.wood, { y: 1.1 });
          kit.add(boxGeo(0.6, 0.5, 0.6), COL.woodLight, { x: 1.9, y: 0 });
          kit.add(boxGeo(0.6, 0.5, 0.6), COL.wood, { x: 1.9, y: 0.5, ry: 0.4 });
        });
      }
    }

    if (!kit.empty) this.group.add(kit.mesh());
    if (lid.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(lid, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(lidCol, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.lidMaterial);
      m.receiveShadow = true;
      this.group.add(m);
    }
    if (water.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(water, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.water);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  setWaterColor(color: THREE.Color): void {
    this.water.color.copy(color);
  }
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
