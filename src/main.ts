import './style.css';
import * as THREE from 'three';
import { CHAPTERS, type Chapter } from './data/campaign.ts';
import { GOOD_BY_ID, GOODS } from './data/goods.ts';
import { VALLEY } from './data/maps/valley.ts';
import { Landscape } from './render/landscape.ts';
import { Stage } from './render/scene.ts';
import { ambient, isMuted, mute, playSfx, setMusic, unlockAudioOnGesture, type SfxName } from './audio/index.ts';
import { RIVAL_BY_ID } from './data/rivals.ts';
import { SHIPS } from './data/ships.ts';
import { Estates, PLAYER_COLOR, type EstateInfo } from './render/buildings.ts';
import { ShipView } from './render/ships.ts';
import { WaterWorks } from './render/works.ts';
import { buildBridge, buildTown, placeTown, type TownView } from './render/towns.ts';
import { dateText, dayInSeason, dayOfYear, season, SEASON_NAME, SEASONS, type Season } from './sim/calendar.ts';
import { acceptContract, deliverContract } from './sim/contracts.ts';
import { dismissCaptain, hireCaptain, repair, upgrade } from './sim/fleet.ts';
import {
  advance,
  buy,
  buyShip,
  capacityOf,
  depart,
  dismantleRaft,
  kontorBuy,
  kontorSell,
  load,
  newGame,
  sell,
  shipClass,
  store,
  upgradeState,
  voyagePosition,
  wind,
  type GameEvent,
  type GameState,
  type OrderKind,
  type Ship,
  type TradeResult,
  type Voyage,
} from './sim/game.ts';
import { startProject } from './sim/works.ts';
import { EPOCHS } from './data/ships.ts';
import { buildBetrieb, buildKontor, sellBetrieb, toggleBetrieb, upgradeKontor } from './sim/house.ts';
import { goalDone, goalProgress } from './sim/goals.ts';
import { deserialize, SAVE_VERSION, serialize, type SaveGame } from './sim/save.ts';
import { LEVELS, levelOf } from './sim/towns.ts';
import { Hud } from './ui/hud.ts';
import { Menu, type SlotInfo } from './ui/menu.ts';
import { loadJson, saveJson } from './ui/storage.ts';

/** Spielstunden pro echter Sekunde bei Tempo 1 */
const HOURS_PER_SECOND = 3;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = '<div class="viewport"></div>';
const viewport = app.querySelector<HTMLDivElement>('.viewport')!;

// --- Welt (einmal aufgebaut, gilt für jedes Spiel auf dieser Karte) ---
const stage = new Stage(viewport);
const land = new Landscape(VALLEY.rivers);
const towns = VALLEY.towns.map((def) => placeTown(land, def));
land.build([
  ...towns.map((t) => ({ pos: t.center, radius: t.radius * 1.4, fields: !!t.def.fields })),
  // Bauplätze am Ufer frei von Bäumen halten
  ...towns.flatMap((t) => t.lots.map((l) => ({ pos: l.pos, radius: 0.5, fields: false }))),
]);
land.buildIce(VALLEY.segments.filter((s) => s.freezes).map((s) => ({ river: s.river, from: s.fromT, to: s.toT })));
stage.scene.add(land.group);
const townViews = new Map<string, TownView>();
const townLabels = new Map<string, HTMLDivElement>();
towns.forEach((t, i) => {
  const view = buildTown(land, t, 100 + i);
  stage.scene.add(view.group);
  townViews.set(t.def.id, view);
  townLabels.set(t.def.id, stage.addLabel(t.def.name, t.center.clone().setY(land.heightAt(t.center.x, t.center.z) + 6)));
});
const oldBridges = new Map<string, THREE.Object3D>();
for (const seg of VALLEY.segments) {
  if (seg.bridgeHeight === undefined) continue;
  const b = buildBridge(land, seg);
  oldBridges.set(seg.id, b);
  stage.scene.add(b);
}
const waterWorks = new WaterWorks(stage.scene, land, VALLEY.segments, oldBridges);
const estates = new Estates(stage.scene, towns);

