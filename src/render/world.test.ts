import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VALLEY } from '../data/maps/valley.ts';
import { Landscape, RIVER_HALF_WIDTH, WORLD_D, WORLD_W } from './landscape.ts';
import { civicModel, CIVIC_ORDER } from './civic.ts';
import { buildTown, CIVIC_COUNT, houseCount, placeTown } from './towns.ts';
import { TOWN_STYLES } from './townstyles.ts';

const land = new Landscape(VALLEY.rivers);
const towns = VALLEY.towns.map((def) => placeTown(land, def));
land.build(towns.map((t) => ({ pos: t.center, radius: t.radius * 1.4, fields: !!t.def.fields })));

describe('Gelände', () => {
  it('hat keine Spalten: benachbarte Punkte abseits der Flüsse springen nicht in der Höhe', () => {
    for (let x = -108; x < 108; x += 1.3) {
      for (let z = -68; z < 68; z += 1.3) {
        if (land.riverDistance(x, z).d < RIVER_HALF_WIDTH + 1) continue;
        const h = land.heightAt(x, z);
        expect(Math.abs(land.heightAt(x + 0.5, z) - h)).toBeLessThan(1.6);
        expect(Math.abs(land.heightAt(x, z + 0.5) - h)).toBeLessThan(1.6);
      }
    }
  });

  it('hat keine Pfützen: abseits der Flüsse liegt das Land über dem Wasser', () => {
    for (let x = -WORLD_W / 2 + 2; x < WORLD_W / 2; x += 3.7) {
      for (let z = -WORLD_D / 2 + 2; z < WORLD_D / 2; z += 3.1) {
        if (land.riverDistance(x, z).d > RIVER_HALF_WIDTH + 2) expect(land.heightAt(x, z)).toBeGreaterThan(0.1);
      }
    }
  });

  it('surfaceAt folgt dem gezeichneten Netz und liegt nah an heightAt', () => {
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const x = -100 + ((i * 37) % 200);
      const z = -60 + ((i * 53) % 120);
      worst = Math.max(worst, Math.abs(land.surfaceAt(x, z) - land.heightAt(x, z)));
    }
    expect(worst).toBeLessThan(2.5);
  });
});

describe('Städte', () => {
  it('nichts ragt über den Kartenrand: Bauplätze, Häuser, Wahrzeichen, Wege', () => {
    towns.forEach((place, i) => {
      for (const l of place.lots) expect(Math.abs(l.pos.x)).toBeLessThan(WORLD_W / 2 - 3);
      const view = buildTown(land, place, 100 + i);
      view.setPopulation(place.def.population * 4);
      view.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(view.group);
      expect(box.min.x).toBeGreaterThan(-WORLD_W / 2 - 0.5);
      expect(box.max.x).toBeLessThan(WORLD_W / 2 + 0.5);
      expect(box.min.z).toBeGreaterThan(-WORLD_D / 2 - 0.5);
      expect(box.max.z).toBeLessThan(WORLD_D / 2 + 0.5);
    });
  });

  it('jede Stadt hat Plätze für Stadthaus und Stiftungen, frei von Fluss und Uferplätzen', () => {
    for (const place of towns) {
      expect(place.civic.length, place.def.id).toBe(CIVIC_COUNT);
      for (const c of place.civic) {
        expect(Math.abs(c.pos.x)).toBeLessThan(WORLD_W / 2 - 3);
        expect(Math.abs(c.pos.z)).toBeLessThan(WORLD_D / 2 - 3);
        expect(land.riverDistance(c.pos.x, c.pos.z).d).toBeGreaterThan(RIVER_HALF_WIDTH + 5);
        for (const l of [...place.lots, ...place.civic]) if (l !== c) expect(l.pos.distanceTo(c.pos)).toBeGreaterThan(5);
      }
    }
  });

  it('Modelle für Stadthaus und Stiftungen lassen sich bauen', () => {
    for (const kind of CIVIC_ORDER) {
      const m = civicModel(kind, 0xa8322a)!;
      const box = new THREE.Box3().setFromObject(m.group);
      const size = box.getSize(new THREE.Vector3());
      expect(size.x, kind).toBeLessThan(6);
      expect(size.z, kind).toBeLessThan(6);
      expect(size.y, kind).toBeGreaterThan(1);
    }
  });

  it('jede Stadt der Karte hat einen eigenen Stil', () => {
    for (const t of VALLEY.towns) expect(TOWN_STYLES[t.id]).toBeDefined();
  });

  it('jede Stadt baut genug Häuser für ihr Wachstum und zeigt sie nach Einwohnerzahl', () => {
    towns.forEach((place, i) => {
      const view = buildTown(land, place, 100 + i);
      const houses = () => {
        let n = 0;
        view.group.traverse((o) => {
          const m = o as { isInstancedMesh?: boolean; count?: number; geometry?: { userData: unknown } };
          if (m.isInstancedMesh && o.castShadow) n += m.count ?? 0;
        });
        return n / 2; // Körper und Dach
      };
      const start = houses();
      expect(start).toBeGreaterThanOrEqual(houseCount(place.def, place.def.population) - 1);
      view.setPopulation(place.def.population * 4);
      expect(houses()).toBeGreaterThan(start);
      view.setPopulation(10);
      expect(houses()).toBeLessThan(start);
    });
  });
});
