import { BUILDING_BY_ID, BUILDINGS, betriebUpkeep, KONTOR_CAPACITY, KONTOR_PRICE, KONTOR_SLOTS, KONTOR_UPGRADE } from '../data/buildings.ts';
import { TRAITS } from '../data/captains.ts';
import { GOOD_BY_ID, GOODS } from '../data/goods.ts';
import type { MapDef, TownDef } from '../data/maps/valley.ts';
import { RIVAL_BY_ID } from '../data/rivals.ts';
import { EPOCHS, SHIPS, UPGRADES } from '../data/ships.ts';
import { dayInSeason, season, SEASON_NAME, year } from '../sim/calendar.ts';
import { MAX_ACCEPTED, PENALTY } from '../sim/contracts.ts';
import { buyPrice, sellPrice } from '../sim/economy.ts';
import { describeEvent, describeForecast, EVENT_TITLE, visibleForecasts } from '../sim/events.ts';
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
import { betriebeIn, betriebSlots, buildingAllowed, kontorUpkeepIn, playerWorth } from '../sim/house.ts';
import { extraSlots } from '../sim/standing.ts';
import { closedLine, renderRathaus, seasonLine, standingLine } from './standing-panel.ts';
import { rivalWorth } from '../sim/rivals.ts';
import { BLOCK_TEXT, segmentDepth } from '../sim/river.ts';
import { GROWTH_THRESHOLD, LEVELS, levelOf, netFlow, nextLevelNeeds, CRISIS_THRESHOLD, MIN_POP_SHARE } from '../sim/towns.ts';

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
export type Tab = 'markt' | 'kontor' | 'werft' | 'kneipe' | 'route' | 'rathaus';

/** Was gerade sichtbar ist; die Kampagne schaltet Reiter und Bücher nach und nach frei */
export interface HudFeatures {
  tabs: Tab[];
  views: View[];
}
export const ALL_FEATURES: HudFeatures = {
  tabs: ['markt', 'kontor', 'werft', 'kneipe', 'route', 'rathaus'],
  views: ['ship', 'register', 'news', 'contracts', 'works', 'map'],
};

