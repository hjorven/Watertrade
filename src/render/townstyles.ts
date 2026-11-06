import * as THREE from 'three';
import type { HouseType } from './houses.ts';
import { boxGeo, coneGeo, cylGeo, gableGeo, hipGeo, Kit } from './kit.ts';
import {
  C, church, dryingRack, fence, forge, granary, haystack, headframe, kiln, lighthouse, logPile, lumberYard,
  rails, rowboat, smallTree, spoil, stall, tower, wall, well, windmill, barrel, crate, crane, smokeAt, type TownCtx,
} from './landmarks.ts';

/** Werkzeuge, die der Stadtbau den Stilen für ihre Wahrzeichen gibt */
export interface StyleCtx extends TownCtx {
  /** Stadtradius */
  radius: number;
  /** Radius des Marktplatzes, 0 wenn keiner */
  plazaRadius: number;
  /**
   * Freien Bauplatz nahe (u, v) suchen (u vom Fluss weg, v flussabwärts), reservieren und dort bauen.
   * Im Bezugssystem von `fn` zeigt +z zum Fluss (oder zur Stadtmitte).
   */
  site(u: number, v: number, r: number, fn: () => void, face?: 'river' | 'center'): boolean;
  /** Weltpunkt in Stadtkoordinaten, auf Geländehöhe */
  at(u: number, v: number): THREE.Vector3;
  /** Fläche um einen lokalen Punkt im aktuellen Bezugssystem für Häuser sperren */
  reserveLocal(x: number, z: number, r: number): void;
}

export interface TownStyle {
  houses: [HouseType, number][];
  walls: number[];
  wallsFor?: Partial<Record<HouseType, number[]>>;
  roofs: number[];
  roofsFor?: Partial<Record<HouseType, number[]>>;
  /** Größe der Häuser */
  scale: number;
  road: number;
  /** Pflasterfarbe des Marktplatzes, null = Dorf ohne Platz */
  plaza: number | null;
  harbor: 'steg' | 'kai';
  decorate(ctx: StyleCtx): void;
}

const TILE = [0xa8432f, 0xb5573a, 0x9a3a28, 0x8f3a2a];
const SLATE = [0x4f5560, 0x5a5f68, 0x465058, 0x5c5652];
const SHINGLE = [0x5a4636, 0x4e3e30, 0x6a5040, 0x5e4a3a];
const THATCH = [0xc8a860, 0xb89a58, 0xd0b46a, 0xbca060];
const BARN_WALLS = [0x9a4a32, 0x8a5a3a, 0xa06a48, 0x7a5a40];

// --- Wahrzeichen der Städte an der Schwarzach ---

/** Gemauerter Schlot mit Rauch (Zeche, Kokerei) */
function stack(ctx: TownCtx, h: number): void {
  const k = ctx.kit;
  k.add(boxGeo(0.9, 0.5, 0.9), 0x6a5a4a);
  k.add(cylGeo(0.3, 0.42, h, 8), 0x8a4a34, { y: 0.5 });
  k.add(cylGeo(0.36, 0.36, 0.25, 8), 0x5a3a2a, { y: h + 0.4 });
  smokeAt(ctx, 0, h + 0.8, 0);
}

/** Reihe von Koksöfen: niedriger Ziegelblock mit Türen und zwei Schloten */
function cokeOvens(ctx: TownCtx): void {
  const k = ctx.kit;
  k.add(boxGeo(5, 1.2, 1.8), 0x7a4a36);
  k.add(boxGeo(5.2, 0.15, 2), 0x4a3a30, { y: 1.2 });
  for (let i = 0; i < 6; i++) k.add(boxGeo(0.45, 0.7, 0.04), 0x2a1e18, { x: -2 + i * 0.8, y: 0.15, z: 0.92 });
  for (const x of [-1.6, 1.6]) k.at({ x, y: 1.2, z: -0.3 }, () => stack(ctx, 2.6));
  k.add(coneGeo(0.9, 0.7, 7), C.coal, { x: 3.4, z: 0.6 });
}

