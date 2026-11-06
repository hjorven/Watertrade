import { describe, expect, it } from 'vitest';
import { VALLEY } from '../data/maps/valley.ts';
import { Landscape, RIVER_HALF_WIDTH, WORLD_D, WORLD_W } from './landscape.ts';
import { buildTown, houseCount, placeTown } from './towns.ts';
import { TOWN_STYLES } from './townstyles.ts';

const land = new Landscape(VALLEY.rivers);
const towns = VALLEY.towns.map((def) => placeTown(land, def));
land.build(towns.map((t) => ({ pos: t.center, radius: t.radius * 1.4, fields: !!t.def.fields })));

describe('Gelände', () => {
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
