import { GOOD_BY_ID, GOODS } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { SHIPS } from '../data/ships.ts';
import { buyPrice, sellPrice } from '../sim/economy.ts';
import {
  cargoLoad,
  day,
  planVoyage,
  RAFT_TIMBER,
  shipClass,
  voyagePosition,
  wind,
  type GameState,
  type Ship,
  type TradeResult,
} from '../sim/game.ts';
import { BLOCK_TEXT } from '../sim/river.ts';
import { netFlow } from '../sim/towns.ts';

export interface HudActions {
  select(shipId: number): void;
  buy(good: string, amount: number): void;
  sell(good: string, amount: number): void;
  depart(to: string): void;
  wait(): void;
  buyShip(type: string): void;
  dismantle(): void;
  speed(factor: number): void;
  start(): void;
}

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

const lastHtml = new WeakMap<HTMLElement, string>();
function setHtml(el: HTMLElement, html: string): void {
  if (lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  el.innerHTML = html;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class Hud {
  private readonly top: HTMLElement;
  private readonly fleet: HTMLElement;
  private readonly body: HTMLElement;
  private readonly root: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly map: MapDef;
  private readonly actions: HudActions;
  private speedFactor = 1;

  constructor(root: HTMLElement, map: MapDef, actions: HudActions) {
    this.map = map;
    this.actions = actions;
    root.insertAdjacentHTML(
      'beforeend',
      `
      <header class="topbar">
        <div class="brand">Flussreich</div>
        <div class="stats"></div>
        <div class="speed" role="group" aria-label="Tempo">
          <button class="btn on" data-act="speed" data-factor="1">1×</button>
          <button class="btn" data-act="speed" data-factor="4">4×</button>
        </div>
      </header>
      <aside class="ledger">
        <nav class="fleet" aria-label="Flotte"></nav>
        <div class="ledger-body" aria-live="polite"></div>
      </aside>
      <div class="toasts"></div>
      <div class="intro">
        <div class="intro-card">
          <div class="intro-head">Frachtbrief Nr. 1</div>
          <h1>Flussreich</h1>
          <p>Dein Handelshaus beginnt mit einem <b>Treidelkahn</b> und <b>500 Talern</b> im Holzfällerdorf <b>Oberau</b>. Acht Städte liegen am Weißstrom und am Erzbach, jede braucht etwas anderes.</p>
          <p>Talwärts trägt dich die Strömung, bergwärts ziehen Pferde. Unter der Brücke von Kesselbrück passt kein Mast, und der obere Erzbach ist nur für flache Boote tief genug.</p>
          <button class="btn primary" data-act="start">Leinen los</button>
        </div>
      </div>`,
    );
    this.top = root.querySelector('.topbar .stats')!;
    this.fleet = root.querySelector('.fleet')!;
    this.body = root.querySelector('.ledger-body')!;
    this.root = root;
    this.toasts = root.querySelector('.toasts')!;
    this.intro = root.querySelector('.intro')!;

    root.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!btn || btn.disabled) return;
      const { act, good, n, to, ship, type, factor } = btn.dataset;
      const amount = n === 'all' ? Infinity : Number(n);
      switch (act) {
        case 'select':
          this.actions.select(Number(ship));
          break;
        case 'buy':
          this.actions.buy(good!, amount);
          break;
        case 'sell':
          this.actions.sell(good!, amount);
          break;
        case 'depart':
          this.actions.depart(to!);
          break;
        case 'wait':
          this.actions.wait();
          break;
        case 'buyship':
          this.actions.buyShip(type!);
          break;
        case 'dismantle':
          this.actions.dismantle();
          break;
        case 'speed':
          this.speedFactor = Number(factor);
          this.root.querySelectorAll<HTMLButtonElement>('.speed .btn').forEach((b) =>
            b.classList.toggle('on', Number(b.dataset.factor) === this.speedFactor),
          );
          this.actions.speed(this.speedFactor);
          break;
        case 'start':
          this.intro.remove();
          this.actions.start();
          break;
      }
    });
  }

  render(state: GameState, selected: number): void {
    const w = wind(state);
    this.top.innerHTML = `
      <span><small>Kasse</small><b>${state.money}</b> Taler</span>
      <span><small>Tag</small><b>${day(state)}</b> ${clock(state.hour)}</span>
      <span class="hide-narrow"><small>Wind</small><b>${windText(w)}</b></span>`;

    const ship = state.ships.find((s) => s.id === selected) ?? state.ships[0];
    if (!ship) {
      setHtml(this.fleet, '');
      setHtml(this.body, `<div class="ledger-head"><h2>Keine Schiffe</h2><p>Deine Flotte ist leer.</p></div>`);
      return;
    }
    // Nur neu aufbauen, was sich geändert hat, sonst gehen Klicks während einer Fahrt verloren
    setHtml(this.fleet, this.renderFleet(state, ship));
    setHtml(this.body, ship.port ? this.renderPort(state, ship) : this.renderVoyage(ship));
  }

  private townName(id: string): string {
    return this.map.towns.find((t) => t.id === id)?.name ?? id;
  }

  private renderFleet(state: GameState, current: Ship): string {
    const chips = state.ships
      .map((s) => {
        const where = s.port
          ? `in ${this.townName(s.port)}`
          : `nach ${this.townName(s.voyage!.to)}`;
        return `<button class="chip ${s.id === current.id ? 'on' : ''}" data-act="select" data-ship="${s.id}">
          <b>${s.name}</b><small>${shipClass(s).name}, ${where}</small></button>`;
      })
      .join('');
    return chips;
  }

  private renderPort(state: GameState, ship: Ship): string {
    const town = this.map.towns.find((t) => t.id === ship.port)!;
    const market = state.markets[town.id];
    const cls = shipClass(ship);
    const load = cargoLoad(ship);
    const full = load >= cls.capacity;

    const goods = GOODS.filter((g) => market[g.id] || ship.cargo[g.id]);
    const rows = goods
      .map((g) => {
        const m = market[g.id];
        const slot = ship.cargo[g.id];
        const aboard = slot?.amount ?? 0;
        const avg = slot ? Math.round(slot.cost / slot.amount) : null;
        if (!m) {
          return `<tr class="muted"><th scope="row"><span class="swatch" style="background:${hex(g.color)}"></span>${g.name}<small>hier kein Handel</small></th>
            <td class="num">–</td><td class="num">–</td><td class="num">${aboard}</td><td></td></tr>`;
        }
        const bp = buyPrice(g.base, m);
        const sp = sellPrice(g.base, m);
        const margin = avg === null ? '' : sp > avg ? 'gain' : sp < avg ? 'loss' : '';
        const canBuy = !full && m.stock >= 1 && state.money >= bp;
        const flow = netFlow(town, g.id);
        const role = flow > 0 ? 'Überschuss' : flow < 0 ? 'Bedarf' : '';
        return `
        <tr>
          <th scope="row"><span class="swatch" style="background:${hex(g.color)}"></span>${g.name}<small>${Math.floor(m.stock)} t${role ? ` · ${role}` : ''}</small></th>
          <td class="num">${bp}</td>
          <td class="num ${margin}">${sp}${avg !== null ? `<small>ø ${avg}</small>` : ''}</td>
          <td class="num">${aboard}</td>
          <td class="acts">
            <button class="btn" data-act="buy" data-good="${g.id}" data-n="1" ${canBuy ? '' : 'disabled'}>+1</button>
            <button class="btn" data-act="buy" data-good="${g.id}" data-n="10" ${canBuy ? '' : 'disabled'}>+10</button>
            <button class="btn" data-act="sell" data-good="${g.id}" data-n="1" ${aboard ? '' : 'disabled'}>−1</button>
            <button class="btn" data-act="sell" data-good="${g.id}" data-n="all" ${aboard ? '' : 'disabled'}>alles</button>
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
        return `<button class="btn dest" data-act="depart" data-to="${t.id}"><b>${t.name}</b><small>${dir}, ${fmtHours(v.hours)}</small></button>`;
      })
      .join('');

    const industries = town.industries.length
      ? `<p class="note">Betriebe: ${town.industries
          .map(
            (i) =>
              `${i.name} (${Object.entries(i.inputs).map(([g, n]) => `${n} ${GOOD_BY_ID.get(g)!.name}`).join(' + ')} → ${Object.entries(i.outputs)
                .map(([g, n]) => `${n} ${GOOD_BY_ID.get(g)!.name}`)
                .join(' + ')})`,
          )
          .join(', ')} pro Tag</p>`
      : '';

    const yard = town.shipyard.length
      ? `<h3>Werft</h3><div class="yard">${town.shipyard
          .map((id) => {
            const c = SHIPS[id];
            return `<div class="yard-row">
              <div><b>${c.name}</b> <small>${c.capacity} t · ${c.speed} km/h · Tiefgang ${String(c.draft).replace('.', ',')} m · Höhe ${c.height} m</small>
              <small class="desc">${c.description}</small></div>
              <button class="btn" data-act="buyship" data-type="${id}" ${state.money >= c.price ? '' : 'disabled'}>${c.price} Taler</button>
            </div>`;
          })
          .join('')}</div>`
      : '';

    const raft =
      ship.type === 'floss'
        ? `<button class="btn primary wide" data-act="dismantle" ${load > 0 ? 'disabled' : ''}>Floß zerlegen und als Holz verkaufen
            <small>${load > 0 ? 'Erst die Ladung verkaufen' : `${RAFT_TIMBER} t Holz${market.holz ? '' : ', hier kauft aber niemand Holz'}`}</small></button>`
        : '';

    return `
      <div class="ledger-head">
        <div class="stamp-small">Kontor</div>
        <h2>${town.name}</h2>
        <p>${town.description}</p>
      </div>
      <p class="note">${ship.name} (${cls.name}): ${load}/${cls.capacity} t geladen</p>
      <table class="market">
        <thead><tr><th>Ware</th><th>Kauf</th><th>Verkauf</th><th>Bord</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${industries}
      ${raft}
      <h3>Ablegen nach</h3>
      <div class="dests">${departures}</div>
      <button class="btn wide" data-act="wait">Einen Tag warten<small>Städte produzieren und verbrauchen</small></button>
      ${yard}`;
  }

  private renderVoyage(ship: Ship): string {
    const v = ship.voyage!;
    const { leg, index } = voyagePosition(v);
    const seg = this.map.segments.find((s) => s.id === leg.seg)!;
    const cls = shipClass(ship);
    // Geschwindigkeit aus der geplanten Fahrzeit, so ist der Wind beim Ablegen schon eingerechnet
    const speed = seg.length / leg.hours;
    const pct = Math.round((v.elapsed / v.hours) * 100);
    const cargo = GOODS.filter((g) => ship.cargo[g.id])
      .map((g) => `${ship.cargo[g.id].amount} t ${g.name}`)
      .join(', ');
    const how =
      cls.propulsion === 'drift'
        ? 'Das Floß treibt mit der Strömung.'
        : leg.downstream
          ? 'Talwärts hilft die Strömung.'
          : cls.propulsion === 'tow'
            ? 'Bergwärts ziehen Treidelpferde vom Ufer.'
            : 'Bergwärts unter Segel, gegen die Strömung.';
    const route = v.legs
      .map((l, i) => `<li class="${i < index ? 'done' : i === index ? 'now' : ''}">${this.townName(l.from)} → ${this.townName(l.to)} <small>${fmtHours(l.hours)}</small></li>`)
      .join('');

    return `
      <div class="ledger-head">
        <div class="stamp-small">Unterwegs</div>
        <h2>${ship.name} nach ${this.townName(v.to)}</h2>
        <p>${how} ${speed.toFixed(1).replace('.', ',')} km/h über Grund, Strömung ${String(seg.current).replace('.', ',')} km/h.</p>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <p class="note">${fmtHours(v.elapsed)} von ${fmtHours(v.hours)}</p>
      <ol class="route">${route}</ol>
      <p class="note">Ladung: ${cargo || 'leer'}</p>`;
  }

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
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3800);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild!.remove();
  }

  stamp(title: string, sub: string): void {
    const el = document.createElement('div');
    el.className = 'stamp';
    el.innerHTML = `<div>${title}</div><small>${sub}</small>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3400);
  }
}
