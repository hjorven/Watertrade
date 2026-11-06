import './style.css';
import * as THREE from 'three';
import { GOODS } from './data/goods.ts';
import { VALLEY } from './data/maps/valley.ts';
import { Landscape } from './render/landscape.ts';
import { Stage } from './render/scene.ts';
import { ShipView } from './render/ships.ts';
import { buildBridge, buildTown, placeTown } from './render/towns.ts';
import {
  advance,
  anySailing,
  buy,
  buyShip,
  depart,
  dismantleRaft,
  newGame,
  sell,
  shipClass,
  voyagePosition,
  type GameState,
  type Ship,
} from './sim/game.ts';
import { Hud } from './ui/hud.ts';

/** Spielstunden pro echter Sekunde, solange ein Schiff fährt */
const HOURS_PER_SECOND = 3;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = '<div class="viewport"></div>';
const viewport = app.querySelector<HTMLDivElement>('.viewport')!;

// --- Welt ---
const stage = new Stage(viewport);
const land = new Landscape(VALLEY.rivers);
const towns = VALLEY.towns.map((def) => placeTown(land, def));
land.build(towns.map((t) => ({ pos: t.center, radius: t.radius, fields: !!t.def.fields })));
stage.scene.add(land.group);
towns.forEach((t, i) => {
  stage.scene.add(buildTown(land, t, 100 + i));
  stage.addLabel(t.def.name, t.center.clone().setY(land.heightAt(t.center.x, t.center.z) + 5));
});
for (const seg of VALLEY.segments) if (seg.bridgeHeight !== undefined) stage.scene.add(buildBridge(land, seg));
const placeOf = (id: string) => towns.find((t) => t.def.id === id)!;
const segOf = (id: string) => VALLEY.segments.find((s) => s.id === id)!;

// --- Spiel ---
const state: GameState = newGame(VALLEY, 'oberau');
let selected = state.ships[0].id;
let started = false;
let follow = true;
let timeScale = 1;
const views = new Map<number, ShipView>();

const current = (): Ship | undefined => state.ships.find((s) => s.id === selected);

const hud = new Hud(app, VALLEY, {
  select(id) {
    selected = id;
    follow = true;
    refresh();
  },
  buy(good, n) {
    hud.tradeFeedback(buy(state, selected, good, n));
    refresh();
  },
  sell(good, n) {
    hud.tradeFeedback(sell(state, selected, good, n));
    refresh();
  },
  depart(to) {
    if (!depart(state, VALLEY, selected, to)) hud.toast('Diese Fahrt ist nicht möglich.', 'warn');
    follow = true;
    refresh();
  },
  wait() {
    advance(state, VALLEY, 24);
    hud.toast('Ein Tag vergeht. Die Städte arbeiten.');
    refresh();
  },
  buyShip(type) {
    const ship = current();
    if (!ship?.port) return;
    const r = buyShip(state, VALLEY, ship.port, type);
    hud.toast(r.message, r.ok ? 'info' : 'warn');
    if (r.ship) selected = r.ship.id;
    refresh();
  },
  dismantle() {
    const r = dismantleRaft(state, selected);
    hud.tradeFeedback(r);
    if (r.ok) selected = state.ships[0]?.id ?? -1;
    refresh();
  },
  speed(f) {
    timeScale = f;
    refresh();
  },
  start() {
    started = true;
  },
});

/** Schiffsansichten mit dem Spielstand abgleichen */
function syncViews(): void {
  for (const [id, view] of views) {
    if (!state.ships.some((s) => s.id === id)) {
      view.removeFrom(stage.scene);
      views.delete(id);
    }
  }
  const slots = new Map<string, number>();
  for (const ship of state.ships) {
    let view = views.get(ship.id);
    if (!view) {
      view = new ShipView(land, shipClass(ship), ship.id);
      view.addTo(stage.scene);
      views.set(ship.id, view);
    }
    view.setSelected(ship.id === selected);
    view.setCargo(GOODS.map((g) => ({ color: g.color, amount: ship.cargo[g.id]?.amount ?? 0 })));
    if (ship.port) {
      const p = placeOf(ship.port);
      const slot = slots.get(ship.port) ?? 0;
      slots.set(ship.port, slot + 1);
      view.dock(p.mooring, p.def.river, p.def.riverT, slot);
    }
  }
}

function refresh(): void {
  hud.render(state, selected);
  syncViews();
}

const smooth = (x: number) => x * x * (3 - 2 * x);

function placeOnVoyage(ship: Ship, view: ShipView): void {
  const v = ship.voyage!;
  const { leg, progress, index } = voyagePosition(v);
  const seg = segOf(leg.seg);
  const t = leg.downstream
    ? seg.fromT + (seg.toT - seg.fromT) * progress
    : seg.toT - (seg.toT - seg.fromT) * progress;
  view.sail(seg.river, t, leg.downstream);

  // Ablegen und Anlegen weich vom Steg in die Fahrrinne
  const pos = view.group.position;
  const legLen = Math.max(1, seg.length);
  const ease = 4 / legLen; // etwa 4 km Manöver
  if (index === 0 && progress < ease) pos.lerp(placeOf(v.from).mooring.clone().setY(0), 1 - smooth(progress / ease));
  if (index === v.legs.length - 1 && progress > 1 - ease) {
    pos.lerp(placeOf(v.to).mooring.clone().setY(0), 1 - smooth((1 - progress) / ease));
  }
}

// Kamera folgt dem ausgewählten Schiff, bis der Spieler selbst die Ansicht bewegt
stage.controls.addEventListener('start', () => (follow = false));
const camOffset = new THREE.Vector3();

// Schiff anklicken wählt es aus
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt: { x: number; y: number } | null = null;
stage.renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
stage.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  const rect = stage.renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, stage.camera);
  const hits = raycaster.intersectObjects([...views.values()].map((v) => v.group), true);
  for (const hit of hits) {
    let o: THREE.Object3D | null = hit.object;
    while (o && o.userData.shipId === undefined) o = o.parent;
    if (o) {
      selected = o.userData.shipId as number;
      follow = true;
      refresh();
      return;
    }
  }
});

// --- Schleife ---
const timer = new THREE.Timer();
let uiTick = 0;

function frame(): void {
  timer.update();
  const dt = Math.min(0.1, timer.getDelta());

  if (started && anySailing(state)) {
    const events = advance(state, VALLEY, dt * HOURS_PER_SECOND * timeScale);
    let changed = false;
    for (const e of events) {
      if (e.type === 'arrived') {
        const ship = state.ships.find((s) => s.id === e.ship)!;
        hud.toast(`${ship.name} ist in ${placeOf(e.town).def.name} angekommen.`);
        changed = true;
      }
    }
    if (changed) refresh();
    uiTick += dt;
    if (uiTick > 0.2) {
      uiTick = 0;
      hud.render(state, selected);
    }
  }

  for (const ship of state.ships) {
    const view = views.get(ship.id)!;
    if (ship.voyage) placeOnVoyage(ship, view);
    view.update(dt);
  }

  // Strömung: Anteil der Flusslänge pro Sekunde, sichtbar aber ruhig
  land.update(dt, 0.012);

  const sel = views.get(selected);
  if (follow && sel) {
    camOffset.subVectors(stage.camera.position, stage.controls.target);
    stage.controls.target.lerp(sel.group.position, 1 - Math.exp(-dt * 2));
    stage.camera.position.copy(stage.controls.target).add(camOffset);
  }

  stage.render();
  requestAnimationFrame(frame);
}

refresh();
requestAnimationFrame(frame);