/** Tuchrahmen: lange Holzgestelle, auf denen frisch gefärbtes Tuch trocknet */
function tenterFrames(k: Kit, colors: number[]): void {
  colors.forEach((c, i) => {
    const z = (i - (colors.length - 1) / 2) * 1.1;
    for (const x of [-2, 0, 2]) k.add(boxGeo(0.08, 1.1, 0.08), C.timber, { x, z });
    k.add(boxGeo(4.2, 0.6, 0.03), c, { y: 0.4, z });
  });
}

/** Färberei: Bottiche mit farbigem Sud vor einem Fachwerkhaus */
function dyeWorks(k: Kit): void {
  k.add(boxGeo(2.6, 1.5, 1.8), 0xefe0c4);
  k.add(gableGeo(2.9, 2.1, 1.1), C.tile, { y: 1.5 });
  [0x2f4a8a, 0xa83a2a, 0xc8a030].forEach((c, i) => {
    k.add(cylGeo(0.45, 0.4, 0.5, 9), C.woodDark, { x: -0.9 + i * 0.9, z: 1.6 });
    k.add(cylGeo(0.4, 0.4, 0.02, 9), c, { x: -0.9 + i * 0.9, y: 0.46, z: 1.6 });
  });
}

/** Residenz: Schloss mit Walmdach, zwei Ecktürmen und einem Garten mit Hecken */
function residence(ctx: TownCtx): void {
  const k = ctx.kit;
  k.add(boxGeo(6.4, 0.3, 4.2), C.stoneLight, { y: -0.1 });
  k.add(boxGeo(5.6, 2.6, 2.6), 0xf0e2c4, { y: 0.2 });
  k.add(hipGeo(6, 3, 1.5), C.slate, { y: 2.8 });
  for (let i = 0; i < 6; i++) for (const y of [0.7, 1.8]) k.add(boxGeo(0.4, 0.6, 0.04), C.window, { x: -2.2 + i * 0.88, y, z: 1.31 });
  k.add(boxGeo(1.2, 1.4, 0.06), 0x5a3a22, { y: 0.2, z: 1.32 });
  k.add(gableGeo(1.6, 0.6, 0.6), C.stoneLight, { y: 1.65, z: 1.35 });
  for (const x of [-3.2, 3.2]) {
    k.add(cylGeo(0.85, 0.9, 3.6, 10), 0xe8dcc0, { x, y: 0.2 });
    k.add(coneGeo(1.05, 1.8, 10), C.slate, { x, y: 3.8 });
    k.add(cylGeo(0.04, 0.04, 0.8, 4), C.iron, { x, y: 5.5 });
  }
  k.add(boxGeo(0.5, 0.3, 0.02), C.red, { x: -3.2, y: 6.0, z: 0.25 });
  // Garten vor dem Schloss: Hecken im Viereck, Brunnen in der Mitte
  for (const sx of [-1, 1]) {
    k.add(boxGeo(2, 0.45, 0.45), 0x3f6a2e, { x: sx * 1.6, z: 3.2 });
    k.add(boxGeo(2, 0.45, 0.45), 0x3f6a2e, { x: sx * 1.6, z: 5.6 });
    k.add(boxGeo(0.45, 0.45, 2), 0x3f6a2e, { x: sx * 2.6, z: 4.4 });
    k.add(coneGeo(0.3, 1.1, 6), 0x2f5a26, { x: sx * 0.7, z: 3.2 });
  }
  k.add(cylGeo(0.7, 0.75, 0.3, 10), C.stoneLight, { z: 4.4 });
  k.add(cylGeo(0.6, 0.6, 0.02, 10), 0x5a9ab0, { y: 0.3, z: 4.4 });
}

/** Torfstiche: gestapelte dunkle Soden zum Trocknen */
function peatStacks(k: Kit, n: number): void {
  for (let i = 0; i < n; i++) {
    const x = (i % 3) * 1.1;
    const z = Math.floor(i / 3) * 1.0;
    k.add(boxGeo(0.7, 0.35, 0.5), 0x3a2a1e, { x, z, ry: i * 0.3 });
    k.add(boxGeo(0.5, 0.3, 0.4), 0x4a3424, { x, y: 0.35, z, ry: i * 0.3 + 0.4 });
  }
}

