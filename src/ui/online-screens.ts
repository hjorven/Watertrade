import { CHALLENGES, DAILY_DAYS } from '../data/challenges.ts';
import { SHIPS } from '../data/ships.ts';
import { dailyOptions, dailyRule } from '../sim/daily.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { ACHIEVEMENTS } from '../sim/achievements.ts';
import { price, SELL_FACTOR } from '../sim/economy.ts';
import { dateText } from '../sim/calendar.ts';
import type { SaveGame } from '../sim/save.ts';
import { dailySeed, LEAGUE_TRAVEL_SECONDS, secondsUntilArrival, SLOT_COUNT, todayUtc } from '../online/rules.ts';
import type { DailyEntry, LeagueMarketRow, LeaguePlayer, LeagueRankEntry, SlotInfo as CloudSlot } from '../online/index.ts';

type OnlineApi = typeof import('../online/index.ts');
let api: Promise<OnlineApi> | null = null;
/** Supabase erst laden, wenn jemand einen Online-Bildschirm öffnet: hält den Spielstart schlank */
function online(): Promise<OnlineApi> {
  api ??= import('../online/index.ts');
  return api;
}
import type { Menu } from './menu.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (n: number) => Math.floor(n).toLocaleString('de-DE');
const LEAGUE_CARGO = 40;

export interface OnlineHooks {
  /** scored: gewerteter Versuch des Tages, sonst Übungsrunde */
  startDaily(day: string, seed: number, scored: boolean): void;
  /** Spielstand zum Speichern, null außerhalb eines Spiels oder in Wertungsmodi */
  currentSave(): SaveGame | null;
  inGame(): boolean;
  loadSave(save: SaveGame): boolean;
  unlock(id: string): void;
  achievements(): Record<string, string>;
  challenges(): Record<string, number>;
  /** lokaler Stand des Tages: gewerteter Versuch begonnen, gewertetes Ergebnis */
  dailyLocal(day: string): { tried: boolean; worth: number | null };
  toast(text: string, kind?: 'info' | 'warn' | 'gain'): void;
  sfx(name: 'klick' | 'kauf' | 'verkauf' | 'muenzen' | 'fehler' | 'ablegen' | 'erfolg' | 'papier'): void;
}

/** Schöne Fehlermeldungen für Serverantworten */
function niceError(e: string): string {
  const map: Record<string, string> = {
    'nicht genug taler': 'Nicht genug Taler.',
    'nicht genug bestand': 'So viel hat der Markt nicht.',
    'laderaum voll': `Der Laderaum fasst nur ${LEAGUE_CARGO} t.`,
    'nicht genug ladung': 'So viel hast du nicht an Bord.',
    'nicht in dieser stadt': 'Dein Kahn ist noch unterwegs.',
    'nicht in der liga': 'Du bist noch nicht in der Liga.',
  };
  for (const [k, v] of Object.entries(map)) if (e.toLowerCase().includes(k)) return v;
  if (/fetch|network/i.test(e)) return 'Keine Verbindung zum Server.';
  return e;
}

/** Fehlermeldungen des Tagesmarkts (eigene Liste, niceError gehört der Liga) */
function dailyError(e: string): string {
  const map: Record<string, string> = {
    'kein gewerteter versuch': 'Kein gewerteter Versuch angemeldet.',
    'versuch abgelaufen': 'Der Versuch ist älter als zwei Tage.',
    'tagesmarkt nicht von heute': 'Dieser Tagesmarkt ist nicht von heute.',
  };
  for (const [k, v] of Object.entries(map)) if (e.toLowerCase().includes(k)) return v;
  return niceError(e);
}

/** Tagesmarkt, Handelsliga, Konto mit Cloud-Speicher und Erfolge als Menükarten */
export class OnlineScreens {
  private readonly menu: Menu;
  private readonly map: MapDef;
  private readonly hooks: OnlineHooks;

  // Liga
  private player: LeaguePlayer | null = null;
  private market: LeagueMarketRow[] = [];
  private ranking: LeagueRankEntry[] = [];
  private leagueMsg = '';
  private leagueBusy = false;
  private unsubscribe: (() => void) | null = null;
  private ticker = 0;
  private lastWait = 0;

  // Tagesmarkt
  private daily: { entries: DailyEntry[] | null; status: string } = { entries: null, status: '' };
  /** Stand des eigenen gewerteten Versuchs laut Server */
  private dailyServer: { day: string; started: boolean; wealth: number | null } | null = null;
  private dailyStarting = false;