// Papierkarte: Flussläufe in Kartenkoordinaten (x nach rechts, z nach unten)
function setupMapData(): void {
  const all: THREE.Vector3[] = [];
  const rivers = VALLEY.rivers.map((r) => {
    const pts = land.curve(r.id).getSpacedPoints(80);
    all.push(...pts);
    return { pts, width: r.halfWidth * 0.9 };
  });
  for (const t of towns) all.push(t.center);
  const minX = Math.min(...all.map((p) => p.x)) - 30;
  const maxX = Math.max(...all.map((p) => p.x)) + 90;
  const minZ = Math.min(...all.map((p) => p.z)) - 20;
  const maxZ = Math.max(...all.map((p) => p.z)) + 20;
  const f = (n: number) => n.toFixed(1);
  hud.setMapData({
    viewBox: `${f(minX)} ${f(minZ)} ${f(maxX - minX)} ${f(maxZ - minZ)}`,
    rivers: rivers.map((r) => ({ path: 'M' + r.pts.map((p) => `${f(p.x)} ${f(p.z)}`).join(' L'), width: r.width })),
    towns: Object.fromEntries(towns.map((t) => [t.def.id, { x: t.center.x, y: t.center.z }])),
    segMid: Object.fromEntries(
      VALLEY.segments.map((sg) => {
        const p = land.pointAt(sg.river, (sg.fromT + sg.toT) / 2);
        return [sg.id, { x: p.x + 6, y: p.z + 2 }];
      }),
    ),
    shipPos(ship) {
      if (ship.port) {
        const m = placeOf(ship.port).mooring;
        return { x: m.x, y: m.z };
      }
      const v = ship.voyage;
      if (!v) return null;
      const { leg, progress: p } = voyagePosition(v);
      const sg = segOf(leg.seg);
      const t = leg.downstream ? sg.fromT + (sg.toT - sg.fromT) * p : sg.toT - (sg.toT - sg.fromT) * p;
      const q = land.pointAt(sg.river, t);
      return { x: q.x, y: q.z };
    },
  });
}
const placeOf = (id: string) => towns.find((t) => t.def.id === id)!;
const segOf = (id: string) => VALLEY.segments.find((s) => s.id === id)!;
const townName = (id: string) => placeOf(id).def.name;

// --- Einstellungen und Fortschritt ---
interface Settings {
  tiltShift: boolean;
  sound?: boolean;
}
interface Progress {
  unlocked: string[];
}
const settings = loadJson<Settings>('settings', { tiltShift: true });
const progress = loadJson<Progress>('progress', { unlocked: ['k1'] });
stage.postfx.enabled = settings.tiltShift;
unlockAudioOnGesture();
mute(settings.sound === false);
setMusic('ruhig');
const sfx = (name: SfxName) => playSfx(name);

// --- Spielsitzung ---
interface Session {
  mode: 'kampagne' | 'frei';
  chapter?: Chapter;
  completed: Set<number>;
  finished: boolean;
}

let state: GameState = newGame(VALLEY, 'oberau');
let session: Session = { mode: 'frei', completed: new Set(), finished: false };
let selected = state.ships[0].id;
let running = false; // läuft die Zeit
let follow = true;
let timeScale = 1;
const views = new Map<number, ShipView>();
const rivalViews = new Map<number, ShipView>();

/** Rückmeldung mit passendem Geräusch */
function feedback(r: TradeResult, ok: SfxName = 'klick'): void {
  hud.tradeFeedback(r);
  sfx(r.ok ? ok : 'fehler');
}

const current = (): Ship | undefined => state.ships.find((s) => s.id === selected);

const hud = new Hud(app, VALLEY, {
  select(id) {
    selected = id;
    follow = true;
    refresh();
  },
  buy(good, n) {
    feedback(buy(state, selected, good, n), 'kauf');
    refresh();
  },
  sell(good, n) {
    const r = sell(state, selected, good, n);
    feedback(r, r.profit !== undefined && r.profit > 0 ? 'muenzen' : 'verkauf');
    refresh();
  },
  depart(to) {
    const ship = current();
    if (ship?.route?.active) ship.route.active = false;
    if (!depart(state, VALLEY, selected, to)) {
      hud.toast('Diese Fahrt ist nicht möglich.', 'warn');
      sfx('fehler');
    } else sfx('ablegen');
    follow = true;
    refresh();
  },
  wait() {
    handleEvents(advance(state, VALLEY, 24));
    hud.toast('Ein Tag vergeht.');
    refresh();
  },
  buyShip(type) {
    const ship = current();
    if (!ship?.port) return;
    const r = buyShip(state, VALLEY, ship.port, type);
    hud.toast(r.message, r.ok ? 'info' : 'warn');
    sfx(r.ok ? 'erfolg' : 'fehler');
    if (r.ship) selected = r.ship.id;
    refresh();
  },
  dismantle() {
    const r = dismantleRaft(state, selected);
    feedback(r, 'muenzen');
    if (r.ok) selected = state.ships[0]?.id ?? -1;
    refresh();
  },
  speed(f) {
    timeScale = f;
  },
  menu() {
    running = false;
    sfx('papier');
    menu.showGameMenu();
  },
  command(cmd, d) {
    runCommand(cmd, d);
  },
});

