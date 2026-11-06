import { CHAPTERS, type Chapter } from '../data/campaign.ts';

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
}

export interface MenuInfo {
  slots: SlotInfo[];
  unlockedChapters: string[];
  tiltShift: boolean;
  sound: boolean;
  inGame: boolean;
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
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  private show(html: string): void {
    this.el.innerHTML = `<div class="card">${html}</div>`;
    this.el.hidden = false;
  }

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
        <button class="btn wide" data-menu="free">Freies Spiel<small>Ohne Ziele, alle Schiffe der ersten Epoche</small></button>
        ${info.slots.some((s) => s.slot !== 'auto') ? `<button class="btn wide" data-menu="loadlist">Spielstand laden</button>` : ''}
      </div>
      <p class="fine"><button class="link" data-menu="tilt">Tilt-Shift-Effekt: ${info.tiltShift ? 'an' : 'aus'}</button> · <button class="link" data-menu="sound">Ton: ${info.sound ? 'an' : 'aus'}</button></p>`);
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

  showChapterIntro(c: Chapter): void {
    this.show(`
      <div class="card-head">Kapitel ${c.number}</div>
      <h2>${esc(c.title)}</h2>
      ${c.intro.map((p) => `<p>${esc(p)}</p>`).join('')}
      <h3>Ziele</h3>
      <ul class="goal-list">${c.goals.map((g) => `<li>${esc(g.text)}</li>`).join('')}</ul>
      ${c.deadlineDays ? `<p class="fine">Zeit: ${Math.round(c.deadlineDays / 120)} Jahre</p>` : ''}
      <div class="menu-buttons"><button class="btn primary wide" data-menu="begin" data-id="${c.id}">Leinen los</button></div>
      <p class="fine"><button class="link" data-menu="campaign">Zurück</button></p>`);
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
