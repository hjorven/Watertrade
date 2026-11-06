import { BUILDING_BY_ID, BUILDINGS, betriebUpkeep, KONTOR_CAPACITY, KONTOR_PRICE, KONTOR_SLOTS, KONTOR_UPGRADE } from '../data/buildings.ts';
import { CAPTAIN_RANKS, captainRank, traitText } from '../data/captains.ts';
import { fairWage, LOYALTY_POACH, LOYALTY_WARN } from '../sim/captains.ts';
import { GOOD_BY_ID, GOODS } from '../data/goods.ts';
import type { MapDef, TownDef } from '../data/maps/valley.ts';
import { RIVAL_BY_ID } from '../data/rivals.ts';
import { EPOCHS, SHIPS, UPGRADES } from '../data/ships.ts';
import { dayInSeason, season, SEASON_NAME, SEASONS, year } from '../sim/calendar.ts';
import { MAX_ACCEPTED, PENALTY } from '../sim/contracts.ts';
import { buyPrice, sellPrice } from '../sim/economy.ts';
import { describeEvent, describeForecast, EVENT_TITLE, visibleForecasts } from '../sim/events.ts';
import { epochProgress, epochProgressText } from '../sim/epochs.ts';
import { hasYard, repairCost, timberPlan, upgradeCost } from '../sim/fleet.ts';
import {
  bunkerPlan,
  capacityOf,
  cargoLoad,
  day,
  effectiveDraft,
  kontorSpace,
  planVoyage,
  RAFT_TIMBER,
  sellFactorAt,
  shipAllowed,
  shipClass,
  voyagePosition,
  wind,
  type GameState,
  type OrderKind,
  type Ship,
  type TradeResult,
  type Voyage,
  effectiveSegments,
} from '../sim/game.ts';
import { PROJECTS } from '../data/projects.ts';
import { daysLeft, projectState } from '../sim/works.ts';
import { HARBOR_LEVELS, LIGHTER_FEE } from '../data/harbors.ts';
import {
  berths,
  dredgeCost,
  FEE_LABEL,
  feeSum,
  harborCost,
  harborDaysLeft,
  harborOf,
  harborPartner,
  nextHarborLevel,
  ownerName,
  partnerOffer,
  passageFee,
  quayDepth,
  upkeepCost,
} from '../sim/wasserbau.ts';
import { sailingHours } from '../sim/voyage.ts';
import { betriebeIn, buildingAllowed, kontorUpkeepIn, playerWorth } from '../sim/house.ts';
import { rivalWorth } from '../sim/rivals.ts';
import { renderRivalry } from './rivalry.ts';
import { BLOCK_TEXT, segmentDepth } from '../sim/river.ts';
import { goodPicker, priceBookPanel, shipBook } from './market-info.ts';
import { GROWTH_THRESHOLD, LEVELS, levelOf, netFlow, nextLevelNeeds } from '../sim/towns.ts';
import {
  activePlan,
  conditionText,
  DEFAULT_WINTER_SEASONS,
  fmtLevel,
  hasWinterPlan,
  LOAD_RETRY_HOURS,
  MAX_LOAD_WAIT_HOURS,
  PLAN_NAME,
  ROUTE_BOOK_DAYS,
  routeProfit,
  stopSkipped,
  stopsOf,
  winterSeasonsOf,
} from '../sim/routes.ts';
import type { RoutePlan, TradeRoute } from '../sim/state.ts';

/** Frische verderblicher Ware als kurzer Hinweis, etwa "Frische 82 %" */
function freshText(slot: { fresh?: number } | undefined): string {
  if (!slot || slot.fresh === undefined || slot.fresh > 0.995) return '';
  return `Frische ${Math.round(slot.fresh * 100)} %`;
}

export interface HudActions {
  select(shipId: number): void;
  buy(good: string, amount: number): void;
  sell(good: string, amount: number): void;
  depart(to: string): void;
  wait(): void;
  buyShip(type: string): void;
  dismantle(): void;
  speed(factor: number): void;
  menu(): void;
  /** Alle weiteren Befehle: Kontor, Werft, Kneipe, Route, Aufträge */
  command(cmd: string, data: Record<string, string | number>): void;
}

export type View = 'ship' | 'register' | 'news' | 'contracts' | 'works' | 'map';
export type Tab = 'markt' | 'kontor' | 'werft' | 'kneipe' | 'route' | 'buch';

/** Was gerade sichtbar ist; die Kampagne schaltet Reiter und Bücher nach und nach frei */
export interface HudFeatures {
  tabs: Tab[];
  views: View[];
}
export const ALL_FEATURES: HudFeatures = {
  tabs: ['markt', 'kontor', 'werft', 'kneipe', 'route'],
  views: ['ship', 'register', 'news', 'contracts', 'works', 'map'],
};

const fmtHours = (h: number) => {
  if (h >= 48) return `${(h / 24).toFixed(1).replace('.', ',')} Tage`;
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min === 0 ? `${whole} Std` : `${whole} Std ${min} Min`;
};

const m1 = (x: number) => x.toFixed(1).replace('.', ',');

/** Warnung im Hafen, wenn das Schiff für den Kai zu tief geht: Umschlag dann über Schuten */
function quayWarning(state: GameState, ship: Ship, town: string): string {
  const quay = quayDepth(state, town);
  const now = effectiveDraft(ship);
  const full = effectiveDraft({ ...ship, cargo: { _: { amount: capacityOf(ship), cost: 0 } } });
  const how = `Umschlag über Schuten: halb so schnell und ${LIGHTER_FEE.toLocaleString('de-DE')} Taler je Tonne Leichtergeld. Ein ausgebauter Hafen (Wasserbau, Kaimauer) hilft.`;
  if (now > quay) return `<p class="note warn"><b>Zu tief für den Kai:</b> ${m1(now)} m Tiefgang, nur ${m1(quay)} m Wasser am Kai. ${how}</p>`;
  if (full > quay) return `<p class="note warn"><b>Voll beladen zu tief für den Kai:</b> ${m1(full)} m Tiefgang, nur ${m1(quay)} m Wasser am Kai. ${how}</p>`;
  return '';
}

/** Hinweis, solange ein Schiff zu Beginn oder am Ende einer Fahrt am Anleger umschlägt */
const dockNote = (v: Voyage) => {
  const lighter = v.fees?.some((f) => f.work === 'leichtern') ? ' über Schuten (zu tief für den Kai)' : '';
  if (v.dock && v.elapsed < v.dock) return `<p class="note">Wird noch${lighter} beladen, legt in ${fmtHours(v.dock - v.elapsed)} ab.</p>`;
  if (v.dockEnd && v.elapsed > v.hours - v.dockEnd) return `<p class="note">Liegt am Kai und wird${lighter} gelöscht.</p>`;
  return '';
};

