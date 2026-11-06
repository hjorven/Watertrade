import * as THREE from 'three';
import type { SegmentDef, TownDef } from '../data/maps/valley.ts';
import { Landscape, mulberry32, RIVER_HALF_WIDTH } from './landscape.ts';

export interface TownPlacement {
  def: TownDef;
  center: THREE.Vector3;
  mooring: THREE.Vector3; // Liegeplatz des Kahns am Steg
  radius: number;
}

export function placeTown(land: Landscape, def: TownDef): TownPlacement {
  const p = land.pointAt(def.river, def.riverT);
  const n = land.normalAt(def.river, def.riverT).multiplyScalar(def.side);
  const hw = land.halfWidth(def.river);
  const radius = 5 + def.houses * 0.42;
  const center = p.clone().addScaledVector(n, hw + 3 + radius);
  const mooring = p.clone().addScaledVector(n, Math.max(0.6, hw - 1.3));
  return { def, center, mooring, radius };
}

const WALLS = [0xf1e6cf, 0xe8d6b3, 0xd9c09a, 0xefe0c4, 0xc9a77f];
const ROOFS = [0xa8432f, 0x8f3a2a, 0xb5573a, 0x6f4a3a];

/** Häuser einer Stadt; wächst Haus für Haus von innen nach außen */
export interface TownView {
  group: THREE.Group;
  setPopulation(pop: number): void;
}

/** Anzahl Häuser bei gegebener Einwohnerzahl */
export function houseCount(def: { houses: number; population: number }, pop: number): number {
  return Math.round(def.houses * Math.sqrt(pop / def.population));
}

export function buildTown(land: Landscape, place: TownPlacement, seed: number): TownView {
  const g = new THREE.Group();
  const rand = mulberry32(seed);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  wallGeo.translate(0, 0.5, 0);
  const roofGeo = new THREE.ConeGeometry(0.75, 0.8, 4);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.translate(0, 0.4, 0);

  // Platz für das Dreifache: so viele Häuser hat eine Großstadt
  const max = place.def.houses * 3;
  const walls = new THREE.InstancedMesh(
    wallGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    max,
  );
  const roofs = new THREE.InstancedMesh(
    roofGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }),
    max,
  );

  // Kandidaten in wachsenden Ringen, nach Abstand zum Markt sortiert
  const spots: { x: number; z: number; d: number }[] = [];
  const outer = place.radius * Math.sqrt(3);
  let tries = 0;
  while (spots.length < max && tries < 6000) {
    tries++;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * outer;
    const x = place.center.x + Math.cos(a) * r;
    const z = place.center.z + Math.sin(a) * r;
    if (land.riverDistance(x, z).d < RIVER_HALF_WIDTH + 2.2) continue;
    if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < 2.9)) continue;
    if (land.heightAt(x, z) > 9) continue; // nicht an den Steilhang
    spots.push({ x, z, d: r + rand() * 2 });
  }
  spots.sort((p, q) => p.d - q.d);

  spots.forEach((sp, i) => {
    const y = land.heightAt(sp.x, sp.z);
    // größere Häuser weiter innen, außen Hütten und Scheunen
    const inner = 1 - i / max;
    const w = 1.6 + rand() * 0.9 + inner * 0.5;
    const d = 1.4 + rand() * 0.7 + inner * 0.3;
    const h = 1.1 + rand() * 1.0 + inner * 0.9;
    const rot = Math.atan2(place.center.z - sp.z, place.center.x - sp.x) + (rand() - 0.5) * 0.3;

    dummy.position.set(sp.x, y - 0.2, sp.z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(w, h + 0.2, d);
    dummy.updateMatrix();
    walls.setMatrixAt(i, dummy.matrix);
    walls.setColorAt(i, color.setHex(WALLS[Math.floor(rand() * WALLS.length)]));

    dummy.position.set(sp.x, y + h, sp.z);
    dummy.scale.set(w * 1.05, 1.4 + rand() * 0.6, d * 1.05);
    dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
    roofs.setColorAt(i, color.setHex(ROOFS[Math.floor(rand() * ROOFS.length)]));
  });
  walls.castShadow = roofs.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls, roofs);

  const setPopulation = (pop: number) => {
    const n = Math.min(spots.length, houseCount(place.def, pop));
    walls.count = n;
    roofs.count = n;
  };
  setPopulation(place.def.population);

  // Steg vom Ufer zum Liegeplatz
  const shore = place.mooring.clone().lerp(place.center, 0.25);
  const len = place.mooring.distanceTo(shore) + 1.5;
  const pier = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.15, len),
    new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 }),
  );
  pier.position.copy(place.mooring).lerp(shore, 0.5);
  pier.position.y = 0.35;
  pier.lookAt(shore.x, 0.35, shore.z);
  pier.castShadow = pier.receiveShadow = true;
  g.add(pier);

  // Pfähle
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.6, 5);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5b3b22 });
  for (let k = 0; k < 3; k++) {
    const p = place.mooring.clone().lerp(shore, k / 3);
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(p.x, -0.3, p.z);
    g.add(post);
  }

  // Lagerhaus am Steg
  const shed = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 1.4, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x7d5a3a, roughness: 0.9 }),
  );
  const shedPos = shore.clone().lerp(place.center, 0.15);
  shed.position.set(shedPos.x, land.heightAt(shedPos.x, shedPos.z) + 0.6, shedPos.z);
  shed.lookAt(place.mooring.x, shed.position.y, place.mooring.z);
  shed.castShadow = true;
  g.add(shed);

  return { group: g, setPopulation };
}

/** Alte Steinbrücke mit zwei Bögen über einen Abschnitt mit Brückenhöhe */
export function buildBridge(land: Landscape, seg: SegmentDef): THREE.Group {
  const g = new THREE.Group();
  const t = seg.fromT + (seg.toT - seg.fromT) * 0.3;
  const p = land.pointAt(seg.river, t);
  const tan = land.tangentAt(seg.river, t);
  const hw = land.halfWidth(seg.river);
  const span = hw * 2 + 7;
  const stone = new THREE.MeshStandardMaterial({ color: 0xb8a588, roughness: 0.95, flatShading: true });

  // Bauhöhe optisch etwa 1 m = 0,5 Einheiten
  const deckY = (seg.bridgeHeight ?? 4) * 0.5 + 0.4;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 0.5, 2.4), stone);
  deck.position.y = deckY;
  g.add(deck);
  for (const side of [-1, 1]) {
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(span, 0.4, 0.25), stone);
    parapet.position.set(0, deckY + 0.45, side * 1.1);
    g.add(parapet);
  }
  // Pfeiler in der Mitte und an den Ufern
  for (const x of [-hw - 1.2, 0, hw + 1.2]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(1.1, deckY + 2, 2.6), stone);
    pier.position.set(x, deckY / 2 - 1, 0);
    g.add(pier);
  }
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  g.position.set(p.x, 0, p.z);
  // Brücke quer zum Fluss: lokale x-Achse entlang der Ufernormalen
  g.rotation.y = Math.atan2(-tan.z, tan.x) + Math.PI / 2;
  return g;
}