/** Befehle aus Kontor, Werft, Kneipe, Route und Auftragsbuch */
function runCommand(cmd: string, d: Record<string, string | number>): void {
  const ship = current();
  const town = ship?.port ?? '';
  const n = (k: string) => Number(d[k] ?? 0);
  let r: TradeResult | null = null;
  let ok: SfxName = 'klick';
  switch (cmd) {
    case 'refresh':
      sfx('papier');
      break;
    case 'buildKontor':
      r = buildKontor(state, town);
      ok = 'erfolg';
      break;
    case 'upgradeKontor':
      r = upgradeKontor(state, town);
      ok = 'erfolg';
      break;
    case 'buildBetrieb':
      r = buildBetrieb(state, VALLEY, town, String(d.type));
      ok = 'erfolg';
      break;
    case 'toggleBetrieb':
      r = toggleBetrieb(state, n('id'));
      break;
    case 'sellBetrieb':
      r = sellBetrieb(state, n('id'));
      ok = 'muenzen';
      break;
    case 'store':
      r = store(state, selected, String(d.good), n('n'));
      break;
    case 'load':
      r = load(state, selected, String(d.good), n('n'));
      break;
    case 'kontorBuy':
      r = kontorBuy(state, town, String(d.good), n('n'));
      ok = 'kauf';
      break;
    case 'kontorSell':
      r = kontorSell(state, town, String(d.good), n('n'));
      ok = 'verkauf';
      break;
    case 'repair':
      r = repair(state, VALLEY, selected);
      ok = 'erfolg';
      break;
    case 'upgrade':
      r = upgrade(state, VALLEY, selected, String(d.id));
      ok = 'erfolg';
      break;
    case 'hire':
      r = hireCaptain(state, selected, n('id'));
      ok = 'glocke';
      break;
    case 'dismiss':
      r = dismissCaptain(state, selected);
      break;
    case 'project':
      r = startProject(state, String(d.id));
      ok = 'glocke';
      break;
    case 'accept':
      r = acceptContract(state, n('id'));
      ok = 'stempel';
      break;
    case 'deliver':
      r = deliverContract(state, selected, n('id'));
      ok = r.taler > 0 ? 'muenzen' : 'verkauf';
      break;
    case 'routeAddStop':
    case 'routeDelStop':
    case 'routeAddOrder':
    case 'routeDelOrder':
    case 'routeToggle':
    case 'routeClear':
      if (ship) r = editRoute(ship, cmd, d);
      break;
  }
  if (r) feedback(r, ok);
  refresh();
}

function editRoute(ship: Ship, cmd: string, d: Record<string, string | number>): TradeResult | null {
  const okMsg = (message: string): TradeResult => ({ ok: true, message, amount: 0, taler: 0 });
  const r = (ship.route ??= { stops: [], next: 0, active: false });
  switch (cmd) {
    case 'routeAddStop': {
      const town = String(d.town);
      if (r.stops.length && r.stops[r.stops.length - 1].town === town) return { ok: false, message: 'Diese Stadt ist schon der letzte Halt.', amount: 0, taler: 0 };
      r.stops.push({ town, orders: [] });
      return null;
    }
    case 'routeDelStop':
      r.stops.splice(Number(d.stop), 1);
      r.next = 0;
      if (r.stops.length < 2) r.active = false;
      return null;
    case 'routeAddOrder': {
      const stop = r.stops[Number(d.stop)];
      if (!stop) return null;
      stop.orders.push({
        kind: String(d.kind) as OrderKind,
        good: String(d.good),
        amount: Math.max(0, Math.floor(Number(d.amount) || 0)),
        limit: Math.max(0, Math.floor(Number(d.limit) || 0)),
      });
      return null;
    }
    case 'routeDelOrder':
      r.stops[Number(d.stop)]?.orders.splice(Number(d.order), 1);
      return null;
    case 'routeToggle':
      if (!r.active && !ship.captain) return { ok: false, message: 'Erst einen Kapitän anheuern.', amount: 0, taler: 0 };
      if (!r.active && r.stops.length < 2) return { ok: false, message: 'Eine Route braucht mindestens zwei Halte.', amount: 0, taler: 0 };
      r.active = !r.active;
      r.retryAt = undefined;
      r.note = undefined;
      // beginnt am Halt, an dem das Schiff gerade liegt, sonst beim ersten
      if (r.active) {
        const here = r.stops.findIndex((s) => s.town === ship.port);
        r.next = here >= 0 ? here : 0;
      }
      return okMsg(r.active ? `${ship.captain!.name} übernimmt die Route.` : 'Route angehalten.');
    case 'routeClear':
      ship.route = null;
      return okMsg('Route gelöscht.');
  }
  return null;
}

