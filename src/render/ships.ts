import * as THREE from 'three';
import type { ShipClass } from '../data/ships.ts';
import { Landscape } from './landscape.ts';

const CRATE_SLOTS = 8;

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

/** Rumpf aus einem Grundriss mit spitzem Bug, nach oben extrudiert */
function hullGeometry(length: number, width: number, depth: number, bow = 0.25): THREE.ExtrudeGeometry {
  const l = length / 2;
  const w = width / 2;
  const b = length * bow;
  const shape = new THREE.Shape();
  shape.moveTo(-l, -w);
  shape.lineTo(l - b, -w);
  shape.quadraticCurveTo(l - b * 0.3, -w * 0.5, l, 0);
  shape.quadraticCurveTo(l - b * 0.3, w * 0.5, l - b, w);
  shape.lineTo(-l, w);
  shape.quadraticCurveTo(-l - 0.25, 0, -l, -w);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -depth * 0.45, 0);
  return geo;
}

interface Model {
  root: THREE.Group;
  crates: THREE.Mesh[];
  mastTop: THREE.Object3D | null;
  sail: THREE.Mesh | null;
}

function crateGrid(root: THREE.Group, x0: number, dx: number, y: number): THREE.Mesh[] {
  const geo = new THREE.BoxGeometry(dx * 0.85, 0.42, 0.42);
  const crates: THREE.Mesh[] = [];
  for (let i = 0; i < CRATE_SLOTS; i++) {
    const col = Math.floor(i / 2);
    const row = i % 2;
    const crate = new THREE.Mesh(geo, mat(0xffffff, { roughness: 0.9 }));
    crate.position.set(x0 + col * dx, y + 0.21, row === 0 ? -0.24 : 0.24);
    crate.castShadow = true;
    crate.visible = false;
    crates.push(crate);
    root.add(crate);
  }
  return crates;
}

function buildModel(type: ShipClass): Model {
  const root = new THREE.Group();
  const wood = mat(0x7a4b2a, { flatShading: true });
  const dark = mat(0x4e2f1a);
  const deckMat = mat(0xb08a5a);

  if (type.id === 'floss') {
    // Stämme nebeneinander, darauf eine kleine Hütte und ein Steuerruder
    const log = new THREE.CylinderGeometry(0.16, 0.16, 3.6, 7);
    log.rotateZ(Math.PI / 2);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(log, mat(i % 2 ? 0x8a5a33 : 0x9a6a3c, { flatShading: true }));
      m.position.set((i % 3) * 0.1 - 0.1, 0, -0.96 + i * 0.32);
      m.castShadow = true;
      root.add(m);
    }
    const hut = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.6), dark);
    hut.position.set(-1.25, 0.38, 0);
    root.add(hut);
    const oar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.1), dark);
    oar.position.set(-2.4, 0.2, 0);
    root.add(oar);
    return { root, crates: crateGrid(root, -0.7, 0.45, 0.16), mastTop: null, sail: null };
  }

  if (type.id === 'plaette') {
    // Langer, flacher Kahn ohne Mast, mit Stakstange
    const hull = new THREE.Mesh(hullGeometry(3.8, 1.0, 0.35, 0.18), wood);
    hull.castShadow = true;
    root.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.04, 0.85), deckMat);
    deck.position.y = 0.2;
    root.add(deck);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 5), dark);
    pole.position.set(-1.5, 0.9, 0.3);
    pole.rotation.z = 0.5;
    root.add(pole);
    const mastTop = new THREE.Object3D();
    mastTop.position.set(1.2, 0.8, 0);
    root.add(mastTop);
    return { root, crates: crateGrid(root, -0.8, 0.42, 0.22), mastTop, sail: null };
  }

  if (type.id === 'segelkahn') {
    const hull = new THREE.Mesh(hullGeometry(4.6, 1.5, 0.7), mat(0x5e3b22, { flatShading: true }));
    hull.castShadow = true;
    root.add(hull);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.52), mat(0x2f5f7a));
    stripe.position.set(-0.2, 0.3, 0);
    root.add(stripe);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.05, 1.3), deckMat);
    deck.position.y = 0.39;
    root.add(deck);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 1.1), dark);
    cabin.position.set(-1.7, 0.65, 0);
    root.add(cabin);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6), dark);
    mast.position.set(0.9, 2.4, 0);
    mast.castShadow = true;
    root.add(mast);
    // Rahsegel als leicht gewölbte Fläche quer zum Schiff
    const sailGeo = new THREE.PlaneGeometry(2.4, 2.6, 6, 1);
    const pos = sailGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.cos((pos.getX(i) / 1.2) * (Math.PI / 2)) * 0.35);
    sailGeo.computeVertexNormals();
    sailGeo.rotateY(Math.PI / 2);
    sailGeo.translate(0, -1.3, 0); // Drehpunkt an der Rah, damit das Reffen nach oben zieht
    const sail = new THREE.Mesh(sailGeo, mat(0xf1e6cc, { side: THREE.DoubleSide, roughness: 1 }));
    sail.position.set(0.95, 4.1, 0);
    sail.castShadow = true;
    root.add(sail);
    return { root, crates: crateGrid(root, -1.0, 0.42, 0.42), mastTop: null, sail };
  }

  // Treidelkahn
  const hull = new THREE.Mesh(hullGeometry(3.7, 1.24, 0.55), wood);
  hull.castShadow = true;
  root.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.05, 1.05), deckMat);
  deck.position.y = 0.31;
  root.add(deck);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.95), dark);
  cabin.position.set(-1.25, 0.6, 0);
  cabin.castShadow = true;
  root.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 1.1), mat(0x9a3a2a));
  roof.position.set(-1.25, 0.92, 0);
  root.add(roof);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 6), dark);
  mast.position.set(0.95, 1.4, 0);
  mast.castShadow = true;
  root.add(mast);
  const mastTop = new THREE.Object3D();
  mastTop.position.set(0.95, 2.4, 0);
  root.add(mastTop);
  return { root, crates: crateGrid(root, -0.55, 0.36, 0.33), mastTop, sail: null };
}

