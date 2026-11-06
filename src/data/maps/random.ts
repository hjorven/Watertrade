/**
 * Zufallsflüsse für das freie Spiel: erzeugt aus einem Startwert ein Flussnetz mit Hauptstrom,
 * ein oder zwei Nebenflüssen, Städten, Rohstoffen, Betrieben, Brücken und Wasserbauten.
 *
 * Der Generator baut nur Kandidaten. Ob eine Karte spielbar ist, prüft sim/mapcheck.ts
 * mit dem Balance-Bot; dort wird so lange ein neuer Versuch erzeugt, bis eine Karte besteht.
 * Gleicher Startwert und gleicher Versuch ergeben immer dieselbe Karte.
 */
import * as THREE from 'three';
import type { ProjectDef } from '../projects.ts';
import type { Industry, MapDef, RiverDef, SegmentDef, TownDef } from './valley.ts';

export const RANDOM_PREFIX = 'zufall-';
export const randomMapId = (seed: number): string => `${RANDOM_PREFIX}${seed}`;
export const isRandomMapId = (id: string | undefined): boolean => !!id && id.startsWith(RANDOM_PREFIX);

/** Startwert aus einer Karten-Id, oder null */
export function seedOfMapId(id: string | undefined): number | null {
  if (!isRandomMapId(id)) return null;
  const n = Number(id!.slice(RANDOM_PREFIX.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Größter Startwert, den das Menü anbietet */
export const MAX_SEED = 999_999;

/* ---------- Zufall ---------- */

class Rng {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }
  /** mulberry32 */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** ganze Zahl von a bis b, beide eingeschlossen */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  /** Eintrag nach Gewicht ziehen; null, wenn alle Gewichte 0 sind */
  weighted<T>(items: readonly T[], weight: (x: T) => number): T | null {
    const total = items.reduce((s, x) => s + Math.max(0, weight(x)), 0);
    if (total <= 0) return null;
    let r = this.next() * total;
    for (const x of items) {
      r -= Math.max(0, weight(x));
      if (r < 0) return x;
    }
    return items[items.length - 1];
  }
}

/** Startwert und Versuch zu einem Zufallsstrom mischen */
function mix(seed: number, attempt: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) ^ Math.imul(attempt + 1, 0x27d4eb2f);
  return (h ^ (h >>> 16)) >>> 0;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ---------- Geometrie (wie render/landscape.ts) ---------- */

/** Halbe Breite und Tiefe der Geländefläche (WORLD_W und WORLD_D in render/landscape.ts) */
export const HALF_W = 110;
export const HALF_D = 70;

const MAIN_HALF_WIDTH = 3.6;
const TRIB_HALF_WIDTH = 2.3;

interface Sample {
  x: number;
  z: number;
  t: number;
}

interface RiverGeo {
  def: RiverDef;
  curve: THREE.CatmullRomCurve3;
  samples: Sample[];
}

/** Gleiche Kurve wie im Gelände: Kontrollpunkte, beim Nebenfluss plus Mündungspunkt */
function riverGeo(def: RiverDef, rivers: Map<string, RiverGeo>): RiverGeo {
  const pts = def.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  if (def.joins) pts.push(rivers.get(def.joins.river)!.curve.getPointAt(def.joins.t));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const n = Math.max(20, Math.round(curve.getLength() / 2));
  const samples = curve.getSpacedPoints(n).map((p, i) => ({ x: p.x, z: p.z, t: i / n }));
  return { def, curve, samples };
}

export function riversGeo(defs: RiverDef[]): Map<string, RiverGeo> {
  const out = new Map<string, RiverGeo>();
  for (const d of defs) out.set(d.id, riverGeo(d, out));
  return out;
}

/** Stadtmitte und Radius genau wie placeTown in render/towns.ts */
export function townFootprint(geo: RiverGeo, t: number, side: number, houses: number): { x: number; z: number; radius: number } {
  const p = geo.curve.getPointAt(clamp(t, 0, 1));
  const tan = geo.curve.getTangentAt(clamp(t, 0, 1));
  const radius = 5 + houses * 0.42;
  const off = geo.def.halfWidth + 3 + radius;
  return { x: p.x - tan.z * side * off, z: p.z + tan.x * side * off, radius };
}

interface Spot {
  x: number;
  z: number;
  radius: number;
}

/** Passt eine Stadt hierhin: im Gelände, nicht im Wasser eines Flusses, nicht in einer anderen Stadt */
function spotFits(s: Spot, rivers: Iterable<RiverGeo>, placed: Spot[]): boolean {
  if (Math.abs(s.x) > HALF_W - s.radius * 0.5 - 1 || Math.abs(s.z) > HALF_D - s.radius * 0.5 - 1) return false;
  for (const r of rivers) {
    // wie im Tal: die Stadtmitte liegt mindestens 0,9 Stadtradien vom Ufer entfernt
    const min = s.radius * 0.9 + r.def.halfWidth;
    for (const p of r.samples) if (Math.hypot(p.x - s.x, p.z - s.z) < min) return false;
  }
  return placed.every((o) => Math.hypot(o.x - s.x, o.z - s.z) >= o.radius + s.radius + 3);
}

/** Lageprobleme einer fertigen Karte (auch für handgebaute Karten nutzbar) */
export function layoutProblems(map: MapDef): string[] {
  const rivers = riversGeo(map.rivers);
  const out: string[] = [];
  const placed: Spot[] = [];
  for (const t of map.towns) {
    const geo = rivers.get(t.river);
    if (!geo) {
      out.push(`${t.name} liegt an einem unbekannten Fluss`);
      continue;
    }
    const s = townFootprint(geo, t.riverT, t.side, t.houses);
    if (!spotFits(s, rivers.values(), placed)) out.push(`${t.name} überschneidet sich mit Wasser, Rand oder einer anderen Stadt`);
    placed.push(s);
  }
  return out;
}

/* ---------- Flüsse ---------- */

function mainRiver(rng: Rng): [number, number][] {
  const n = 9;
  const pts: [number, number][] = [];
  let z = rng.range(-36, 36);
  for (let i = 0; i < n; i++) {
    if (i > 0) z = clamp(z + rng.range(-24, 24), -40, 40);
    pts.push([round1(-HALF_W + (2 * HALF_W * i) / (n - 1)), round1(z)]);
  }
  // mal fließt der Strom nach Osten, mal nach Westen
  return rng.chance(0.5) ? pts.map(([x, zz]) => [-x, zz] as [number, number]) : pts;
}

/**
 * Kontrollpunkte eines Nebenflusses von der Quelle bis kurz vor die Mündung bei `t` auf dem Hauptstrom.
 * `side` 1 heißt rechts vom Hauptstrom in Fließrichtung.
 */
function tributary(rng: Rng, main: RiverGeo, t: number, side: number, others: RiverGeo[]): [number, number][] | null {
  const p = main.curve.getPointAt(t);
  const tan = main.curve.getTangentAt(t);
  const nx = -tan.z * side;
  const nz = tan.x * side;
  // flussaufwärts am Nebenfluss: vom Strom weg und etwas gegen dessen Fließrichtung
  const back = rng.range(0.1, 0.6);
  let dir = Math.atan2(nz - tan.z * back, nx - tan.x * back);
  const pts: [number, number][] = [];
  let x = p.x;
  let z = p.z;
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const step = i === 0 ? rng.range(20, 26) : rng.range(16, 24);
    dir += rng.range(-0.38, 0.38);
    x = clamp(x + Math.cos(dir) * step, -HALF_W + 6, HALF_W - 6);
    z = clamp(z + Math.sin(dir) * step, -HALF_D + 6, HALF_D - 6);
    pts.push([round1(x), round1(z)]);
  }
  pts.reverse();
  const def: RiverDef = { id: 'probe', name: '', halfWidth: TRIB_HALF_WIDTH, points: pts, joins: { river: main.def.id, t } };
  const geo = riverGeo(def, new Map([[main.def.id, main]]));
  const len = geo.curve.getLength();
  if (len < 60 || len > 125) return null;
  for (const s of geo.samples) {
    if (Math.abs(s.x) > HALF_W - 4 || Math.abs(s.z) > HALF_D - 4) return null;
    // zur Mündung hin darf der Bach dem Strom näher kommen, sonst bleibt Abstand
    const toMouth = Math.hypot(s.x - p.x, s.z - p.z);
    const min = Math.min(18, toMouth * 0.55);
    for (const m of main.samples) if (Math.hypot(m.x - s.x, m.z - s.z) < min - 0.01) return null;
    for (const o of others) for (const q of o.samples) if (Math.hypot(q.x - s.x, q.z - s.z) < 26) return null;
  }
  // keine Schleife: die Quelle liegt weit von der Mündung
  const [sx, sz] = pts[0];
  if (Math.hypot(sx - p.x, sz - p.z) < 45) return null;
  return pts;
}

/* ---------- Namen ---------- */

const PREFIX = [
  'Ober', 'Nieder', 'Alt', 'Neu', 'Hohen', 'Kalten', 'Wald', 'Stein', 'Eichen', 'Linden', 'Birken', 'Hasel', 'Erlen',
  'Weiden', 'Rosen', 'Mühl', 'Brunn', 'Hirsch', 'Wolfs', 'Fuchs', 'Raben', 'Grün', 'Roth', 'Schön', 'Kirch', 'Marien',
  'Sand', 'Bären', 'Falken', 'Tannen', 'Buchen', 'Lauter', 'Kranich', 'Otter', 'Biber', 'Reh',
];
const SUFFIX = ['au', 'furt', 'brück', 'heim', 'hof', 'dorf', 'stadt', 'berg', 'hausen', 'ingen', 'feld', 'born', 'rode', 'werder', 'kirchen', 'stede'];
const MINE_PREFIX = ['Erz', 'Kohl', 'Silber', 'Zinn', 'Eisen', 'Kupfer', 'Blei', 'Schiefer'];
const MINE_SUFFIX = ['grube', 'berg', 'stollen', 'hütte', 'zeche'];
const PORT_SUFFIX = ['münd', 'hafen', 'mündung', 'siel'];
const MAIN_RIVERS = ['Silberstrom', 'Grünstrom', 'Breitach', 'Lauter', 'Wiesel', 'Eller', 'Schwarzach', 'Weide', 'Kronstrom', 'Rotstrom', 'Ahrstrom', 'Weitwasser'];
const SIDE_RIVERS = ['Kupferbach', 'Eisenbach', 'Steinbach', 'Kaltbach', 'Mühlbach', 'Wildbach', 'Lindbach', 'Erlenbach', 'Forellenbach', 'Sandbach', 'Rauschbach', 'Grenzbach'];

/** Id aus einem Namen: klein, ohne Umlaute */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

function townName(rng: Rng, role: Role, used: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    let name: string;
    if (role === 'grube' || role === 'kohle') name = rng.pick(MINE_PREFIX) + rng.pick(MINE_SUFFIX);
    else if (role === 'hafen') name = rng.pick(PREFIX) + rng.pick(PORT_SUFFIX);
    else {
      // "-stadt" nur für Orte, die groß genug sind
      const suffix = rng.pick(SUFFIX);
      if (suffix === 'stadt' && ROLES[role].pop[1] < 800) continue;
      name = rng.pick(PREFIX) + suffix;
    }
    // "Hohenheim" ja, "Neuneu" nicht
    if (/(.)\1\1/.test(name.toLowerCase())) continue;
    if (!used.has(slug(name))) {
      used.add(slug(name));
      return name;
    }
  }
  const name = `${rng.pick(PREFIX)}${rng.pick(SUFFIX)} ${used.size + 1}`;
  used.add(slug(name));
  return name;
}

