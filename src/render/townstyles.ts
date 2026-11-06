import * as THREE from 'three';
import type { HouseType } from './houses.ts';
import { boxGeo, coneGeo, Kit } from './kit.ts';
import {
  C, church, dryingRack, fence, forge, granary, haystack, headframe, kiln, lighthouse, logPile, lumberYard,
  rails, rowboat, smallTree, spoil, stall, tower, wall, well, windmill, barrel, crate, type TownCtx,
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
