import './style.css';
import * as THREE from 'three';
import { CHAPTERS, type Chapter } from './data/campaign.ts';
import { CHALLENGES, DAILY_DAYS } from './data/challenges.ts';
import { newDailyGame } from './sim/daily.ts';
import { newAchievements, ACHIEVEMENTS } from './sim/achievements.ts';
import { OnlineScreens } from './ui/online-screens.ts';
import { GOOD_BY_ID, GOODS } from './data/goods.ts';
import { VALLEY } from './data/maps/valley.ts';
import { canalProgress } from './sim/canal.ts';
import { mapById, mapFor, randomMap, randomMapResult, stateFitsMap } from './data/maps/index.ts';
import { CHECK_DAYS } from './sim/mapcheck.ts';
import { mapPreviewSvg } from './ui/mappreview.ts';
import { projectsOf } from './data/projects.ts';
import { Landscape } from './render/landscape.ts';
import { Stage } from './render/scene.ts';
import { BASE_FOG, easeEpoch, moodAt } from './render/epochmood.ts';
import { ambient, getVolume, isMuted, mute, playSfx, setMusic, setVolume, unlockAudioOnGesture, type SfxName } from './audio/index.ts';
import { RIVAL_BY_ID } from './data/rivals.ts';
import { buyShares, endPact, offerPact, placeBid, sellShares } from './sim/rivalry.ts';
import { SHIPS } from './data/ships.ts';
import { Estates, PLAYER_COLOR, type EstateInfo } from './render/buildings.ts';
import { ShipView } from './render/ships.ts';
import { WaterWorks } from './render/works.ts';
import { buildBridge, buildTown, placeTown, type TownView } from './render/towns.ts';
import { dateText, dayInSeason, dayOfYear, season, SEASON_NAME, SEASONS, type Season } from './sim/calendar.ts';
import { acceptContract, deliverContract } from './sim/contracts.ts';
import { dismissCaptain, hireCaptain, repair, upgrade } from './sim/fleet.ts';
import { setCaptainWage } from './sim/captains.ts';
import {
  advance,
  buy,
  buyShip,
  capacityOf,
  depart,
  departProblem,
  dismantleRaft,
  fillBunker,
  kontorBuy,
  kontorSell,
  load,
  newGame,
  sell,
  shipClass,
  store,
  transship,
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
import { buildHarbor, dredge, setFee, setUpkeep, startProjectWith } from './sim/wasserbau.ts';
import type { FeeLevel } from './sim/state.ts';
import { activePlan, resetBook, stopsOf, winterSeasonsOf } from './sim/routes.ts';
import type { RoutePlan } from './sim/state.ts';
import { deliverToCanal, startCanalStage } from './sim/canal.ts';
import { EPOCHS } from './data/ships.ts';
import { buildBetrieb, buildKontor, playerWorth, sellBetrieb, toggleBetrieb, upgradeKontor } from './sim/house.ts';
import { goalDone, goalProgress, restoreCompleted } from './sim/goals.ts';
import { payOverdueNow, repayLoan, setInsured, takeLoan } from './sim/finance.ts';
import { deserialize, SAVE_VERSION, serialize, type GameMode, type SaveGame } from './sim/save.ts';
import { LEVELS, levelOf } from './sim/towns.ts';
import { chapterOneHint } from './ui/tutorial.ts';
import { ALL_FEATURES, Hud, type HudFeatures } from './ui/hud.ts';
import { Menu, type SlotInfo } from './ui/menu.ts';
import { loadJson, saveJson } from './ui/storage.ts';

/** Spielstunden pro echter Sekunde bei Tempo 1 */
const HOURS_PER_SECOND = 3;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = '<div class="viewport"></div>';
const viewport = app.querySelector<HTMLDivElement>('.viewport')!;

// --- Karte ---
// Die Welt wird einmal beim Laden aufgebaut. Startet ein Spiel auf einer anderen Karte (Zufallsfluss),
// legt startGame den Spielstand in den sessionStorage und lädt die Seite neu; hier geht es dann weiter.
const PENDING_KEY = 'flussreich.pending';
const pending = takePending();
/** Die Seite wurde für einen übergebenen Spielstand neu geladen: höchstens ein Versuch, ihn zu starten */
let bootedWithPending = !!pending;
const MAP = pending ? mapFor(pending.state) : VALLEY;

function takePending(): SaveGame | null {
  try {
    const text = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return text ? deserialize(text) : null;
  } catch {
    return null;
  }
}

// --- Welt (einmal aufgebaut, gilt für jedes Spiel auf dieser Karte) ---
const stage = new Stage(viewport);
const land = new Landscape(MAP.rivers, MAP.bounds);
if (MAP.bounds) stage.fitWorld(MAP.bounds);
const towns = MAP.towns.map((def) => placeTown(land, def));
land.build([
  ...towns.map((t) => ({ pos: t.center, radius: t.radius * 1.4, fields: !!t.def.fields })),
  // Bauplätze am Ufer frei von Bäumen halten
  ...towns.flatMap((t) => t.lots.map((l) => ({ pos: l.pos, radius: 0.5, fields: false }))),
]);
land.buildIce(MAP.segments.filter((s) => s.freezes).map((s) => ({ river: s.river, from: s.fromT, to: s.toT })));
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
for (const seg of MAP.segments) {
  if (seg.bridgeHeight === undefined) continue;
  const b = buildBridge(land, seg);
  oldBridges.set(seg.id, b);
  stage.scene.add(b);
}
const waterWorks = new WaterWorks(stage.scene, land, MAP.segments, oldBridges, projectsOf(MAP));
const estates = new Estates(stage.scene, towns);

// Papierkarte: Flussläufe in Kartenkoordinaten (x nach rechts, z nach unten)
function setupMapData(): void {
  const all: THREE.Vector3[] = [];
  const rivers = MAP.rivers.map((r) => {
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
    towns: Object.fromEntries(towns.map((t) => [t.def.id, { x: t.mooring.x, y: t.mooring.z }])),
    segMid: Object.fromEntries(
      MAP.segments.map((sg) => {
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
/** Baufortschritt des Kanals in der 3D-Welt (nur auf Karten mit Kanal) */
function showCanal(): void {
  const build = canalProgress(state, MAP);
  if (build) land.setCanal(build);
}
const placeOf = (id: string) => towns.find((t) => t.def.id === id)!;
const segOf = (id: string) => MAP.segments.find((s) => s.id === id)!;
const townName = (id: string) => placeOf(id).def.name;

// --- Einstellungen und Fortschritt ---
interface Settings {
  tiltShift: boolean;
  sound?: boolean;
}
interface Progress {
  unlocked: string[];
  /** bestandene Herausforderungen: Id -> wenigste Tage */
  challenges?: Record<string, number>;
  /** gewertetes lokales Tagesmarkt-Ergebnis je Kalendertag (erster Versuch) */
  daily?: Record<string, number>;
  /** Kalendertage, an denen der gewertete Versuch schon begonnen wurde */
  dailyTried?: string[];
  /** gewertetes Ergebnis, das noch zum Server muss */
  dailyPending?: { day: string; worth: number } | null;
}
const settings = loadJson<Settings>('settings', { tiltShift: true });
const progress = loadJson<Progress>('progress', { unlocked: ['k1'] });
progress.challenges ??= {};
progress.daily ??= {};
progress.dailyTried ??= [];
const achieved = loadJson<Record<string, string>>('achievements', {});
// Anmeldelink aus der Adresse übernehmen, falls jemand über die E-Mail zurückkommt.
// Supabase wird nur dann sofort geladen, sonst erst beim ersten Online-Bildschirm.
if (/access_token|refresh_token|[?&]code=|error_description/.test(location.hash + location.search)) {
  void import('./online/index.ts').then((m) => m.getClient());
}
stage.postfx.enabled = settings.tiltShift;
unlockAudioOnGesture();
mute(settings.sound === false);
setMusic('ruhig');
const sfx = (name: SfxName) => playSfx(name);

// --- Spielsitzung ---
interface Session {
  mode: GameMode;
  /** Kapitel oder Herausforderung */
  chapter?: Chapter;
  completed: Set<number>;
  finished: boolean;
  /** Spielstunde beim Start, für Zeitlimits */
  startHour?: number;
  dailyDay?: string;
  /** Tagesmarkt: gewerteter Versuch (sonst Übungsrunde) */
  dailyScored?: boolean;
}

let state: GameState = newGame(MAP, MAP.start ?? MAP.towns[0].id);
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

const hud = new Hud(app, MAP, {
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
    const problem = departProblem(state, MAP, selected, to);
    if (problem || !depart(state, MAP, selected, to)) {
      hud.toast(problem ?? 'Diese Fahrt ist nicht möglich.', 'warn');
      sfx('fehler');
    } else sfx('ablegen');
    follow = true;
    refresh();
  },
  wait() {
    handleEvents(advance(state, MAP, 24));
    hud.toast('Ein Tag vergeht.');
    refresh();
  },
  buyShip(type) {
    const ship = current();
    if (!ship?.port) return;
    const r = buyShip(state, MAP, ship.port, type);
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
      r = buildBetrieb(state, MAP, town, String(d.type));
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
    case 'transship':
      r = transship(state, selected, n('to'), String(d.good), n('n'));
      break;
    case 'kontorBuy':
      r = kontorBuy(state, town, String(d.good), n('n'));
      ok = 'kauf';
      break;
    case 'kontorSell':
      r = kontorSell(state, town, String(d.good), n('n'));
      ok = 'verkauf';
      break;
    case 'pactOffer':
      r = offerPact(state, MAP, String(d.house), String(d.mine), String(d.theirs));
      ok = 'erfolg';
      break;
    case 'pactEnd':
      r = endPact(state, String(d.house));
      break;
    case 'buyShares':
      r = buyShares(state, MAP, String(d.house));
      ok = 'muenzen';
      break;
    case 'sellShares':
      r = sellShares(state, String(d.house));
      ok = 'muenzen';
      break;
    case 'bid':
      r = placeBid(state, String(d.town));
      ok = 'muenzen';
      break;
    case 'bunker':
      r = fillBunker(state, selected);
      ok = 'kauf';
      break;
    case 'repair':
      r = repair(state, MAP, selected);
      ok = 'erfolg';
      break;
    case 'upgrade':
      r = upgrade(state, MAP, selected, String(d.id));
      ok = 'erfolg';
      break;
    case 'hire':
      r = hireCaptain(state, selected, n('id'));
      ok = 'glocke';
      break;
    case 'dismiss':
      r = dismissCaptain(state, selected);
      break;
    case 'wage':
      r = setCaptainWage(state, selected, n('wage'));
      break;
    case 'project':
      r = startProjectWith(state, MAP, String(d.id), d.partner === 'stadt' || d.partner === 'haus' ? d.partner : undefined);
      ok = 'glocke';
      break;
    case 'workFee':
      r = setFee(state, String(d.id), String(d.level) as FeeLevel);
      break;
    case 'workUpkeep':
      r = setUpkeep(state, String(d.id), String(d.on) === '1');
      break;
    case 'dredge':
      r = dredge(state, String(d.id));
      ok = 'erfolg';
      break;
    case 'harbor':
      r = buildHarbor(state, MAP, String(d.town), d.partner === 'stadt');
      ok = 'glocke';
      break;
    case 'canalStart':
      r = startCanalStage(state, MAP);
      ok = 'glocke';
      break;
    case 'canalDeliver':
      r = deliverToCanal(state, MAP, d.kontor ? { kontor: String(d.kontor) } : { ship: n('ship') }, String(d.good), n('n'));
      ok = 'verkauf';
      break;
    case 'accept':
      r = acceptContract(state, n('id'));
      ok = 'stempel';
      break;
    case 'deliver':
      r = deliverContract(state, selected, n('id'));
      ok = r.taler > 0 ? 'muenzen' : 'verkauf';
      break;
    case 'takeLoan':
      r = takeLoan(state, town, n('n'), n('days'));
      ok = 'muenzen';
      break;
    case 'repayLoan':
      r = repayLoan(state, n('id'));
      ok = 'muenzen';
      break;
    case 'payOverdue':
      r = payOverdueNow(state, n('id'));
      ok = 'muenzen';
      break;
    case 'insure':
      r = setInsured(state, selected, n('on') === 1);
      ok = 'stempel';
      break;
    case 'routeAddStop':
    case 'routeDelStop':
    case 'routeAddOrder':
    case 'routeDelOrder':
    case 'routeToggle':
    case 'routeClear':
    case 'routeStopCond':
    case 'routeWinterSeason':
    case 'routeCopyPlan':
    case 'routeResetBook':
      if (ship) r = editRoute(ship, cmd, d);
      break;
  }
  if (r) feedback(r, ok);
  refresh();
}

function editRoute(ship: Ship, cmd: string, d: Record<string, string | number>): TradeResult | null {
  const okMsg = (message: string): TradeResult => ({ ok: true, message, amount: 0, taler: 0 });
  const failMsg = (message: string): TradeResult => ({ ok: false, message, amount: 0, taler: 0 });
  const r = (ship.route ??= { stops: [], next: 0, active: false });
  // Sommerplan ist die Haupt-Liste, der Winterplan die zweite
  const plan: RoutePlan = d.plan === 'winter' ? 'winter' : 'sommer';
  const stops = plan === 'winter' ? (r.winterStops ??= []) : r.stops;
  // Änderungen am Plan, nach dem gerade gefahren wird: beim ersten Halt neu anfangen
  const touchesActive = () => r.active && plan === (r.plan ?? 'sommer');
  const restart = () => {
    r.next = 0;
    r.retryAt = undefined;
    r.loadingSince = undefined;
  };
  switch (cmd) {
    case 'routeAddStop': {
      const town = String(d.town);
      if (stops.length && stops[stops.length - 1].town === town) return failMsg('Diese Stadt ist schon der letzte Halt.');
      stops.push({ town, orders: [] });
      return null;
    }
    case 'routeDelStop': {
      stops.splice(Number(d.stop), 1);
      if (touchesActive()) restart();
      if (r.stops.length < 2) r.active = false;
      return null;
    }
    case 'routeAddOrder': {
      const stop = stops[Number(d.stop)];
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
      stops[Number(d.stop)]?.orders.splice(Number(d.order), 1);
      return null;
    case 'routeStopCond': {
      const stop = stops[Number(d.stop)];
      if (!stop) return null;
      // leeres Feld heißt: keine Bedingung
      const num = (v: string | number | undefined) => (v === undefined || String(v).trim() === '' ? undefined : Number(String(v).replace(',', '.')));
      const load = num(d.minLoad);
      const lo = num(d.levelMin);
      const hi = num(d.levelMax);
      if ([load, lo, hi].some((x) => x !== undefined && !Number.isFinite(x))) return failMsg('Bitte Zahlen eintragen, z. B. 80 oder -0,5.');
      if (lo !== undefined && hi !== undefined && lo >= hi) return failMsg('Die untere Pegelgrenze muss unter der oberen liegen.');
      stop.minLoad = load ? Math.min(1, Math.max(0, load / 100)) : undefined;
      stop.levelMin = lo === undefined ? undefined : Math.round(lo * 10) / 10;
      stop.levelMax = hi === undefined ? undefined : Math.round(hi * 10) / 10;
      if (!stop.minLoad) delete stop.minLoad;
      if (stop.levelMin === undefined) delete stop.levelMin;
      if (stop.levelMax === undefined) delete stop.levelMax;
      return okMsg(`Bedingungen für ${MAP.towns.find((t) => t.id === stop.town)?.name ?? stop.town} gespeichert.`);
    }
    case 'routeWinterSeason': {
      const s = String(d.season) as Season;
      if (!SEASONS.includes(s)) return null;
      const list = winterSeasonsOf(r);
      r.winterSeasons = list.includes(s) ? list.filter((x) => x !== s) : SEASONS.filter((x) => x === s || list.includes(x));
      return null;
    }
    case 'routeCopyPlan': {
      // Sommerplan als Vorlage für den Winterplan übernehmen
      r.winterStops = structuredClone(r.stops);
      if (r.active && (r.plan ?? 'sommer') === 'winter') restart();
      return okMsg('Sommerplan in den Winterplan übernommen.');
    }
    case 'routeResetBook':
      resetBook(r);
      return okMsg('Routenbuch geleert.');
    case 'routeToggle':
      if (!r.active && !ship.captain) return failMsg('Erst einen Kapitän anheuern.');
      if (!r.active && r.stops.length < 2) return failMsg('Eine Route braucht mindestens zwei Halte.');
      r.active = !r.active;
      r.retryAt = undefined;
      r.loadingSince = undefined;
      r.note = undefined;
      // beginnt am Halt, an dem das Schiff gerade liegt, sonst beim ersten
      if (r.active) {
        r.plan = activePlan(state, r);
        const here = stopsOf(r, r.plan).findIndex((s) => s.town === ship.port);
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
        newGame(mapById(c.map), {
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
          weakHouse: c.weakHouse,
        }),
        { mode: 'kampagne', chapter: c, completed: new Set(), finished: false },
      );
    },
    startFree(seed) {
      // ohne Startwert das Tal der zwei Flüsse, sonst eine Zufallskarte
      const map = seed === null ? VALLEY : randomMap(seed);
      startGame(newGame(map, { startTown: map.start ?? map.towns[0].id, seed: Date.now() % 100000 }), { mode: 'frei', completed: new Set(), finished: false });
    },
    mapPreview(seed) {
      const r = randomMapResult(seed);
      const bridges = r.map.segments.filter((x) => x.bridgeHeight !== undefined).length;
      const facts = `${r.map.towns.length} Städte an ${r.map.rivers.length} Flüssen, ${bridges} ${bridges === 1 ? 'Brücke' : 'Brücken'}.`;
      const test = r.report.ok
        ? `Probefahrt: Ein Händler mit einem Treidelkahn hatte nach ${CHECK_DAYS} Tagen ${fmtNum(r.report.money ?? 0)} Taler.`
        : 'Diese Karte hat die Probefahrt nicht ganz bestanden und kann schwer sein.';
      return { svg: mapPreviewSvg(r.map), name: r.map.name, text: `${facts} ${test}` };
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
    setVolume(channel, v) {
      setVolume(v, channel);
    },
    getVolume: (channel) => getVolume(channel),
    leaveGame() {
      if (!inGame) return;
      saveSlot('auto');
      inGame = false;
      running = false;
      document.body.classList.add('no-game');
      hud.renderGoals(null, []);
      hud.setHint(null);
      setMusic('ruhig');
    },
    startChallenge(id) {
      const c = CHALLENGES.find((x) => x.id === id)!;
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
        { mode: 'herausforderung', chapter: c, completed: new Set(), finished: false },
      );
    },
    other(cmd, data) {
      screens.handle(cmd, data);
    },
  },
  () => ({
    slots: listSlots(),
    unlockedChapters: progress.unlocked,
    tiltShift: settings.tiltShift,
    sound: !isMuted(),
    inGame: inGame,
    challenges: progress.challenges!,
    online: true,
    canSave: canSave(),
  }),
);

const screens = new OnlineScreens(menu, VALLEY, {
  startDaily(day, seed, scored) {
    if (scored && !progress.dailyTried!.includes(day)) {
      // nur die letzten Tage merken, damit die Liste nicht wächst
      progress.dailyTried = [...progress.dailyTried!, day].slice(-14);
      saveJson('progress', progress);
    }
    startGame(newDailyGame(VALLEY, day, seed), { mode: 'tagesmarkt', completed: new Set(), finished: false, dailyDay: day, dailyScored: scored });
  },
  currentSave: () => (inGame && canSave() ? makeSave() : null),
  inGame: () => inGame,
  loadSave(save) {
    return startSave(save);
  },
  unlock,
  achievements: () => achieved,
  challenges: () => progress.challenges!,
  dailyLocal: (day) => ({ tried: progress.dailyTried!.includes(day), worth: progress.daily![day] ?? null }),
  dailyPending: () => progress.dailyPending ?? null,
  dailyPendingDone(day) {
    if (progress.dailyPending?.day !== day) return;
    progress.dailyPending = null;
    saveJson('progress', progress);
  },
  toast: (text, kind) => hud.toast(text, kind),
  sfx: (name) => sfx(name),
});

/** Erfolg freischalten und melden */
function unlock(id: string): void {
  if (achieved[id]) return;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return;
  achieved[id] = new Date().toISOString();
  saveJson('achievements', achieved);
  hud.toast(`Erfolg: ${a.title}. ${a.text}.`, 'gain');
  sfx('stempel');
}
let inGame = false;
// Tagesmarkt: beim Verlassen der Seite den aktuellen Stand sichern, damit Neuladen keinen Spieltag zurückdreht
addEventListener('pagehide', () => {
  if (inGame && session.mode === 'tagesmarkt' && !session.finished) saveSlot('auto');
});
document.body.classList.add('no-game');
const canSave = () => session.mode !== 'tagesmarkt' && session.mode !== 'herausforderung';

function startGame(s: GameState, sess: Session): void {
  const target = mapFor(s);
  // nach dem Neuladen ist die Welt schon die richtige; ein zweites Neuladen gibt es nie
  if (target.id !== MAP.id && !bootedWithPending) {
    reloadWithMap(s, sess);
    return;
  }
  bootedWithPending = false;
  if (target.id !== MAP.id || !stateFitsMap(s, MAP)) {
    hud.toast('Dieser Spielstand gehört zu einer Karte, die es hier nicht gibt.', 'warn');
    menu.showMain();
    return;
  }
  for (const view of [...views.values(), ...rivalViews.values()]) view.removeFrom(stage.scene);
  views.clear();
  rivalViews.clear();
  setMusic(epochMusic(s.epoch));
  state = s;
  moodEpoch = s.epoch; // beim Laden sofort die richtige Stimmung, ohne Überblenden
  session = { ...sess, startHour: sess.startHour ?? s.hour };
  selected = state.ships[0]?.id ?? -1;
  follow = true;
  inGame = true;
  document.body.classList.remove('no-game');
  running = true;
  lastSeason = null;
  hud.setFeatures(featuresFor(session));
  checkGoals(true);
  showCanal();
  refresh();
  saveSlot('auto');
}

/** Spielstand auf einer anderen Karte: übergeben und die Seite mit der neuen Welt neu laden */
function reloadWithMap(s: GameState, sess: Session): void {
  const save: SaveGame = {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    mode: sess.mode,
    chapter: sess.chapter?.id,
    completedGoals: [...sess.completed],
    startHour: sess.startHour ?? s.hour,
    dailyDay: sess.dailyDay,
    state: s,
  };
  try {
    sessionStorage.setItem(PENDING_KEY, serialize(save));
  } catch {
    hud.toast('Diese Karte lässt sich nicht laden: Der Browser erlaubt keinen Sitzungsspeicher.', 'warn');
    menu.showMain();
    return;
  }
  menu.show('<div class="card-head">Neue Karte</div><h2>Der Fluss wird vermessen …</h2><p>Gleich geht es los.</p>');
  location.reload();
}

/** Die Kampagne führt Reiter und Bücher nach und nach ein, alle anderen Modi zeigen alles */
function featuresFor(sess: Session): HudFeatures {
  const n = sess.mode === 'kampagne' ? (sess.chapter?.number ?? 99) : 99;
  if (n <= 1) return { tabs: ['markt', 'werft', 'bank'], views: ['ship', 'news', 'map'] };
  if (n === 2) return { tabs: ['markt', 'kontor', 'werft', 'kneipe', 'route', 'bank'], views: ['ship', 'news', 'map', 'contracts', 'register'] };
  return ALL_FEATURES;
}

/** Nächster Schritt im ersten Kapitel, solange man noch lernt */
function tutorialHint(): string | null {
  if (session.mode !== 'kampagne' || session.chapter?.id !== 'k1' || session.finished) return null;
  const ship = current();
  return ship ? chapterOneHint(state, MAP, ship, townName) : null;
}

// --- Speichern ---
function summary(s: SaveGame): string {
  const day = Math.floor(s.state.hour / 24) + 1;
  const what =
    s.mode === 'kampagne'
      ? `Kapitel ${CHAPTERS.find((c) => c.id === s.chapter)?.number ?? '?'}`
      : s.mode === 'herausforderung'
        ? `Herausforderung ${CHALLENGES.find((c) => c.id === s.chapter)?.title ?? ''}`
        : s.mode === 'tagesmarkt'
          ? `Tagesmarkt ${s.dailyDay ?? ''}${s.dailyScored ? '' : ' (Übung)'}`
          : 'Freies Spiel';
  return `${what}, ${dateText(day)}, ${s.state.money} Taler`;
}

function makeSave(): SaveGame {
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    mode: session.mode,
    chapter: session.chapter?.id,
    completedGoals: [...session.completed],
    completedTexts: session.chapter ? [...session.completed].map((i) => session.chapter!.goals[i]?.text).filter((t): t is string => !!t) : undefined,
    startHour: session.startHour,
    dailyDay: session.dailyDay,
    dailyScored: session.dailyScored,
    state,
  };
}

function saveSlot(slot: string): void {
  const save = makeSave();
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
  return !!save && startSave(save);
}

function startSave(save: SaveGame): boolean {
  if (!save?.state || !Array.isArray(save.state.ships)) return false;
  const chapter = [...CHAPTERS, ...CHALLENGES].find((c) => c.id === save.chapter);
  const daysPlayed = save.startHour !== undefined ? (save.state.hour - save.startHour) / 24 : 0;
  const loaded = upgradeState(save.state, mapFor(save.state));
  // nur Kampagnenkapitel wurden umgebaut, Herausforderungen behalten ihre Nummern
  const remap = !!chapter && (!!save.completedTexts || save.mode === 'kampagne');
  const completed = remap ? restoreCompleted(loaded, chapter!.goals, save.completedGoals, save.completedTexts) : new Set(save.completedGoals);
  startGame(loaded, {
    mode: save.mode,
    chapter,
    completed,
    finished:
      (!!chapter && completed.size >= chapter.goals.length) ||
      (save.mode === 'tagesmarkt' && daysPlayed >= DAILY_DAYS) ||
      (save.mode === 'herausforderung' && !!chapter?.deadlineDays && daysPlayed >= chapter.deadlineDays),
    startHour: save.startHour,
    dailyDay: save.dailyDay,
    dailyScored: save.dailyScored === true,
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
const daysPlayed = () => Math.floor((state.hour - (session.startHour ?? state.hour)) / 24);

function checkGoals(silent = false): void {
  if (inGame) for (const a of newAchievements(state, achieved)) unlock(a.id);
  if (session.mode === 'tagesmarkt' && !session.finished) {
    checkDaily();
    return;
  }
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
  const challenge = session.mode === 'herausforderung';
  const left = challenge && c.deadlineDays ? c.deadlineDays - daysPlayed() : null;
  hud.renderGoals(
    challenge ? `${c.title} · noch ${Math.max(0, left ?? 0)} Tage` : `Kapitel ${c.number}: ${c.title}`,
    c.goals.map((g, i) => {
      const p = goalProgress(state, g);
      const done = session.completed.has(i);
      const binary = ['profit', 'townLevel', 'rank', 'project'].includes(g.type);
      const unit = g.type === 'supply' ? ' %' : '';
      const progressText = binary ? '' : `${fmtNum(Math.min(p.value, p.target))} / ${fmtNum(p.target)}${unit}`;
      return { text: g.text, done, progress: progressText };
    }),
  );
  if (challenge) {
    const won = session.completed.size === c.goals.length;
    if (!won && (left === null || left > 0)) return;
    session.finished = true;
    running = false;
    hud.renderGoals(null, []);
    if (won) {
      const days = daysPlayed();
      const best = progress.challenges![c.id];
      if (best === undefined || days < best) progress.challenges![c.id] = days;
      saveJson('progress', progress);
      unlock('herausforderer');
      if (CHALLENGES.every((x) => progress.challenges![x.id] !== undefined)) unlock('meister');
      sfx('stempel');
    } else sfx('fehler');
    saveSlot('auto');
    menu.showChallengeEnd(c, won, daysPlayed());
    return;
  }
  if (session.completed.size === c.goals.length) {
    session.finished = true;
    if (!CHAPTERS.some((x) => x.number === c.number + 1)) unlock('chronist');
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

/** Tagesmarkt: Fortschritt zeigen und nach Ablauf abrechnen */
function checkDaily(): void {
  const played = daysPlayed();
  const worth = Math.round(playerWorth(state));
  if (played < DAILY_DAYS) {
    hud.renderGoals(`Tagesmarkt${session.dailyScored ? '' : ' (Übung)'} · Tag ${played + 1} von ${DAILY_DAYS}`, [
      { text: `Vermögen ${fmtNum(worth)} Taler`, done: false, progress: `Kasse, Schiffe, Kontore und Ladung` },
      { text: `Noch ${DAILY_DAYS - played} Tage bis zur Abrechnung`, done: false, progress: '' },
    ]);
    return;
  }
  session.finished = true;
  running = false;
  hud.renderGoals(null, []);
  const day = session.dailyDay ?? '';
  // Gewertet ist nur der erste Versuch des Tages, Übungsrunden ändern das Ergebnis nicht
  if (session.dailyScored && progress.daily![day] === undefined) {
    progress.daily![day] = worth;
    progress.dailyPending = { day, worth };
  }
  saveJson('progress', progress);
  saveSlot('auto');
  sfx('stempel');
  void screens.finishDaily(day, worth, !!session.dailyScored);
}

// --- Ereignisse ---
let lastSeason: Season | null = null;
const SEASON_HINT: Record<Season, string> = {
  fruehling: 'Hochwasser: schnelle Talfahrt, aber hohe Schiffe kommen unter Brücken schlechter durch.',
  sommer: 'Niedrigwasser: tiefe Kähne nur mit halber Ladung, flache Boote sind jetzt Gold wert.',
  herbst: 'Normales Wasser und Erntezeit, die beste Zeit zum Handeln.',
  winter: 'Bald frieren die Bäche und der Oberlauf zu. Wer jetzt nicht liefert, muss bis zum Frühjahr warten.',
};

const epochMusic = (e: number) => (e >= 3 ? 'epoche3' : e === 2 ? 'epoche2' : 'epoche1');

function handleEvents(events: GameEvent[]): void {
  let changed = false;
  // die Bank kann bei einer Pfändung das gewählte Schiff nehmen
  if (!current()) selected = state.ships[0]?.id ?? -1;
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
      showCanal();
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
  for (const def of MAP.towns) {
    const t = state.towns[def.id];
    townViews.get(def.id)!.setPopulation(t.population);
    const label = townLabels.get(def.id)!;
    const html = `${def.name}<small>${LEVELS[levelOf(t.population)].name}</small>`;
    if (label.innerHTML !== html) label.innerHTML = html;
  }
}

function refresh(): void {
  hud.setHint(tutorialHint());
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
// Farbstimmung je Epoche, gleitend überblendet (epochmood.ts)
let moodEpoch = 1;
const mood = moodAt(1);

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

  moodAt(moodEpoch, mood);
  const sky = tmpA.setHex(SKY[s]).lerp(tmpB.setHex(SKY[next]), f).lerp(mood.sky, mood.skyMix);
  (stage.scene.background as THREE.Color).copy(sky);
  stage.scene.fog?.color.copy(sky);
  if (stage.scene.fog instanceof THREE.Fog) {
    stage.scene.fog.near = BASE_FOG.near * mood.fog;
    stage.scene.fog.far = BASE_FOG.far * mood.fog;
  }
  stage.sun.color.setHex(SUN[s]).lerp(tmpB.setHex(SUN[next]), f).lerp(mood.sun, mood.sunMix);
  stage.hemi.color.copy(mood.hemiSky);
  stage.hemi.groundColor.copy(mood.hemiGround);
  stage.postfx.setWarmth(WARMTH[s] + (WARMTH[next] - WARMTH[s]) * f);
  stage.postfx.setMood(mood.saturation, mood.contrast, mood.tint);
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Tagesmarkt: Konkurrenz rückt in ganzen Stunden vor; für die Anzeige den Bruchteil der Stunde dazurechnen */
function rivalShown(v: Voyage): { voyage: Voyage } {
  if (state.fairSeed === undefined) return { voyage: v };
  const frac = state.hour - Math.floor(state.hour);
  return { voyage: { ...v, elapsed: Math.min(v.hours, v.elapsed + frac) } };
}

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
  // bewusst leise: der Fluss soll Hintergrund sein, kein Rauschen im Vordergrund
  ambient({
    flow: state.ice ? 0.05 : Math.min(0.4, 0.18 + Math.max(-0.3, state.waterLevel) * 0.12),
    wind: Math.min(0.35, wind(state) / 3.5),
    birds: night ? 0 : BIRDS[s],
  });
}

// --- Schleife ---
const timer = new THREE.Timer();
let uiTick = 0;

const camAim = new THREE.Vector3();
const camRight = new THREE.Vector3();
const ledgerEl = document.querySelector<HTMLElement>('.ledger')!;

function frame(): void {
  timer.update();
  const dt = Math.min(0.1, timer.getDelta());

  if (inGame && running && !menu.open && timeScale > 0) {
    handleEvents(advance(state, MAP, dt * HOURS_PER_SECOND * timeScale));
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
      if (ship.voyage) placeOnVoyage(rivalShown(ship.voyage), view);
      else if (!view.docked) rivalDocked = true;
      view.update(dt);
    }
  }
  if (rivalDocked) syncViews();
  estates.update(dt, wind(state));

  moodEpoch = easeEpoch(moodEpoch, state.epoch, dt);
  updateSeasonVisuals();
  land.update(dt, 0.012 * (1 + Math.max(0, state.waterLevel) * 0.35));

  const sel = views.get(selected);
  if (inGame && follow && sel) {
    camOffset.subVectors(stage.camera.position, stage.controls.target);
    // Das Kontorbuch rechts verdeckt einen Teil des Bildes: Schiff in die Mitte der freien Fläche rücken
    camAim.copy(sel.group.position);
    const panel = ledgerEl.offsetWidth;
    const h = viewport.clientHeight;
    if (window.innerWidth > 720 && panel > 0 && h > 0) {
      const worldPerPx = (2 * camOffset.length() * Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2))) / h;
      camRight.setFromMatrixColumn(stage.camera.matrixWorld, 0).setY(0).normalize();
      camAim.addScaledVector(camRight, (panel / 2 + 12) * worldPerPx);
    }
    stage.controls.target.lerp(camAim, 1 - Math.exp(-dt * 2));
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
      handleEvents(advance(state, MAP, n * 24));
      refresh();
    },
    money(n: number) {
      state.money = n;
      refresh();
    },
  };
}

refresh();
if (!pending || !startSave(pending)) menu.showMain();
bootedWithPending = false;
requestAnimationFrame(frame);
