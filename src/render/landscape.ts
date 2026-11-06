import * as THREE from 'three';

/** Größe des Dioramas in Welteinheiten (1 Einheit ≈ 0,5 km, nur optisch) */
export const WORLD_W = 220;
export const WORLD_D = 140;
export const RIVER_HALF_WIDTH = 3.6;
const BASE_Y = -7;

const PALETTE = {
  bed: new THREE.Color(0x6b6248),
  sand: new THREE.Color(0xd8c38f),
  meadow: new THREE.Color(0x8fb35a),
  meadowDark: new THREE.Color(0x6f9a48),
  field: new THREE.Color(0xd9b85c),
  forest: new THREE.Color(0x4f7a3a),
  rock: new THREE.Color(0x9a8f7e),
  snow: new THREE.Color(0xf2efe6),
  plinth: new THREE.Color(0x5a3d26),
};

/** Deterministischer Zufall, damit die Landschaft bei jedem Start gleich aussieht */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weiches Rauschen aus überlagerten Sinuswellen, reicht für sanfte Hügel */
function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.051 + 1.3) * Math.cos(z * 0.063 - 0.7) * 0.5 +
    Math.sin(x * 0.13 - z * 0.09 + 2.1) * 0.3 +
    Math.sin(x * 0.29 + z * 0.31) * 0.12 +
    Math.cos(x * 0.61 - z * 0.53) * 0.06
  );
}

export class Landscape {
  readonly group = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  private readonly samples: THREE.Vector3[];
  private ripples!: THREE.InstancedMesh;
  private readonly rippleState: { t: number; offset: number; speed: number }[] = [];
  private readonly dummy = new THREE.Object3D();

  private readonly townSpots: { pos: THREE.Vector3; radius: number; fields: boolean }[] = [];