  // Konto
  private account: { name: string | null; email: string | null; anonymous: boolean; slots: CloudSlot[]; status: string; reachable: boolean } = {
    name: null,
    email: null,
    anonymous: true,
    slots: [],
    status: '',
    reachable: true,
  };

  constructor(menu: Menu, map: MapDef, hooks: OnlineHooks) {
    this.menu = menu;
    this.map = map;
    this.hooks = hooks;
  }

  private townName(id: string): string {
    return this.map.towns.find((t) => t.id === id)?.name ?? id;
  }

  /** Klicks aus der Menükarte */
  handle(cmd: string, d: DOMStringMap): void {
    switch (cmd) {
      case 'daily':
        void this.openDaily();
        break;
      case 'dailyStart':
        void this.startDailyRun();
        break;
      case 'league':
        void this.openLeague();
        break;
      case 'leagueTravel':
        void this.leagueAction(async () => (await online()).leagueTravel(d.id!), (p) => {
          this.player = p;
          this.hooks.sfx('ablegen');
          this.leagueMsg = `Unterwegs nach ${this.townName(p.townId)}.`;
        });
        break;
      case 'leagueTrade': {
        const amount = Number(d.amount);
        void this.leagueAction(async () => (await online()).leagueTrade(this.player!.townId, d.good!, amount), (r) => {
          if (!this.player) return;
          this.player = { ...this.player, gold: r.gold, cargo: r.cargo ?? {}, wealth: r.wealth };
          const row = this.market.find((m) => m.townId === this.player!.townId && m.goodId === d.good);
          if (row) row.stock = r.stock;
          const good = GOOD_BY_ID.get(d.good!)?.name ?? d.good;
          this.leagueMsg = amount < 0 ? `${-amount} t ${good} für ${fmt(r.taler)} Taler gekauft.` : `${amount} t ${good} für ${fmt(r.taler)} Taler verkauft.`;
          this.hooks.sfx(amount < 0 ? 'kauf' : 'muenzen');
          this.hooks.unlock('liga');
        });
        break;
      }
      case 'leagueRefresh':
        void this.openLeague();
        break;
      case 'account':
        void this.openAccount();
        break;
      case 'setName':
        void this.accountAction(async () => {
          const r = await (await online()).setUsername(this.menu.value('name'));
          this.account.status = r.ok ? `Name gespeichert: ${r.data}` : r.error;
          if (r.ok) this.account.name = r.data;
        });
        break;
      case 'magicLink':
        void this.accountAction(async () => {
          const email = this.menu.value('email');
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            this.account.status = 'Bitte eine gültige E-Mail-Adresse eingeben.';
            return;
          }
          const r = await (await online()).signInWithMagicLink(email);
          this.account.status = r.ok ? `Link verschickt an ${email}. Öffne ihn auf diesem oder einem anderen Gerät.` : niceError(r.error);
        });
        break;
      case 'signOut':
        void this.accountAction(async () => {
          const r = await (await online()).signOut();
          this.account.status = r.ok ? 'Abgemeldet.' : r.error;
          await this.loadAccount();
        });
        break;
      case 'cloudSave':
        void this.accountAction(async () => {
          const save = this.hooks.currentSave();
          if (!save) return;
          const slot = Number(d.id);
          const r = await (await online()).saveSlot(slot, cloudName(save), save);
          this.account.status = r.ok ? `In der Cloud gespeichert, Platz ${slot}.` : niceError(r.error);
          await this.loadSlots();
          if (r.ok) this.hooks.sfx('papier');
        });
        break;
      case 'cloudLoad':
        void this.accountAction(async () => {
          const r = await (await online()).loadSlot<SaveGame>(Number(d.id));
          if (!r.ok || !r.data) {
            this.account.status = r.ok ? 'Dieser Platz ist leer.' : niceError(r.error);
            return;
          }
          this.menu.close();
          if (!this.hooks.loadSave(r.data.data)) this.hooks.toast('Dieser Spielstand lässt sich nicht laden.', 'warn');
        });
        break;
      case 'achievements':
        this.showAchievements();
        break;
    }
  }

  // --- Tagesmarkt ---

  private async openDaily(): Promise<void> {
    const api = await online();
    this.daily = { entries: null, status: api.isConfigured() ? 'Bestenliste wird geladen ...' : 'Ohne Verbindung gibt es keine Bestenliste.' };
    this.renderDaily();
    if (!api.isConfigured()) return;
    const day = todayUtc();
    const [r, mine] = await Promise.all([api.topDaily(day, 10), api.myDaily(day)]);
    this.daily = r.ok ? { entries: r.data, status: r.data.length ? '' : 'Heute hat noch niemand gespielt. Sei der Erste.' } : { entries: null, status: niceError(r.error) };
    this.dailyServer = mine.ok ? { day, ...mine.data } : null;
    if (this.menu.screen === 'daily') this.renderDaily();
  }

  /** Gewerteter Versuch schon verbraucht? Server hat Vorrang vor dem lokalen Stand. */
  private dailyUsed(day: string): { tried: boolean; worth: number | null } {
    const local = this.hooks.dailyLocal(day);
    const srv = this.dailyServer?.day === day ? this.dailyServer : null;
    return { tried: local.tried || !!srv?.started, worth: srv?.wealth ?? local.worth };
  }

  /** Versuch beim Server anmelden: nur der erste des Tages wird gewertet */
  private async startDailyRun(): Promise<void> {
    if (this.dailyStarting) return;
    this.dailyStarting = true;
    try {
      const day = todayUtc();
      const api = await online();
      let scored = !this.dailyUsed(day).tried;
      if (api.isConfigured()) {
        const r = await api.beginDaily(day);
        if (r.ok) {
          scored = r.data.scored;
          this.dailyServer = { day, started: true, wealth: r.data.wealth };
        } else {
          scored = false;
          this.hooks.toast(`Der Versuch ließ sich nicht beim Server anmelden (${dailyError(r.error)}). Diese Runde ist eine Übungsrunde.`, 'warn');
        }
      }
      this.menu.close();
      this.stopLeague();
      if (!scored) this.hooks.toast('Übungsrunde: Dieser Tagesmarkt zählt nicht für die Bestenliste.', 'info');
      this.hooks.startDaily(day, dailySeed(day), scored);
    } finally {
      this.dailyStarting = false;
    }
  }

  private renderDaily(result?: { worth: number; scored: boolean; accepted: boolean | null; kept?: number | null }): void {
    const day = todayUtc();
    const seed = dailySeed(day);
    const opts = dailyOptions(day, seed);
    const rule = dailyRule(day);
    const used = this.dailyUsed(day);
    const shipName = SHIPS[opts.startShip ?? 'treidelkahn']?.name ?? 'Treidelkahn';
    const dateText = new Date(day + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    let resultText = '';
    if (result) {
      resultText = `<p>Dein Vermögen nach ${DAILY_DAYS} Tagen: Kasse, Schiffe, Kontore, Betriebe und Ladung zum Marktwert.`;
      if (!result.scored) resultText += ' Das war eine Übungsrunde, sie zählt nicht.';
      else if (result.accepted) resultText += ' Eingetragen in der Bestenliste.';
      else if (result.accepted === false) resultText += result.kept != null ? ` Für heute steht schon ${fmt(result.kept)} Taler in der Bestenliste.` : ' Das Ergebnis wurde nicht angenommen.';
      resultText += '</p>';
    }
    this.menu.show(`
      ${result ? `<div class="stamp-big">${result.scored ? 'Abgerechnet' : 'Übung'}</div>` : ''}
      <div class="card-head">Tagesmarkt · ${esc(dateText)}</div>
      <h2>${result ? `${fmt(result.worth)} Taler` : 'Ein Tal für alle'}</h2>
      ${
        result
          ? resultText
          : `<p>Heute starten alle in <b>${esc(this.townName(opts.startTown))}</b> mit einem ${esc(shipName)} und <b>${fmt(opts.money ?? 0)} Taler</b>, im Jahr ${opts.startYear ?? 1}. Markt, Wetter, Ereignisse und Konkurrenz sind für alle gleich. Nach ${DAILY_DAYS} Spieltagen zählt das Vermögen.</p>`
      }
      <p><b>Tagesregel: ${esc(rule.name)}.</b> ${esc(rule.text)}</p>
      <p class="fine">${
        used.tried
          ? `Dein gewerteter Versuch für heute ist verbraucht${used.worth !== null ? ` (${fmt(used.worth)} Taler)` : ''}. Weitere Runden sind Übung und zählen nicht.`
          : 'Pro Tag zählt nur der erste Versuch. Er wird beim Start auf dem Server angemeldet, Neustarten hilft also nicht.'
      }</p>
      <h3>Bestenliste heute</h3>
      ${this.daily.entries?.length ? rankTable(this.daily.entries) : `<p class="fine">${esc(this.daily.status)}</p>`}
      <div class="menu-buttons">
        <button class="btn primary wide" data-menu="dailyStart">${used.tried ? 'Übungsrunde spielen' : 'Gewerteten Versuch beginnen'}</button>
        ${result ? '<button class="btn wide" data-menu="resume">Weiterspielen ohne Wertung</button>' : ''}
      </div>
      <p class="fine"><button class="link" data-menu="leave">Hauptmenü</button>${this.account.name ? '' : ' · <button class="link" data-menu="account">Namen für die Bestenliste festlegen</button>'}</p>`);
    this.menu.screen = 'daily';
  }

  /** Tagesmarkt abgelaufen: gewerteten Versuch eintragen und Bestenliste zeigen */
  async finishDaily(day: string, worth: number, scored: boolean): Promise<void> {
    this.hooks.unlock('tagesmarkt');
    const api = await online();
    const configured = api.isConfigured();
    this.daily = {
      entries: null,
      status: !configured ? 'Ohne Verbindung wird nur lokal gezählt.' : scored ? 'Ergebnis wird eingetragen ...' : 'Bestenliste wird geladen ...',
    };
    this.renderDaily({ worth, scored, accepted: null });
    if (!configured) return;
    const sent = scored ? await api.submitDaily(worth, day) : null;
    const top = await api.topDaily(day, 10);
    this.daily = top.ok ? { entries: top.data, status: '' } : { entries: null, status: niceError(top.error) };
    if (sent && !sent.ok) this.daily.status = dailyError(sent.error);
    if (sent?.ok) this.dailyServer = { day, started: true, wealth: sent.data.wealth };
    if (this.menu.screen === 'daily') {
      this.renderDaily({ worth, scored, accepted: sent?.ok ? sent.data.accepted : null, kept: sent?.ok ? sent.data.wealth : null });
    }
  }

  // --- Handelsliga ---

  private async openLeague(): Promise<void> {
    if (!(await online()).isConfigured()) {
      this.leagueMsg = 'Die Handelsliga braucht eine Verbindung zum Server.';
      this.renderLeague();
      return;
    }
    this.leagueBusy = true;
    this.leagueMsg = 'Verbinde mit der Liga ...';
    this.renderLeague();
    const [p, m, r] = await Promise.all([(await online()).joinLeague(), (await online()).getLeagueMarket(), (await online()).leagueRanking(10)]);
    this.leagueBusy = false;
    if (!p.ok) {
      this.leagueMsg = niceError(p.error);
      this.renderLeague();
      return;
    }
    this.player = p.data;
    if (m.ok) this.market = m.data;
    if (r.ok) this.ranking = r.data;
    this.leagueMsg = '';
    if (!this.unsubscribe) {
      const subscribe = (await online()).subscribeLeagueMarket as (
        onChange: (row: LeagueMarketRow) => void,
        onGiveUp?: () => void,
      ) => () => void;
      this.unsubscribe = subscribe((row) => {
        const i = this.market.findIndex((x) => x.townId === row.townId && x.goodId === row.goodId);
        if (i >= 0) this.market[i] = row;
        else this.market.push(row);
        if (this.menu.screen === 'league') this.renderLeague();
      }, () => {
        // Realtime gibt nach mehreren Fehlversuchen auf: Preise nur noch beim Neuladen aktuell
        this.unsubscribe = null;
        this.leagueMsg = 'Live-Verbindung unterbrochen. Die Preise aktualisieren sich beim Neuladen.';
        if (this.menu.screen === 'league') this.renderLeague();
      });
    }
    if (!this.ticker) {
      this.ticker = window.setInterval(() => {
        if (this.menu.screen !== 'league') {
          this.stopLeague();
          return;
        }
        // nur während der Fahrt neu zeichnen, sonst würden Klicks ins Leere gehen
        const wait = this.player ? secondsUntilArrival(this.player) : 0;
        if (wait > 0) this.updateTravel(wait);
        else if (this.lastWait > 0) this.renderLeague();
        this.lastWait = wait;
      }, 1000);
    }
    this.renderLeague();
  }

  /** Nur Balken und Sekunden der laufenden Fahrt erneuern */
  private updateTravel(wait: number): void {
    const box = document.querySelector('.league-travel');
    if (!box) return;
    const bar = box.querySelector<HTMLElement>('.bar i');
    if (bar) bar.style.width = `${Math.round((1 - wait / LEAGUE_TRAVEL_SECONDS) * 100)}%`;
    const sec = box.querySelector('.sec');
    if (sec) sec.textContent = String(wait);
  }

  private stopLeague(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.ticker) window.clearInterval(this.ticker);
    this.ticker = 0;
  }

  private async leagueAction<T>(
    run: () => Promise<{ ok: true; data: T } | { ok: false; error: string; offline: boolean }>,
    done: (data: T) => void,
  ): Promise<void> {
    if (this.leagueBusy || !this.player) return;
    this.leagueBusy = true;
    this.renderLeague();
    const r = await run();
    this.leagueBusy = false;
    if (r.ok) done(r.data);
    else {
      this.leagueMsg = niceError(r.error);
      this.hooks.sfx('fehler');
    }
    const rank = await (await online()).leagueRanking(10);
    if (rank.ok) this.ranking = rank.data;
    if (this.menu.screen === 'league') this.renderLeague();
  }

  private renderLeague(): void {
    const p = this.player;
    let body = '';
    if (p) {
      const wait = secondsUntilArrival(p);
      const load = Object.values(p.cargo).reduce((s, n) => s + n, 0);
      const towns = [...new Set(this.market.map((m) => m.townId))];
      const here = this.market.filter((m) => m.townId === p.townId);
      const cargoText = Object.entries(p.cargo)
        .filter(([, n]) => n > 0)
        .map(([g, n]) => `${n} t ${esc(GOOD_BY_ID.get(g)?.name ?? g)}`)
        .join(', ');
      const dis = this.leagueBusy ? 'disabled' : '';
      const rows = here
        .map((m) => {
          const g = GOOD_BY_ID.get(m.goodId);
          const buyP = price(m.basePrice, m.stock - 1, m.targetStock);
          const sellP = Math.floor(price(m.basePrice, m.stock + 1, m.targetStock) * SELL_FACTOR);
          const have = p.cargo[m.goodId] ?? 0;
          const canBuy = !wait && m.stock > 0 && load < LEAGUE_CARGO && p.gold >= buyP;
          const fill = Math.min(LEAGUE_CARGO - load, m.stock, Math.floor(p.gold / Math.max(1, buyP)));
          return `<tr>
            <td><span class="swatch" style="background:#${(g?.color ?? 0x888888).toString(16).padStart(6, '0')}"></span>${esc(g?.name ?? m.goodId)}</td>
            <td class="num">${fmt(m.stock)} t</td><td class="num">${buyP}</td><td class="num">${sellP}</td><td class="num">${have || ''}</td>
            <td class="acts">
              <button class="btn small" data-menu="leagueTrade" data-good="${m.goodId}" data-amount="-1" ${canBuy && !dis ? '' : 'disabled'}>+1</button>
              <button class="btn small" data-menu="leagueTrade" data-good="${m.goodId}" data-amount="${-Math.max(1, Math.min(10, fill))}" ${canBuy && fill >= 2 && !dis ? '' : 'disabled'}>+${Math.max(1, Math.min(10, fill))}</button>
              <button class="btn small" data-menu="leagueTrade" data-good="${m.goodId}" data-amount="1" ${have && !wait && !dis ? '' : 'disabled'}>−1</button>
              <button class="btn small" data-menu="leagueTrade" data-good="${m.goodId}" data-amount="${have}" ${have > 1 && !wait && !dis ? '' : 'disabled'}>alles</button>
            </td></tr>`;
        })
        .join('');
      body = `
        <div class="league-head">
          <span><small>Ort</small><b>${wait ? `unterwegs nach ${esc(this.townName(p.townId))}` : esc(this.townName(p.townId))}</b></span>
          <span><small>Kasse</small><b>${fmt(p.gold)} Taler</b></span>
          <span><small>Laderaum</small><b>${load} / ${LEAGUE_CARGO} t</b></span>
          <span><small>Vermögen</small><b>${fmt(p.wealth)}</b></span>
        </div>
        ${cargoText ? `<p class="fine">An Bord: ${cargoText}</p>` : ''}
        ${
          wait
            ? `<div class="league-travel"><div class="bar"><i style="width:${Math.round((1 - wait / LEAGUE_TRAVEL_SECONDS) * 100)}%"></i></div><p>Ankunft in <b class="sec">${wait}</b> Sekunden. Die Preise ändern sich derweil mit jedem Handel der anderen.</p></div>`
            : `<table class="league-market"><thead><tr><th>Ware</th><th class="num">Bestand</th><th class="num">Kauf</th><th class="num">Verkauf</th><th class="num">Bord</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        }
        <h3>Fahren nach</h3>
        <div class="slot-grid league-towns">${towns
          .filter((t) => t !== p.townId)
          .map((t) => `<button class="btn" data-menu="leagueTravel" data-id="${t}" ${wait || dis ? 'disabled' : ''}>${esc(this.townName(t))}<small>${LEAGUE_TRAVEL_SECONDS} s</small></button>`)
          .join('')}</div>
        <h3>Rangliste</h3>
        ${this.ranking.length ? rankTable(this.ranking) : '<p class="fine">Noch keine Einträge.</p>'}`;
    }
    this.menu.show(
      `<div class="card-head">Handelsliga · live</div>
      <h2>Ein Markt für alle</h2>
      <p class="fine">Alle Spieler handeln auf demselben Markt. Jeder Kauf macht die Ware teurer, jeder Verkauf billiger, für alle. Ein Kahn mit ${LEAGUE_CARGO} t, Start mit 300 Talern. Die Märkte erholen sich langsam von selbst.</p>
      ${this.leagueMsg ? `<p class="league-msg">${esc(this.leagueMsg)}</p>` : ''}
      ${body}
      <p class="fine"><button class="link" data-menu="leagueRefresh">Neu laden</button> · <button class="link" data-menu="account">Konto und Name</button> · <button class="link" data-menu="${this.menuBack()}">Zurück</button></p>`,
      true,
    );
    this.menu.screen = 'league';
  }

  private menuBack(): string {
    return this.hooks.inGame() ? 'resume' : 'main';
  }

  // --- Konto ---

  private async loadAccount(): Promise<void> {
    // echte Anfrage als Verbindungstest, getUsername fragt ohne Sitzung gar nicht beim Server nach
    const api = await online();
    // Der Client wiederholt fehlgeschlagene Anfragen eine Weile; nach 5 Sekunden gilt der Server als nicht erreichbar
    const ping = await Promise.race([
      api.getLeagueMarket(),
      new Promise<{ ok: false; error: string; offline: false }>((resolve) =>
        setTimeout(() => resolve({ ok: false, error: 'Zeitüberschreitung', offline: false }), 5000),
      ),
    ]);
    this.account.reachable = ping.ok;
    if (!ping.ok) {
      this.account.status = ping.offline ? 'Ohne Verbindung zum Server gibt es kein Konto.' : 'Der Server ist gerade nicht erreichbar. Versuch es später noch einmal.';
      return;
    }
    const me = await (await online()).currentPlayer();
    this.account.email = me?.email ?? null;
    this.account.anonymous = !me || me.anonymous;
    const n = await (await online()).getUsername();
    this.account.name = n.ok ? n.data : null;
    await this.loadSlots();
  }

  private async loadSlots(): Promise<void> {
    const me = await (await online()).currentPlayer();
    if (!me) {
      this.account.slots = [];
      return;
    }
    const s = await (await online()).listSlots();
    this.account.slots = s.ok ? s.data : [];
  }

  private async openAccount(): Promise<void> {
    this.account.status = (await online()).isConfigured() ? 'Lade Konto ...' : 'Ohne Verbindung zum Server gibt es kein Konto.';
    this.renderAccount();
    if (!(await online()).isConfigured()) return;
    this.account.status = '';
    await this.loadAccount();
    if (this.menu.screen === 'account') this.renderAccount();
  }

  private async accountAction(run: () => Promise<void>): Promise<void> {
    this.account.status = 'Einen Moment ...';
    this.renderAccount();
    await run();
    if (this.menu.screen === 'account') this.renderAccount();
  }

  private renderAccount(): void {
    const a = this.account;
    const save = this.hooks.currentSave();
    const slots = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1)
      .map((n) => {
        const s = a.slots.find((x) => x.slot === n);
        return `<div class="cloud-slot"><span>Platz ${n}<small>${s ? `${esc(s.name)} · ${new Date(s.updatedAt).toLocaleString('de-DE')}` : 'leer'}</small></span>
          <button class="btn small" data-menu="cloudSave" data-id="${n}" ${save && a.reachable ? '' : 'disabled'}>Speichern</button>
          <button class="btn small" data-menu="cloudLoad" data-id="${n}" ${s ? '' : 'disabled'}>Laden</button></div>`;
      })
      .join('');
    this.menu.show(`
      <div class="card-head">Konto</div>
      <h2>${a.name ? esc(a.name) : 'Ohne Namen'}</h2>
      <p class="fine">${
        a.email ? `Angemeldet mit ${esc(a.email)}. Deine Spielstände und Ergebnisse gehören zu dieser Adresse.` : 'Du spielst ohne Anmeldung. Mit einer E-Mail-Adresse kannst du dein Konto auf andere Geräte mitnehmen, ein Passwort gibt es nicht.'
      }</p>
      ${a.status ? `<p class="league-msg">${esc(a.status)}</p>` : ''}
      <form class="inline-form"><label>Name in den Bestenlisten<input name="name" maxlength="20" placeholder="3 bis 20 Zeichen" value="${esc(a.name ?? '')}"></label><button type="button" class="btn" data-menu="setName" ${a.reachable ? '' : 'disabled'}>Speichern</button></form>
      ${
        a.email
          ? '<p class="fine"><button class="link" data-menu="signOut">Abmelden</button></p>'
          : `<form class="inline-form"><label>E-Mail für den Anmeldelink<input name="email" type="email" placeholder="name@beispiel.de"></label><button type="button" class="btn" data-menu="magicLink" ${a.reachable ? '' : 'disabled'}>Link senden</button></form>`
      }
      <h3>Cloud-Speicher</h3>
      <p class="fine">${save ? 'Speichert das laufende Spiel auf dem Server.' : this.hooks.inGame() ? 'Herausforderungen und Tagesmarkt lassen sich nicht speichern.' : 'Starte oder lade ein Spiel, um es in der Cloud zu speichern.'}</p>
      <div class="cloud-slots">${slots}</div>
      <p class="fine"><button class="link" data-menu="${this.menuBack()}">Zurück</button></p>`);
    this.menu.screen = 'account';
  }

  // --- Erfolge ---

  showAchievements(): void {
    const have = this.hooks.achievements();
    const done = this.hooks.challenges();
    const count = ACHIEVEMENTS.filter((a) => have[a.id]).length;
    const list = ACHIEVEMENTS.map((a) => {
      const when = have[a.id];
      return `<li class="${when ? 'done' : ''}"><b>${esc(a.title)}</b><small>${esc(a.text)}${when ? ` · ${new Date(when).toLocaleDateString('de-DE')}` : ''}</small></li>`;
    }).join('');
    const ch = CHALLENGES.map((c) => `<li class="${done[c.id] !== undefined ? 'done' : ''}"><b>${esc(c.title)}</b><small>${done[c.id] !== undefined ? `bestanden in ${done[c.id]} Tagen` : 'offen'}</small></li>`).join('');
    this.menu.show(`
      <div class="card-head">Erfolge · ${count} von ${ACHIEVEMENTS.length}</div>
      <h2>Das Hausbuch</h2>
      <ul class="achievements">${list}</ul>
      <h3>Herausforderungen</h3>
      <ul class="achievements">${ch}</ul>
      <p class="fine"><button class="link" data-menu="${this.menuBack()}">Zurück</button></p>`, true);
    this.menu.screen = 'achievements';
  }
}

function rankTable(list: { rank: number; username: string; wealth: number; mine: boolean }[]): string {
  return `<table class="rank-table"><tbody>${list
    .map((e) => `<tr class="${e.mine ? 'mine' : ''}"><td class="num">${e.rank}.</td><td>${esc(e.username)}${e.mine ? ' (du)' : ''}</td><td class="num">${fmt(e.wealth)} Taler</td></tr>`)
    .join('')}</tbody></table>`;
}

function cloudName(save: SaveGame): string {
  const what =
    save.mode === 'kampagne' ? 'Kampagne' : save.mode === 'herausforderung' ? 'Herausforderung' : save.mode === 'tagesmarkt' ? 'Tagesmarkt' : 'Freies Spiel';
  const day = Math.floor(save.state.hour / 24) + 1;
  return `${what}, ${dateText(day)}, ${fmt(save.state.money)} Taler`.slice(0, 60);
}