function buildHorse(): THREE.Group {
  const horse = new THREE.Group();
  const horseMat = mat(0x6b4a2e, { roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.3), horseMat);
  body.position.y = 0.65;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.2), horseMat);
  head.position.set(0.55, 0.95, 0);
  head.rotation.z = 0.5;
  const legGeo = new THREE.BoxGeometry(0.08, 0.45, 0.08);
  horse.add(body, head);
  for (const [lx, lz] of [[-0.35, -0.1], [-0.35, 0.1], [0.35, -0.1], [0.35, 0.1]]) {
    const leg = new THREE.Mesh(legGeo, horseMat);
    leg.position.set(lx, 0.23, lz);
    horse.add(leg);
  }
  horse.traverse((o) => (o.castShadow = true));
  horse.scale.setScalar(1.4);
  return horse;
}

/** Ein Schiff in der Szene. Die Position wird von außen über `dock` oder `sail` gesetzt. */
export class ShipView {
  readonly group = new THREE.Group();
  readonly shipId: number;
  private readonly model: Model;
  private readonly horse: THREE.Group | null = null;
  private readonly towLine: THREE.Line | null = null;
  private readonly wake: THREE.Mesh;
  private readonly marker: THREE.Mesh;
  private readonly land: Landscape;
  private readonly type: ShipClass;
  private time = Math.random() * 10;

