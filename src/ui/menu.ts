import { CHAPTERS, type Chapter } from '../data/campaign.ts';
import { CHALLENGES } from '../data/challenges.ts';

export interface SlotInfo {
  slot: string; // 'auto' | '1' | '2' | '3'
  label: string;
  savedAt?: string;
  summary?: string;
}

export interface MenuActions {
  continueGame(): void;
  startChapter(id: string): void;
  startFree(): void;
  save(slot: string): void;
  load(slot: string): void;
  setTiltShift(on: boolean): void;
  setSound(on: boolean): void;
  resume(): void;
  startChallenge(id: string): void;
  /** Bildschirme außerhalb des Menüs: Tagesmarkt, Liga, Konto, Erfolge */
  other(cmd: string, data: DOMStringMap): void;
}

export interface MenuInfo {
  slots: SlotInfo[];
  unlockedChapters: string[];
  tiltShift: boolean;
  sound: boolean;
  inGame: boolean;
  /** bestandene Herausforderungen mit benötigten Tagen */
  challenges: Record<string, number>;
  online: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Haupt- und Spielmenü sowie Kapitelkarten, alles im Stil von Frachtbriefen */
export class Menu {
  private readonly el: HTMLElement;
  private readonly actions: MenuActions;
  private info: () => MenuInfo;

