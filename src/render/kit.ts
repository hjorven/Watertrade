import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Baukasten für Low-Poly-Modelle: viele kleine Teile mit eigener Farbe werden zu einer einzigen Geometrie
 * mit Vertexfarben verschmolzen. So kostet ein ganzes Dorf mit Kirche, Steg und Holzstapeln nur einen Draw-Call.
 */

/** Gemeinsames Material für alles, was aus dem Baukasten kommt */
export const KIT_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });

/** Für flache Auflagen (Wege, Plätze): wird vor dem Gelände gezeichnet, ohne zu flimmern */
export const DECAL_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: false, // weich schattiert, damit Plätze auf Hängen nicht wie Krater wirken
  roughness: 0.95,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -4,
});

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Quader mit Unterkante bei y = 0 */
export const boxGeo = (w: number, h: number, d: number) =>
  cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0));

/** Zylinder mit Unterkante bei y = 0 */
export const cylGeo = (rt: number, rb: number, h: number, seg = 8) =>
  cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, h / 2, 0));

/** Kegel mit Unterkante bei y = 0 */
export const coneGeo = (r: number, h: number, seg = 8) =>
  cached(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0));

/** Einseitige Fläche, Vorderseite nach +z, Unterkante bei y = 0 (Fenster, Balken, Bretter auf Wänden) */
export const panelGeo = (w: number, h: number) => cached(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0));

export const icoGeo = (r: number, detail = 0) => cached(`i${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail));

export const dodecaGeo = (r: number) => cached(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0));

export const torusGeo = (r: number, tube: number, rs = 5, ts = 12) =>
  cached(`t${r},${tube},${rs},${ts}`, () => new THREE.TorusGeometry(r, tube, rs, ts));

/**
 * Satteldach: dreiseitiges Prisma, First entlang x, Traufe bei y = 0.
 * w = Länge des Firsts, d = Tiefe (quer zum First), h = Firsthöhe.
 */
export const gableGeo = (w: number, d: number, h: number) =>
  cached(`g${w},${d},${h}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-d / 2, 0);
    s.lineTo(d / 2, 0);
    s.lineTo(0, h);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);
    return g;
  });

/** Walmdach (vier Flächen), First entlang x */
export const hipGeo = (w: number, d: number, h: number) =>
  cached(`h${w},${d},${h}`, () => {
    const hw = w / 2;
    const hd = d / 2;
    const r = Math.max(0, hw - hd * 0.8);
    const v = [
      [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [-r, h, 0], [r, h, 0],
    ];
    const tris = [
      [0, 4, 5], [0, 5, 1], [2, 5, 4], [2, 4, 3], [1, 5, 2], [3, 4, 0],
    ];
    const pos: number[] = [];
    for (const t of tris) for (const i of t) pos.push(...v[i]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();

export interface Place {
  x?: number;
  y?: number;
  z?: number;
  /** Drehung um y */
  ry?: number;
  rx?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Einheitliche Skalierung */
  s?: number;
}

export class Kit {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  /** Teil hinzufügen; Lage relativ zum aktuellen Bezugssystem */
  add(geo: THREE.BufferGeometry, color: number, p: Place = {}): this {
    return this.addMatrix(geo, color, this.matrix(p, tmpM));
  }

  /** Weltmatrix für eine Lage im aktuellen Bezugssystem (z. B. um in einen anderen Baukasten zu bauen) */
  matrix(p: Place, target = new THREE.Matrix4()): THREE.Matrix4 {
    tmpE.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    const s = p.s ?? 1;
    tmpS.set((p.sx ?? 1) * s, (p.sy ?? 1) * s, (p.sz ?? 1) * s);
    tmpP.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
    return target.compose(tmpP, tmpQ, tmpS).premultiply(this.top());
  }

  addMatrix(geo: THREE.BufferGeometry, color: number, m: THREE.Matrix4): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    g.applyMatrix4(m);
    tmpC.setHex(color); // setHex rechnet bereits in den linearen Farbraum um
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpC.r;
      col[i * 3 + 1] = tmpC.g;
      col[i * 3 + 2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }

  /** Neues Bezugssystem: alles in `fn` wird relativ zu dieser Lage gebaut */
  at(p: Place, fn: () => void): this {
    tmpE.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ');
    const s = p.s ?? 1;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
      new THREE.Quaternion().setFromEuler(tmpE),
      new THREE.Vector3((p.sx ?? 1) * s, (p.sy ?? 1) * s, (p.sz ?? 1) * s),
    );
    this.stack.push(m.premultiply(this.top()));
    try {
      fn();
    } finally {
      this.stack.pop();
    }
    return this;
  }

  /** Aktuelles Bezugssystem als Matrix, z. B. für Rauchquellen */
  local(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.top());
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  mesh(shadows = true): THREE.Mesh {
    const m = new THREE.Mesh(this.geometry(), KIT_MATERIAL);
    m.castShadow = shadows;
    m.receiveShadow = true;
    return m;
  }

  private top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }
}

/** Farbe leicht abwandeln (für lebendigere Flächen) */
export function vary(hex: number, amount: number, r: number): number {
  const c = new THREE.Color(hex);
  const f = 1 + (r * 2 - 1) * amount;
  c.setRGB(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
  return c.getHex();
}