setupMapData();

const menu = new Menu(
  app,
  {
    continueGame() {
      if (!loadSlot('auto')) menu.showMain();
    },
    startChapter(id) {
      const c = CHAPTERS.find((x) => x.id === id)!;
      startGame(
        newGame(VALLEY, {
          startTown: c.startTown,
          money: c.money,
          startShip: c.startShip,
          allowedShips: c.allowedShips,
          rivals: c.rivals ?? false,
          seed: Date.now() % 100000,
          epoch: c.epoch ?? 1,
          startYear: c.startYear,
          extraShips: c.extraShips,
          kontore: c.kontore,
          works: c.works,
        }),
        { mode: 'kampagne', chapter: c, completed: new Set(), finished: false },
      );
    },
    startFree() {
      startGame(newGame(VALLEY, { startTown: 'oberau', seed: Date.now() % 100000 }), { mode: 'frei', completed: new Set(), finished: false });
    },
    save(slot) {
      saveSlot(slot);
      hud.toast(`Gespeichert auf Platz ${slot}.`);
    },
    load(slot) {
      if (!loadSlot(slot)) {
        hud.toast('Dieser Spielstand lässt sich nicht laden.', 'warn');
        menu.showMain();
      }
    },
    setTiltShift(on) {
      settings.tiltShift = on;
      stage.postfx.enabled = on;
      saveJson('settings', settings);
    },
    resume() {
      running = true;
    },
    setSound(on) {
      settings.sound = on;
      mute(!on);
      saveJson('settings', settings);
    },
  },
  () => ({
    slots: listSlots(),
    unlockedChapters: progress.unlocked,
    tiltShift: settings.tiltShift,
    sound: !isMuted(),
    inGame: inGame,
  }),
);
let inGame = false;

function startGame(s: GameState, sess: Session): void {
  for (const view of [...views.values(), ...rivalViews.values()]) view.removeFrom(stage.scene);
  views.clear();
  rivalViews.clear();
  setMusic(epochMusic(s.epoch));
  state = s;
  session = sess;
  selected = state.ships[0]?.id ?? -1;
  follow = true;
  inGame = true;
  running = true;
  lastSeason = null;
  checkGoals(true);
  refresh();
  saveSlot('auto');
}

// --- Speichern ---
function summary(s: SaveGame): string {
  const day = Math.floor(s.state.hour / 24) + 1;
  const what = s.mode === 'kampagne' ? `Kapitel ${CHAPTERS.find((c) => c.id === s.chapter)?.number ?? '?'}` : 'Freies Spiel';
  return `${what}, ${dateText(day)}, ${s.state.money} Taler`;
}

function saveSlot(slot: string): void {
  const save: SaveGame = {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    mode: session.mode,
    chapter: session.chapter?.id,
    completedGoals: [...session.completed],
    state,
  };
  try {
    localStorage.setItem(`flussreich.save.${slot}`, serialize(save));
  } catch {
    hud.toast('Speichern nicht möglich: Der Browser erlaubt keinen lokalen Speicher.', 'warn');
  }
}

function readSlot(slot: string): SaveGame | null {
  try {
    const text = localStorage.getItem(`flussreich.save.${slot}`);
    return text ? deserialize(text) : null;
  } catch {
    return null;
  }
}

function loadSlot(slot: string): boolean {
  const save = readSlot(slot);
  if (!save) return false;
  const chapter = CHAPTERS.find((c) => c.id === save.chapter);
  startGame(upgradeState(save.state, VALLEY), {
    mode: save.mode,
    chapter,
    completed: new Set(save.completedGoals),
    finished: !!chapter && save.completedGoals.length >= chapter.goals.length,
  });
  return true;
}