/* ---------- Städte und Wirtschaft ---------- */

type Role = 'wald' | 'wald2' | 'grube' | 'kohle' | 'hafen' | 'korn' | 'aue' | 'markt' | 'schmiede' | 'glas' | 'fischer';

interface RoleDef {
  kind: string;
  produces: Record<string, [number, number]>;
  pop: [number, number];
  houses: [number, number];
  target: [number, number];
  style: string;
  fields?: boolean;
}

/** Stadtarten mit Spannweiten nach dem Vorbild des Tals der zwei Flüsse */
const ROLES: Record<Role, RoleDef> = {
  wald: { kind: 'Holzfällerdorf', produces: { holz: [12, 16], wolle: [2, 4] }, pop: [320, 420], houses: [10, 12], target: [55, 65], style: 'oberau' },
  wald2: { kind: 'Waldsiedlung', produces: { holz: [8, 11] }, pop: [300, 380], houses: [9, 11], target: [50, 60], style: 'oberau' },
  grube: { kind: 'Bergwerk', produces: { erz: [8, 11], kohle: [7, 9] }, pop: [280, 340], houses: [8, 10], target: [45, 55], style: 'erzgrube' },
  kohle: { kind: 'Köhlerdorf', produces: { kohle: [6, 8], wolle: [2, 3] }, pop: [280, 340], houses: [8, 10], target: [45, 55], style: 'erzgrube' },
  hafen: { kind: 'Hafenstadt', produces: { salz: [10, 13], fisch: [6, 9] }, pop: [1500, 1900], houses: [22, 26], target: [100, 115], style: 'niedermuend' },
  korn: { kind: 'Kornstadt', produces: { getreide: [10, 13] }, pop: [600, 800], houses: [14, 16], target: [75, 85], style: 'muehlheim', fields: true },
  aue: { kind: 'Bauerndorf', produces: { getreide: [6, 9], fisch: [4, 7], wolle: [2, 4] }, pop: [400, 520], houses: [11, 13], target: [65, 75], style: 'weidenhof', fields: true },
  markt: { kind: 'Marktflecken', produces: {}, pop: [850, 1100], houses: [16, 19], target: [75, 85], style: 'altenfurt' },
  schmiede: { kind: 'Handwerkerstadt', produces: {}, pop: [800, 1000], houses: [15, 17], target: [65, 75], style: 'kesselbrueck' },
  glas: { kind: 'Glasbläserdorf', produces: { wolle: [2, 4] }, pop: [300, 360], houses: [9, 11], target: [45, 55], style: 'glashuette' },
  fischer: { kind: 'Fischerdorf', produces: { fisch: [6, 8] }, pop: [350, 450], houses: [10, 12], target: [55, 65], style: 'weidenhof' },
};