/** Schafpferch mit ein paar Schafen */
function sheepPen(k: Kit): void {
  fence(k, -1.8, -1.4, 1.8, -1.4);
  fence(k, 1.8, -1.4, 1.8, 1.4);
  fence(k, 1.8, 1.4, -1.8, 1.4);
  fence(k, -1.8, 1.4, -1.8, -1.4);
  for (const [x, z] of [[-0.9, 0.2], [0.3, -0.5], [0.9, 0.6], [-0.2, 0.8], [1.1, -0.3]]) {
    k.add(boxGeo(0.46, 0.3, 0.3), 0xeee8dc, { x, y: 0.14, z, ry: x * 2 });
    k.add(boxGeo(0.14, 0.16, 0.14), 0x3a3430, { x: x + 0.27, y: 0.3, z, ry: x * 2 });
  }
}

/** Schiffswerft am Seehafen: Helling mit halb beplanktem Rumpf */
function slipway(k: Kit): void {
  k.add(boxGeo(1.6, 0.15, 6), C.stoneDark, { rx: 0.08 });
  for (let i = 0; i < 6; i++) {
    const z = -2.2 + i * 0.9;
    const w = 0.7 + Math.sin((i / 5) * Math.PI) * 0.5;
    for (const sx of [-1, 1]) k.add(boxGeo(0.1, 1.2, 0.1), C.woodDark, { x: sx * w, y: 0.2, z, rz: -sx * 0.25 });
  }
  k.add(boxGeo(0.25, 0.25, 5.4), C.woodDark, { y: 0.2 });
  for (const sx of [-1, 1]) k.add(boxGeo(0.06, 0.5, 3.2), C.wood, { x: sx * 0.95, y: 0.5, z: 0.4, rz: -sx * 0.22 });
}