function listSlots(): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (const slot of ['auto', '1', '2', '3']) {
    const s = readSlot(slot);
    if (s) out.push({ slot, label: slot === 'auto' ? 'Automatisch gespeichert' : `Platz ${slot}`, savedAt: s.savedAt, summary: summary(s) });
  }
  return out;
}

// --- Ziele ---
const fmtNum = (n: number) => Math.floor(n).toLocaleString('de-DE');
function checkGoals(silent = false): void {
  const c = session.chapter;
  if (!c || session.finished) {
    hud.renderGoals(null, []);
    return;
  }
  c.goals.forEach((g, i) => {
    if (session.completed.has(i) || !goalDone(state, g)) return;
    session.completed.add(i);
    if (!silent) {
      hud.toast(`Ziel erfüllt: ${g.text}`, 'gain');
      sfx('erfolg');
    }
  });
  hud.renderGoals(
    `Kapitel ${c.number}: ${c.title}`,
    c.goals.map((g, i) => {
      const p = goalProgress(state, g);
      const done = session.completed.has(i);
      const binary = ['profit', 'townLevel', 'rank', 'project'].includes(g.type);
      const progressText = binary ? '' : `${fmtNum(Math.min(p.value, p.target))} / ${fmtNum(p.target)}`;
      return { text: g.text, done, progress: progressText };
    }),
  );
  if (session.completed.size === c.goals.length) {
    session.finished = true;
    const next = CHAPTERS.find((x) => x.number === c.number + 1);
    if (next && !progress.unlocked.includes(next.id)) {
      progress.unlocked.push(next.id);
      saveJson('progress', progress);
    }
    running = false;
    hud.renderGoals(null, []);
    saveSlot('auto');
    sfx('stempel');
    menu.showChapterDone(c, next);
  }
}

// --- Ereignisse ---
let lastSeason: Season | null = null;
const SEASON_HINT: Record<Season, string> = {
  fruehling: 'Hochwasser: schnelle Talfahrt, aber hohe Schiffe kommen unter Brücken schlechter durch.',
  sommer: 'Niedrigwasser: tiefe Kähne nur mit halber Ladung, flache Boote sind jetzt Gold wert.',
  herbst: 'Normales Wasser und Erntezeit, die beste Zeit zum Handeln.',
  winter: 'Bald friert der Erzbach zu. Wer jetzt nicht liefert, muss bis zum Frühjahr warten.',
};

const epochMusic = (e: number) => (e >= 3 ? 'epoche3' : e === 2 ? 'epoche2' : 'epoche1');

