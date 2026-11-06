import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ZWEI_TAELER } from '../data/maps/zwei-taeler.ts';
import { Landscape, RIVER_HALF_WIDTH } from './landscape.ts';
import { buildTown, placeTown } from './towns.ts';
import { TOWN_STYLES } from './townstyles.ts';

const b = ZWEI_TAELER.bounds!;
const land = new Landscape(ZWEI_TAELER.rivers, b);
const towns = ZWEI_TAELER.towns.map((def) => placeTown(land, def));
land.build(towns.map((t) => ({ pos: t.center, radius: t.radius * 1.4, fields: !!t.def.fields })));

describe('Zwei Täler', () => {
  it('Gelände ohne Spalten, auch auf dem Rücken zwischen den Tälern', () => {
    for (let x = b.minX + 2; x < b.maxX - 2; x += 1.7) {
      for (let z = b.minZ + 2; z < b.maxZ - 2; z += 1.7) {
        if (land.riverDistance(x, z).d < RIVER_HALF_WIDTH + 1) continue;
        if (land.nearCanal(x, z, 1)) continue; // Ufermauer und Schleusenstufen sind gewollte Kanten
        const h = land.heightAt(x, z);
        expect(Math.abs(land.heightAt(x + 0.5, z) - h)).toBeLessThan(1.6);
        expect(Math.abs(land.heightAt(x, z + 0.5) - h)).toBeLessThan(1.6);
      }
    }
  });

  it('der Waldrücken ist niedriger als das Hochgebirge', () => {
    let top = 0;
    for (let x = -80; x <= 80; x += 4) top = Math.max(top, land.heightAt(x, -60));
    expect(top).toBeLessThan(16);
  });

  it('Kanal steigt in Schleusenstufen zum Scheitel und fällt wieder', () => {
    const c = land.canals[0];
    expect(c).toBeDefined();
    expect(c.locks.length).toBeGreaterThanOrEqual(2);
    const levels = c.points.map((p) => p.level);
    const top = levels.indexOf(Math.max(...levels));
    for (let i = 1; i <= top; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    for (let i = top + 1; i < levels.length; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
    // trockenes Bett liegt über dem Flusswasser, sonst stünde die Baustelle unter Wasser
    for (const p of c.points) expect(p.level - 0.9).toBeGreaterThan(0.1);
  });

  it('jede Stadt hat einen Stil, bleibt auf der Platte und baut nicht in den Kanal', () => {
    towns.forEach((place, i) => {
      expect(TOWN_STYLES[place.def.id]).toBeDefined();
      for (const l of place.lots) expect(land.nearCanal(l.pos.x, l.pos.z)).toBe(false);
      const view = buildTown(land, place, 100 + i);
      view.setPopulation(place.def.population * 3);
      view.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(view.group);
      expect(box.min.x).toBeGreaterThan(b.minX - 0.5);
      expect(box.max.x).toBeLessThan(b.maxX + 0.5);
      expect(box.min.z).toBeGreaterThan(b.minZ - 0.5);
      expect(box.max.z).toBeLessThan(b.maxZ + 0.5);
    });
  });

  it('Kanal zeigt jede Bauphase', () => {
    const count = () => {
      let n = 0;
      land.group.traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if (g?.attributes.position) n += g.attributes.position.count;
      });
      return n;
    };
    const base = count();
    let last = 0;
    for (const p of [
      { stage: 0, stageShare: 0.5, done: false },
      { stage: 1, stageShare: 0.5, done: false },
      { stage: 3, stageShare: 0.5, done: false },
      { stage: 3, stageShare: 1, done: true },
    ]) {
      land.setCanal(p);
      const n = count() - base;
      expect(n).toBeGreaterThan(0);
      expect(n).not.toBe(last);
      last = n;
    }
  });
});