const clock = (hour: number) => {
  const h = Math.floor(hour % 24);
  const m = Math.floor((hour % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const windText = (w: number) => (w > 1 ? 'frisch' : w > 0.7 ? 'mäßig' : w > 0.45 ? 'schwach' : 'Flaute');
const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');

const ORDER_TEXT: Record<OrderKind, string> = {
  kaufen: 'Kaufen',
  verkaufen: 'Verkaufen',
  einlagern: 'Ins Kontor',
  auslagern: 'Aus dem Kontor',
};

const lastHtml = new WeakMap<HTMLElement, string>();
function setHtml(el: HTMLElement, html: string): void {
  if (lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  el.innerHTML = html;
}

/**
 * Beim Neuzeichnen offene Klappfelder und angefangene Eingaben in Blöcken mit data-keep erhalten
 * (Routen-Editor), sonst klappt das Bedingungen-Feld während der Fahrt ständig zu.
 */
function keepForms(root: HTMLElement, redraw: () => void): void {
  const kept = new Map<string, { open: boolean; values: Map<string, string> }>();
  root.querySelectorAll<HTMLElement>('[data-keep]').forEach((el) => {
    const values = new Map<string, string>();
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name][data-dirty]').forEach((f) => values.set(f.name, f.value));
    kept.set(el.dataset.keep!, { open: !!el.querySelector('details[open]'), values });
  });
  const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused?.closest<HTMLElement>('[data-keep]')?.dataset.keep;
  const focusName = focused?.getAttribute('name');
  const before = root.firstElementChild;
  redraw();
  if (!kept.size || root.firstElementChild === before) return;
  root.querySelectorAll<HTMLElement>('[data-keep]').forEach((el) => {
    const k = kept.get(el.dataset.keep!);
    if (!k) return;
    if (k.open) el.querySelector('details')?.setAttribute('open', '');
    for (const [name, value] of k.values) {
      const f = el.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
      if (f) {
        f.value = value;
        f.dataset.dirty = '1';
      }
    }
    if (el.dataset.keep === focusKey && focusName) el.querySelector<HTMLElement>(`[name="${focusName}"]`)?.focus();
  });
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const goodName = (id: string) => GOOD_BY_ID.get(id)?.name ?? id;
const swatch = (id: string) => `<span class="swatch" style="background:${hex(GOOD_BY_ID.get(id)?.color ?? 0x999999)}"></span>`;
const flows = (r: Record<string, number>) =>
  Object.entries(r)
    .map(([g, n]) => `${n} ${goodName(g)}`)
    .join(' + ');

export interface MapData {
  viewBox: string;
  rivers: { path: string; width: number }[];
  towns: Record<string, { x: number; y: number }>;
  segMid: Record<string, { x: number; y: number }>;
  shipPos(ship: { port: string | null; voyage: Voyage | null }): { x: number; y: number } | null;
}

export class Hud {
  private readonly top: HTMLElement;
  private readonly fleet: HTMLElement;
  private readonly body: HTMLElement;
  private readonly root: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly goals: HTMLElement;
  private readonly navBadges: Record<string, HTMLElement>;
  private readonly map: MapDef;
  private readonly actions: HudActions;
  private speedFactor = 1;
  private view: View = 'ship';
  private tab: Tab = 'markt';
  /** Welcher Plan im Routen-Reiter bearbeitet wird */
  private routePlan: RoutePlan = 'sommer';
  private newsSeen = '';
  private newsKey = '';

  constructor(root: HTMLElement, map: MapDef, actions: HudActions) {
    this.map = map;
    this.actions = actions;
    root.insertAdjacentHTML(
      'beforeend',
      `
      <header class="topbar">
        <div class="brand">Flussreich</div>
        <div class="stats"></div>
        <nav class="views" aria-label="Bücher">
          <button class="btn" data-act="view" data-view="contracts">Aufträge<i class="badge" data-badge="contracts"></i></button>
          <button class="btn" data-act="view" data-view="news">Flussbote<i class="badge" data-badge="news"></i></button>
          <button class="btn" data-act="view" data-view="works">Wasserbau</button>
          <button class="btn" data-act="view" data-view="register">Register</button>
          <button class="btn" data-act="view" data-view="map">Karte</button>
        </nav>
        <button class="btn menu-btn" data-act="menu" aria-label="Menü">Menü</button>
        <div class="speed" role="group" aria-label="Tempo">
          <button class="btn" data-act="speed" data-factor="0" aria-label="Pause">II</button>
          <button class="btn on" data-act="speed" data-factor="1">1×</button>
          <button class="btn" data-act="speed" data-factor="4">4×</button>
        </div>
      </header>
      <aside class="ledger">
        <button class="fold" data-act="fold" aria-label="Kontorbuch ein- oder ausklappen" title="Kontorbuch ein- oder ausklappen"></button>
        <section class="goals"></section>
        <div class="hint" hidden></div>
        <nav class="fleet" aria-label="Flotte"></nav>
        <div class="ledger-body" aria-live="polite"></div>
      </aside>
      <div class="toasts"></div>
`,
    );
    this.top = root.querySelector('.topbar .stats')!;
    this.fleet = root.querySelector('.fleet')!;
    this.body = root.querySelector('.ledger-body')!;
    this.root = root;
    this.toasts = root.querySelector('.toasts')!;
    this.goals = root.querySelector('.goals')!;
    this.navBadges = {
      contracts: root.querySelector('[data-badge="contracts"]')!,
      news: root.querySelector('[data-badge="news"]')!,
    };

    // angefangene Eingaben im Routen-Editor merken, damit sie das Neuzeichnen überstehen
    const markDirty = (ev: Event) => {
      const f = ev.target as HTMLElement;
      if (f.getAttribute('name') && f.closest('[data-keep]')) f.dataset.dirty = '1';
    };
    root.addEventListener('input', markDirty);
    root.addEventListener('change', markDirty);

    root.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!btn || btn.disabled) return;
      const d = btn.dataset;
      const amount = d.n === 'all' ? Infinity : Number(d.n);
      switch (d.act) {
        case 'select':
          this.view = 'ship';
          this.actions.select(Number(d.ship));
          break;
        case 'buy':
          this.actions.buy(d.good!, amount);
          break;
        case 'sell':
          this.actions.sell(d.good!, amount);
          break;
        case 'depart':
          this.actions.depart(d.to!);
          break;
        case 'wait':
          this.actions.wait();
          break;
        case 'buyship':
          this.actions.buyShip(d.type!);
          break;
        case 'dismantle':
          this.actions.dismantle();
          break;
        case 'speed':
          this.speedFactor = Number(d.factor);
          this.root.querySelectorAll<HTMLButtonElement>('.speed .btn').forEach((b) =>
            b.classList.toggle('on', Number(b.dataset.factor) === this.speedFactor),
          );
          this.actions.speed(this.speedFactor);
          break;
        case 'menu':
          this.actions.menu();
          break;
        case 'goals':
          this.goalsOpen = !this.goalsOpen;
          this.goals.classList.toggle('all', this.goalsOpen);
          break;
        case 'fold':
          this.folded = !this.folded;
          this.root.querySelector('.ledger')!.classList.toggle('folded', this.folded);
          break;
        case 'hintClose':
          this.hintDismissed = this.hintText;
          this.setHint(this.hintText);
          break;
        case 'view': {
          const v = d.view as View;
          this.view = this.view === v ? 'ship' : v;
          if (this.view === 'news') this.newsSeen = this.newsKey;
          this.actions.command('refresh', {});
          break;
        }
        case 'bookGood':
          // im Markt-Reiter klappt ein Klick auf die Ware das Preisbuch auf und wieder zu
          if (this.tab === 'markt') {
            this.marketGood = this.marketGood === d.good ? null : d.good!;
            this.bookTown = null;
          }
          this.bookGood = d.good!;
          this.actions.command('refresh', {});
          break;
        case 'bookTown':
          this.bookTown = d.town!;
          this.actions.command('refresh', {});
          break;
        case 'tab':
          this.tab = d.tab as Tab;
          this.bookTown = null;
          this.actions.command('refresh', {});
          break;
        case 'routePlan':
          this.routePlan = d.plan === 'winter' ? 'winter' : 'sommer';
          this.actions.command('refresh', {});
          break;
        case 'cmd': {
          // nach dem Löschen verschieben sich die Halte: gemerkte Eingaben verwerfen
          if (d.cmd === 'routeDelStop' || d.cmd === 'routeClear' || d.cmd === 'routeCopyPlan')
            root.querySelectorAll<HTMLElement>('[data-dirty]').forEach((f) => delete f.dataset.dirty);
          const data: Record<string, string | number> = {};
          for (const [k, v] of Object.entries(d)) if (k !== 'act' && k !== 'cmd' && v !== undefined) data[k] = v;
          // Formularfelder im selben Block mitschicken (Routen-Editor)
          const form = btn.closest('[data-form]');
          form?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name]').forEach((f) => (data[f.name] = f.value));
          this.actions.command(d.cmd!, data);
          break;
        }
      }
    });
  }

  private goalsOpen = false;
  private folded = false;
  /** Preisbuch: gewählte Ware und Stadt; im Markt-Reiter die aufgeklappte Ware */
  private bookGood: string | null = null;
  private bookTown: string | null = null;
  private marketGood: string | null = null;
  private features: HudFeatures = ALL_FEATURES;
  private hintText: string | null = null;
  private hintDismissed: string | null = null;

  /** Reiter und Bücher ein- und ausblenden */
  setFeatures(f: HudFeatures): void {
    this.features = f;
    this.root.querySelectorAll<HTMLButtonElement>('.views .btn').forEach((b) => {
      b.hidden = !f.views.includes(b.dataset.view as View);
    });
    if (!f.views.includes(this.view)) this.view = 'ship';
  }

  /** Kurzer Hinweis über der Flotte, zum Beispiel der nächste Schritt im ersten Kapitel */
  setHint(text: string | null): void {
    this.hintText = text;
    const el = this.root.querySelector<HTMLElement>('.hint')!;
    const show = !!text && text !== this.hintDismissed;
    el.hidden = !show;
    if (show) setHtml(el, `<span>${text}</span><button class="link" data-act="hintClose" aria-label="Hinweis schließen">ok</button>`);
  }

  /** Ziele des Kapitels; null blendet die Liste aus (freies Spiel) */
  renderGoals(title: string | null, goals: { text: string; done: boolean; progress: string }[]): void {
    if (!title) {
      setHtml(this.goals, '');
      return;
    }
    const done = goals.filter((g) => g.done).length;
    setHtml(
      this.goals,
      `<button class="goals-head" data-act="goals" title="Alle Ziele zeigen"><span>${title}</span><small>${done}/${goals.length} Ziele ${this.goalsOpen ? '▴' : '▾'}</small></button>
      <ul class="goal-list">${goals
        .map((g, i) => {
          // eingeklappt: nur die nächsten zwei offenen Ziele
          const rank = goals.slice(0, i).filter((x) => !x.done).length;
          const extra = g.done || rank >= 2 ? ' extra' : '';
          return `<li class="${g.done ? 'done' : ''}${extra}">${g.text}${g.done || !g.progress ? '' : `<small>${g.progress}</small>`}</li>`;
        })
        .join('')}</ul>`,
    );
  }

  showView(v: View): void {
    this.view = v;
  }

  render(state: GameState, selected: number): void {
    const w = wind(state);
    // angekündigte Wetterlagen (nur mit Pegelstation sichtbar) stehen mit in der Lage
    const ahead = visibleForecasts(state);
    const lage = [...state.events.map((e) => EVENT_TITLE[e.kind]), ...ahead.map((e) => `${EVENT_TITLE[e.kind]} (angekündigt)`)];
    const lageTitle = [...state.events.map((e) => describeEvent(this.map, e)), ...ahead.map((e) => describeForecast(state, e))].join('\n');
    const events = lage.length ? `<span class="hide-narrow event-chip" title="${lageTitle}"><small>Lage</small><b>${lage.join(', ')}</b></span>` : '';
    setHtml(
      this.top,
      `
      <span><small>Kasse</small><b>${fmt(state.money)} Taler</b></span>
      <span title="${epochProgressText(state)}"><small>${SEASON_NAME[season(day(state))]} · Jahr ${year(day(state))}</small><b>${dayInSeason(day(state))}. Tag, ${clock(state.hour)}</b></span>
      <span class="river-stat" title="Pegel und Wind bestimmen, welche Schiffe wie schnell fahren"><small>Fluss</small><b>${state.waterLevel >= 0 ? '+' : '−'}${Math.abs(state.waterLevel).toFixed(1).replace('.', ',')} m${state.ice ? ', Eis' : ''} · Wind ${windText(w)}</b></span>${events}`,
    );
    this.newsKey = state.news[0] ? `${state.news[0].day}|${state.news[0].text}` : '';
    if (this.view === 'news') this.newsSeen = this.newsKey;
    this.navBadges.news.textContent = this.newsKey && this.newsKey !== this.newsSeen ? '•' : '';
    const offers = state.contracts.filter((c) => !c.accepted).length;
    this.navBadges.contracts.textContent = offers ? String(offers) : '';
    this.root.querySelectorAll<HTMLButtonElement>('.views .btn').forEach((b) => b.classList.toggle('on', b.dataset.view === this.view));

    this.root.querySelector('.ledger')!.classList.toggle('wide', this.view === 'map');
    const ship = state.ships.find((s) => s.id === selected) ?? state.ships[0];
    setHtml(this.fleet, ship ? this.renderFleet(state, ship) : '');
    if (this.view === 'register') return setHtml(this.body, this.renderRegister(state));
    if (this.view === 'news') return setHtml(this.body, this.renderNews(state));
    if (this.view === 'contracts') return setHtml(this.body, this.renderContracts(state, ship));
    if (this.view === 'works') return setHtml(this.body, this.renderWorks(state));
    if (this.view === 'map') return setHtml(this.body, this.mapHtml(state));
    if (!ship) {
      setHtml(this.body, `<div class="ledger-head"><h2>Keine Schiffe</h2><p>Deine Flotte ist leer.</p></div>`);
      return;
    }
    // Nur neu aufbauen, was sich geändert hat, sonst gehen Klicks während einer Fahrt verloren
    keepForms(this.body, () => setHtml(this.body, this.renderShip(state, ship)));
  }

  private townName(id: string): string {
    return this.map.towns.find((t) => t.id === id)?.name ?? id;
  }

  private renderFleet(state: GameState, current: Ship): string {
    return state.ships
      .map((s) => {
        const where = s.port ? `in ${this.townName(s.port)}` : `nach ${this.townName(s.voyage!.to)}`;
        const auto = s.route?.active ? '<i class="auto" title="fährt eine Handelsroute">R</i>' : '';
        return `<button class="chip ${s.id === current.id && this.view === 'ship' ? 'on' : ''}" data-act="select" data-ship="${s.id}">
          <b>${s.name}${auto}</b><small>${shipClass(s).name}, ${where}</small></button>`;
      })
      .join('');
  }

  /* ---------- Schiff: Reiter ---------- */

  private renderShip(state: GameState, ship: Ship): string {
    const tabs: [Tab, string][] = ship.port
      ? [
          ['markt', 'Markt'],
          ['kontor', 'Kontor'],
          ['werft', 'Werft'],
          ['kneipe', 'Kneipe'],
          ['route', 'Route'],
          ['buch', 'Bücher'],
        ]
      : [
          ['markt', 'Fahrt'],
          ['route', 'Route'],
          ['buch', 'Bücher'],
        ];
    const visible = tabs.filter(([t]) => t === 'markt' || t === 'buch' || this.features.tabs.includes(t));
    tabs.length = 0;
    tabs.push(...visible);
    if (!tabs.some(([t]) => t === this.tab)) this.tab = 'markt';
    const nav = `<nav class="tabs">${tabs
      .map(([t, label]) => `<button class="tab ${t === this.tab ? 'on' : ''}" data-act="tab" data-tab="${t}">${label}</button>`)
      .join('')}</nav>`;
    let body = '';
    if (this.tab === 'buch') body = this.renderBooks(state, ship);
    else if (!ship.port) body = this.tab === 'route' ? this.renderRoute(state, ship) : this.renderVoyage(state, ship);
    else if (this.tab === 'kontor') body = this.renderKontor(state, ship);
    else if (this.tab === 'werft') body = this.renderYard(state, ship);
    else if (this.tab === 'kneipe') body = this.renderTavern(state, ship);
    else if (this.tab === 'route') body = this.renderRoute(state, ship);
    else body = this.renderPort(state, ship);
    return nav + body;
  }

  private portHead(town: TownDef, stamp: string): string {
    return `<div class="ledger-head">
        <div class="stamp-small">${stamp}</div>
        <h2>${town.name}</h2>
        <p>${town.description}</p>
      </div>`;
  }

  private renderPort(state: GameState, ship: Ship): string {
    const town = this.map.towns.find((t) => t.id === ship.port)!;
    const market = state.markets[town.id];
    const cap = capacityOf(ship);
    const load = cargoLoad(ship);
    const full = load >= cap;
    const kontor = state.kontore[town.id];

    const goods = GOODS.filter((g) => market[g.id] || ship.cargo[g.id]);
    const rows = goods
      .map((g) => {
        const m = market[g.id];
        const slot = ship.cargo[g.id];
        const aboard = slot?.amount ?? 0;
        const avg = slot ? Math.round(slot.cost / slot.amount) : null;
        if (!m) {
          return `<tr class="muted"><th scope="row">${swatch(g.id)}${g.name}<small>hier kein Handel</small></th>
            <td class="num">–</td><td class="num">–</td><td class="num">${aboard}</td><td></td></tr>`;
        }
        const bp = buyPrice(g.base, m);
        const sp = Math.floor((sellPrice(g.base, m) / 0.9) * sellFactorAt(state, town.id));
        const margin = avg === null ? '' : sp > avg ? 'gain' : sp < avg ? 'loss' : '';
        const canBuy = !full && m.stock >= 1 && state.money >= bp;
        const flow = netFlow(town, g.id, state.towns[town.id]);
        const role = flow > 0 ? 'Überschuss' : flow < 0 ? 'Bedarf' : '';
        return `
        <tr>
          <th scope="row"><button class="link goodlink ${this.marketGood === g.id ? 'on' : ''}" data-act="bookGood" data-good="${g.id}" title="Preisbuch und Verlauf">${swatch(g.id)}${g.name}</button><small>${Math.floor(m.stock)} t${role ? ` · ${role}` : ''}</small></th>
          <td class="num">${bp}</td>
          <td class="num ${margin}">${sp}${avg !== null ? `<small>ø ${avg}</small>` : ''}</td>
          <td class="num">${aboard}${freshText(slot) ? `<small>${freshText(slot)}</small>` : ''}</td>
          <td class="acts trade">
            <button class="btn" data-act="buy" data-good="${g.id}" data-n="1" ${canBuy ? '' : 'disabled'} title="1 t kaufen">+1</button>
            <button class="btn" data-act="buy" data-good="${g.id}" data-n="10" ${canBuy ? '' : 'disabled'} title="10 t kaufen">+10</button>
            ${aboard ? `<button class="btn sellall" data-act="sell" data-good="${g.id}" data-n="all" title="alles verkaufen">Verkaufen</button>` : ''}
          </td>
        </tr>`;
      })
      .join('');

    const departures = this.map.towns
      .filter((t) => t.id !== town.id)
      .map((t) => {
        const plan = planVoyage(state, this.map, ship.id, t.id);
        if (!plan) return '';
        if (!plan.ok) {
          const why = plan.reasons.map((r) => r.reason).filter((r, i, a) => a.indexOf(r) === i).map((r) => BLOCK_TEXT[r]);
          return `<button class="btn dest" disabled><b>${t.name}</b><small>${why.join(', ') || 'kein Weg'}</small></button>`;
        }
        const v = plan.voyage;
        const dir = v.legs.every((l) => l.downstream) ? 'talwärts' : v.legs.every((l) => !l.downstream) ? 'bergwärts' : 'tal- und bergwärts';
        const fees = feeSum(v.fees);
        const tow = v.towFee ?? 0;
        const zoll = (v.toll ?? 0) - fees - tow;
        const toll = `${zoll ? `, Zoll ${zoll}` : v.evaded ? `, ${v.evaded} Zoll umgangen, Kontrolle möglich` : ''}${fees ? `, Gebühren ${fees}` : ''}${tow ? `, Treidelgeld ${tow}` : ''}`;
        const dockH = (v.dock ?? 0) + (v.dockEnd ?? 0);
        const lighter = v.fees?.some((f) => f.work === 'leichtern') ? ', muss leichtern' : '';
        const dockText = (dockH >= 0.5 ? ` (davon ${fmtHours(dockH)} Laden und Löschen)` : '') + lighter;
        const coal = bunkerPlan(state, ship, sailingHours(v), v.toll ?? 0);
        if (coal.problem) return `<button class="btn dest" disabled title="${coal.problem}"><b>${t.name}</b><small>${coal.buy ? `${coal.buy} t Kohle fehlen` : 'Bunker zu klein'}</small></button>`;
        const coalText = coal.need ? `, Kohle ${String(coal.need).replace('.', ',')} t${coal.fromKontor ? `, ${coal.fromKontor} t aus dem Kontor` : ''}${coal.buy ? `, bunkert ${coal.buy} t für ${coal.cost} Taler` : ''}` : '';
        const tooDear = (v.toll ?? 0) + coal.cost > state.money;
        return `<button class="btn dest" data-act="depart" data-to="${t.id}" ${tooDear ? 'disabled' : ''}><b>${t.name}</b><small>${dir}, ${fmtHours(v.hours)}${dockText}${toll}${coalText}</small></button>`;
      })
      .join('');

    const industries = town.industries.length
      ? `<p class="note">Betriebe der Stadt: ${town.industries.map((i) => `${i.name} (${flows(i.inputs)} → ${flows(i.outputs)})`).join(', ')} pro Tag</p>`
      : '';

    const raft =
      ship.type === 'floss'
        ? `<button class="btn primary wide" data-act="dismantle" ${load > 0 ? 'disabled' : ''}>Floß zerlegen und als Holz verkaufen
            <small>${load > 0 ? 'Erst die Ladung verkaufen' : `${RAFT_TIMBER} t Holz${market.holz ? '' : ', hier kauft aber niemand Holz'}`}</small></button>`
        : '';

    const cls = shipClass(ship);
    const bunker = cls.coal ? ` · Bunker <b>${Math.floor(ship.bunker ?? 0)}/${cls.bunker} t</b> Kohle` : '';
    const bunkerBtn =
      cls.coal && (market.kohle || (kontor?.stock.kohle?.amount ?? 0) >= 1) && (ship.bunker ?? 0) < (cls.bunker ?? 0) - 1
        ? `<button class="btn wide" data-act="cmd" data-cmd="bunker">Bunker füllen<small>${(kontor?.stock.kohle?.amount ?? 0) >= 1 ? 'Erst eigene Kohle aus dem Kontor, dann vom Markt' : 'Kohle vom Markt für Häfen ohne Kohlehandel'}</small></button>`
        : '';

    const here = state.contracts.filter((c) => c.accepted && c.town === town.id);
    const contracts = here.length
      ? `<div class="contract-box"><h3>Aufträge für ${town.name}</h3>${here
          .map((c) => {
            const aboard = ship.cargo[c.good]?.amount ?? 0;
            return `<div class="contract-row">${swatch(c.good)}<span>${c.amount - c.delivered} t ${goodName(c.good)} für ${fmt(c.reward)} Taler<small>bis Tag ${c.deadline}</small></span>
              <button class="btn primary" data-act="cmd" data-cmd="deliver" data-id="${c.id}" ${aboard ? '' : 'disabled'}>Liefern</button></div>`;
          })
          .join('')}</div>`
      : '';

    return `
      ${this.portHead(town, kontor ? 'Eigenes Kontor' : 'Hafen')}
      ${this.renderTownInfo(state, town, industries)}
      ${contracts}
      <p class="note">Laderaum <b>${load}/${cap} t</b> · Tiefgang ${effectiveDraft(ship).toFixed(1).replace('.', ',')} m${kontor ? ' · Kontorbonus' : ''}${bunker}</p>
      ${quayWarning(state, ship, town.id)}
      ${bunkerBtn}
      <table class="market">
        <thead><tr><th>Ware</th><th title="Preis je Tonne beim Kauf">Kauf</th><th title="Preis je Tonne beim Verkauf">Verkauf</th><th>Bord</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${this.marketGood && market[this.marketGood] ? priceBookPanel(state, this.map, this.marketGood, this.bookTown ?? town.id) : '<p class="note">Tipp: Auf eine Ware tippen zeigt Preisbuch und Preisverlauf.</p>'}
      ${raft}
      <h3>Ablegen nach</h3>
      <div class="dests">${departures}</div>
      <button class="btn wide" data-act="wait">Einen Tag warten<small>Städte produzieren und verbrauchen</small></button>`;
  }

  private renderKontor(state: GameState, ship: Ship): string {
    const town = this.map.towns.find((t) => t.id === ship.port)!;
    const k = state.kontore[town.id];
    if (!k) {
      return `${this.portHead(town, 'Kontor')}
        <p>Ein eigenes Kontor ist Lager, Schreibstube und Bauplatz zugleich:</p>
        <ul class="plain">
          <li>${KONTOR_CAPACITY[1]} t Lager, Ware wartet hier auf bessere Preise</li>
          <li>Die Stadt zahlt dir 5 % mehr beim Verkauf</li>
          <li>Platz für eigene Betriebe, die mit dem Lager arbeiten</li>
          <li>Kapitäne auf Handelsrouten können hier ein- und auslagern</li>
        </ul>
        <p class="note">Unterhalt ${kontorUpkeepIn(state, town.id, 1)} Taler am Tag. Jedes weitere Kontor macht alle etwas teurer.</p>
        <button class="btn primary wide" data-act="cmd" data-cmd="buildKontor" ${state.money >= KONTOR_PRICE ? '' : 'disabled'}>Kontor bauen<small>${KONTOR_PRICE} Taler</small></button>`;
    }
    const used = Math.floor(cargoLoad({ cargo: k.stock }));
    const space = Math.floor(kontorSpace(state, town.id));
    const market = state.markets[town.id];
    const goods = GOODS.filter((g) => (k.stock[g.id]?.amount ?? 0) >= 1 || ship.cargo[g.id] || market[g.id]);
    const rows = goods
      .map((g) => {
        const inStock = Math.floor(k.stock[g.id]?.amount ?? 0);
        const aboard = ship.cargo[g.id]?.amount ?? 0;
        const m = market[g.id];
        const shipSpace = capacityOf(ship) - cargoLoad(ship);
        return `<tr>
          <th scope="row">${swatch(g.id)}${g.name}${m ? `<small>Markt ${buyPrice(g.base, m)} / ${Math.floor((sellPrice(g.base, m) / 0.9) * 0.95)}</small>` : ''}</th>
          <td class="num">${inStock}</td><td class="num">${aboard}</td>
          <td class="acts">
            <button class="btn" data-act="cmd" data-cmd="store" data-good="${g.id}" data-n="${aboard}" ${aboard && space ? '' : 'disabled'} title="vom Schiff ins Lager">Einlagern</button>
            <button class="btn" data-act="cmd" data-cmd="load" data-good="${g.id}" data-n="${inStock}" ${inStock && shipSpace ? '' : 'disabled'} title="aus dem Lager an Bord">An Bord</button>
            <button class="btn" data-act="cmd" data-cmd="kontorBuy" data-good="${g.id}" data-n="10" ${m && space && m.stock >= 1 ? '' : 'disabled'} title="10 t vom Markt ins Lager">+10</button>
            <button class="btn" data-act="cmd" data-cmd="kontorSell" data-good="${g.id}" data-n="${inStock}" ${m && inStock ? '' : 'disabled'} title="alles aus dem Lager verkaufen">Verkaufen</button>
          </td></tr>`;
      })
      .join('');

    const mine = betriebeIn(state, town.id);
    const slots = KONTOR_SLOTS[k.level];
    const betriebe = mine
      .map((b) => {
        const t = BUILDING_BY_ID.get(b.type)!;
        const pct = Math.round(b.lastShare * 100);
        return `<div class="yard-row">
          <div><b>${t.name}</b> <small>${t.inputs && Object.keys(t.inputs).length ? `${flows(t.inputs)} → ` : ''}${flows(t.outputs)} am Tag · Lohn ${t.wage}, Unterhalt ${betriebUpkeep(t)}</small>
          <small class="desc">${b.active ? `Auslastung gestern ${pct} %${pct < 100 && Object.keys(t.inputs).length ? ', es fehlt Rohware im Lager' : ''}` : 'ruht'}</small></div>
          <div class="row-btns">
            <button class="btn" data-act="cmd" data-cmd="toggleBetrieb" data-id="${b.id}">${b.active ? 'Ruhen' : 'Starten'}</button>
            <button class="btn" data-act="cmd" data-cmd="sellBetrieb" data-id="${b.id}" title="Abriss, die Hälfte zurück">Abriss</button>
          </div></div>`;
      })
      .join('');
    const options =
      mine.length < slots
        ? BUILDINGS.filter((b) => buildingAllowed(this.map, town.id, b.id))
            .map(
              (b) => `<div class="yard-row">
              <div><b>${b.name}</b> <small>${Object.keys(b.inputs).length ? `${flows(b.inputs)} → ` : ''}${flows(b.outputs)} am Tag · Lohn ${b.wage}, Unterhalt ${betriebUpkeep(b)}</small>
              <small class="desc">${b.description}</small></div>
              <button class="btn" data-act="cmd" data-cmd="buildBetrieb" data-type="${b.id}" ${state.money >= b.price ? '' : 'disabled'}>${fmt(b.price)} Taler</button></div>`,
            )
            .join('')
        : `<p class="note">Alle ${slots} Bauplätze belegt.${k.level < 3 ? ' Ein Ausbau des Kontors schafft Platz.' : ''}</p>`;
    const upgrade =
      k.level < 3
        ? `<button class="btn wide" data-act="cmd" data-cmd="upgradeKontor" ${state.money >= KONTOR_UPGRADE[k.level + 1] ? '' : 'disabled'}>Kontor ausbauen auf Stufe ${k.level + 1}
          <small>${fmt(KONTOR_UPGRADE[k.level + 1])} Taler: ${KONTOR_CAPACITY[k.level + 1]} t Lager, ${KONTOR_SLOTS[k.level + 1]} Bauplätze, Unterhalt ${kontorUpkeepIn(state, town.id, k.level + 1)} am Tag</small></button>`
        : '';
    return `${this.portHead(town, `Kontor Stufe ${k.level}`)}
      <div class="town-info"><span>Lager <b>${used}</b> von ${KONTOR_CAPACITY[k.level]} t · Bauplätze ${mine.length}/${slots} · Unterhalt ${kontorUpkeepIn(state, town.id)} am Tag</span>
      <div class="meter"><div style="width:${Math.round((used / KONTOR_CAPACITY[k.level]) * 100)}%"></div></div></div>
      <table class="market kontor">
        <thead><tr><th>Ware</th><th>Lager</th><th>Bord</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h3>Eigene Betriebe</h3>
      <div class="yard">${betriebe || '<p class="note">Noch keine. Betriebe nehmen Rohware aus dem Lager und legen ihre Erzeugnisse dort ab.</p>'}</div>
      ${mine.length < slots ? '<h3>Neuen Betrieb bauen</h3>' : ''}<div class="yard">${options}</div>
      ${upgrade}`;
  }

  private renderYard(state: GameState, ship: Ship): string {
    const town = this.map.towns.find((t) => t.id === ship.port)!;
    const cond = Math.round(ship.condition * 100);
    const yard = hasYard(this.map, town.id);
    const state_ = `<div class="town-info"><span><b>${ship.name}</b> · ${shipClass(ship).name} · Zustand ${cond} %</span>
      <div class="meter ${cond < 50 ? 'bad' : ''}"><div style="width:${cond}%"></div></div>
      <small>Ein abgenutztes Schiff ist bis zu 30 % langsamer.${ship.upgrades.length ? ` Eingebaut: ${ship.upgrades.map((u) => UPGRADES.find((x) => x.id === u)?.name).join(', ')}.` : ''}</small></div>`;
    if (!yard) {
      const yards = this.map.towns.filter((t) => t.shipyard.length).map((t) => t.name);
      return `${this.portHead(town, 'Werft')}${state_}<p>${town.name} hat keine Werft. Reparieren und Ausbauen geht in ${yards.join(', ')}.</p>`;
    }
    const cost = repairCost(ship);
    const ups =
      ship.type === 'floss'
        ? ''
        : `<h3>Ausbauten</h3><div class="yard">${UPGRADES.map((u) => {
            const has = ship.upgrades.includes(u.id);
            const c = upgradeCost(ship, u.id);
            return `<div class="yard-row"><div><b>${u.name}</b> <small>${u.text}</small></div>
              <button class="btn" data-act="cmd" data-cmd="upgrade" data-id="${u.id}" ${has || state.money < c ? 'disabled' : ''}>${has ? 'eingebaut' : `${fmt(c)} Taler`}</button></div>`;
          }).join('')}</div>`;
    const buildable = town.shipyard.filter((id) => shipAllowed(state, id));
    const later = town.shipyard.filter((id) => SHIPS[id].epoch > state.epoch);
    const newShips = buildable.length
      ? `<h3>Neue Schiffe</h3><div class="yard">${buildable
          .map((id) => {
            const c = SHIPS[id];
            const wood = c.timber ? timberPlan(state, town.id, id) : null;
            const label = `${fmt(wood ? wood.cost : c.price)} Taler`;
            const woodNote = wood ? ` · ${c.timber} t Holz${wood.fromKontor ? `, ${wood.fromKontor} t davon aus dem Kontor` : ' vom Markt'} und ${c.price} Taler Lohn` : '';
            const can = wood ? !wood.problem : state.money >= c.price;
            return `<div class="yard-row">
              <div><b>${c.name}</b> <small>${c.capacity} t · ${c.speed} km/h · Tiefgang ${String(c.draft).replace('.', ',')} m · Höhe ${c.height} m${woodNote}</small>
              <small class="desc">${c.description}</small></div>
              <button class="btn" data-act="buyship" data-type="${id}" ${can ? '' : 'disabled'} ${wood?.problem ? `title="${wood.problem}"` : ''}>${label}</button>
            </div>`;
          })
          .join('')}${later
          .map((id) => `<div class="yard-row muted"><div><b>${SHIPS[id].name}</b> <small>kommt in der Epoche „${EPOCHS[SHIPS[id].epoch - 1].name}“</small></div></div>`)
          .join('')}</div>`
      : '';
    return `${this.portHead(town, 'Werft')}${state_}
      ${ship.type === 'floss' ? '' : `<button class="btn wide ${cost > 0 ? 'primary' : ''}" data-act="cmd" data-cmd="repair" ${cost > 0 && state.money >= cost ? '' : 'disabled'}>Überholen<small>${cost > 0 ? `${fmt(cost)} Taler` : 'nicht nötig'}</small></button>`}
      ${ups}${newShips}${epochNote(state)}`;
  }

  /** Kapitän an Bord: Erfahrung, Treue, Lohn mit Knöpfen zum Anpassen */
  private captainBox(state: GameState, ship: Ship, dismiss: boolean): string {
    const c = ship.captain!;
    const fair = fairWage(c);
    const rank = CAPTAIN_RANKS[captainRank(c.km)];
    const next = CAPTAIN_RANKS[captainRank(c.km) + 1];
    const loyalty = Math.round(c.loyalty ?? 70);
    const mood = loyalty >= 60 ? 'zufrieden' : loyalty >= LOYALTY_WARN ? 'unruhig' : loyalty >= LOYALTY_POACH ? 'unzufrieden' : 'sieht sich um';
    const target = Math.max(fair, c.offer?.wage ?? 0);
    const who = c.offer ? (c.offer.from ? (RIVAL_BY_ID.get(c.offer.from)?.name ?? c.offer.from) : 'Ein anderer Reeder') : '';
    const promise = c.promised && c.promised.until >= Math.floor(state.hour / 24) + 1 ? `, zugesagt bis Tag ${c.promised.until}` : '';
    const offer = c.offer
      ? `<p class="note">${who} bietet ${c.name} ${c.offer.wage} Taler am Tag. Zahlst du nicht mindestens so viel, geht ${c.name} ${ship.port ? 'morgen hier' : 'im nächsten Hafen'} von Bord.</p>`
      : '';
    return `<div class="captain"><b>${c.name}</b> führt die ${ship.name}
        <small>${traitText(c)}</small>
        <small>${rank.name}, ${fmt(c.km ?? 0)} km gefahren${next ? `, ${next.name} ab ${fmt(next.km)} km` : ''} · Treue ${loyalty} von 100, ${mood}</small>
        <small>Lohn ${c.wage} Taler am Tag${promise}, wert ist ${c.name.split(' ')[0]} ${fair}</small>
        <span class="wage-btns"><button class="btn" data-act="cmd" data-cmd="wage" data-wage="${c.wage - 1}" ${c.wage > 1 ? '' : 'disabled'} aria-label="Lohn senken">Lohn −1</button>
        <button class="btn" data-act="cmd" data-cmd="wage" data-wage="${c.wage + 1}" aria-label="Lohn erhöhen">Lohn +1</button>
        ${c.wage < target ? `<button class="btn primary" data-act="cmd" data-cmd="wage" data-wage="${target}">Auf ${target} erhöhen</button>` : ''}
        ${dismiss ? '<button class="btn" data-act="cmd" data-cmd="dismiss">Entlassen</button>' : ''}</span></div>${offer}`;
  }

  private renderTavern(state: GameState, ship: Ship): string {
    const town = this.map.towns.find((t) => t.id === ship.port)!;
    const c = ship.captain;
    const mine = c
      ? this.captainBox(state, ship, true)
      : `<p>${ship.type === 'floss' ? 'Ein Floß steuert sich selbst.' : `Die ${ship.name} hat keinen Kapitän. Ohne Kapitän fährt sie nur auf deinen Befehl, mit Kapitän kann sie Handelsrouten allein fahren.`}</p>`;
    const list = state.tavern[town.id] ?? [];
    const guests = list.length
      ? list
          .map(
            (x) => `<div class="yard-row"><div><b>${x.name}</b> <small>${CAPTAIN_RANKS[captainRank(x.km)].name}, ${fmt(x.km ?? 0)} km · ${traitText(x)}</small>
              <small class="desc">Lohn ${x.wage} Taler am Tag, Handgeld ${x.hire}</small></div>
              <button class="btn" data-act="cmd" data-cmd="hire" data-id="${x.id}" ${state.money >= x.hire && ship.type !== 'floss' ? '' : 'disabled'}>Anheuern</button></div>`,
          )
          .join('')
      : '<p class="note">Heute sucht niemand Arbeit. Alle 20 Tage kommen neue Leute.</p>';
    return `${this.portHead(town, 'Hafenkneipe')}
      <h3>An Bord</h3>${mine}
      <h3>Am Tresen</h3><div class="yard">${guests}</div>`;
  }

  private renderRoute(state: GameState, ship: Ship): string {
    const r = ship.route;
    const town = ship.port ?? ship.voyage?.to;
    const cap = ship.captain;
    const head = `<div class="ledger-head"><div class="stamp-small">Handelsroute</div><h2>${ship.name}</h2>
      <p>${cap ? `${cap.name} fährt die Route allein ab: an jedem Halt werden die Befehle ausgeführt, erst Verkauf und Einlagern, dann Kauf.` : 'Für eine Handelsroute braucht das Schiff einen Kapitän. Heuere in einer Hafenkneipe einen an.'}</p></div>`;
    if (ship.type === 'floss') return head.replace(/<p>.*<\/p>/s, '<p>Ein Floß fährt keine Routen.</p>');
    const plan = this.routePlan;
    // gefahren wird nach r.plan; umgeschaltet wird erst beim nächsten Anlegen
    const running: RoutePlan = r ? (r.active ? (r.plan ?? 'sommer') : activePlan(state, r)) : 'sommer';
    const planStops = r ? stopsOf(r, plan) : [];
    const goodsOptions = GOODS.map((g) => `<option value="${g.id}">${g.name}</option>`).join('');
    const kindOptions = (Object.keys(ORDER_TEXT) as OrderKind[]).map((k) => `<option value="${k}">${ORDER_TEXT[k]}</option>`).join('');
    const num = (v: number | undefined, f = 1) => (v === undefined ? '' : String(Math.round(v * f * 10) / 10).replace('.', ','));
    const stops = planStops
      .map((s, i) => {
        const orders = s.orders
          .map(
            (o, j) =>
              `<li>${ORDER_TEXT[o.kind]} ${swatch(o.good)}${goodName(o.good)} <small>${o.amount ? `${o.amount} t` : o.kind === 'kaufen' || o.kind === 'auslagern' ? 'voll' : 'alles'}${o.limit ? `, ${o.kind === 'kaufen' ? 'höchstens' : 'mindestens'} ${o.limit} Taler` : ''}</small>
              <button class="link" data-act="cmd" data-cmd="routeDelOrder" data-plan="${plan}" data-stop="${i}" data-order="${j}" aria-label="Befehl löschen">entfernen</button></li>`,
          )
          .join('');
        const isNext = r?.active && plan === running && i === r.next;
        const cond = conditionText(s);
        const skipNow = stopSkipped(state, s);
        return `<div class="stop ${isNext ? 'next' : ''}" data-form data-keep="${plan}-${i}">
          <div class="stop-head"><b>${i + 1}. ${this.townName(s.town)}</b>${isNext ? '<small>nächster Halt</small>' : ''}${skipNow ? '<small>wird beim jetzigen Pegel übersprungen</small>' : ''}
            <button class="link" data-act="cmd" data-cmd="routeDelStop" data-plan="${plan}" data-stop="${i}">Halt entfernen</button></div>
          <ul class="orders">${orders || '<li class="muted">keine Befehle, nur durchfahren</li>'}</ul>
          ${cond ? `<p class="route-cond">${cond}</p>` : ''}
          <div class="order-form">
            <select name="kind" aria-label="Befehl">${kindOptions}</select>
            <select name="good" aria-label="Ware">${goodsOptions}</select>
            <input name="amount" type="number" min="0" step="5" value="0" aria-label="Menge, 0 = voll oder alles" title="Menge in t, 0 = voll oder alles">
            <input name="limit" type="number" min="0" step="1" value="0" aria-label="Preisgrenze, 0 = egal" title="Preisgrenze je t, 0 = egal">
            <button class="btn" data-act="cmd" data-cmd="routeAddOrder" data-plan="${plan}" data-stop="${i}">+</button>
          </div>
          <details class="route-cond-form"><summary>Bedingungen</summary>
            <div class="order-form">
              <label>Ablegen ab <input name="minLoad" type="text" inputmode="numeric" value="${num(s.minLoad, 100)}" placeholder="–"> % Ladung</label>
              <label>Überspringen bei Pegel unter <input name="levelMin" type="text" value="${num(s.levelMin)}" placeholder="–"> m</label>
              <label>oder über <input name="levelMax" type="text" value="${num(s.levelMax)}" placeholder="–"> m</label>
              <button class="btn" data-act="cmd" data-cmd="routeStopCond" data-plan="${plan}" data-stop="${i}">Speichern</button>
            </div>
          </details></div>`;
      })
      .join('');
    const townOptions = this.map.towns
      .map((t) => `<option value="${t.id}" ${t.id === town ? 'selected' : ''}>${t.name}</option>`)
      .join('');
    const canRun = !!cap && (r?.stops.length ?? 0) >= 2;
    const status = r
      ? `<p class="note">${r.active ? `Route läuft nach dem ${PLAN_NAME[running]}${r.note ? `: ${r.note}` : ''}.` : 'Route angehalten.'}</p>
        <div class="row-btns">
          <button class="btn ${r.active ? '' : 'primary'}" data-act="cmd" data-cmd="routeToggle" ${canRun || r.active ? '' : 'disabled'}>${r.active ? 'Anhalten' : 'Route starten'}</button>
          <button class="btn" data-act="cmd" data-cmd="routeClear">Route löschen</button>
        </div>${this.renderRouteBook(state, r)}`
      : '';
    const planNav = `<div class="row-btns route-plans">${(['sommer', 'winter'] as RoutePlan[])
      .map(
        (p) =>
          `<button class="btn ${p === plan ? 'on' : ''}" data-act="routePlan" data-plan="${p}">${PLAN_NAME[p]}${r?.active && p === running ? ' (gilt jetzt)' : ''}</button>`,
      )
      .join('')}</div>`;
    const winterInfo =
      plan === 'winter'
        ? `<p class="fine">Der Winterplan gilt in diesen Jahreszeiten, sobald er mindestens zwei Halte hat. Sonst fährt der Kapitän das ganze Jahr den Sommerplan. Umgeschaltet wird beim nächsten Anlegen.</p>
          <div class="row-btns">${SEASONS.map((x) => {
            const on = r ? winterSeasonsOf(r).includes(x) : DEFAULT_WINTER_SEASONS.includes(x);
            return `<button class="btn ${on ? 'on' : ''}" data-act="cmd" data-cmd="routeWinterSeason" data-season="${x}" aria-pressed="${on}">${SEASON_NAME[x]}</button>`;
          }).join('')}
          ${r?.stops.length ? '<button class="btn" data-act="cmd" data-cmd="routeCopyPlan" data-plan="winter">Sommerplan übernehmen</button>' : ''}</div>`
        : '';
    return `${head}${status}${planNav}${winterInfo}
      <div class="stops">${stops || `<p class="note">${plan === 'winter' ? 'Noch kein Winterplan. Ohne ihn gilt das ganze Jahr der Sommerplan.' : 'Noch keine Halte. Eine Route braucht mindestens zwei.'}</p>`}</div>
      <div class="order-form add-stop" data-form data-keep="add-${plan}">
        <select name="town" aria-label="Stadt">${townOptions}</select>
        <button class="btn" data-act="cmd" data-cmd="routeAddStop" data-plan="${plan}">Halt hinzufügen</button>
      </div>
      <p class="fine">Menge 0 heißt: bis der Laderaum voll ist, oder alles verkaufen. Mit einer Preisgrenze kauft der Kapitän nicht zu teuer und verkauft nicht zu billig.
        Bedingungen: Mit Mindestladung wartet der Kapitän und kauft alle ${LOAD_RETRY_HOURS} Stunden nach, höchstens ${MAX_LOAD_WAIT_HOURS / 24} Tage lang. Mit einer Pegelgrenze fährt er an dem Halt vorbei, solange der Pegel (jetzt ${fmtLevel(state.waterLevel)}) außerhalb liegt.</p>`;
  }

  /** Routenauswertung: Gewinn pro Tag über die letzten 30 Tage, mit kleinem Balkenbild */
  private renderRouteBook(state: GameState, r: TradeRoute): string {
    if (r.bookSince === undefined) return '<p class="fine">Die Auswertung beginnt, sobald die Route fährt.</p>';
    const p = routeProfit(state, r);
    const max = Math.max(1, ...p.series.map((x) => Math.abs(x)));
    const w = 6;
    const h = 40;
    const bars = p.series
      .map((v, i) => {
        const bh = Math.max(v === 0 ? 0 : 1, (Math.abs(v) / max) * (h / 2 - 1));
        const y = v >= 0 ? h / 2 - bh : h / 2;
        return `<rect x="${(ROUTE_BOOK_DAYS - p.days + i) * w}" y="${y.toFixed(1)}" width="${w - 1}" height="${bh.toFixed(1)}" fill="var(${v >= 0 ? '--gain' : '--loss'})"><title>Tag ${day(state) - p.days + 1 + i}: ${fmt(v)} Taler</title></rect>`;
      })
      .join('');
    const cls = p.perDay >= 0 ? 'gain' : 'loss';
    return `<div class="route-book">
        <p>Gewinn pro Tag: <b class="${cls}">${fmt(p.perDay)} Taler</b> <small>(${p.days === 1 ? 'heute' : `letzte ${p.days} Tage`}, zusammen ${fmt(p.total)} Taler, nach Löhnen, Zoll und Brennstoff)</small></p>
        <svg viewBox="0 0 ${ROUTE_BOOK_DAYS * w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="Gewinn je Tag"><line x1="0" x2="${ROUTE_BOOK_DAYS * w}" y1="${h / 2}" y2="${h / 2}" stroke="var(--line)" stroke-width="0.5"/>${bars}</svg>
        <button class="link" data-act="cmd" data-cmd="routeResetBook">Auswertung neu beginnen</button>
      </div>`;
  }

  private renderTownInfo(state: GameState, town: TownDef, more = ''): string {
    const t = state.towns[town.id];
    const level = levelOf(t.population);
    const next = LEVELS[level + 1];
    const wants = nextLevelNeeds(town, t).map((g) => GOOD_BY_ID.get(g)!.name);
    const sat = Math.round(t.satisfaction * 100);
    const trend = t.satisfaction > GROWTH_THRESHOLD ? 'wächst' : 'stagniert';
    const ev = state.events.filter((e) => e.town === town.id).map((e) => `<b class="event">${describeEvent(this.map, e)}</b>`);
    return `<div class="town-info">
      <span><b>${LEVELS[level].name}</b> · ${Math.round(t.population)} Einwohner · ${trend}</span>
      <div class="meter" title="Versorgung ${sat} %"><div style="width:${sat}%"></div><i style="left:${GROWTH_THRESHOLD * 100}%"></i></div>
      ${ev.join('')}
      <details class="more"><summary>Mehr über ${town.name}</summary>
        <small>Versorgung ${sat} %${next ? `, ab ${next.from} Einwohnern ${next.name}${wants.length ? ` (will dann auch ${wants.join(', ')})` : ''}` : ''}</small>
        ${more}
      </details>
    </div>`;
  }

  private renderVoyage(state: GameState, ship: Ship): string {
    const v = ship.voyage!;
    const { leg, index } = voyagePosition(v);
    const seg = this.map.segments.find((s) => s.id === leg.seg)!;
    const cls = shipClass(ship);
    const speed = seg.length / leg.hours;
    const pct = Math.round((v.elapsed / v.hours) * 100);
    const cargo = GOODS.filter((g) => ship.cargo[g.id])
      .map((g) => {
        const f = freshText(ship.cargo[g.id]);
        return `${ship.cargo[g.id].amount} t ${g.name}${f ? ` (${f})` : ''}`;
      })
      .join(', ');
    const how =
      cls.propulsion === 'drift'
        ? 'Das Floß treibt mit der Strömung.'
        : leg.downstream
          ? 'Talwärts hilft die Strömung.'
          : cls.propulsion === 'tow'
            ? 'Bergwärts ziehen Treidelpferde vom Ufer.'
            : cls.propulsion === 'steam'
              ? 'Die Schaufelräder stampfen gegen die Strömung.'
              : cls.propulsion === 'motor'
                ? 'Der Motor schiebt gleichmäßig gegen die Strömung.'
                : 'Bergwärts unter Segel, gegen die Strömung.';
    const route = v.legs
      .map((l, i) => `<li class="${i < index ? 'done' : i === index ? 'now' : ''}">${this.townName(l.from)} → ${this.townName(l.to)} <small>${fmtHours(l.hours)}</small></li>`)
      .join('');
    const captain = ship.captain ? `${ship.route?.active ? '<p class="note">Der Kapitän fährt die Handelsroute.</p>' : ''}${this.captainBox(state, ship, false)}` : '';
    void state;
    return `
      <div class="ledger-head">
        <div class="stamp-small">Unterwegs</div>
        <h2>${ship.name} nach ${this.townName(v.to)}</h2>
        <p>${how} ${speed.toFixed(1).replace('.', ',')} km/h über Grund, Strömung ${String(seg.current).replace('.', ',')} km/h.</p>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <p class="note">${fmtHours(v.elapsed)} von ${fmtHours(v.hours)}${v.toll ? ` · ${paidLabel(v)} bezahlt: ${v.toll} Taler` : ''}${v.evaded ? ` · ${v.evaded} Taler Zoll umgangen, Kontrolle möglich` : ''}</p>
      ${dockNote(v)}
      <ol class="route">${route}</ol>
      <p class="note">Ladung: ${cargo || 'leer'} · Zustand ${Math.round(ship.condition * 100)} %${cls.coal ? ` · Bunker ${Math.floor(ship.bunker ?? 0)} t Kohle` : ''}</p>
      ${captain}`;
  }

  /** Reiter Bücher: Preisbuch aller Städte und Schiffsbuch mit Gewinn je Fahrt */
  private renderBooks(state: GameState, ship: Ship): string {
    const here = ship.port ?? ship.voyage?.to ?? this.map.towns[0].id;
    const firstCargo = GOODS.find((g) => ship.cargo[g.id])?.id;
    const good = this.bookGood ?? firstCargo ?? Object.keys(state.markets[here] ?? {})[0] ?? GOODS[0].id;
    return `<div class="ledger-head"><div class="stamp-small">Preisbuch</div><h2>Was kostet was am Fluss?</h2>
        <p>Preise, die deine Schiffe gesehen haben, und was jede Fahrt eingebracht hat.</p></div>
      ${goodPicker(state, good)}
      ${priceBookPanel(state, this.map, good, this.bookTown ?? here)}
      ${shipBook(this.map, ship)}`;
  }

  /* ---------- Bücher ---------- */

  private renderRegister(state: GameState): string {
    const rows = [
      { name: 'Dein Handelshaus', color: 0xa8322a, ships: state.ships.length, kontore: Object.keys(state.kontore).length, worth: playerWorth(state), me: true, text: '' },
      ...state.rivals.map((r) => {
        const def = RIVAL_BY_ID.get(r.id)!;
        return { name: def.name, color: def.color, ships: r.ships.length, kontore: r.kontore.length, worth: rivalWorth(r), me: false, text: def.description };
      }),
    ].sort((a, b) => b.worth - a.worth);
    const table = rows
      .map(
        (r, i) => `<tr class="${r.me ? 'me' : ''}"><td class="num">${i + 1}.</td>
          <th scope="row"><span class="flag" style="background:${hex(r.color)}"></span>${r.name}${r.text ? `<small>${r.text}</small>` : ''}</th>
          <td class="num">${r.ships}</td><td class="num">${r.kontore}</td><td class="num">${fmt(r.worth)}</td></tr>`,
      )
      .join('');
    const l = state.ledger;
    const kontore = Object.entries(state.kontore)
      .map(([town, k]) => {
        const b = betriebeIn(state, town).map((x) => BUILDING_BY_ID.get(x.type)!.name);
        return `<li><b>${this.townName(town)}</b>, Stufe ${k.level}, ${Math.floor(cargoLoad({ cargo: k.stock }))}/${KONTOR_CAPACITY[k.level]} t${b.length ? ` · ${b.join(', ')}` : ''}</li>`;
      })
      .join('');
    return `<div class="ledger-head"><div class="stamp-small">Handelsregister</div><h2>Die Häuser am Fluss</h2>
      <p>Vermögen aus Kasse, Schiffen, Kontoren, Betrieben und Ware.</p></div>
      ${state.rivalsActive ? '' : '<p class="note">Noch hat niemand anderes den Mut, am Fluss zu handeln.</p>'}
      <table class="market register"><thead><tr><th></th><th>Haus</th><th>Schiffe</th><th>Kontore</th><th>Vermögen</th></tr></thead><tbody>${table}</tbody></table>
      <h3>Dein Haus</h3>
      <ul class="plain">
        <li>Gewinn bisher: <b>${fmt(state.totalProfit)}</b> Taler, ${state.stats.trips} Fahrten, ${state.stats.contracts} Aufträge erfüllt</li>
        <li>Gestern: Löhne ${fmt(l.wages)}, Unterhalt ${fmt(l.upkeep)}${l.fuel ? `, Brennstoff ${fmt(l.fuel)}` : ''}, eigene Erzeugung im Wert von ${fmt(l.production)} Taler</li>
        ${kontore || '<li>Noch keine Kontore</li>'}
      </ul>
      ${renderRivalry(state, this.map)}${this.renderRouteSummary(state)}`;
  }

  /** Alle Handelsrouten im Vergleich, die schwächste zuerst, damit man schlechte Routen erkennt */
  private renderRouteSummary(state: GameState): string {
    const rows = state.ships
      .filter((s) => s.route && s.route.bookSince !== undefined)
      .map((s) => ({ ship: s, p: routeProfit(state, s.route!) }))
      .sort((a, b) => a.p.perDay - b.p.perDay)
      .map(({ ship, p }) => {
        const r = ship.route!;
        const towns = r.stops.map((x) => this.townName(x.town)).join(' – ');
        const winter = hasWinterPlan(r) ? ' <small>(mit Winterplan)</small>' : '';
        return `<tr><th scope="row"><button class="link" data-act="select" data-ship="${ship.id}">${ship.name}</button>${r.active ? '' : ' <small>angehalten</small>'}<small>${towns}${winter}</small></th>
          <td class="num ${p.perDay >= 0 ? 'gain' : 'loss'}">${fmt(p.perDay)}</td><td class="num">${p.days}</td></tr>`;
      })
      .join('');
    if (!rows) return '';
    return `<h3>Handelsrouten</h3>
      <table class="market register"><thead><tr><th>Schiff und Route</th><th>Gewinn pro Tag</th><th>Tage</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="fine">Schnitt der letzten höchstens ${ROUTE_BOOK_DAYS} Tage, nach Löhnen, Zoll und Brennstoff. Die schwächste Route steht oben.</p>`;
  }

  private renderNews(state: GameState): string {
    // Vorhersagen der Pegelstationen stehen mit in der Lage am Fluss
    const forecasts = visibleForecasts(state).map((e) => `<li><b>Pegelmeldung</b>: ${describeForecast(state, e)}</li>`);
    const events = state.events.length || forecasts.length
      ? `<div class="contract-box"><h3>Lage am Fluss</h3><ul class="plain">${state.events
          .map((e) => `<li><b>${EVENT_TITLE[e.kind]}</b>: ${describeEvent(this.map, e)}<small> bis Tag ${e.until}</small></li>`)
          .join('')}${forecasts.join('')}</ul></div>`
      : '';
    const items = state.news
      .slice(0, 40)
      .map((n) => `<li class="news-${n.kind}"><small>Tag ${n.day}</small>${n.text}</li>`)
      .join('');
    return `<div class="ledger-head"><div class="stamp-small">Flussbote</div><h2>Neues vom Fluss</h2></div>
      ${events}
      <ul class="news">${items || '<li>Noch keine Nachrichten.</li>'}</ul>`;
  }

  private renderContracts(state: GameState, ship: Ship | undefined): string {
    const accepted = state.contracts.filter((c) => c.accepted);
    const offers = state.contracts.filter((c) => !c.accepted);
    const d = day(state);
    const row = (c: (typeof state.contracts)[number]) => {
      const left = c.accepted ? c.deadline - d : c.offerUntil - d;
      const progress = c.delivered ? ` · ${c.delivered}/${c.amount} t geliefert` : '';
      const canDeliver = c.accepted && ship?.port === c.town && (ship.cargo[c.good]?.amount ?? 0) > 0;
      const btn = c.accepted
        ? `<button class="btn primary" data-act="cmd" data-cmd="deliver" data-id="${c.id}" ${canDeliver ? '' : 'disabled'} title="Das gewählte Schiff muss in der Stadt liegen und die Ware an Bord haben">Liefern</button>`
        : `<button class="btn" data-act="cmd" data-cmd="accept" data-id="${c.id}" ${accepted.length >= MAX_ACCEPTED ? 'disabled' : ''}>Annehmen</button>`;
      return `<div class="contract-row">${swatch(c.good)}<span><b>${c.amount} t ${goodName(c.good)}</b> nach ${this.townName(c.town)} · ${fmt(c.reward)} Taler
        <small>${c.accepted ? `Lieferfrist bis Tag ${c.deadline}, noch ${left} Tage${progress}` : `Liefern bis Tag ${c.deadline}, Angebot gilt noch ${left} Tage`}</small></span>${btn}</div>`;
    };
    return `<div class="ledger-head"><div class="stamp-small">Auftragsbuch</div><h2>Aufträge</h2>
      <p>Städte suchen knappe Ware und zahlen gut dafür. Wer eine Frist verpasst, zahlt ${Math.round(PENALTY * 100)} % der Summe als Strafe.</p></div>
      <h3>Angenommen (${accepted.length}/${MAX_ACCEPTED})</h3>
      ${accepted.map(row).join('') || '<p class="note">Keine.</p>'}
      <h3>Angebote</h3>
      ${offers.map(row).join('') || '<p class="note">Gerade sucht niemand etwas. Neue Angebote kommen fast täglich.</p>'}`;
  }

  private renderWorks(state: GameState): string {
    const feeBtns = (id: string, current: string | undefined) =>
      `<div class="row-btns" role="group" aria-label="Gebühr"><small>Gebühr:</small>${(['frei', 'normal', 'hoch'] as const)
        .map(
          (lv) =>
            `<button class="btn small ${(current ?? 'normal') === lv ? 'on' : ''}" data-act="cmd" data-cmd="workFee" data-id="${id}" data-level="${lv}" aria-pressed="${(current ?? 'normal') === lv}" title="${FEE_LABEL[lv]}">${lv === 'frei' ? 'frei' : lv === 'normal' ? 'üblich' : 'hoch'}</button>`,
        )
        .join('')}</div>`;
    const list = PROJECTS.map((p) => {
      const st = projectState(state, p.id);
      const w = state.works.find((x) => x.id === p.id);
      const seg = this.map.segments.find((s) => s.id === p.seg)!;
      const where = `${this.townName(seg.from)} – ${this.townName(seg.to)}`;
      const locked = p.epoch > state.epoch;
      const extra: string[] = [];
      let btn: string;
      if (st === 'offen') {
        if (locked) btn = `<span class="note nowrap">ab Epoche „${EPOCHS[p.epoch - 1].name}“</span>`;
        else {
          const half = Math.round(p.cost / 2);
          const town = partnerOffer(state, this.map, p.id, 'stadt');
          const house = partnerOffer(state, this.map, p.id, 'haus');
          btn = `<div class="row-btns">
            <button class="btn" data-act="cmd" data-cmd="project" data-id="${p.id}" ${state.money >= p.cost ? '' : 'disabled'} title="allein bauen, alle Gebühren gehören dir">${fmt(p.cost)} Taler</button>
            ${town ? `<button class="btn" data-act="cmd" data-cmd="project" data-id="${p.id}" data-partner="stadt" ${state.money >= half ? '' : 'disabled'} title="${town.name} zahlt die Hälfte und bekommt die Hälfte der Gebühren">mit ${town.name}: ${fmt(half)}</button>` : ''}
            ${house ? `<button class="btn" data-act="cmd" data-cmd="project" data-id="${p.id}" data-partner="haus" ${state.money >= half ? '' : 'disabled'} title="${house.name} zahlt die Hälfte, bekommt die Hälfte der Gebühren und fährt selbst gebührenfrei">mit ${house.name}: ${fmt(half)}</button>` : ''}
          </div>`;
        }
      } else {
        btn = st === 'fertig' ? '<span class="done-mark">fertig</span>' : `<span class="note">noch ${daysLeft(state, p.id)} Tage</span>`;
        if (w?.owner) {
          const partner = w.partner ? `, gemeinsam mit ${w.partner.kind === 'stadt' ? this.townName(w.partner.id) : (RIVAL_BY_ID.get(w.partner.id)?.name ?? w.partner.id)}` : '';
          extra.push(`Bauherr: ${ownerName(w)}${partner}`);
          const fee = passageFee({ ...w, done: true }, 60);
          if (w.owner === 'spieler') {
            const part = w.partner ? `, Anteil des Partners: ${fmt(Math.round(w.partnerEarned ?? 0))} Taler` : '';
            if (fee || w.fee === 'frei') extra.push(`Gebühr je fremder Durchfahrt: ${fee} Taler (mittleres Schiff), eingenommen: ${fmt(Math.round(w.earned ?? 0))} Taler${part}`);
          } else if (fee) extra.push(`Gebühr für deine Schiffe: rund ${fee} Taler je Durchfahrt (mittleres Schiff).`);
        }
        if (w?.owner === 'spieler' && st === 'fertig' && p.kind === 'vertiefung') {
          const silt = Math.round((w.silt ?? 0) * 100);
          const cost = dredgeCost(w);
          extra.push(
            w.upkeep
              ? `Baggerschiffe halten die Rinne auf ihrem Stand (${silt} % verlandet): ${upkeepCost(w)} Taler am Tag.`
              : `Verlandet zu ${silt} %. Ohne Pflege schwemmt der Fluss die Rinne langsam zu.`,
          );
          extra.push(`<span class="row-btns">
            <button class="btn small" data-act="cmd" data-cmd="workUpkeep" data-id="${p.id}" data-on="${w.upkeep ? 0 : 1}">${w.upkeep ? 'Pflege beenden' : `Pflege für ${upkeepCost(w)} Taler am Tag`}</button>
            ${cost && (w.silt ?? 0) >= 0.05 ? `<button class="btn small" data-act="cmd" data-cmd="dredge" data-id="${p.id}" ${state.money >= cost ? '' : 'disabled'}>Nachbaggern: ${fmt(cost)} Taler</button>` : ''}
          </span>`);
        }
        if (w?.owner === 'spieler' && st === 'fertig' && passageFee({ ...w, fee: 'normal' }, 60)) extra.push(feeBtns(p.id, w.fee));
      }
      return `<div class="yard-row ${locked && st === 'offen' ? 'muted' : ''}"><div><b>${p.name}</b> <small>${where} · ${p.days} Tage Bauzeit</small>
        <small class="desc">${p.text}</small>${extra.map((x) => (x.startsWith('<') ? x : `<small class="desc">${x}</small>`)).join('')}</div>${btn}</div>`;
    }).join('');

    const harbors = this.map.towns
      .map((t) => {
        const h = harborOf(state, t.id);
        const cur = HARBOR_LEVELS[h.level];
        const next = nextHarborLevel(state, t.id);
        const depth = quayDepth(state, t.id).toFixed(1).replace('.', ',');
        const info = `${cur.name} · ${cur.rate} t je Stunde · ${berths(state, t.id)} Liegeplätze · ${depth} m am Kai`;
        let btn = '';
        if (h.building) btn = `<span class="note">${HARBOR_LEVELS[h.building.level].name}: noch ${harborDaysLeft(state, t.id)} Tage</span>`;
        else if (!next) btn = '<span class="done-mark">voll ausgebaut</span>';
        else if (next.epoch > state.epoch) btn = `<span class="note nowrap">${next.name} ab Epoche „${EPOCHS[next.epoch - 1].name}“</span>`;
        else {
          const alone = harborCost(state, this.map, t.id, false);
          const town = harborPartner(state, this.map, t.id);
          const withTown = harborCost(state, this.map, t.id, true);
          btn = `<div class="row-btns">
            <button class="btn" data-act="cmd" data-cmd="harbor" data-town="${t.id}" ${state.money >= alone ? '' : 'disabled'} title="${next.text}">${next.name}: ${fmt(alone)}</button>
            ${town ? `<button class="btn" data-act="cmd" data-cmd="harbor" data-town="${t.id}" data-partner="stadt" ${state.money >= withTown ? '' : 'disabled'} title="Die Stadt zahlt die Hälfte und bekommt die Hälfte des Liegegelds">mit der Stadt: ${fmt(withTown)}</button>` : ''}
          </div>`;
        }
        const own =
          h.level > 0
            ? `<small class="desc">Liegegeld von fremden Schiffen, eingenommen: ${fmt(Math.round(h.earned ?? 0))} Taler${h.partner ? `, Anteil der Stadt: ${fmt(Math.round(h.partnerEarned ?? 0))} Taler` : ''}</small>${feeBtns(`hafen:${t.id}`, h.fee)}`
            : '';
        return `<div class="yard-row"><div><b>${t.name}</b> <small>${info}</small>${own}</div>${btn}</div>`;
      })
      .join('');

    const l = state.ledger.works;
    const ledger = l && (l.income || l.cost) ? `<p class="note">Gestern: Gebühren +${fmt(l.income)} Taler, Unterhalt und fremde Gebühren −${fmt(l.cost)} Taler.</p>` : '';
    return `<div class="ledger-head"><div class="stamp-small">Wasserbauamt</div><h2>Den Fluss verbessern</h2>
      <p>Brücken, Schleusen, Kanäle und Fahrrinnen verändern den Fluss für immer. Wer baut, darf von fremden Schiffen eine Durchfahrtsgebühr nehmen. Eine Stadt oder ein Handelshaus trägt auf Wunsch die Hälfte und bekommt dafür die Hälfte der Gebühren. Ausgebaggerte Rinnen verlanden, wenn niemand sie pflegt.</p></div>
      ${ledger}
      <div class="yard">${list}</div>
      <div class="ledger-head"><div class="stamp-small">Häfen</div><h2>Häfen ausbauen</h2>
      <p>Ein besserer Hafen schlägt schneller um, hat mehr Liegeplätze und tieferes Wasser am Kai. Zu tiefe Schiffe müssen sonst über Schuten geleichtert werden, das dauert doppelt so lange und kostet einen halben Taler je Tonne.</p></div>
      <div class="yard">${harbors}</div>`;
  }

  /** Papierkarte des Tals mit allen Schiffen; Daten der Flussläufe kommen von außen */
  setMapData(data: MapData): void {
    this.mapData = data;
  }

  private mapData: MapData | null = null;

  private mapHtml(state: GameState): string {
    const d = this.mapData;
    if (!d) return '';
    const rivers = d.rivers.map((r) => `<path d="${r.path}" class="m-river" style="stroke-width:${r.width}"/>`).join('');
    const segs = effectiveSegments(state, this.map);
    const townPts = Object.values(d.towns);
    const legend: string[] = [];
    const noteBoxes: { x: number; y: number; w: number; h: number }[] = [];
    const notes = segs
      .map((seg) => {
        const m = { ...d.segMid[seg.id] };
        // Beschriftung von nahen Städten wegschieben, damit sich nichts überdeckt
        for (const t of townPts) {
          const dx = m.x - t.x;
          const dy = m.y - t.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 22) {
            const k = dist > 0.1 ? 22 / dist : 1;
            m.x = t.x + (dist > 0.1 ? dx * k : 22);
            m.y = t.y + (dist > 0.1 ? dy * k : 0);
          }
        }
        const depth = segmentDepth(seg, state.waterLevel).toFixed(1).replace('.', ',');
        const marks: string[] = [`${depth} m`];
        if (seg.bridgeHeight !== undefined) marks.push(`Br. ${String(seg.bridgeHeight).replace('.', ',')} m`);
        if (seg.freezes && state.ice) marks.push('Eis');
        const ev = state.events.find((e) => e.seg === seg.id);
        if (ev) marks.push(EVENT_TITLE[ev.kind]);
        legend.push(
          `<li><b>${this.townName(seg.from)} – ${this.townName(seg.to)}</b>: ${depth} m tief${seg.bridgeHeight !== undefined ? `, Brücke ${String(seg.bridgeHeight).replace('.', ',')} m hoch` : ''}${seg.freezes ? (state.ice ? ', zugefroren' : ', friert im Winter zu') : ''}${ev ? `, ${EVENT_TITLE[ev.kind]}` : ''}</li>`,
        );
        const text = marks.join(' · ');
        noteBoxes.push({ x: m.x - text.length * 1.6, y: m.y - 5, w: text.length * 3.2, h: 6 });
        return `<text x="${m.x.toFixed(1)}" y="${m.y.toFixed(1)}" class="m-note" text-anchor="middle">${text}</text>`;
      })
      .join('');
    // Ortsnamen so setzen, dass sie sich nicht überdecken: oben, unten, rechts oder links vom Kreis
    type Box = { x: number; y: number; w: number; h: number };
    const placed: Box[] = [...noteBoxes];
    // Überlappungsfläche mit schon gesetzten Beschriftungen, Kreise zählen mit
    const cost = (b: Box) => {
      let c = 0;
      for (const o of placed) {
        const ox = Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x);
        const oy = Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y);
        if (ox > 0 && oy > 0) c += ox * oy;
      }
      for (const t of townPts) if (t.x > b.x - 5 && t.x < b.x + b.w + 5 && t.y > b.y - 5 && t.y < b.y + b.h + 5) c += 200;
      return c;
    };
    const towns = this.map.towns
      .map((t) => {
        const p = d.towns[t.id];
        const lvl = levelOf(state.towns[t.id].population);
        const r = 4 + lvl * 1.5;
        const w = t.name.length * 4.6 + 4;
        const h = 9;
        const options: { box: Box; ax: number; ay: number; anchor: string }[] = [
          { box: { x: p.x - w / 2, y: p.y - r - 3 - h, w, h }, ax: 0, ay: -r - 4, anchor: 'middle' },
          { box: { x: p.x - w / 2, y: p.y + r + 2, w, h }, ax: 0, ay: r + 10, anchor: 'middle' },
          { box: { x: p.x + r + 3, y: p.y - h / 2, w, h }, ax: r + 3, ay: 3, anchor: 'start' },
          { box: { x: p.x - r - 3 - w, y: p.y - h / 2, w, h }, ax: -r - 3, ay: 3, anchor: 'end' },
        ];
        const pick = options.reduce((a, o) => (cost(o.box) < cost(a.box) ? o : a));
        placed.push(pick.box);
        const mine = state.kontore[t.id] ? `<rect class="m-kontor" x="-3" y="-3" width="6" height="6"/>` : '';
        return `<g transform="translate(${p.x},${p.y})"><circle r="${r}" class="m-town"/>${mine}<text x="${pick.ax}" y="${pick.ay}" class="m-label" text-anchor="${pick.anchor}">${t.name}</text></g>`;
      })
      .join('');
    const ships = state.ships
      .map((s) => {
        const p = d.shipPos(s);
        return p ? `<circle cx="${p.x}" cy="${p.y}" r="3.2" class="m-ship"><title>${s.name}</title></circle>` : '';
      })
      .join('');
    const rivals = state.rivals
      .flatMap((r) => r.ships.map((s) => ({ s, color: RIVAL_BY_ID.get(r.id)!.color })))
      .map(({ s, color }) => {
        const p = d.shipPos(s);
        return p ? `<circle cx="${p.x}" cy="${p.y}" r="2.4" fill="${hex(color)}" class="m-rival"/>` : '';
      })
      .join('');
    return `<div class="ledger-head"><div class="stamp-small">Flusskarte</div><h2>Das Tal</h2><p>Rote Punkte sind deine Schiffe, Quadrate deine Kontore. Zahlen am Fluss: Wassertiefe.</p></div>
      <p class="note swipe-hint">Karte zum Verschieben seitlich wischen.</p><div class="map-scroll"><svg class="paper-map" viewBox="${d.viewBox}" role="img" aria-label="Karte des Flusstals">${rivers}${notes}${towns}${rivals}${ships}</svg></div>
      <details class="more"><summary>Alle Abschnitte mit Tiefe und Brücken</summary><ul class="plain map-legend">${legend.join('')}</ul></details>`;
  }

  /* ---------- Rückmeldungen ---------- */

  tradeFeedback(r: TradeResult): void {
    if (!r.ok) {
      this.toast(r.message, 'warn');
      return;
    }
    if (r.profit !== undefined) {
      const sign = r.profit >= 0 ? '+' : '−';
      this.toast(`${r.message} Gewinn: ${sign}${Math.abs(r.profit)} Taler`, r.profit >= 0 ? 'gain' : 'loss');
      if (r.firstProfit) this.stamp('Erster Gewinn!', `+${r.profit} Taler`);
    } else {
      this.toast(r.message);
    }
  }

  toast(text: string, kind: 'info' | 'warn' | 'gain' | 'loss' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.prepend(el);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
    while (this.toasts.children.length > 3) this.toasts.lastElementChild!.remove();
  }

  private stampQueue: [string, string][] = [];
  private stampBusy = false;

  /** Stempel nacheinander zeigen, nie mehrere übereinander */
  stamp(title: string, sub: string): void {
    if (this.stampQueue.length >= 3) return;
    this.stampQueue.push([title, sub]);
    if (!this.stampBusy) this.nextStamp();
  }

  private nextStamp(): void {
    const item = this.stampQueue.shift();
    if (!item) {
      this.stampBusy = false;
      return;
    }
    this.stampBusy = true;
    const [title, sub] = item;
    setTimeout(() => this.nextStamp(), 3000);
    const el = document.createElement('div');
    el.className = 'stamp';
    el.innerHTML = `<div>${title}</div><small>${sub}</small>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3400);
  }
}

/** Hinweis in der Werft, was die nächste Epoche bringt (nur freies Spiel) */
function epochNote(state: GameState): string {
  if (!state.epochAuto) return '';
  const p = epochProgress(state);
  if (!p.next) return '';
  const parts = p.conditions.map((c) => `${c.label} (${Math.min(c.value, c.target)}/${c.target})`);
  return `<p class="note">Die Zeit „${p.next.name}“ beginnt, sobald alles erfüllt ist: ${parts.join(', ')}. Spätestens im Jahr ${p.next.latestYear}.</p>`;
}

/** Was beim Ablegen bezahlt wurde: Zoll, Gebühren, Treidelgeld */
function paidLabel(v: Voyage): string {
  const tow = v.towFee ?? 0;
  const fees = feeSum(v.fees);
  const parts: string[] = [];
  if ((v.toll ?? 0) - tow - fees > 0) parts.push('Zoll');
  if (fees > 0) parts.push('Gebühren');
  if (tow > 0) parts.push('Treidelgeld');
  if (parts.length <= 1) return parts[0] ?? 'Zoll';
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}