  constructor() {
    // Fließrichtung von links oben (Quelle, Gebirge) nach rechts unten (Aue)
    this.curve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-WORLD_W / 2, 0, -38),
        new THREE.Vector3(-80, 0, -30),
        new THREE.Vector3(-55, 0, -8),
        new THREE.Vector3(-28, 0, -18),
        new THREE.Vector3(0, 0, 4),
        new THREE.Vector3(28, 0, 22),
        new THREE.Vector3(55, 0, 8),
        new THREE.Vector3(82, 0, 26),
        new THREE.Vector3(WORLD_W / 2, 0, 34),
      ],
      false,
      'catmullrom',
      0.5,
    );
    this.samples = this.curve.getSpacedPoints(400);
  }

  /** Baut Gelände, Wasser und Bäume. Stadtflächen werden vom Wald ausgespart, Äcker liegen um Städte mit `fields`. */
  build(townSpots: { pos: THREE.Vector3; radius: number; fields: boolean }[]): void {
    this.townSpots.push(...townSpots);
    this.group.add(this.buildTerrain());
    this.group.add(this.buildWater());
    this.ripples = this.buildRipples();
    this.group.add(this.ripples);
    this.group.add(this.buildTrees());
  }

  /** Abstand zum Flusslauf in der Ebene und Position auf dem Fluss (0..1) */
  riverDistance(x: number, z: number): { d: number; t: number } {
    let best = Infinity;
    let bestI = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const p = this.samples[i];
      const dx = p.x - x;
      const dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        bestI = i;
      }
    }
    return { d: Math.sqrt(best), t: bestI / (this.samples.length - 1) };
  }

  heightAt(x: number, z: number): number {
    const { d, t } = this.riverDistance(x, z);
    const n = noise(x, z);
    if (d < RIVER_HALF_WIDTH) return -1.4 + (d / RIVER_HALF_WIDTH) * 1.1;
    const bank = Math.min(1, (d - RIVER_HALF_WIDTH) / 3);
    let h = -0.3 + bank * 0.7;
    // Talaue, flussaufwärts schmaler
    const plain = 10 + t * 22;
    if (d > RIVER_HALF_WIDTH + 3) h += Math.max(0, n) * 0.5;
    if (d > plain) {
      const wall = d - plain;
      const steep = 0.28 + (1 - t) * 0.35; // im Oberlauf steile Hänge
      const peak = 12 + (1 - t) * 10; // Gipfelhöhe, damit der Sockel nicht zur Wand wird
      h += peak * (1 - Math.exp((-wall * steep) / peak)) + n * (1.5 + wall * 0.05);
    }
    return h;
  }

  /** Ufernormale (in der Ebene, rechts in Fließrichtung) bei Position t */
  normalAt(t: number): THREE.Vector3 {
    const tan = this.curve.getTangentAt(Math.min(1, Math.max(0, t)));
    return new THREE.Vector3(-tan.z, 0, tan.x).normalize();
  }

  private colorFor(x: number, z: number, h: number, d: number): THREE.Color {
    if (d < RIVER_HALF_WIDTH) return PALETTE.bed;
    if (d < RIVER_HALF_WIDTH + 1.4) return PALETTE.sand;
    for (const s of this.townSpots) {
      if (!s.fields) continue;
      const dist = Math.hypot(x - s.pos.x, z - s.pos.z);
      if (dist > s.radius + 2 && dist < s.radius + 26 && h < 2.5) {
        const stripe = Math.floor((x * 0.7 + z * 0.4) / 3.5) % 3;
        if (stripe === 0) return PALETTE.field;
        if (stripe === 1) return PALETTE.meadowDark;
      }
    }
    if (h > 22) return PALETTE.snow;
    if (h > 13) return PALETTE.rock;
    if (h > 4) return PALETTE.forest;
    return noise(x * 2.3, z * 2.3) > 0.15 ? PALETTE.meadowDark : PALETTE.meadow;
  }

  private buildTerrain(): THREE.Group {
    const g = new THREE.Group();
    const segX = 180;
    const segZ = 115;
    const geo = new THREE.PlaneGeometry(WORLD_W, WORLD_D, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const { d } = this.riverDistance(x, z);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      const c = this.colorFor(x, z, h, d);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
    );
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    g.add(terrain);
    g.add(this.buildPlinth(segX, segZ));
    return g;
  }

  /** Holzsockel unter dem Diorama mit Seitenwänden bis zur Geländekante */
  private buildPlinth(segX: number, segZ: number): THREE.Group {
    const g = new THREE.Group();
    const earth = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1, side: THREE.DoubleSide });
    const water = new THREE.MeshStandardMaterial({ color: 0x2f6680, roughness: 0.4, side: THREE.DoubleSide });
    const hw = WORLD_W / 2;
    const hd = WORLD_D / 2;

    const edge = (ax: number, az: number, bx: number, bz: number, steps: number, ox: number, oz: number) => {
      const verts: number[] = [];
      const waterVerts: number[] = [];
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const x0 = ax + (bx - ax) * t0;
        const z0 = az + (bz - az) * t0;
        const x1 = ax + (bx - ax) * t1;
        const z1 = az + (bz - az) * t1;
        const h0 = this.heightAt(x0, z0);
        const h1 = this.heightAt(x1, z1);
        verts.push(x0, BASE_Y, z0, x1, BASE_Y, z1, x1, h1, z1, x0, BASE_Y, z0, x1, h1, z1, x0, h0, z0);
        if (h0 < 0 || h1 < 0) {
          const w0 = Math.max(h0, 0);
          const w1 = Math.max(h1, 0);
          const b0 = Math.min(h0, 0);
          const b1 = Math.min(h1, 0);
          waterVerts.push(x0, b0, z0, x1, b1, z1, x1, w1, z1, x0, b0, z0, x1, w1, z1, x0, w0, z0);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, earth));
      if (waterVerts.length) {
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(waterVerts, 3));
        wg.computeVertexNormals();
        const m = new THREE.Mesh(wg, water);
        // minimal nach außen, damit es nicht mit der Erdwand flackert
        m.position.set(ox * 0.03, 0, oz * 0.03);
        g.add(m);
      }
    };
    edge(-hw, -hd, hw, -hd, segX, 0, -1);
    edge(hw, hd, -hw, hd, segX, 0, 1);
    edge(-hw, hd, -hw, -hd, segZ, -1, 0);
    edge(hw, -hd, hw, hd, segZ, 1, 0);

    // Rahmen aus dunklem Holz
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(WORLD_W + 3, 2.4, WORLD_D + 3),
      new THREE.MeshStandardMaterial({ color: PALETTE.plinth, roughness: 0.7 }),
    );
    frame.position.y = BASE_Y - 1.2;
    frame.receiveShadow = true;
    g.add(frame);
    return g;
  }

  private buildWater(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(WORLD_W, WORLD_D, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3f86a3,
      roughness: 0.25,
      metalness: 0.05,
      transparent: true,
      opacity: 0.88,
    });
    const water = new THREE.Mesh(geo, mat);
    water.position.y = -0.05;
    water.receiveShadow = true;
    return water;
  }

  /** Helle Striche auf dem Wasser, die mit der Strömung treiben */
  private buildRipples(): THREE.InstancedMesh {
    const count = 140;
    const geo = new THREE.PlaneGeometry(1.4, 0.12);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xe8f4f6, transparent: true, opacity: 0.55 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const rand = mulberry32(7);
    for (let i = 0; i < count; i++) {
      this.rippleState.push({ t: rand(), offset: (rand() * 2 - 1) * (RIVER_HALF_WIDTH - 0.8), speed: 0.8 + rand() * 0.4 });
    }
    return mesh;
  }

  /** dt in Sekunden, flowSpeed als Anteil der Flusslänge pro Sekunde */
  update(dt: number, flowSpeed: number): void {
    for (let i = 0; i < this.rippleState.length; i++) {
      const r = this.rippleState[i];
      r.t += dt * flowSpeed * r.speed;
      if (r.t > 1) r.t -= 1;
      const p = this.curve.getPointAt(r.t);
      const n = this.normalAt(r.t);
      const tan = this.curve.getTangentAt(r.t);
      this.dummy.position.set(p.x + n.x * r.offset, 0.0, p.z + n.z * r.offset);
      this.dummy.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
      // an den Enden ausblenden durch Skalierung
      const fade = Math.min(1, r.t * 20, (1 - r.t) * 20);
      this.dummy.scale.setScalar(fade);
      this.dummy.updateMatrix();
      this.ripples.setMatrixAt(i, this.dummy.matrix);
    }
    this.ripples.instanceMatrix.needsUpdate = true;
  }

  /** Bäume als InstancedMesh, mehr Wald im Oberlauf */
  private buildTrees(seed = 11): THREE.Group {
    const rand = mulberry32(seed);
    const spots: THREE.Vector3[] = [];
    let tries = 0;
    while (spots.length < 1000 && tries < 20000) {
      tries++;
      const x = (rand() - 0.5) * (WORLD_W - 4);
      const z = (rand() - 0.5) * (WORLD_D - 4);
      const { d, t } = this.riverDistance(x, z);
      if (d < RIVER_HALF_WIDTH + 2.5) continue;
      const h = this.heightAt(x, z);
      if (h > 14 || h < 0.2) continue;
      if (this.townSpots.some((s) => Math.hypot(x - s.pos.x, z - s.pos.z) < s.radius + (s.fields ? 26 : 4))) continue;
      // Wahrscheinlichkeit: Oberlauf und Hänge dicht bewaldet
      const p = 0.15 + (1 - t) * 0.55 + Math.min(0.4, h * 0.05);
      if (rand() > p) continue;
      spots.push(new THREE.Vector3(x, h, z));
    }

    const crownGeo = new THREE.ConeGeometry(0.9, 2.6, 6);
    crownGeo.translate(0, 2.3, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 5);
    trunkGeo.translate(0, 0.6, 0);
    const crowns = new THREE.InstancedMesh(
      crownGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }),
      spots.length,
    );
    const trunks = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 1 }),
      spots.length,
    );
    const shades = [0x3f6b34, 0x4c7d3a, 0x5a8a3f, 0x2f5a2e];
    const c = new THREE.Color();
    spots.forEach((p, i) => {
      const s = 0.7 + rand() * 0.6;
      this.dummy.position.copy(p);
      this.dummy.rotation.set(0, rand() * Math.PI, 0);
      this.dummy.scale.set(s, s * (0.8 + rand() * 0.5), s);
      this.dummy.updateMatrix();
      crowns.setMatrixAt(i, this.dummy.matrix);
      trunks.setMatrixAt(i, this.dummy.matrix);
      crowns.setColorAt(i, c.setHex(shades[Math.floor(rand() * shades.length)]));
    });
    crowns.castShadow = true;
    trunks.castShadow = true;
    const g = new THREE.Group();
    g.add(crowns, trunks);
    return g;
  }
}