const fmtHours = (h: number) => {
  if (h >= 48) return `${(h / 24).toFixed(1).replace('.', ',')} Tage`;
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min === 0 ? `${whole} Std` : `${whole} Std ${min} Min`;
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
        case 'tab':
          this.tab = d.tab as Tab;
          this.actions.command('refresh', {});
          break;
        case 'cmd': {
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
      <span title="${EPOCHS[state.epoch - 1].name}"><small>${SEASON_NAME[season(day(state))]} · Jahr ${year(day(state))}</small><b>${dayInSeason(day(state))}. Tag, ${clock(state.hour)}</b></span>
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
    setHtml(this.body, this.renderShip(state, ship));
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
          ['rathaus', 'Rathaus'],
        ]
      : [
          ['markt', 'Fahrt'],
          ['route', 'Route'],
        ];
    const visible = tabs.filter(([t]) => t === 'markt' || this.features.tabs.includes(t));
    tabs.length = 0;
    tabs.push(...visible);
    if (!tabs.some(([t]) => t === this.tab)) this.tab = 'markt';
    const nav = `<nav class="tabs">${tabs
      .map(([t, label]) => `<button class="tab ${t === this.tab ? 'on' : ''}" data-act="tab" data-tab="${t}">${label}</button>`)
      .join('')}</nav>`;
    let body = '';
    if (!ship.port) body = this.tab === 'route' ? this.renderRoute(ship) : this.renderVoyage(state, ship);
    else if (this.tab === 'kontor') body = this.renderKontor(state, ship);
    else if (this.tab === 'werft') body = this.renderYard(state, ship);
    else if (this.tab === 'kneipe') body = this.renderTavern(state, ship);
    else if (this.tab === 'route') body = this.renderRoute(ship);
    else if (this.tab === 'rathaus') body = this.renderTownHall(state, ship);
    else body = this.renderPort(state, ship);
    return nav + body;
  }

  private renderTownHall(state: GameState, ship: Ship): string {
    const town = this.map.towns.find((t) => t.id === ship.port)!;
    return `${this.portHead(town, 'Rathaus')}${renderRathaus(state, town)}`;
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
          <th scope="row">${swatch(g.id)}${g.name}<small>${Math.floor(m.stock)} t${role ? ` · ${role}` : ''}</small></th>
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
        const toll = v.toll ? `, Zoll ${v.toll}` : '';
        const coal = bunkerPlan(state, ship, v.hours, v.toll ?? 0);
        if (coal.problem) return `<button class="btn dest" disabled title="${coal.problem}"><b>${t.name}</b><small>${coal.buy ? `${coal.buy} t Kohle fehlen` : 'Bunker zu klein'}</small></button>`;
        const coalText = coal.need ? `, Kohle ${String(coal.need).replace('.', ',')} t${coal.buy ? `, bunkert ${coal.buy} t für ${coal.cost} Taler` : ''}` : '';
        const tooDear = (v.toll ?? 0) + coal.cost > state.money;
        return `<button class="btn dest" data-act="depart" data-to="${t.id}" ${tooDear ? 'disabled' : ''}><b>${t.name}</b><small>${dir}, ${fmtHours(v.hours)}${toll}${coalText}</small></button>`;
      })
      .join('');

    const industries = town.industries.length
      ? `<p class="note">Betriebe der Stadt: ${town.industries.map((i) => `${i.name} (${flows(i.inputs)} → ${flows(i.outputs)})${state.towns[town.id].closed?.includes(i.name) ? ' geschlossen' : ''}`).join(', ')} pro Tag</p>`
      : '';

    const raft =
      ship.type === 'floss'
        ? `<button class="btn primary wide" data-act="dismantle" ${load > 0 ? 'disabled' : ''}>Floß zerlegen und als Holz verkaufen
            <small>${load > 0 ? 'Erst die Ladung verkaufen' : `${RAFT_TIMBER} t Holz${market.holz ? '' : ', hier kauft aber niemand Holz'}`}</small></button>`
        : '';

    const cls = shipClass(ship);
    const bunker = cls.coal ? ` · Bunker <b>${Math.floor(ship.bunker ?? 0)}/${cls.bunker} t</b> Kohle` : '';
    const bunkerBtn =
      cls.coal && market.kohle && (ship.bunker ?? 0) < (cls.bunker ?? 0) - 1
        ? `<button class="btn wide" data-act="cmd" data-cmd="bunker">Bunker füllen<small>Kohle vom Markt für Häfen ohne Kohlehandel</small></button>`
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
      ${bunkerBtn}
      <table class="market">
        <thead><tr><th>Ware</th><th title="Preis je Tonne beim Kauf">Kauf</th><th title="Preis je Tonne beim Verkauf">Verkauf</th><th>Bord</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
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
    const slots = betriebSlots(state, town.id);
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
          <small>${fmt(KONTOR_UPGRADE[k.level + 1])} Taler: ${KONTOR_CAPACITY[k.level + 1]} t Lager, ${KONTOR_SLOTS[k.level + 1] + extraSlots(state, town.id)} Bauplätze, Unterhalt ${kontorUpkeepIn(state, town.id, k.level + 1)} am Tag</small></button>`
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
      ${ups}${newShips}`;
  }

  private renderTavern(state: GameState, ship: Ship): string {
    const town = this.map.towns.find((t) => t.id === ship.port)!;
    const c = ship.captain;
    const mine = c
      ? `<div class="captain"><b>${c.name}</b> führt die ${ship.name}<small>${TRAITS[c.trait].name}: ${TRAITS[c.trait].text} · Lohn ${c.wage} am Tag</small>
         <button class="btn" data-act="cmd" data-cmd="dismiss">Entlassen</button></div>`
      : `<p>${ship.type === 'floss' ? 'Ein Floß steuert sich selbst.' : `Die ${ship.name} hat keinen Kapitän. Ohne Kapitän fährt sie nur auf deinen Befehl, mit Kapitän kann sie Handelsrouten allein fahren.`}</p>`;
    const list = state.tavern[town.id] ?? [];
    const guests = list.length
      ? list
          .map(
            (x) => `<div class="yard-row"><div><b>${x.name}</b> <small>${TRAITS[x.trait].name}: ${TRAITS[x.trait].text}</small>
              <small class="desc">Lohn ${x.wage} Taler am Tag, Handgeld ${x.hire}</small></div>
              <button class="btn" data-act="cmd" data-cmd="hire" data-id="${x.id}" ${state.money >= x.hire && ship.type !== 'floss' ? '' : 'disabled'}>Anheuern</button></div>`,
          )
          .join('')
      : '<p class="note">Heute sucht niemand Arbeit. Alle 20 Tage kommen neue Leute.</p>';
    return `${this.portHead(town, 'Hafenkneipe')}
      <h3>An Bord</h3>${mine}
      <h3>Am Tresen</h3><div class="yard">${guests}</div>`;
  }

  private renderRoute(ship: Ship): string {
    const r = ship.route;
    const town = ship.port ?? ship.voyage?.to;
    const cap = ship.captain;
    const head = `<div class="ledger-head"><div class="stamp-small">Handelsroute</div><h2>${ship.name}</h2>
      <p>${cap ? `${cap.name} fährt die Route allein ab: an jedem Halt werden die Befehle ausgeführt, erst Verkauf und Einlagern, dann Kauf.` : 'Für eine Handelsroute braucht das Schiff einen Kapitän. Heuere in einer Hafenkneipe einen an.'}</p></div>`;
    if (ship.type === 'floss') return head.replace(/<p>.*<\/p>/s, '<p>Ein Floß fährt keine Routen.</p>');
    const goodsOptions = GOODS.map((g) => `<option value="${g.id}">${g.name}</option>`).join('');
    const kindOptions = (Object.keys(ORDER_TEXT) as OrderKind[]).map((k) => `<option value="${k}">${ORDER_TEXT[k]}</option>`).join('');
    const stops = (r?.stops ?? [])
      .map((s, i) => {
        const orders = s.orders
          .map(
            (o, j) =>
              `<li>${ORDER_TEXT[o.kind]} ${swatch(o.good)}${goodName(o.good)} <small>${o.amount ? `${o.amount} t` : o.kind === 'kaufen' || o.kind === 'auslagern' ? 'voll' : 'alles'}${o.limit ? `, ${o.kind === 'kaufen' ? 'höchstens' : 'mindestens'} ${o.limit} Taler` : ''}</small>
              <button class="link" data-act="cmd" data-cmd="routeDelOrder" data-stop="${i}" data-order="${j}" aria-label="Befehl löschen">entfernen</button></li>`,
          )
          .join('');
        const isNext = r && i === r.next;
        return `<div class="stop ${isNext ? 'next' : ''}" data-form>
          <div class="stop-head"><b>${i + 1}. ${this.townName(s.town)}</b>${isNext ? '<small>nächster Halt</small>' : ''}
            <button class="link" data-act="cmd" data-cmd="routeDelStop" data-stop="${i}">Halt entfernen</button></div>
          <ul class="orders">${orders || '<li class="muted">keine Befehle, nur durchfahren</li>'}</ul>
          <div class="order-form">
            <select name="kind" aria-label="Befehl">${kindOptions}</select>
            <select name="good" aria-label="Ware">${goodsOptions}</select>
            <input name="amount" type="number" min="0" step="5" value="0" aria-label="Menge, 0 = voll oder alles" title="Menge in t, 0 = voll oder alles">
            <input name="limit" type="number" min="0" step="1" value="0" aria-label="Preisgrenze, 0 = egal" title="Preisgrenze je t, 0 = egal">
            <button class="btn" data-act="cmd" data-cmd="routeAddOrder" data-stop="${i}">+</button>
          </div></div>`;
      })
      .join('');
    const townOptions = this.map.towns
      .map((t) => `<option value="${t.id}" ${t.id === town ? 'selected' : ''}>${t.name}</option>`)
      .join('');
    const canRun = !!cap && (r?.stops.length ?? 0) >= 2;
    const status = r
      ? `<p class="note">${r.active ? `Route läuft${r.note ? `: ${r.note}` : ''}.` : 'Route angehalten.'}</p>
        <div class="row-btns">
          <button class="btn ${r.active ? '' : 'primary'}" data-act="cmd" data-cmd="routeToggle" ${canRun || r.active ? '' : 'disabled'}>${r.active ? 'Anhalten' : 'Route starten'}</button>
          <button class="btn" data-act="cmd" data-cmd="routeClear">Route löschen</button>
        </div>`
      : '';
    return `${head}${status}
      <div class="stops">${stops || '<p class="note">Noch keine Halte. Eine Route braucht mindestens zwei.</p>'}</div>
      <div class="order-form add-stop" data-form>
        <select name="town" aria-label="Stadt">${townOptions}</select>
        <button class="btn" data-act="cmd" data-cmd="routeAddStop">Halt hinzufügen</button>
      </div>
      <p class="fine">Menge 0 heißt: bis der Laderaum voll ist, oder alles verkaufen. Mit einer Preisgrenze kauft der Kapitän nicht zu teuer und verkauft nicht zu billig.</p>`;
  }

  private renderTownInfo(state: GameState, town: TownDef, more = ''): string {
    const t = state.towns[town.id];
    const level = levelOf(t.population);
    const next = LEVELS[level + 1];
    const wants = nextLevelNeeds(town, t).map((g) => GOOD_BY_ID.get(g)!.name);
    const sat = Math.round(t.satisfaction * 100);
    const shrinking =
      (t.satisfaction < CRISIS_THRESHOLD && t.population > town.population * MIN_POP_SHARE + 0.5) ||
      (t.satisfaction < GROWTH_THRESHOLD && t.population > town.population + 0.5);
    const trend = t.satisfaction > GROWTH_THRESHOLD ? 'wächst' : shrinking ? 'schrumpft' : 'stagniert';
    const ev = state.events.filter((e) => e.town === town.id).map((e) => `<b class="event">${describeEvent(this.map, e)}</b>`);
    return `<div class="town-info">
      <span><b>${LEVELS[level].name}</b> · ${Math.round(t.population)} Einwohner · ${trend}</span>
      ${this.features.tabs.includes('rathaus') ? standingLine(state, town) : ''}
      <div class="meter" title="Versorgung ${sat} %"><div style="width:${sat}%"></div><i style="left:${GROWTH_THRESHOLD * 100}%"></i></div>
      ${ev.join('')}
      ${closedLine(state, town)}
      <details class="more"><summary>Mehr über ${town.name}</summary>
        <small>Versorgung ${sat} %${next ? `, ab ${next.from} Einwohnern ${next.name}${wants.length ? ` (will dann auch ${wants.join(', ')})` : ''}` : ''}</small>
        ${seasonLine(state, town)}
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
    const captain = ship.captain ? `<p class="note">Kapitän: ${ship.captain.name} (${TRAITS[ship.captain.trait].name})${ship.route?.active ? ', fährt Handelsroute' : ''}</p>` : '';
    void state;
    return `
      <div class="ledger-head">
        <div class="stamp-small">Unterwegs</div>
        <h2>${ship.name} nach ${this.townName(v.to)}</h2>
        <p>${how} ${speed.toFixed(1).replace('.', ',')} km/h über Grund, Strömung ${String(seg.current).replace('.', ',')} km/h.</p>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <p class="note">${fmtHours(v.elapsed)} von ${fmtHours(v.hours)}${v.toll ? ` · Zoll bezahlt: ${v.toll} Taler` : ''}</p>
      <ol class="route">${route}</ol>
      <p class="note">Ladung: ${cargo || 'leer'} · Zustand ${Math.round(ship.condition * 100)} %${cls.coal ? ` · Bunker ${Math.floor(ship.bunker ?? 0)} t Kohle` : ''}</p>
      ${captain}`;
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
      </ul>`;
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
    const list = PROJECTS.map((p) => {
      const st = projectState(state, p.id);
      const seg = this.map.segments.find((s) => s.id === p.seg)!;
      const where = `${this.townName(seg.from)} – ${this.townName(seg.to)}`;
      const locked = p.epoch > state.epoch;
      const btn =
        st === 'fertig'
          ? '<span class="done-mark">fertig</span>'
          : st === 'bau'
            ? `<span class="note">noch ${daysLeft(state, p.id)} Tage</span>`
            : locked
              ? `<span class="note nowrap">ab Epoche „${EPOCHS[p.epoch - 1].name}“</span>`
              : `<button class="btn" data-act="cmd" data-cmd="project" data-id="${p.id}" ${state.money >= p.cost ? '' : 'disabled'}>${fmt(p.cost)} Taler</button>`;
      return `<div class="yard-row ${locked ? 'muted' : ''}"><div><b>${p.name}</b> <small>${where} · ${p.days} Tage Bauzeit</small>
        <small class="desc">${p.text}</small></div>${btn}</div>`;
    }).join('');
    return `<div class="ledger-head"><div class="stamp-small">Wasserbauamt</div><h2>Den Fluss verbessern</h2>
      <p>Brücken, Schleusen, Kanäle und Fahrrinnen verändern den Fluss für immer, für dich und für die Konkurrenz. Wer baut, zahlt, aber jede Fahrt wird leichter.</p></div>
      <div class="yard">${list}</div>`;
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