function handleEvents(events: GameEvent[]): void {
  let changed = false;
  for (const e of events) {
    if (e.type === 'epoch') {
      hud.stamp('Neue Zeit', EPOCHS[e.epoch - 1].name);
      setMusic(epochMusic(e.epoch));
      changed = true;
      continue;
    }
    if (e.type === 'arrived') {
      const ship = state.ships.find((s) => s.id === e.ship);
      if (ship && (!e.auto || ship.id === selected)) {
        hud.toast(`${ship.name} ist in ${townName(e.town)} angekommen.`);
        sfx('anlegen');
      }
      changed = true;
    } else if (e.type === 'news') {
      if (e.important) {
        hud.toast(e.item.text, 'warn');
        sfx('glocke');
      } else if (e.item.kind === 'auftrag' && e.item.text.startsWith('Frist')) {
        hud.toast(e.item.text, 'loss');
      }
      changed = true;
    } else if (e.type === 'townLevel') {
      const name = townName(e.town);
      if (e.up) {
        const goods = e.newGoods.map((g) => GOOD_BY_ID.get(g)!.name).join(', ');
        hud.stamp(`${name} wächst`, `jetzt ${LEVELS[e.level].name}`);
        sfx('stempel');
        hud.toast(`${name} ist jetzt ${LEVELS[e.level].name}.${goods ? ` Neue Nachfrage: ${goods}.` : ''}`, 'gain');
      } else {
        hud.toast(`${name} schrumpft zum ${LEVELS[e.level].name}.`, 'loss');
      }
      changed = true;
    } else if (e.type === 'newDay') {
      const s = season(e.day);
      if (s !== lastSeason) {
        if (lastSeason !== null) hud.toast(`${SEASON_NAME[s]}. ${SEASON_HINT[s]}`);
        lastSeason = s;
      }
      changed = true;
    }
  }
  if (events.some((e) => e.type === 'newDay')) saveSlot('auto');
  if (changed) refresh();
}

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
    view.setCargo(
      GOODS.map((g) => ({ color: g.color, amount: ship.cargo[g.id]?.amount ?? 0 })),
      capacityOf(ship),
    );
    if (ship.port) {
      const p = placeOf(ship.port);
      const slot = slots.get(ship.port) ?? 0;
      slots.set(ship.port, slot + 1);
      view.dock(p.mooring, p.def.river, p.def.riverT, slot);
    }
  }

  // Schiffe der Konkurrenz mit ihren Farben
  const alive = new Set<number>();
  for (const r of state.rivals) {
    const color = RIVAL_BY_ID.get(r.id)!.color;
    for (const ship of r.ships) {
      alive.add(ship.id);
      let view = rivalViews.get(ship.id);
      if (!view) {
        view = new ShipView(land, SHIPS[ship.type], -ship.id, color);
        view.addTo(stage.scene);
        rivalViews.set(ship.id, view);
      }
      view.setCargo(GOODS.map((g) => ({ color: g.color, amount: ship.cargo?.good === g.id ? ship.cargo.amount : 0 })));
      if (ship.port) {
        const p = placeOf(ship.port);
        const slot = slots.get(ship.port) ?? 0;
        slots.set(ship.port, slot + 1);
        view.dock(p.mooring, p.def.river, p.def.riverT, slot);
      }
    }
  }
  for (const [id, view] of rivalViews) {
    if (alive.has(id)) continue;
    view.removeFrom(stage.scene);
    rivalViews.delete(id);
  }
}

/** Kontore und Betriebe aller Häuser in die Landschaft stellen */
function syncEstates(): void {
  const info = new Map<string, EstateInfo>();
  const get = (town: string) => {
    let e = info.get(town);
    if (!e) info.set(town, (e = { kontore: [], betriebe: [] }));
    return e;
  };
  for (const [town, k] of Object.entries(state.kontore)) get(town).kontore.push({ color: PLAYER_COLOR, level: k.level });
  for (const r of state.rivals) for (const town of r.kontore) get(town).kontore.push({ color: RIVAL_BY_ID.get(r.id)!.color, level: 1 });
  for (const b of state.betriebe) get(b.town).betriebe.push({ type: b.type, active: b.active });
  estates.sync(info);
}

function syncTowns(): void {
  for (const def of VALLEY.towns) {
    const t = state.towns[def.id];
    townViews.get(def.id)!.setPopulation(t.population);
    const label = townLabels.get(def.id)!;
    const html = `${def.name}<small>${LEVELS[levelOf(t.population)].name}</small>`;
    if (label.innerHTML !== html) label.innerHTML = html;
  }
}

function refresh(): void {
  hud.render(state, selected);
  syncViews();
  syncTowns();
  syncEstates();
  waterWorks.sync(state.works);
  checkGoals();
}

// --- Jahreszeiten in der Landschaft ---
const SKY: Record<Season, number> = { fruehling: 0xe6dcc2, sommer: 0xeedcb8, herbst: 0xe6d0b0, winter: 0xdfe2e2 };
const SUN: Record<Season, number> = { fruehling: 0xfff0d0, sommer: 0xffe2b0, herbst: 0xffcf98, winter: 0xe4ecff };
const WARMTH: Record<Season, number> = { fruehling: 0.2, sommer: 0.5, herbst: 0.9, winter: -0.6 };
const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function updateSeasonVisuals(): void {
  const dayFloat = state.hour / 24 + 1;
  const day = Math.floor(dayFloat);
  const s = season(day);
  const next = SEASONS[(SEASONS.indexOf(s) + 1) % 4];
  const into = dayInSeason(day) - 1 + (dayFloat - day);
  const f = Math.round(THREE.MathUtils.clamp((into - 25) / 5, 0, 1) * 20) / 20;
  land.setSeason(s, next, f);
  land.setWaterLevel(state.waterLevel);

  // Eis: zufrieren, festes Eis, dann Eisgang mit treibenden Schollen
  const doy = dayOfYear(day) + (dayFloat - day);
  let ice = 0;
  let drift = false;
  if (doy >= 91 && doy < 95) ice = (doy - 91) / 4;
  else if (doy >= 95 && doy < 116) ice = 1;
  else if (doy >= 116 && doy < 120) {
    ice = 1 - (doy - 116) / 4;
    drift = true;
  }
  land.setIce(ice, drift);

  const sky = tmpA.setHex(SKY[s]).lerp(tmpB.setHex(SKY[next]), f);
  (stage.scene.background as THREE.Color).copy(sky);
  stage.scene.fog?.color.copy(sky);
  stage.sun.color.setHex(SUN[s]).lerp(tmpB.setHex(SUN[next]), f);
  stage.postfx.setWarmth(WARMTH[s] + (WARMTH[next] - WARMTH[s]) * f);
}