export const TOWN_STYLES: Record<string, TownStyle> = {
  // Holzfällerdorf: Blockhäuser, Schindeldächer, Holzkapelle und ein großer Holzplatz
  oberau: {
    houses: [['block', 6], ['huette', 3], ['scheune', 1]],
    walls: [0x9a6a42, 0x8a5a36, 0xa87a4c, 0x946640],
    wallsFor: { huette: [0xb08a5a, 0xa07a4c] },
    roofs: SHINGLE,
    scale: 1,
    road: 0x8a7458,
    plaza: null,
    harbor: 'steg',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(r * 0.35, -r * 0.45, 3.4, () => church(ctx, 0x8a5e38, 0x4e3e30, 0x4e3e30, 0.7));
      ctx.site(r * 0.2, r * 0.75, 3.6, () => lumberYard(ctx.kit));
      ctx.site(-r * 0.55, -3, 1.4, () => logPile(ctx.kit, 0, 0, 8, Math.PI / 2, 2.4));
      ctx.site(-r * 0.55, 3, 1.4, () => logPile(ctx.kit, 0, 0, 6, Math.PI / 2, 2.2));
      ctx.site(r * 0.9, r * 0.1, 1.4, () => logPile(ctx.kit, 0, 0, 5, 0.4));
    },
  },

  // Schmiedestadt: Steinhäuser mit Schieferdächern, Stadtturm mit Mauer, rauchende Essen
  kesselbrueck: {
    houses: [['stein', 5], ['fachwerk', 2], ['huette', 1]],
    walls: [0xd8d0c0, 0xc8bca8, 0xbfb4a0, 0xe0d6c4],
    roofs: SLATE,
    scale: 1,
    road: 0x9a9080,
    plaza: 0xa49a88,
    harbor: 'steg',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(r * 0.85, 0, 2.4, () => {
        tower(ctx);
        for (const sx of [-1, 1]) {
          ctx.kit.at({ x: sx * 4.6, z: 0.2 }, () => wall(ctx.kit, 6));
          ctx.reserveLocal(sx * 3.2, 0.2, 1.4);
          ctx.reserveLocal(sx * 6.2, 0.2, 1.4);
        }
      }, 'center');
      ctx.site(r * 0.3, -r * 0.6, 2.2, () => forge(ctx));
      ctx.site(r * 0.35, r * 0.6, 2.2, () => forge(ctx));
      if (ctx.plazaRadius) ctx.kit.at(ctx.at(0, 0), () => well(ctx.kit, 0, 0));
      ctx.site(-r * 0.5, -2.5, 1, () => {
        barrel(ctx.kit, 0, 0);
        barrel(ctx.kit, 0.5, 0.2);
        crate(ctx.kit, -0.5, 0.3);
      });
    },
  },

  // Kornkammer: Fachwerk mit roten Ziegeln, Windmühle zwischen den Feldern, Speicher, Heuhaufen
  muehlheim: {
    houses: [['fachwerk', 6], ['scheune', 2], ['huette', 1]],
    walls: [0xf1e6cf, 0xefe0c4, 0xe8d6b3, 0xf4ead8],
    wallsFor: { scheune: BARN_WALLS },
    roofs: TILE,
    scale: 1,
    road: 0xa08a62,
    plaza: 0xb0a48a,
    harbor: 'steg',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(r * 1.25, r * 0.5, 2.4, () => windmill(ctx));
      ctx.site(r * 0.35, -r * 0.65, 3, () => granary(ctx.kit, 0xe8d6b3, 0x9a3a28));
      for (const [u, v] of [[r * 1.1, -r * 0.4], [r * 1.45, -r * 0.1], [r * 1.0, r * 1.0]]) {
        ctx.site(u, v, 1, () => {
          haystack(ctx.kit, 0, 0, 1);
          haystack(ctx.kit, 1.1, 0.4, 0.8);
        });
      }
      if (ctx.plazaRadius) ctx.kit.at(ctx.at(0, 0), () => well(ctx.kit, 0, 0));
      ctx.site(-r * 0.5, 3, 1, () => {
        for (let i = 0; i < 4; i++) crate(ctx.kit, (i % 2) * 0.55, Math.floor(i / 2) * 0.55, 0.5, 0, 0xc8a050);
      });
    },
  },

  // Marktflecken: bunte Fassaden, großer Platz mit Kirche, Marktständen und Brunnen
  altenfurt: {
    houses: [['fachwerk', 6], ['stein', 2], ['giebel', 1]],
    walls: [0xf1e6cf, 0xe8c9a0, 0xd8e0c8, 0xf0d8c8, 0xe6d6a8, 0xd6dce4],
    roofs: [0xa8432f, 0x8f3a2a, 0xb5573a, 0x6f4a3a],
    scale: 1.02,
    road: 0xa49a88,
    plaza: 0xb4a890,
    harbor: 'steg',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(ctx.plazaRadius + 3.2, -1, 3.6, () => church(ctx, 0xe8dcc4, 0x8f3a2a, 0x3f6a5a, 1), 'center');
      if (ctx.plazaRadius) {
        const pr = ctx.plazaRadius;
        const colors = [0xb03a2a, 0x2f6a8a, 0x3a7a3a, 0xc89a2a, 0x7a3a6a];
        const goods = [0xd06a3a, 0x8ab04a, 0xe0c060, 0xc04040, 0x9a7a4a];
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * 0.3 + (i / 5) * Math.PI * 1.4;
          const p = ctx.at(Math.cos(a) * (pr - 1.4), Math.sin(a) * (pr - 1.4));
          const c = ctx.at(0, 0);
          ctx.kit.at({ x: p.x, y: Math.max(p.y, c.y) + 0.1, z: p.z, ry: Math.atan2(c.x - p.x, c.z - p.z) }, () => stall(ctx.kit, colors[i], goods[i]));
        }
        ctx.kit.at(ctx.at(0, 0), () => well(ctx.kit, 0, 0));
      }
      ctx.site(r * 0.9, r * 0.7, 1.2, () => smallTree(ctx.kit, 0, 0, 1.1, 0x5f9a3c));
      ctx.site(r * 0.8, -r * 0.8, 1.2, () => smallTree(ctx.kit, 0, 0, 1, 0x6aa040));
    },
  },

  // Bauern und Fischer: Reetdachkaten, rote Scheunen, Trockengestelle und Ruderboote am Ufer
  weidenhof: {
    houses: [['huette', 5], ['scheune', 3], ['fachwerk', 1]],
    walls: [0xf1e6cf, 0xe8dcc0, 0xefe4d0],
    wallsFor: { scheune: BARN_WALLS },
    roofs: TILE,
    roofsFor: { huette: THATCH, fachwerk: THATCH },
    scale: 1,
    road: 0xa08a62,
    plaza: null,
    harbor: 'steg',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(-r * 0.6, -2.6, 1.3, () => dryingRack(ctx.kit));
      ctx.site(-r * 0.6, 2.8, 1.3, () => dryingRack(ctx.kit));
      ctx.site(-r * 0.75, -4.2, 1, () => {
        rowboat(ctx.kit, 0, 0, 0.3, 0x5a6a4a, true);
        rowboat(ctx.kit, 0.3, 0.9, 0.1, 0x6a4a2e, true);
      });
      for (const [u, v] of [[r * 1.0, -r * 0.6], [r * 1.2, r * 0.4]]) {
        ctx.site(u, v, 1.2, () => {
          haystack(ctx.kit, 0, 0, 1.1);
          haystack(ctx.kit, -1.1, 0.5, 0.9);
        });
      }
      ctx.site(r * 0.6, r * 0.9, 2.6, () => {
        const k = ctx.kit;
        fence(k, -2, -1.6, 2, -1.6);
        fence(k, 2, -1.6, 2, 1.6);
        fence(k, 2, 1.6, -2, 1.6);
        fence(k, -2, 1.6, -2, -1.6);
        for (const [x, z] of [[-1, 0.3], [0.4, -0.6], [1, 0.7], [-0.3, -0.9]]) {
          k.add(boxGeo(0.5, 0.32, 0.3), C.white, { x, y: 0.12, z, ry: x });
          k.add(boxGeo(0.16, 0.16, 0.16), 0x3a3a3a, { x: x + 0.28, y: 0.32, z, ry: x });
        }
      });
      ctx.site(r * 0.2, -r * 0.9, 1.2, () => smallTree(ctx.kit, 0, 0, 1.2, 0x8ab04a));
    },
  },

  // Hafenstadt: schmale Giebelhäuser, Kaimauer mit Kränen, Leuchtturm, Salzhaufen
  niedermuend: {
    houses: [['giebel', 6], ['stein', 2], ['fachwerk', 1]],
    walls: [0xb0583e, 0xc87850, 0xe8dcc8, 0x9a4a36, 0xd8c0a0, 0xa8b8c0, 0xe0d0a8],
    roofs: [0x8f3a2a, 0x4f5560, 0x6f4a3a, 0xa8432f],
    scale: 1.05,
    road: 0x9a9080,
    plaza: 0xa49a88,
    harbor: 'kai',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(-r * 0.35, r + 4, 2.2, () => lighthouse(ctx));
      ctx.site(r * 0.4, -r * 0.7, 3.2, () => granary(ctx.kit, 0x9a4a36, 0x4f5560));
      ctx.site(r * 0.45, r * 0.65, 3.2, () => granary(ctx.kit, 0xc87850, 0x8f3a2a));
      ctx.site(-r * 0.4, -r - 2, 1.8, () => {
        const k = ctx.kit;
        for (const [x, z, s] of [[0, 0, 1], [1.3, 0.4, 0.8], [0.4, 1.2, 0.7]]) k.add(coneGeo(0.8 * s, 0.9 * s, 8), C.salt, { x, z });
      });
      ctx.site(-r * 0.5, 3, 1, () => {
        for (let i = 0; i < 5; i++) barrel(ctx.kit, (i % 3) * 0.5, Math.floor(i / 3) * 0.5);
      });
      if (ctx.plazaRadius) ctx.kit.at(ctx.at(0, 0), () => well(ctx.kit, 0, 0));
    },
  },

  // Bergwerk: Förderturm mit Seilscheibe, Halden, Loren, graue Steinkaten
  erzgrube: {
    houses: [['huette', 4], ['stein', 3], ['block', 1]],
    walls: [0xa8a090, 0xb8b0a0, 0x9a9284, 0xc0b8a8],
    roofs: SLATE,
    roofsFor: { huette: SHINGLE },
    scale: 0.95,
    road: 0x6e665c,
    plaza: null,
    harbor: 'steg',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(r * 0.55, -r * 0.25, 4.6, () => headframe(ctx));
      ctx.site(r * 1.1, r * 0.5, 2.2, () => spoil(ctx.kit, 0, 0, 1.2));
      ctx.site(r * 1.2, -r * 0.9, 2, () => spoil(ctx.kit, 0, 0, 1));
      ctx.site(-r * 0.45, 3, 1.6, () => rails(ctx.kit, 4, 2), 'river');
      ctx.site(-r * 0.5, -3, 1.2, () => {
        const k = ctx.kit;
        k.add(coneGeo(1.0, 0.8, 7), C.coal, {});
        k.add(coneGeo(0.7, 0.6, 7), 0x7a5a48, { x: 1.2, z: 0.4 });
      });
    },
  },

  // Glasbläser: großer Glasofen mit Glut und Rauch, Holzstapel, Hütte mit Glasscheiben
  glashuette: {
    houses: [['huette', 4], ['fachwerk', 3], ['stein', 1]],
    walls: [0xe8dcc8, 0xdcd0bc, 0xe4d8c0],
    roofs: [0x6a5a6a, 0x5a5060, 0x7a4a3a, 0x5c5652],
    scale: 1,
    road: 0x9a8a6a,
    plaza: null,
    harbor: 'steg',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(r * 0.45, 0, 3, () => kiln(ctx));
      ctx.site(r * 0.2, r * 0.75, 2.2, () => {
        const k = ctx.kit;
        k.add(boxGeo(2.6, 1.4, 1.8), 0xdcd0bc);
        k.add(boxGeo(2.9, 0.12, 2.1), 0x5a5060, { y: 1.4 });
        for (let i = 0; i < 4; i++) k.add(boxGeo(0.45, 0.6, 0.04), 0x9ad0d8, { x: -0.9 + i * 0.6, y: 0.5, z: 0.92 });
        for (let i = 0; i < 5; i++) k.add(coneGeo(0.1, 0.3, 6), [0x6ab0c0, 0x4a9a6a, 0xa0d0e0][i % 3], { x: -1 + i * 0.5, y: 0, z: 1.3 });
      });
      ctx.site(r * 0.8, -r * 0.6, 1.6, () => logPile(ctx.kit, 0, 0, 9, 0.3, 2.4));
      ctx.site(-r * 0.5, -3, 1.2, () => {
        for (let i = 0; i < 4; i++) crate(ctx.kit, (i % 2) * 0.55, Math.floor(i / 2) * 0.55, 0.5, 0, 0xc8b88a);
      });
    },
  },

  // Bergstädtchen an der Schwarzachquelle: graue Steinhäuser, Stollen mit kleinem Förderturm, Schafe
  krummfels: {
    houses: [['stein', 5], ['huette', 3], ['block', 1]],
    walls: [0xb8b0a0, 0xa8a090, 0xc4bcac, 0x9e968a],
    roofs: SLATE,
    roofsFor: { huette: SHINGLE, block: SHINGLE },
    scale: 0.95,
    road: 0x7e766a,
    plaza: null,
    harbor: 'steg',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(r * 0.8, -r * 0.3, 4.2, () => headframe(ctx));
      ctx.site(r * 1.2, r * 0.5, 2, () => spoil(ctx.kit, 0, 0, 1));
      ctx.site(r * 0.3, r * 0.8, 2.6, () => sheepPen(ctx.kit));
      ctx.site(r * 0.25, -r * 0.8, 2.6, () => church(ctx, 0xb8b0a0, C.slate, C.slate, 0.7));
      ctx.site(-r * 0.5, 2.5, 1, () => {
        const k = ctx.kit;
        k.add(coneGeo(0.9, 0.7, 7), 0x7a5a48);
        rails(k, 3, 1);
      }, 'river');
    },
  },

  // Kohlenrevier: Ziegelhäuser in dichten Reihen, zwei Zechen, Koksöfen und rauchende Schlote
  russheim: {
    houses: [['stein', 5], ['giebel', 2], ['huette', 2]],
    walls: [0x9a5a42, 0x8a4a36, 0xa86a50, 0x7a5040, 0xb87a5a],
    roofs: SLATE,
    scale: 1,
    road: 0x5e5850,
    plaza: 0x7e766a,
    harbor: 'kai',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(r * 0.9, -r * 0.45, 4.6, () => headframe(ctx));
      ctx.site(r * 0.95, r * 0.55, 4.6, () => headframe(ctx));
      ctx.site(r * 0.45, 0, 3.4, () => cokeOvens(ctx), 'river');
      ctx.site(r * 1.35, 0, 2.4, () => spoil(ctx.kit, 0, 0, 1.4));
      ctx.site(-r * 0.4, -3.5, 1.8, () => {
        const k = ctx.kit;
        k.add(coneGeo(1.2, 1.0, 7), C.coal);
        k.add(coneGeo(0.9, 0.8, 7), C.coal, { x: 1.5, z: 0.3 });
        rails(k, 3, 2);
      }, 'river');
      ctx.site(-r * 0.4, 3.5, 2, () => crane(ctx), 'river');
      ctx.site(r * 0.2, -r * 0.7, 2, () => forge(ctx));
      if (ctx.plazaRadius) ctx.kit.at(ctx.at(0, 0), () => well(ctx.kit, 0, 0));
    },
  },

  // Tuchmacherstadt: hohe Fachwerkhäuser, Tuchrahmen mit bunten Bahnen, Färberei, Tuchhalle am Platz
  tuchingen: {
    houses: [['fachwerk', 6], ['giebel', 2], ['stein', 1]],
    walls: [0xf1e6cf, 0xe8d6b3, 0xf0dcc8, 0xe0e4d8, 0xefe0c4],
    roofs: [0xa8432f, 0x9a3a28, 0x6f4a3a, 0xb5573a],
    scale: 1.02,
    road: 0xa49a88,
    plaza: 0xb0a48a,
    harbor: 'steg',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(r * 1.0, -r * 0.4, 3, () => tenterFrames(ctx.kit, [0x2f4a8a, 0xa83a2a, 0xc8a030, 0x3a6a3a]));
      ctx.site(r * 1.05, r * 0.55, 3, () => tenterFrames(ctx.kit, [0xe8e0d0, 0x6a3a6a, 0x2f4a8a]));
      ctx.site(-r * 0.45, 3, 2.4, () => dyeWorks(ctx.kit), 'river');
      ctx.site(ctx.plazaRadius + 3, 1.5, 3.2, () => {
        // Tuchhalle: langes Steinhaus mit Laubengang
        const k = ctx.kit;
        k.add(boxGeo(5, 2.4, 2.4), 0xe0d6c4);
        k.add(gableGeo(5.3, 2.8, 1.4), 0x8f3a2a, { y: 2.4 });
        for (let i = 0; i < 5; i++) k.add(boxGeo(0.6, 0.9, 0.05), 0x3a3028, { x: -2 + i, y: 0, z: 1.22 });
        for (let i = 0; i < 5; i++) k.add(boxGeo(0.4, 0.5, 0.04), C.window, { x: -2 + i, y: 1.5, z: 1.22 });
      }, 'center');
      ctx.site(r * 0.3, -r * 0.8, 3.4, () => church(ctx, 0xe8dcc4, 0x8f3a2a, 0x3f6a5a, 0.9));
      if (ctx.plazaRadius) ctx.kit.at(ctx.at(0, 0), () => well(ctx.kit, 0, 0));
    },
  },

  // Moordorf: niedrige Reetkaten, Torfstapel, Sägemühle mit Holzplatz, Birken am Wegrand
  moorwalde: {
    houses: [['huette', 6], ['scheune', 2], ['block', 1]],
    walls: [0xb8a07a, 0xa8906a, 0xc4ac84, 0x9a8460],
    wallsFor: { scheune: BARN_WALLS },
    roofs: THATCH,
    roofsFor: { block: SHINGLE, scheune: SHINGLE },
    scale: 0.95,
    road: 0x7a6448,
    plaza: null,
    harbor: 'steg',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(r * 1.0, -r * 0.5, 2.4, () => peatStacks(ctx.kit, 9));
      ctx.site(r * 1.1, r * 0.6, 2, () => peatStacks(ctx.kit, 6));
      ctx.site(r * 0.3, r * 0.8, 3.6, () => lumberYard(ctx.kit));
      ctx.site(r * 0.4, -r * 0.8, 2.6, () => sheepPen(ctx.kit));
      ctx.site(-r * 0.5, 2.5, 1.4, () => logPile(ctx.kit, 0, 0, 7, Math.PI / 2, 2.2), 'river');
      for (const [u, v] of [[r * 0.7, r * 0.1], [r * 1.4, -r * 0.1], [r * 0.1, -r * 1.1]]) {
        ctx.site(u, v, 1, () => smallTree(ctx.kit, 0, 0, 1.1, 0x9ab85a));
      }
    },
  },

  // Residenz: Schloss mit Garten, prächtige Steinhäuser mit Walmdächern, Lindenallee
  lindenbrueck: {
    houses: [['stein', 5], ['giebel', 3], ['fachwerk', 1]],
    walls: [0xf0e2c4, 0xe8d8bc, 0xf4ead8, 0xdcd4c8, 0xe8dcc8],
    roofs: [0x4f5560, 0x5a5f68, 0x8f3a2a, 0x465058],
    scale: 1.05,
    road: 0xb0a690,
    plaza: 0xc0b49c,
    harbor: 'kai',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(r * 0.95, 0, 4.4, () => residence(ctx), 'center');
      ctx.site(r * 0.3, -r * 0.75, 3.4, () => church(ctx, 0xf0e2c4, C.slate, 0x3f6a5a, 1));
      for (let i = 0; i < 4; i++) ctx.site(r * 0.45 + i * 1.6, r * 0.75, 0.8, () => smallTree(ctx.kit, 0, 0, 1.2, 0x5a8a34));
      if (ctx.plazaRadius) {
        ctx.kit.at(ctx.at(0, 0), () => {
          const k = ctx.kit;
          // Reiterstandbild auf hohem Sockel statt eines Brunnens
          k.add(boxGeo(1, 1.2, 0.7), C.stoneLight);
          k.add(boxGeo(0.7, 0.4, 0.22), 0x5a6a5a, { y: 1.4 });
          k.add(boxGeo(0.18, 0.6, 0.18), 0x5a6a5a, { x: 0.15, y: 1.6 });
        });
      }
    },
  },

  // Seehafen: hohe Giebelhäuser, Kai mit Kränen, Leuchtturm, Werft, Salz und Fässer
  nordhafen: {
    houses: [['giebel', 7], ['stein', 2], ['fachwerk', 1]],
    walls: [0xe8dcc8, 0xa8b8c0, 0xc87850, 0xf0e8d8, 0x9a4a36, 0xd8e0e4, 0xe0c8a0],
    roofs: [0x8f3a2a, 0x4f5560, 0x6f4a3a, 0x3f4a50],
    scale: 1.05,
    road: 0x9a9080,
    plaza: 0xa8a090,
    harbor: 'kai',
    decorate(ctx) {
      const r = ctx.radius;
      ctx.site(-r * 0.35, r + 4, 2.2, () => lighthouse(ctx));
      ctx.site(-r * 0.4, -3.5, 2, () => crane(ctx), 'river');
      ctx.site(-r * 0.4, 4, 2, () => crane(ctx), 'river');
      ctx.site(-r * 0.2, -r - 3, 3.4, () => slipway(ctx.kit), 'river');
      ctx.site(r * 0.5, -r * 0.7, 3.2, () => granary(ctx.kit, 0x9a4a36, 0x4f5560));
      ctx.site(r * 0.5, r * 0.7, 3.2, () => granary(ctx.kit, 0xe8dcc8, 0x8f3a2a));
      ctx.site(r * 1.1, 0, 3.4, () => church(ctx, 0xe8dcc8, C.slate, 0x3f6a5a, 1.1));
      ctx.site(-r * 0.55, r * 0.55, 1.8, () => {
        const k = ctx.kit;
        for (const [x, z, sc] of [[0, 0, 1], [1.3, 0.4, 0.8]]) k.add(coneGeo(0.8 * sc, 0.9 * sc, 8), C.salt, { x, z });
        for (let i = 0; i < 4; i++) barrel(k, -1 + (i % 2) * 0.5, 1 + Math.floor(i / 2) * 0.5);
      });
      if (ctx.plazaRadius) ctx.kit.at(ctx.at(0, 0), () => well(ctx.kit, 0, 0));
    },
  },
};

/** Für unbekannte Städte (andere Karten): schlichtes Fachwerkdorf */
export const DEFAULT_STYLE: TownStyle = {
  houses: [['fachwerk', 5], ['huette', 2], ['scheune', 1]],
  walls: [0xf1e6cf, 0xe8d6b3, 0xd9c09a, 0xefe0c4],
  wallsFor: { scheune: BARN_WALLS },
  roofs: TILE,
  scale: 1,
  road: 0xa08a62,
  plaza: null,
  harbor: 'steg',
  decorate(ctx) {
    ctx.site(ctx.radius * 0.6, 0, 1.2, () => well(ctx.kit, 0, 0));
  },
};

export type { Kit };