  constructor(root: HTMLElement, actions: MenuActions, info: () => MenuInfo) {
    this.actions = actions;
    this.info = info;
    this.el = document.createElement('div');
    this.el.className = 'overlay';
    this.el.hidden = true;
    root.appendChild(this.el);

    this.el.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target as HTMLFormElement;
      const btn = form.querySelector<HTMLButtonElement>('button[data-menu]');
      btn?.click();
    });
    this.el.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-menu]');
      if (!btn || btn.disabled) return;
      const { menu, id } = btn.dataset;
      switch (menu) {
        case 'continue':
          this.close();
          this.actions.continueGame();
          break;
        case 'campaign':
          this.showCampaign();
          break;
        case 'chapter':
          this.showChapterIntro(CHAPTERS.find((c) => c.id === id)!);
          break;
        case 'begin':
          this.close();
          this.actions.startChapter(id!);
          break;
        case 'free':
          this.close();
          this.actions.startFree();
          break;
        case 'save':
          this.actions.save(id!);
          this.showGameMenu();
          break;
        case 'load':
          this.close();
          this.actions.load(id!);
          break;
        case 'loadlist':
          this.showLoad();
          break;
        case 'tilt':
          this.actions.setTiltShift(!this.info().tiltShift);
          if (this.info().inGame) this.showGameMenu();
          else this.showMain();
          break;
        case 'sound':
          this.actions.setSound(!this.info().sound);
          if (this.info().inGame) this.showGameMenu();
          else this.showMain();
          break;
        case 'main':
          this.showMain();
          break;
        case 'resume':
          this.close();
          this.actions.resume();
          break;
        case 'challenges':
          this.showChallenges();
          break;
        case 'challenge':
          this.showChapterIntro(CHALLENGES.find((c) => c.id === id)!, true);
          break;
        case 'beginChallenge':
          this.close();
          this.actions.startChallenge(id!);
          break;
        default:
          this.actions.other(menu!, btn.dataset);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.info().inGame) return;
      if (this.el.hidden) this.showGameMenu();
      else {
        this.close();
        this.actions.resume();
      }
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    this.screen = '';
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  /** Karte anzeigen; wide für Tabellen wie den Liga-Markt */
  show(html: string, wide = false): void {
    // Eingaben über ein Neuzeichnen hinweg behalten
    this.screen = '';
    const kept = new Map<string, string>();
    let focus: string | null = null;
    for (const input of this.el.querySelectorAll<HTMLInputElement>('input[name]')) {
      kept.set(input.name, input.value);
      if (document.activeElement === input) focus = input.name;
    }
    this.el.innerHTML = `<div class="card${wide ? ' wide' : ''}">${html}</div>`;
    for (const [name, value] of kept) {
      const input = this.el.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (input && !input.value) input.value = value;
    }
    if (focus) this.el.querySelector<HTMLInputElement>(`input[name="${focus}"]`)?.focus();
    this.el.hidden = false;
  }

  /** Wert eines Eingabefelds in der offenen Karte */
  value(name: string): string {
    return this.el.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value.trim() ?? '';
  }

  /** Aktuell gezeigter Bildschirm, damit Live-Daten nur dort neu zeichnen */
  screen = '';

  showMain(): void {
    const info = this.info();
    const auto = info.slots.find((s) => s.slot === 'auto');
    this.show(`
      <div class="card-head">Handelshaus am Fluss · gegründet im Jahr 1</div>
      <h1 class="title">Flussreich</h1>
      <p class="lead">Führe ein Handelshaus an einem großen Flusssystem. Versorge die Städte, bau eine Flotte auf und lerne den Fluss lesen.</p>
      <div class="menu-buttons">
        ${auto ? `<button class="btn primary wide" data-menu="continue">Weiterspielen<small>${esc(auto.summary ?? '')}</small></button>` : ''}
        <button class="btn ${auto ? '' : 'primary'} wide" data-menu="campaign">Kampagne: Hundert Jahre am Fluss<small>Kapitel mit Zielen und Geschichte</small></button>
        <button class="btn wide" data-menu="free">Freies Spiel<small>Ohne Ziele, die Zeit läuft durch alle Epochen</small></button>
        <button class="btn wide" data-menu="challenges">Herausforderungen<small>Kurze Szenarien mit Zeitlimit</small></button>
        <button class="btn wide" data-menu="daily">Tagesmarkt<small>Jeden Tag ein neues Tal, eine Bestenliste für alle</small></button>
        <button class="btn wide" data-menu="league">Handelsliga<small>Live mit allen Spielern auf einem gemeinsamen Markt</small></button>
        ${info.slots.some((s) => s.slot !== 'auto') ? `<button class="btn wide" data-menu="loadlist">Spielstand laden</button>` : ''}
      </div>
      <p class="fine"><button class="link" data-menu="achievements">Erfolge</button> · <button class="link" data-menu="account">Konto und Cloud</button> · <button class="link" data-menu="tilt">Tilt-Shift-Effekt: ${info.tiltShift ? 'an' : 'aus'}</button> · <button class="link" data-menu="sound">Ton: ${info.sound ? 'an' : 'aus'}</button></p>`);
  }

  showCampaign(): void {
    const unlocked = this.info().unlockedChapters;
    const list = CHAPTERS.map((c) => {
      const open = unlocked.includes(c.id);
      return `<button class="btn wide chapter" data-menu="chapter" data-id="${c.id}" ${open ? '' : 'disabled'}>
        <span class="num">Kapitel ${c.number}</span><b>${esc(c.title)}</b>${open ? '' : '<small>noch verschlossen</small>'}</button>`;
    }).join('');
    this.show(`
      <div class="card-head">Kampagne</div>
      <h2>Hundert Jahre am Fluss</h2>
      <div class="menu-buttons">${list}</div>
      <p class="fine"><button class="link" data-menu="main">Zurück</button></p>`);
  }

  showChallenges(): void {
    const done = this.info().challenges;
    const list = CHALLENGES.map((c) => {
      const best = done[c.id];
      return `<button class="btn wide chapter" data-menu="challenge" data-id="${c.id}">
        <span class="num">${c.deadlineDays} Tage</span><b>${esc(c.title)}</b><small>${
          best !== undefined ? `Bestanden in ${best} Tagen` : esc(c.goals.map((g) => g.text).join(' · '))
        }</small></button>`;
    }).join('');
    this.show(`
      <div class="card-head">Herausforderungen</div>
      <h2>Gegen die Zeit</h2>
      <div class="menu-buttons">${list}</div>
      <p class="fine"><button class="link" data-menu="main">Zurück</button></p>`);
  }

  showChallengeEnd(c: Chapter, won: boolean, days: number): void {
    this.show(`
      ${won ? '<div class="stamp-big">Bestanden</div>' : '<div class="stamp-big red">Verfehlt</div>'}
      <div class="card-head">Herausforderung</div>
      <h2>${esc(c.title)}</h2>
      <p>${won ? `${esc(c.outro)} Benötigt: ${days} Tage.` : `Die Zeit ist um. Nach ${days} Tagen fehlt noch etwas.`}</p>
      <div class="menu-buttons">
        <button class="btn primary wide" data-menu="beginChallenge" data-id="${c.id}">${won ? 'Noch einmal, schneller' : 'Neuer Versuch'}</button>
        ${won ? '<button class="btn wide" data-menu="resume">Weiterspielen ohne Ziele</button>' : ''}
        <button class="btn wide" data-menu="challenges">Andere Herausforderung</button>
        <button class="btn wide" data-menu="main">Hauptmenü</button>
      </div>`);
  }

  showChapterIntro(c: Chapter, challenge = false): void {
    this.show(`
      <div class="card-head">${challenge ? 'Herausforderung' : `Kapitel ${c.number}`}</div>
      <h2>${esc(c.title)}</h2>
      ${c.intro.map((p) => `<p>${esc(p)}</p>`).join('')}
      <h3>Ziele</h3>
      <ul class="goal-list">${c.goals.map((g) => `<li>${esc(g.text)}</li>`).join('')}</ul>
      ${c.deadlineDays ? `<p class="fine">Zeit: ${c.deadlineDays} Tage, also ${c.deadlineDays / 30} Jahreszeiten</p>` : ''}
      <div class="menu-buttons"><button class="btn primary wide" data-menu="${challenge ? 'beginChallenge' : 'begin'}" data-id="${c.id}">Leinen los</button></div>
      <p class="fine"><button class="link" data-menu="${challenge ? 'challenges' : 'campaign'}">Zurück</button></p>`);
  }

  showChapterDone(c: Chapter, next: Chapter | undefined): void {
    this.show(`
      <div class="stamp-big">Erfüllt</div>
      <div class="card-head">Kapitel ${c.number}</div>
      <h2>${esc(c.title)}</h2>
      <p>${esc(c.outro)}</p>
      <div class="menu-buttons">
        ${next ? `<button class="btn primary wide" data-menu="chapter" data-id="${next.id}">Weiter mit Kapitel ${next.number}: ${esc(next.title)}</button>` : ''}
        <button class="btn wide" data-menu="resume">Weiterspielen ohne Ziele</button>
        <button class="btn wide" data-menu="main">Hauptmenü</button>
      </div>`);
  }

  showGameMenu(): void {
    const info = this.info();
    const slots = info.slots.filter((s) => s.slot !== 'auto');
    const saveButtons = ['1', '2', '3']
      .map((n) => {
        const s = slots.find((x) => x.slot === n);
        return `<button class="btn" data-menu="save" data-id="${n}">Platz ${n}<small>${s ? esc(s.summary ?? '') : 'leer'}</small></button>`;
      })
      .join('');
    this.show(`
      <div class="card-head">Kontorbuch</div>
      <h2>Pause</h2>
      <div class="menu-buttons">
        <button class="btn primary wide" data-menu="resume">Weiterspielen</button>
      </div>
      <h3>Speichern</h3>
      <div class="slot-grid">${saveButtons}</div>
      <div class="menu-buttons">
        ${slots.length ? '<button class="btn wide" data-menu="loadlist">Spielstand laden</button>' : ''}
        <button class="btn wide" data-menu="main">Hauptmenü</button>
      </div>
      <p class="fine"><button class="link" data-menu="achievements">Erfolge</button> · <button class="link" data-menu="account">Konto und Cloud-Speicher</button></p>
      <p class="fine">Das Spiel speichert außerdem jeden Tag automatisch. <button class="link" data-menu="tilt">Tilt-Shift: ${info.tiltShift ? 'an' : 'aus'}</button> · <button class="link" data-menu="sound">Ton: ${info.sound ? 'an' : 'aus'}</button></p>`);
  }

  showLoad(): void {
    const info = this.info();
    const list = info.slots
      .map(
        (s) => `<button class="btn wide" data-menu="load" data-id="${s.slot}">${esc(s.label)}<small>${esc(s.summary ?? '')}${
          s.savedAt ? ` · ${new Date(s.savedAt).toLocaleString('de-DE')}` : ''
        }</small></button>`,
      )
      .join('');
    this.show(`
      <div class="card-head">Spielstände</div>
      <h2>Laden</h2>
      <div class="menu-buttons">${list || '<p>Keine Spielstände.</p>'}</div>
      <p class="fine"><button class="link" data-menu="${info.inGame ? 'resume' : 'main'}">Zurück</button></p>`);
  }
}