type IndustryId = 'saegewerk' | 'schmiede' | 'muehle' | 'brauerei' | 'tischlerei' | 'weberei' | 'baeckerei' | 'glasofen' | 'apotheke';

/** Betriebe der Städte mit den Mengen aus dem Tal */
const INDUSTRIES: Record<IndustryId, Industry> = {
  saegewerk: { name: 'Sägewerk', inputs: { holz: 4 }, outputs: { bretter: 2 } },
  schmiede: { name: 'Schmiede', inputs: { erz: 2, kohle: 2 }, outputs: { werkzeug: 1 } },
  muehle: { name: 'Mühle', inputs: { getreide: 4 }, outputs: { mehl: 3 } },
  brauerei: { name: 'Brauerei', inputs: { getreide: 2 }, outputs: { bier: 2 } },
  tischlerei: { name: 'Tischlerei', inputs: { bretter: 2 }, outputs: { moebel: 1 } },
  weberei: { name: 'Weberei', inputs: { wolle: 3 }, outputs: { stoff: 2 } },
  baeckerei: { name: 'Bäckerei', inputs: { mehl: 2 }, outputs: { brot: 3 } },
  glasofen: { name: 'Glasofen', inputs: { kohle: 2 }, outputs: { glas: 1 } },
  apotheke: { name: 'Apotheke', inputs: { glas: 0.5, salz: 1 }, outputs: { arznei: 1 } },
};