  constructor(land: Landscape, type: ShipClass, shipId: number) {
    this.land = land;
    this.type = type;
    this.shipId = shipId;
    this.model = buildModel(type);
    this.group.add(this.model.root);
    this.group.userData.shipId = shipId;

    const wakeGeo = new THREE.BufferGeometry();
    wakeGeo.setAttribute('position', new THREE.Float32BufferAttribute([2.2, 0, 0, -5, 0, -2.2, -5, 0, 2.2], 3));
    this.wake = new THREE.Mesh(
      wakeGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
    );
    this.wake.position.y = 0.02;
    this.wake.visible = false;
    this.group.add(this.wake);

    // Auswahlring
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 2.9, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xa8322a, transparent: true, opacity: 0.85 }),
    );
    this.marker.position.y = 0.05;
    this.marker.visible = false;
    this.group.add(this.marker);

    // Schiffe sind die Stars: etwas größer als der Maßstab der Landschaft
    this.group.scale.setScalar(1.6);

    if (type.propulsion === 'tow') {
      this.horse = buildHorse();
      this.horse.visible = false;
      this.towLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0x3a2a1a }),
      );
      this.towLine.visible = false;
    }
  }

  addTo(scene: THREE.Object3D): void {
    scene.add(this.group);
    if (this.horse) scene.add(this.horse);
    if (this.towLine) scene.add(this.towLine);
  }

  removeFrom(scene: THREE.Object3D): void {
    scene.remove(this.group);
    if (this.horse) scene.remove(this.horse);
    if (this.towLine) scene.remove(this.towLine);
  }

  setSelected(on: boolean): void {
    this.marker.visible = on;
  }

  /** Ladung anzeigen: Anteil je Ware in Farben */
  setCargo(load: { color: number; amount: number }[]): void {
    const total = load.reduce((s, l) => s + l.amount, 0);
    const filled = total === 0 ? 0 : Math.max(1, Math.round((total / this.type.capacity) * CRATE_SLOTS));
    const colors: number[] = [];
    for (const l of load) {
      const n = total === 0 ? 0 : Math.round((l.amount / total) * filled);
      for (let i = 0; i < n; i++) colors.push(l.color);
    }
    const fallback = load.find((l) => l.amount > 0)?.color ?? 0x999999;
    while (colors.length < filled) colors.push(fallback);
    this.model.crates.forEach((c, i) => {
      c.visible = i < filled;
      if (c.visible) (c.material as THREE.MeshStandardMaterial).color.setHex(colors[i]);
    });
  }

  /** Liegt am Steg; mehrere Schiffe im selben Hafen liegen hintereinander */
  dock(mooring: THREE.Vector3, river: string, riverT: number, slot: number): void {
    const tan = this.land.tangentAt(river, riverT);
    const offset = (slot % 2 === 1 ? 1 : -1) * Math.ceil(slot / 2) * 7;
    this.group.position.set(mooring.x + tan.x * offset, 0, mooring.z + tan.z * offset);
    this.group.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
    this.wake.visible = false;
    if (this.horse) this.horse.visible = false;
    if (this.towLine) this.towLine.visible = false;
    if (this.model.sail) this.model.sail.scale.set(1, 0.3, 1); // Segel gerefft
  }

  /** In Fahrt an Position t eines Flusses */
  sail(river: string, t: number, downstream: boolean): void {
    const tan = this.land.tangentAt(river, t);
    const n = this.land.normalAt(river, t);
    const p = this.land.pointAt(river, t);
    const hw = this.land.halfWidth(river);
    // Rechtsverkehr: in Fahrtrichtung rechts halten
    const side = downstream ? 1 : -1;
    const lane = side * Math.min(1.2, hw * 0.35);
    this.group.position.set(p.x + n.x * lane, 0, p.z + n.z * lane);
    const heading = Math.atan2(-tan.z, tan.x) + (downstream ? 0 : Math.PI);
    this.group.rotation.set(0, heading, 0);
    this.wake.visible = this.type.propulsion !== 'drift';
    if (this.model.sail) this.model.sail.scale.set(1, 1, 1);

    // Bergwärts ziehen Treidelpferde vom Treidelpfad am Ufer
    const towing = !downstream && this.horse !== null;
    if (this.horse) this.horse.visible = towing;
    if (this.towLine) this.towLine.visible = towing;
    if (towing && this.horse) {
      const len = this.land.curve(river).getLength();
      const ht = Math.max(0, t - 6 / len);
      const hp = this.land.pointAt(river, ht);
      const hn = this.land.normalAt(river, ht);
      const off = side * (hw + 1.6);
      const hx = hp.x + hn.x * off;
      const hz = hp.z + hn.z * off;
      this.horse.position.set(hx, this.land.heightAt(hx, hz) + Math.abs(Math.sin(this.time * 6)) * 0.06, hz);
      this.horse.rotation.set(0, heading, 0);
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.model.root.position.y = Math.sin(this.time * 1.7) * 0.04;
    this.model.root.rotation.x = Math.sin(this.time * 1.3) * 0.02;
    this.marker.rotation.y += dt * 0.6;
    if (this.towLine?.visible && this.horse && this.model.mastTop) {
      this.group.updateMatrixWorld();
      const a = new THREE.Vector3();
      this.model.mastTop.getWorldPosition(a);
      const b = this.horse.position.clone();
      b.y += 1;
      this.towLine.geometry.setFromPoints([a, b]);
    }
  }
}
