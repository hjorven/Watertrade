import { GOODS } from '../data/goods.ts';
import type { MapDef } from '../data/maps/m1.ts';
import { buyPrice, sellPrice } from '../sim/economy.ts';
import { cargoLoad, day, planVoyage, type GameState, type TradeResult } from '../sim/game.ts';
import { groundSpeed } from '../sim/river.ts';

export interface HudActions {
  buy(good: string, amount: number): void;
  sell(good: string, amount: number): void;
  depart(to: string): void;
  wait(): void;
  start(): void;
}

const fmtHours = (h: number) => {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min === 0 ? `${whole} Std` : `${whole} Std ${min} Min`;
};

const clock = (hour: number) => {
  const h = Math.floor(hour % 24);
  const m = Math.floor((hour % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export class Hud {
  private readonly top: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly map: MapDef;
  private readonly actions: HudActions;

  constructor(root: HTMLElement, map: MapDef, actions: HudActions) {
    this.map = map;
    this.actions = actions;
    root.insertAdjacentHTML(
      'beforeend',
      `
      <header class="topbar">
        <div class="brand">Flussreich</div>
        <div class="stats"></div>
      </header>
      <aside class="ledger" aria-live="polite"></aside>
      <div class="toasts"></div>
      <div class="intro">
        <div class="intro-card">
          <div class="intro-head">Frachtbrief Nr. 1</div>
          <h1>Flussreich</h1>
          <p>Dein Handelshaus beginnt mit einem <b>Treidelkahn</b> und <b>300 Talern</b> im Holzfällerdorf <b>Oberau</b> am Oberlauf.</p>
          <p>Kaufe, wo eine Ware reichlich da ist, und verkaufe, wo sie gebraucht wird. Talwärts trägt dich die Strömung, bergwärts ziehen Pferde den Kahn, das dauert.</p>
          <button class="btn primary" data-act="start">Leinen los</button>
        </div>
      </div>`,
    );
    this.top = root.querySelector('.topbar .stats')!;
    this.panel = root.querySelector('.ledger')!;
    this.toasts = root.querySelector('.toasts')!;
    this.intro = root.querySelector('.intro')!;

    root.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!btn || btn.disabled) return;
      const { act, good, n, to } = btn.dataset;
      const amount = n === 'all' ? Infinity : Number(n);
      if (act === 'buy') this.actions.buy(good!, amount);
      if (act === 'sell') this.actions.sell(good!, amount);
      if (act === 'depart') this.actions.depart(to!);
      if (act === 'wait') this.actions.wait();
      if (act === 'start') {
        this.intro.remove();
        this.actions.start();
      }
    });
  }

  render(state: GameState): void {
    const load = cargoLoad(state);
    this.top.innerHTML = `
      <span><small>Kasse</small><b>${state.money}</b> Taler</span>
      <span><small>Tag</small><b>${day(state)}</b> ${clock(state.hour)}</span>
      <span><small>Laderaum</small><b>${load}</b>/${state.shipType.capacity} t</span>`;

    if (state.port) this.renderPort(state);
    else this.renderVoyage(state);
  }

  private renderPort(state: GameState): void {
    const town = this.map.towns.find((t) => t.id === state.port)!;
    const market = state.markets[town.id];
    const full = cargoLoad(state) >= state.shipType.capacity;

    const rows = GOODS.map((g) => {
      const m = market[g.id];
      const slot = state.cargo[g.id];
      const bp = buyPrice(g.base, m);
      const sp = sellPrice(g.base, m);
      const avg = slot.amount > 0 ? Math.round(slot.cost / slot.amount) : null;
      const margin = avg === null ? '' : sp > avg ? 'gain' : sp < avg ? 'loss' : '';
      const canBuy = !full && m.stock > 0 && state.money >= bp;
      const has = slot.amount > 0;
      return `
        <tr>
          <th scope="row"><span class="swatch" style="background:#${g.color.toString(16).padStart(6, '0')}"></span>${g.name}<small>${m.stock} t am Markt</small></th>
          <td class="num">${bp}</td>
          <td class="num ${margin}">${sp}${avg !== null ? `<small>Einkauf ø ${avg}</small>` : ''}</td>
          <td class="num">${slot.amount}</td>
          <td class="acts">
            <button class="btn" data-act="buy" data-good="${g.id}" data-n="1" ${canBuy ? '' : 'disabled'}>+1</button>
            <button class="btn" data-act="buy" data-good="${g.id}" data-n="10" ${canBuy ? '' : 'disabled'}>+10</button>
            <button class="btn" data-act="sell" data-good="${g.id}" data-n="1" ${has ? '' : 'disabled'}>−1</button>
            <button class="btn" data-act="sell" data-good="${g.id}" data-n="all" ${has ? '' : 'disabled'}>alles</button>
          </td>
        </tr>`;
    }).join('');

    const departures = this.map.towns
      .filter((t) => t.id !== town.id)
      .map((t) => {
        const v = planVoyage(state, this.map, t.id);
        if (!v) return `<p class="note">Nach ${t.name} ist der Fluss derzeit nicht befahrbar.</p>`;
        const dir = v.downstream ? 'talwärts mit der Strömung' : 'bergwärts mit Treidelpferden';
        return `<button class="btn primary wide" data-act="depart" data-to="${t.id}">
                  Ablegen nach ${t.name}<small>${dir}, ca. ${fmtHours(v.hours)}</small>
                </button>`;
      })
      .join('');

    this.panel.innerHTML = `
      <div class="ledger-head">
        <div class="stamp-small">Kontor</div>
        <h2>${town.name}</h2>
        <p>${town.description}</p>
      </div>
      <table class="market">
        <thead><tr><th>Ware</th><th>Kauf</th><th>Verkauf</th><th>An Bord</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">Preise in Talern je Tonne. Große Mengen verschieben den Preis.</p>
      <div class="departures">${departures}
        <button class="btn wide" data-act="wait">Einen Tag im Hafen warten<small>Märkte füllen sich wieder auf</small></button>
      </div>`;
  }

  private renderVoyage(state: GameState): void {
    const v = state.voyage!;
    const to = this.map.towns.find((t) => t.id === v.to)!;
    const seg = this.map.segments[0];
    const speed = groundSpeed(seg, state.shipType, v.downstream);
    const pct = Math.round((v.elapsed / v.hours) * 100);
    const cargo = GOODS.filter((g) => state.cargo[g.id].amount > 0)
      .map((g) => `${state.cargo[g.id].amount} t ${g.name}`)
      .join(', ');

    this.panel.innerHTML = `
      <div class="ledger-head">
        <div class="stamp-small">Unterwegs</div>
        <h2>Nach ${to.name}</h2>
        <p>${
          v.downstream
            ? `Talwärts trägt die Strömung den Kahn: ${speed} km/h über Grund (${state.shipType.speed} km/h Eigenfahrt + ${seg.current} km/h Strömung).`
            : `Bergwärts gegen die Strömung ziehen Treidelpferde den Kahn: nur ${speed} km/h über Grund (${state.shipType.speed} km/h minus ${seg.current} km/h Strömung).`
        }</p>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <p class="note">${fmtHours(v.elapsed)} von ${fmtHours(v.hours)} · ${seg.length} km</p>
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