/** Wie gut ein Betrieb zu einer Stadtart passt (0 = nie) */
const FIT: Record<IndustryId, Partial<Record<Role, number>>> = {
  saegewerk: { wald: 4, wald2: 3, markt: 1, schmiede: 1, korn: 1 },
  schmiede: { schmiede: 6, markt: 1, korn: 1, hafen: 1 },
  muehle: { korn: 5, aue: 2, markt: 1 },
  brauerei: { korn: 3, aue: 2, hafen: 2, markt: 1, schmiede: 1 },
  tischlerei: { markt: 4, schmiede: 1, hafen: 1, korn: 1 },
  weberei: { markt: 4, aue: 1, schmiede: 1, korn: 1 },
  baeckerei: { aue: 3, hafen: 2, markt: 1, korn: 1, fischer: 1 },
  glasofen: { glas: 6, schmiede: 1, markt: 1, fischer: 1 },
  apotheke: { hafen: 4, markt: 2, schmiede: 1 },
};

/** Jeder Betrieb kommt mindestens einmal vor, damit alle Warenketten bestehen */
const REQUIRED: IndustryId[] = ['schmiede', 'glasofen', 'apotheke', 'muehle', 'baeckerei', 'saegewerk', 'tischlerei', 'weberei', 'brauerei'];

/** Bedarf der Bevölkerung je Ware bei rund 700 Einwohnern, mit Gruppe für die Gewichtung nach Stadtgröße */
const BASKET: Record<string, { amount: number; group: 'essen' | 'handwerk' | 'gehoben' }> = {
  brot: { amount: 2.5, group: 'essen' },
  bier: { amount: 1.8, group: 'essen' },
  salz: { amount: 1.6, group: 'essen' },
  fisch: { amount: 1.4, group: 'essen' },
  getreide: { amount: 3, group: 'essen' },
  holz: { amount: 3, group: 'handwerk' },
  bretter: { amount: 1.5, group: 'handwerk' },
  kohle: { amount: 2.5, group: 'handwerk' },
  werkzeug: { amount: 0.6, group: 'handwerk' },
  stoff: { amount: 1.2, group: 'gehoben' },
  moebel: { amount: 0.6, group: 'gehoben' },
  glas: { amount: 0.6, group: 'gehoben' },
  arznei: { amount: 0.4, group: 'gehoben' },
};

const GOOD_NAMES: Record<string, string> = {
  holz: 'Holz', bretter: 'Bretter', moebel: 'Möbel', getreide: 'Getreide', mehl: 'Mehl', brot: 'Brot', fisch: 'Fisch',
  salz: 'Salz', erz: 'Erz', kohle: 'Kohle', werkzeug: 'Werkzeug', glas: 'Glas', wolle: 'Wolle', stoff: 'Stoff', bier: 'Bier', arznei: 'Arznei',
};

const FULL_YARD = ['plaette', 'treidelkahn', 'segelkahn', 'raddampfer', 'schleppverband', 'motorschiff', 'kuehlschiff'];
const SMALL_YARD = ['plaette', 'treidelkahn', 'raddampfer', 'motorschiff'];

interface Slot {
  river: string;
  t: number;
  side: -1 | 1;
  role?: Role;
  /** Mündungsstadt dieses Nebenflusses: liegt am Hauptstrom gegenüber und knapp unterhalb der Einmündung */
  mouthOf?: string;
  required: boolean;
}

