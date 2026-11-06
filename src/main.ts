import './style.css';
import * as THREE from 'three';
import { GOODS } from './data/goods.ts';
import { MAP_M1 } from './data/maps/m1.ts';
import { SHIPS } from './data/ships.ts';
import { Landscape } from './render/landscape.ts';
import { Stage } from './render/scene.ts';
import { BargeView } from './render/ships.ts';
import { buildTown, placeTown } from './render/towns.ts';
import { advance, buy, depart, newGame, sell, type GameState } from './sim/game.ts';
import { Hud } from './ui/hud.ts';

/** Spielstunden pro echter Sekunde während einer Fahrt */
const HOURS_PER_SECOND = 3;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = '<div class="viewport"></div>';
const viewport = app.querySelector<HTMLDivElement>('.viewport')!;

// --- Welt ---
const stage = new Stage(viewport);
const land = new Landscape();
const towns = MAP_M1.towns.map((def) => placeTown(land, def));
land.build(towns.map((t) => ({ pos: t.center, radius: t.radius, fields: t.def.id === 'niedermuend' })));
stage.scene.add(land.group);
towns.forEach((t, i) => {
  stage.scene.add(buildTown(land, t, 100 + i));
  stage.addLabel(t.def.name, t.center.clone().setY(land.heightAt(t.center.x, t.center.z) + 5));
});

const barge = new BargeView(land);
barge.addTo(stage.scene);
const placeOf = (id: string) => towns.find((t) => t.def.id === id)!;

// --- Spiel ---
const state: GameState = newGame(MAP_M1, SHIPS.treidelkahn, 'oberau');
let started = false;
let follow = true;

const hud = new Hud(app, MAP_M1, {
  buy(good, n) {
    hud.tradeFeedback(buy(state, good, n));
    refresh();
  },
  sell(good, n) {
    hud.tradeFeedback(sell(state, good, n));
    refresh();
  },
  depart(to) {
    const v = depart(state, MAP_M1, to);
    if (!v) hud.toast('Diese Fahrt ist nicht möglich.', 'warn');
    follow = true;
    refresh();
  },
  wait() {
    advance(state, 24);
    hud.toast('Ein Tag vergeht. Die Märkte erholen sich.');
    refresh();
  },
  start() {
    started = true;
  },
});

function refresh(): void {
  hud.render(state);
  barge.setCargo(
    GOODS.map((g) => ({ color: g.color, amount: state.cargo[g.id].amount })),
    state.shipType.capacity,
  );
  if (state.port) {
    const p = placeOf(state.port);
    barge.dock(p.mooring, p.def.riverT);
  }
}

// Kamera folgt dem Kahn, bis der Spieler selbst die Ansicht bewegt
stage.controls.addEventListener('start', () => (follow = false));
const camOffset = new THREE.Vector3();

function placeBargeOnVoyage(): void {
  const v = state.voyage!;
  const from = placeOf(v.from);
  const to = placeOf(v.to);
  const p = v.elapsed / v.hours;
  const t = from.def.riverT + (to.def.riverT - from.def.riverT) * p;
  barge.sail(t, v.downstream);
  // Ablegen und Anlegen weich vom Steg in die Fahrrinne
  const leave = Math.min(1, p * 14);
  const arrive = Math.min(1, (1 - p) * 14);
  const pos = barge.group.position;
  if (leave < 1) pos.lerp(from.mooring.clone().setY(0), 1 - smooth(leave));
  if (arrive < 1) pos.lerp(to.mooring.clone().setY(0), 1 - smooth(arrive));
}
const smooth = (x: number) => x * x * (3 - 2 * x);

// --- Schleife ---
const timer = new THREE.Timer();
let uiTick = 0;

function frame(): void {
  timer.update();
  const dt = Math.min(0.1, timer.getDelta());

  if (started && state.voyage) {
    const events = advance(state, dt * HOURS_PER_SECOND);
    if (state.voyage) placeBargeOnVoyage();
    for (const e of events) {
      if (e.type === 'arrived') {
        hud.toast(`Angekommen in ${placeOf(e.town).def.name}.`);
        refresh();
      }
    }
    uiTick += dt;
    if (uiTick > 0.15 && state.voyage) {
      uiTick = 0;
      hud.render(state);
    }
  }

  // Strömung: Anteil der Flusslänge pro Sekunde, sichtbar aber ruhig
  land.update(dt, 0.012);
  barge.update(dt);

  if (follow) {
    const target = barge.group.position;
    camOffset.subVectors(stage.camera.position, stage.controls.target);
    stage.controls.target.lerp(target, 1 - Math.exp(-dt * 2));
    stage.camera.position.copy(stage.controls.target).add(camOffset);
  }

  stage.render();
  requestAnimationFrame(frame);
}

refresh();
requestAnimationFrame(frame);