const smooth = (x: number) => x * x * (3 - 2 * x);

function placeOnVoyage(ship: { voyage: Voyage | null }, view: ShipView): void {
  const v = ship.voyage!;
  const { leg, progress: p, index } = voyagePosition(v);
  const seg = segOf(leg.seg);
  const t = leg.downstream ? seg.fromT + (seg.toT - seg.fromT) * p : seg.toT - (seg.toT - seg.fromT) * p;
  view.sail(seg.river, t, leg.downstream);

  // Ablegen und Anlegen weich vom Steg in die Fahrrinne
  const pos = view.group.position;
  const ease = 4 / Math.max(1, seg.length); // etwa 4 km Manöver
  if (index === 0 && p < ease) pos.lerp(placeOf(v.from).mooring.clone().setY(0), 1 - smooth(p / ease));
  if (index === v.legs.length - 1 && p > 1 - ease) pos.lerp(placeOf(v.to).mooring.clone().setY(0), 1 - smooth((1 - p) / ease));
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
  if (!inGame || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
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

// --- Geräusche der Landschaft ---
const BIRDS: Record<Season, number> = { fruehling: 0.8, sommer: 0.6, herbst: 0.3, winter: 0.05 };
function updateAmbience(): void {
  const s = season(Math.floor(state.hour / 24) + 1);
  const night = Math.abs((state.hour % 24) - 13) > 8;
  ambient({
    flow: state.ice ? 0.15 : Math.min(1, 0.45 + Math.max(-0.3, state.waterLevel) * 0.3),
    wind: Math.min(1, wind(state) / 1.25),
    birds: night ? 0 : BIRDS[s],
  });
}

// --- Schleife ---
const timer = new THREE.Timer();
let uiTick = 0;

function frame(): void {
  timer.update();
  const dt = Math.min(0.1, timer.getDelta());

  if (inGame && running && !menu.open && timeScale > 0) {
    handleEvents(advance(state, VALLEY, dt * HOURS_PER_SECOND * timeScale));
    uiTick += dt;
    if (uiTick > 0.25) {
      uiTick = 0;
      hud.render(state, selected);
      updateAmbience();
    }
  }

  for (const ship of state.ships) {
    const view = views.get(ship.id);
    if (!view) continue;
    if (ship.voyage) placeOnVoyage(ship, view);
    view.update(dt);
  }
  let rivalDocked = false;
  for (const r of state.rivals) {
    for (const ship of r.ships) {
      const view = rivalViews.get(ship.id);
      if (!view) continue;
      if (ship.voyage) placeOnVoyage(ship, view);
      else if (!view.docked) rivalDocked = true;
      view.update(dt);
    }
  }
  if (rivalDocked) syncViews();
  estates.update(dt, wind(state));

  updateSeasonVisuals();
  land.update(dt, 0.012 * (1 + Math.max(0, state.waterLevel) * 0.35));

  const sel = views.get(selected);
  if (inGame && follow && sel) {
    camOffset.subVectors(stage.camera.position, stage.controls.target);
    stage.controls.target.lerp(sel.group.position, 1 - Math.exp(-dt * 2));
    stage.camera.position.copy(stage.controls.target).add(camOffset);
  }

  stage.render();
  requestAnimationFrame(frame);
}

// Testhilfe: mit ?debug in der Adresse lassen sich Tage überspringen
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).flussreich = {
    state: () => state,
    skipDays(n: number) {
      handleEvents(advance(state, VALLEY, n * 24));
      refresh();
    },
    money(n: number) {
      state.money = n;
      refresh();
    },
  };
}

refresh();
menu.showMain();
requestAnimationFrame(frame);