function joinList(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} und ${words[words.length - 1]}`;
}

/** Warum der letzte Kandidat verworfen wurde (für Tests und Fehlersuche) */
export let lastFailure = '';

function reject(why: string): null {
  lastFailure = why;
  return null;
}

/** Ein Kandidat für eine Zufallskarte. Kann null liefern, wenn sich die Lage nicht auflösen lässt. */
export function generateCandidate(seed: number, attempt = 0): MapDef | null {
  lastFailure = '';
  const rng = new Rng(mix(seed, attempt));

  /* Flüsse */
  const mainName = rng.pick(MAIN_RIVERS);
  const mainDef: RiverDef = { id: 'strom', name: mainName, halfWidth: MAIN_HALF_WIDTH, points: mainRiver(rng) };
  const geos = new Map<string, RiverGeo>([['strom', riverGeo(mainDef, new Map())]]);
  const main = geos.get('strom')!;
  const tribCount = rng.chance(0.45) ? 2 : 1;
  const joinTs = tribCount === 1 ? [rng.range(0.35, 0.68)] : [rng.range(0.24, 0.42), rng.range(0.58, 0.78)];
  const sideNames = rng.shuffle([...SIDE_RIVERS]);
  const tribs: { def: RiverDef; side: -1 | 1 }[] = [];
  for (let i = 0; i < tribCount; i++) {
    const others = tribs.map((x) => geos.get(x.def.id)!);
    const firstSide: -1 | 1 = rng.chance(0.5) ? 1 : -1;
    let made: { pts: [number, number][]; side: -1 | 1 } | null = null;
    for (let k = 0; k < 16 && !made; k++) {
      const side: -1 | 1 = k % 2 === 0 ? firstSide : (-firstSide as -1 | 1);
      const pts = tributary(rng, main, joinTs[i], side, others);
      if (pts) made = { pts, side };
    }
    if (!made) {
      if (i === 0) return reject('kein Platz für den Nebenfluss'); // ohne Nebenfluss fehlt das Bergwerk
      break;
    }
    const def: RiverDef = {
      id: i === 0 ? 'bach' : 'bach2',
      name: sideNames[i],
      halfWidth: TRIB_HALF_WIDTH,
      points: made.pts,
      joins: { river: 'strom', t: round1(joinTs[i] * 100) / 100 },
    };
    // die gerundete Mündung neu messen, damit Gelände und Prüfung dieselbe Kurve sehen
    geos.set(def.id, riverGeo(def, geos));
    tribs.push({ def, side: made.side });
  }

  /* Stadtplätze */
  const slots: Slot[] = [];
  slots.push({ river: 'strom', t: rng.range(0.04, 0.08), side: rng.chance(0.5) ? 1 : -1, role: 'wald', required: true });
  slots.push({ river: 'strom', t: rng.range(0.9, 0.94), side: rng.chance(0.5) ? 1 : -1, role: 'hafen', required: true });
  tribs.forEach((tr, i) => {
    const jt = tr.def.joins!.t;
    slots.push({ river: 'strom', t: jt + rng.range(0.015, 0.03), side: -tr.side as -1 | 1, mouthOf: tr.def.id, required: true });
    slots.push({ river: tr.def.id, t: rng.range(0.06, 0.14), side: rng.chance(0.5) ? 1 : -1, role: i === 0 ? 'grube' : rng.pick(['kohle', 'wald2', 'glas'] as Role[]), required: i === 0 });
    if (rng.chance(i === 0 ? 0.75 : 0.4)) slots.push({ river: tr.def.id, t: rng.range(0.45, 0.62), side: rng.chance(0.5) ? 1 : -1, required: false });
  });
  const mainCount = rng.int(6, 7);
  for (let k = 0; k < 60 && slots.filter((s) => s.river === 'strom').length < mainCount; k++) {
    const t = rng.range(0.13, 0.86);
    if (slots.some((s) => s.river === 'strom' && Math.abs(s.t - t) < 0.11)) continue;
    slots.push({ river: 'strom', t, side: rng.chance(0.5) ? 1 : -1, required: false });
  }

  /* Stadtarten verteilen: ein Kornort ist Pflicht, dann gemischt */
  const open = slots.filter((s) => !s.role);
  const pool: Role[] = rng.shuffle(['aue', 'markt', 'schmiede', 'glas'] as Role[]);
  const extra: Role[] = ['fischer', 'aue', 'markt', 'korn', 'wald2'];
  // die Mündungsstädte sind größere Orte
  open.sort((a, b) => Number(!!b.mouthOf) - Number(!!a.mouthOf));
  open.forEach((s, i) => {
    if (i === 0) s.role = 'korn';
    else if (s.mouthOf && rng.chance(0.6)) s.role = rng.pick(['markt', 'schmiede', 'korn'] as Role[]);
    else s.role = pool.shift() ?? rng.pick(extra);
  });

  /* Lage prüfen und Größen festlegen */
  const placed: Spot[] = [];
  const towns: (TownDef & { role: Role; mouthOf?: string })[] = [];
  const used = new Set<string>();
  // große Städte zuerst, damit sie ihren Platz bekommen
  const order = [...slots].sort((a, b) => ROLES[b.role!].houses[0] - ROLES[a.role!].houses[0]);
  for (const s of order) {
    const role = ROLES[s.role!];
    const houses = rng.int(role.houses[0], role.houses[1]);
    const geo = geos.get(s.river)!;
    let spot: Spot | null = null;
    const tries: { t: number; side: -1 | 1 }[] = [];
    // die Mündungsstadt bleibt gegenüber und rückt nur flussabwärts
    for (const dt of s.mouthOf ? [0, 0.02, 0.04] : [0, 0.02, -0.02, 0.04, -0.04]) {
      tries.push({ t: s.t + dt, side: s.side });
      if (!s.mouthOf) tries.push({ t: s.t + dt, side: -s.side as -1 | 1 });
    }
    for (const c of tries) {
      c.t = Math.round(c.t * 1000) / 1000;
      if (c.t < 0.03 || c.t > 0.97) continue;
      const f = townFootprint(geo, c.t, c.side, houses);
      if (spotFits(f, geos.values(), placed)) {
        spot = f;
        s.t = c.t;
        s.side = c.side;
        break;
      }
    }
    if (!spot) {
      if (s.required) return reject(`kein Platz für ${ROLES[s.role!].kind}`);
      continue;
    }
    placed.push(spot);
    const name = townName(rng, s.role!, used);
    const produces: Record<string, number> = {};
    for (const [g, [a, b]] of Object.entries(role.produces)) produces[g] = Math.round(rng.range(a, b));
    towns.push({
      id: slug(name),
      name,
      description: '',
      river: s.river,
      riverT: s.t,
      side: s.side,
      houses,
      population: Math.round(rng.range(role.pop[0], role.pop[1]) / 10) * 10,
      fields: role.fields,
      target: Math.round(rng.range(role.target[0], role.target[1]) / 5) * 5,
      produces,
      consumes: {},
      industries: [],
      shipyard: [],
      style: role.style,
      role: s.role!,
      mouthOf: s.mouthOf,
    });
  }
  const riverOrder = ['strom', ...tribs.map((x) => x.def.id)];
  towns.sort((a, b) => riverOrder.indexOf(a.river) - riverOrder.indexOf(b.river) || a.riverT - b.riverT);

  /* Betriebe */
  const maxInd = (t: { role: Role }) => (t.role === 'hafen' ? 3 : t.role === 'grube' || t.role === 'kohle' ? 0 : 2);
  const ids: IndustryId[] = [...REQUIRED];
  if (rng.chance(0.7)) ids.push(rng.pick(['brauerei', 'baeckerei'] as IndustryId[]));
  const has = new Map<string, IndustryId[]>(towns.map((t) => [t.id, []]));
  for (const ind of ids) {
    const town = rng.weighted(towns, (t) => (has.get(t.id)!.length < maxInd(t) && !has.get(t.id)!.includes(ind) ? (FIT[ind][t.role] ?? 0) : 0));
    const fallback = town ?? rng.weighted(towns, (t) => (has.get(t.id)!.length < maxInd(t) + 1 && !has.get(t.id)!.includes(ind) && maxInd(t) > 0 ? 1 : 0));
    if (!fallback) return reject(`kein Ort für ${INDUSTRIES[ind].name}`);
    has.get(fallback.id)!.push(ind);
  }
  // Orte ohne eigene Rohstoffe brauchen wenigstens einen Betrieb, sonst gibt es dort nichts zu kaufen
  for (const t of towns) {
    if (Object.keys(t.produces).length || has.get(t.id)!.length) continue;
    has.get(t.id)!.push(rng.pick(['brauerei', 'baeckerei', 'tischlerei', 'weberei'] as IndustryId[]));
  }
  for (const t of towns) t.industries = has.get(t.id)!.map((i) => ({ ...INDUSTRIES[i], inputs: { ...INDUSTRIES[i].inputs }, outputs: { ...INDUSTRIES[i].outputs } }));

  /* Bedarf der Bevölkerung */
  const makes = (t: TownDef) => new Set([...Object.keys(t.produces), ...t.industries.flatMap((i) => Object.keys(i.outputs))]);
  for (const t of towns) {
    const own = makes(t);
    const size = t.population < 500 ? 'klein' : t.population < 1200 ? 'mittel' : 'gross';
    const weight = { klein: { essen: 3, handwerk: 1.5, gehoben: 0.5 }, mittel: { essen: 2, handwerk: 1.5, gehoben: 1.5 }, gross: { essen: 1.5, handwerk: 2, gehoben: 2.5 } }[size];
    const k = size === 'klein' ? rng.int(4, 5) : size === 'mittel' ? rng.int(5, 6) : rng.int(6, 7);
    const candidates = Object.keys(BASKET).filter((g) => !own.has(g));
    for (let i = 0; i < k && candidates.length; i++) {
      const g = rng.weighted(candidates, (x) => weight[BASKET[x].group])!;
      candidates.splice(candidates.indexOf(g), 1);
      t.consumes[g] = round1(BASKET[g].amount * Math.pow(t.population / 700, 0.4) * rng.range(0.8, 1.2));
    }
  }
  // jede Ware aus dem Korb braucht irgendwo einen Abnehmer, der sie nicht selbst herstellt
  for (const g of Object.keys(BASKET)) {
    const used2 = towns.some((t) => (t.consumes[g] ?? 0) > 0 || t.industries.some((i) => g in i.inputs));
    if (used2) continue;
    const buyers = towns.filter((t) => !makes(t).has(g));
    if (!buyers.length) return reject(`kein Abnehmer für ${g}`);
    const t = rng.pick(buyers);
    t.consumes[g] = round1(BASKET[g].amount * rng.range(0.8, 1.2));
  }

  /* Werften */
  const port = towns.find((t) => t.role === 'hafen')!;
  port.shipyard = [...FULL_YARD];
  const mid = towns
    .filter((t) => t.river === 'strom' && t.role !== 'hafen' && t.riverT > 0.15 && t.riverT < 0.75)
    .sort((a, b) => b.population - a.population)[0];
  if (mid) mid.shipyard = [...SMALL_YARD];
  for (const t of towns) if ((t.produces.holz ?? 0) >= 8 && !t.shipyard.length) t.shipyard = ['floss'];

  /* Beschreibungen */
  const riverName = (id: string) => (id === 'strom' ? mainName : tribs.find((x) => x.def.id === id)!.def.name);
  for (const t of towns) {
    const raw = Object.keys(t.produces).map((g) => GOOD_NAMES[g]);
    const ind = t.industries.map((i) => i.name);
    const parts = [`${ROLES[t.role].kind} am ${riverName(t.river)}.`];
    if (raw.length) parts.push(`${joinList(raw)} aus eigener Gegend.`);
    if (ind.length) parts.push(`${ind.length === 1 ? 'Ein Betrieb' : 'Betriebe'}: ${joinList(ind)}.`);
    t.description = parts.join(' ');
  }

  /* Abschnitte */
  const segments: SegmentDef[] = [];
  const byRiver = (r: string) => towns.filter((t) => t.river === r).sort((a, b) => a.riverT - b.riverT);
  const mainTowns = byRiver('strom');
  const mainLen = main.curve.getLength();
  for (let i = 0; i + 1 < mainTowns.length; i++) {
    const a = mainTowns[i];
    const b = mainTowns[i + 1];
    const mid2 = (a.riverT + b.riverT) / 2;
    segments.push({
      id: `${a.id}-${b.id}`,
      river: 'strom',
      fromT: a.riverT,
      toT: b.riverT,
      from: a.id,
      to: b.id,
      length: Math.max(15, Math.round((b.riverT - a.riverT) * mainLen * 0.85 * rng.range(0.85, 1.1))),
      current: round1((2.3 - 1.3 * mid2) * rng.range(0.9, 1.1)),
      baseDepth: round1((1.7 + 1.9 * mid2) * rng.range(0.92, 1.08)),
      ...(mid2 < 0.3 ? { freezes: true } : {}),
    });
  }
  tribs.forEach((tr, i) => {
    const list = byRiver(tr.def.id);
    const mouth = towns.find((t) => t.mouthOf === tr.def.id);
    if (!mouth || !list.length) return;
    const len = geos.get(tr.def.id)!.curve.getLength();
    // der erste Bach ist ein seichter Bergbach wie der Erzbach, der zweite ein ruhigerer Wiesenbach
    const steep = i === 0 || rng.chance(0.4);
    const nodes = [...list.map((t) => ({ id: t.id, t: t.riverT })), { id: mouth.id, t: 1 }];
    for (let k = 0; k + 1 < nodes.length; k++) {
      const a = nodes[k];
      const b = nodes[k + 1];
      const upper = k === 0 && nodes.length > 2;
      segments.push({
        id: `${a.id}-${b.id}`,
        river: tr.def.id,
        fromT: a.t,
        toT: b.t,
        from: a.id,
        to: b.id,
        length: Math.max(12, Math.round((b.t - a.t) * len * 0.55 * rng.range(0.9, 1.15))),
        current: round1(steep ? rng.range(2.0, 2.6) : rng.range(1.4, 1.9)),
        baseDepth: round1(steep ? (upper ? rng.range(0.75, 0.95) : rng.range(1.15, 1.45)) : rng.range(1.3, 1.8)),
        freezes: true,
        lowWater: steep ? 0.5 : 0.7,
      });
    }
  });
  if (segments.some((s) => s.toT <= s.fromT || s.from === s.to)) return reject('Abschnitt ohne Länge');

  /* Brücken: eine alte, niedrige Steinbrücke im Oberlauf, manchmal weitere */
  const mainSegs = segments.filter((s) => s.river === 'strom');
  const upperHalf = mainSegs.slice(0, Math.max(1, Math.ceil(mainSegs.length / 2)));
  const low = rng.pick(upperHalf);
  low.bridgeHeight = round1(rng.range(4.2, 5.2));
  if (rng.chance(0.4)) {
    const rest = mainSegs.filter((s) => s.bridgeHeight === undefined && s !== mainSegs[mainSegs.length - 1]);
    if (rest.length) rng.pick(rest).bridgeHeight = round1(rng.range(6, 8));
  }
  const tribSegs = segments.filter((s) => s.river !== 'strom');
  if (tribSegs.length && rng.chance(0.3)) rng.pick(tribSegs).bridgeHeight = round1(rng.range(3.6, 4.5));

  /* Wasserbauten */
  const nameOf = (id: string) => towns.find((t) => t.id === id)!.name;
  const projects: ProjectDef[] = [];
  for (const s of segments.filter((x) => x.bridgeHeight !== undefined)) {
    projects.push({
      id: `bruecke-${s.id}`,
      name: `Neue Brücke bei ${nameOf(s.from)}`,
      kind: 'bruecke',
      seg: s.id,
      cost: 5000 + Math.round(rng.range(0, 2000) / 100) * 100,
      days: 20,
      epoch: 1,
      effect: { bridgeHeight: 11 },
      text: 'Die alte Brücke weicht einer hohen Bogenbrücke. Danach passen Segel und Schornsteine darunter durch.',
    });
  }
  tribs.forEach((tr) => {
    const segs = segments.filter((s) => s.river === tr.def.id);
    const lower = segs[segs.length - 1];
    if (lower) {
      projects.push({
        id: `vertiefung-${lower.id}`,
        name: `Ausbaggern des unteren ${tr.def.name}s`,
        kind: 'vertiefung',
        seg: lower.id,
        cost: 4500 + Math.round(rng.range(0, 1500) / 100) * 100,
        days: 18,
        epoch: 1,
        effect: { depth: 0.8 },
        text: `Eine Fahrrinne zwischen ${nameOf(lower.from)} und ${nameOf(lower.to)}: 0,8 m mehr Tiefe, auch im Sommer.`,
      });
    }
    const upper = segs.length > 1 ? segs[0] : null;
    if (upper && upper.baseDepth < 1.1) {
      projects.push({
        id: `schleuse-${upper.id}`,
        name: `Schleusentreppe am ${tr.def.name}`,
        kind: 'schleuse',
        seg: upper.id,
        cost: 10000 + Math.round(rng.range(0, 2000) / 100) * 100,
        days: 30,
        epoch: 2,
        effect: { depth: 1.2, current: -1.4 },
        text: `Schleusen stauen den oberen ${tr.def.name}: tiefes, ruhiges Wasser bis ${nameOf(upper.from)}.`,
      });
    }
  });
  const top = mainSegs[0];
  projects.push({
    id: `kanal-${top.id}`,
    name: `Seitenkanal bei ${nameOf(top.from)}`,
    kind: 'kanal',
    seg: top.id,
    cost: 13000 + Math.round(rng.range(0, 2000) / 100) * 100,
    days: 35,
    epoch: 2,
    effect: { depth: 0.8, current: -1.2, iceFree: true },
    text: 'Ein gemauerter Kanal neben dem wilden Oberlauf: kaum Strömung, friert nicht zu.',
  });
  const last = mainSegs[mainSegs.length - 1];
  projects.push({
    id: `vertiefung-${last.id}`,
    name: `Tiefwasserrinne vor ${nameOf(last.to)}`,
    kind: 'vertiefung',
    seg: last.id,
    cost: 8500 + Math.round(rng.range(0, 1500) / 100) * 100,
    days: 25,
    epoch: 2,
    effect: { depth: 1.2 },
    text: 'Baggerschiffe räumen die Sandbänke vor der Mündung. Auch tiefe Schleppverbände kommen dann sicher an.',
  });
  const middle = mainSegs[Math.floor(mainSegs.length / 2)];
  if (middle !== top && middle !== last) {
    projects.push({
      id: `begradigung-${middle.id}`,
      name: `Strombegradigung bei ${nameOf(middle.from)}`,
      kind: 'kanal',
      seg: middle.id,
      cost: 11000 + Math.round(rng.range(0, 2000) / 100) * 100,
      days: 30,
      epoch: 3,
      effect: { depth: 1, current: -0.4 },
      text: `Leitwerke und Buhnen halten den Strom zwischen ${nameOf(middle.from)} und ${nameOf(middle.to)} tief.`,
    });
  }

  // Pegelstationen am Oberlauf und am ersten Bach, Leuchtfeuer am Unterlauf (wie im Tal)
  const gauges = [top, segments.find((x) => x.river === 'bach')].filter((x): x is SegmentDef => !!x);
  gauges.forEach((g, i) => {
    projects.push({
      id: `pegel-${g.id}`,
      name: i === 0 ? `Pegelhaus bei ${nameOf(g.from)}` : `Pegel am ${riverName(g.river)}`,
      kind: 'pegel',
      seg: g.id,
      cost: 1500 + Math.round(rng.range(0, 400) / 100) * 100,
      days: 6 + i * 2,
      epoch: 1,
      effect: { gauge: true },
      text:
        i === 0
          ? `Ein Pegelwärter liest täglich die Latte bei ${nameOf(g.from)} ab und schickt Boten talwärts. Der Flussbote kündigt Hochwasser und Dürre 3 bis 5 Tage vorher an.`
          : 'Eine zweite Messstelle in den Bergen. Zusammen mit der ersten nennt der Flussbote den genauen Tag und den erwarteten Pegel.',
    });
  });
  for (const seg of mainSegs.slice(-3)) {
    projects.push({
      id: `leuchtfeuer-${seg.id}`,
      name: seg === last ? `Leuchtturm vor ${nameOf(seg.to)}` : `Leuchtfeuer bei ${nameOf(seg.from)}`,
      kind: 'leuchtfeuer',
      seg: seg.id,
      cost: 2400 + Math.round(rng.range(0, 800) / 100) * 100,
      days: 10 + Math.round(rng.range(0, 4)),
      epoch: 1,
      effect: { light: true },
      text: `Zwischen ${nameOf(seg.from)} und ${nameOf(seg.to)} zeigt ein Feuer nachts die Fahrrinne.`,
    });
  }

  const start = mainTowns[0];
  const map: MapDef = {
    id: randomMapId(seed),
    seed,
    name: `Das Tal am ${mainName}`,
    rivers: [mainDef, ...tribs.map((x) => x.def)],
    towns: towns.map((t) => {
      const { role, mouthOf, ...def } = t;
      void role;
      void mouthOf;
      return def;
    }),
    segments,
    projects,
    start: start.id,
  };
  return map;
}
