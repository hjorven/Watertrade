import * as THREE from 'three';
import { Landscape, RIVER_HALF_WIDTH } from './landscape.ts';

const CRATE_SLOTS = 8;

/** Der Treidelkahn: Holzrumpf, Kajüte am Heck, Mast für die Treidelleine, Ladung an Deck */
export class BargeView {
  readonly group = new THREE.Group();
  private readonly hull = new THREE.Group();
  private readonly crates: THREE.Mesh[] = [];
  private readonly horse = new THREE.Group();
  private readonly towLine: THREE.Line;
  private readonly mastTop = new THREE.Object3D();
  private readonly wake: THREE.Mesh;
  private time = 0;
  private readonly land: Landscape;

  constructor(land: Landscape) {
    this.land = land;
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a4b2a, roughness: 0.8, flatShading: true });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x4e2f1a, roughness: 0.9 });

    // Rumpf: Grundriss mit spitzem Bug, nach oben extrudiert
    const shape = new THREE.Shape();
    shape.moveTo(-1.7, -0.62);
    shape.lineTo(1.1, -0.62);
    shape.quadraticCurveTo(1.9, -0.3, 2.0, 0);
    shape.quadraticCurveTo(1.9, 0.3, 1.1, 0.62);
    shape.lineTo(-1.7, 0.62);
    shape.quadraticCurveTo(-1.95, 0, -1.7, -0.62);
    const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: false });
    hullGeo.rotateX(-Math.PI / 2);
    hullGeo.translate(0, -0.25, 0);
    const hullMesh = new THREE.Mesh(hullGeo, wood);
    hullMesh.castShadow = true;
    this.hull.add(hullMesh);

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.05, 1.05),
      new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 }),
    );
    deck.position.set(0, 0.31, 0);
    this.hull.add(deck);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.95), darkWood);
    cabin.position.set(-1.25, 0.6, 0);
    cabin.castShadow = true;
    this.hull.add(cabin);
    const cabinRoof = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.08, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x9a3a2a }),
    );
    cabinRoof.position.set(-1.25, 0.92, 0);
    this.hull.add(cabinRoof);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 6), darkWood);
    mast.position.set(0.95, 1.4, 0);
    mast.castShadow = true;
    this.hull.add(mast);
    this.mastTop.position.set(0.95, 2.4, 0);
    this.hull.add(this.mastTop);

    // Ladung: Kisten in 2 Reihen
    const crateGeo = new THREE.BoxGeometry(0.5, 0.42, 0.42);
    for (let i = 0; i < CRATE_SLOTS; i++) {
      const crate = new THREE.Mesh(crateGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
      const col = Math.floor(i / 2);
      const row = i % 2;
      crate.position.set(-0.55 + col * 0.36, 0.55, row === 0 ? -0.24 : 0.24);
      crate.castShadow = true;
      crate.visible = false;
      this.crates.push(crate);
      this.hull.add(crate);
    }

    // Bugwelle: helles Dreieck hinter dem Kahn, nur sichtbar in Fahrt
    const wakeGeo = new THREE.BufferGeometry();
    wakeGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([2.0, 0, 0, -5, 0, -2.2, -5, 0, 2.2], 3),
    );
    wakeGeo.computeVertexNormals();
    this.wake = new THREE.Mesh(
      wakeGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
    );
    this.wake.position.y = 0.02;
    this.wake.visible = false;

    this.group.add(this.hull, this.wake);
    // Schiffe sind die Stars: etwas größer als der Maßstab der Landschaft
    this.group.scale.setScalar(1.6);

    // Treidelpferd am Ufer
    const horseMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.3), horseMat);
    body.position.y = 0.65;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.2), horseMat);
    head.position.set(0.55, 0.95, 0);
    head.rotation.z = 0.5;
    const legGeo = new THREE.BoxGeometry(0.08, 0.45, 0.08);
    this.horse.add(body, head);
    for (const [lx, lz] of [[-0.35, -0.1], [-0.35, 0.1], [0.35, -0.1], [0.35, 0.1]]) {
      const leg = new THREE.Mesh(legGeo, horseMat);
      leg.position.set(lx, 0.23, lz);
      this.horse.add(leg);
    }
    this.horse.traverse((o) => (o.castShadow = true));
    this.horse.visible = false;
    this.horse.scale.setScalar(1.4);

    this.towLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x3a2a1a }),
    );
    this.towLine.visible = false;
  }

  /** Pferd und Leine liegen außerhalb der Schiffsgruppe, damit sie am Ufer bleiben */
  addTo(scene: THREE.Object3D): void {
    scene.add(this.group, this.horse, this.towLine);
  }

  /** Ladung anzeigen: Anteil je Ware in Farben */
  setCargo(load: { color: number; amount: number }[], capacity: number): void {
    const total = load.reduce((s, l) => s + l.amount, 0);
    const filled = total === 0 ? 0 : Math.max(1, Math.round((total / capacity) * CRATE_SLOTS));
    const colors: number[] = [];
    for (const l of load) {
      const n = total === 0 ? 0 : Math.round((l.amount / total) * filled);
      for (let i = 0; i < n; i++) colors.push(l.color);
    }
    while (colors.length < filled && load.length) colors.push(load.find((l) => l.amount > 0)!.color);
    this.crates.forEach((c, i) => {
      c.visible = i < filled;
      if (c.visible) (c.material as THREE.MeshStandardMaterial).color.setHex(colors[i] ?? 0x999999);
    });
  }

  /** Liegt am Steg */
  dock(mooring: THREE.Vector3, riverT: number): void {
    const tan = this.land.curve.getTangentAt(riverT);
    this.group.position.set(mooring.x, 0, mooring.z);
    this.group.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
    this.wake.visible = false;
    this.horse.visible = false;
    this.towLine.visible = false;
  }

  /** In Fahrt an Position t des Flusses */
  sail(t: number, downstream: boolean): void {
    const tan = this.land.curve.getTangentAt(t);
    const n = this.land.normalAt(t);
    const p = this.land.curve.getPointAt(t);
    // Rechtsverkehr: in Fahrtrichtung rechts halten
    const side = downstream ? 1 : -1;
    const lane = side * 1.2;
    this.group.position.set(p.x + n.x * lane, 0, p.z + n.z * lane);
    const heading = Math.atan2(-tan.z, tan.x) + (downstream ? 0 : Math.PI);
    this.group.rotation.set(0, heading, 0);
    this.wake.visible = true;

    // Bergwärts ziehen Treidelpferde vom Treidelpfad am Ufer
    this.horse.visible = !downstream;
    this.towLine.visible = !downstream;
    if (!downstream) {
      const ht = Math.max(0, t - 0.025);
      const hp = this.land.curve.getPointAt(ht);
      const hn = this.land.normalAt(ht);
      const off = side * (RIVER_HALF_WIDTH + 1.6);
      const hx = hp.x + hn.x * off;
      const hz = hp.z + hn.z * off;
      this.horse.position.set(hx, this.land.heightAt(hx, hz), hz);
      this.horse.rotation.set(0, heading, 0);
      this.horse.position.y += Math.abs(Math.sin(this.time * 6)) * 0.06;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.hull.position.y = Math.sin(this.time * 1.7) * 0.04;
    this.hull.rotation.x = Math.sin(this.time * 1.3) * 0.02;
    if (this.towLine.visible) {
      this.group.updateMatrixWorld();
      const a = new THREE.Vector3();
      this.mastTop.getWorldPosition(a);
      const b = this.horse.position.clone();
      b.y += 0.7;
      (this.towLine.geometry as THREE.BufferGeometry).setFromPoints([a, b]);
    }
  }
}
