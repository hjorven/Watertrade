import { CHAPTERS, type Chapter } from '../data/campaign.ts';
import { CHALLENGES } from '../data/challenges.ts';
import { MAX_SEED } from '../data/maps/random.ts';
import { brandMark } from './icons.ts';

export interface SlotInfo {
  slot: string; // 'auto' | '1' | '2' | '3'
  label: string;
  savedAt?: string;
  summary?: string;
}

export interface MenuActions {
  continueGame(): void;
  startChapter(id: string): void;
  /** Freies Spiel: null im Tal der zwei Flüsse, sonst auf der Zufallskarte zu diesem Startwert */
  startFree(seed: number | null): void;
  /** freies Spiel auf einer festen Karte aus dem Kartenregister */
  startFreeMap(id: string): void;
  /** Vorschau einer Zufallskarte für das Menü (Papierkarte als SVG und eine Zeile zum Prüfergebnis) */
  mapPreview(seed: number): { svg: string; name: string; text: string };
  save(slot: string): void;
  load(slot: string): void;
  setTiltShift(on: boolean): void;
  setSound(on: boolean): void;
  setVolume(channel: VolumeChannel, value: number): void;
  getVolume(channel: VolumeChannel): number;
  /** Laufendes Spiel verlassen und ins Hauptmenü */
  leaveGame(): void;
  resume(): void;
  startChallenge(id: string): void;
  /** Bildschirme außerhalb des Menüs: Tagesmarkt, Liga, Konto, Erfolge */
  other(cmd: string, data: DOMStringMap): void;
}

export type VolumeChannel = 'master' | 'music' | 'sfx' | 'ambient';
const VOLUME_LABELS: [VolumeChannel, string][] = [
  ['master', 'Gesamt'],
  ['music', 'Musik'],
  ['sfx', 'Geräusche'],
  ['ambient', 'Fluss und Wind'],
];

export interface MenuInfo {
  slots: SlotInfo[];
  unlockedChapters: string[];
  tiltShift: boolean;
  sound: boolean;
  inGame: boolean;
  /** bestandene Herausforderungen mit benötigten Tagen */
  challenges: Record<string, number>;
  online: boolean;
  /** Herausforderungen und Tagesmarkt lassen sich nicht speichern, sonst wären beliebig viele Versuche möglich */
  canSave: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Zufälliger Startwert für eine neue Karte */
const randomSeed = () => 1 + Math.floor(Math.random() * MAX_SEED);

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

    this.el.addEventListener('input', (ev) => {
      const input = ev.target as HTMLInputElement;
      const channel = input.dataset.volume as VolumeChannel | undefined;
      if (!channel) return;
      const v = Number(input.value) / 100;
      this.actions.setVolume(channel, v);
      const out = input.parentElement?.querySelector('output');
      if (out) out.textContent = `${Math.round(v * 100)} %`;
    });
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
          this.showFree();
          break;
        case 'freeValley':
          this.close();
          this.actions.startFree(null);
          break;
        case 'freeKanal':
          this.close();
          this.actions.startFreeMap('zwei-taeler');
          break;
        case 'freeDice':
          this.showFree(randomSeed());
          break;
        case 'freePreview':
          this.showFree(this.seed() ?? randomSeed());
          break;
        case 'freeRandom': {
          const seed = this.seed();
          if (seed === null) {
            this.showFree(randomSeed(), true);
            break;
          }
          this.close();
          this.actions.startFree(seed);
          break;
        }
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
          this.showSound();
          break;
        case 'soundDialog':
          this.showSound();
          break;
        case 'back':
          if (this.info().inGame) this.showGameMenu();
          else this.showMain();
          break;
        case 'main':
          this.showMain();
          break;
        case 'leave':
          this.actions.leaveGame();
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
      <div class="masthead">${brandMark(64)}<div><h1 class="title">Watertrade</h1><small>Handel und Wasserbau am großen Fluss</small></div></div>
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
      <p class="fine"><button class="link" data-menu="achievements">Erfolge</button> · <button class="link" data-menu="account">Konto und Cloud</button> · <button class="link" data-menu="tilt">Tilt-Shift-Effekt: ${info.tiltShift ? 'an' : 'aus'}</button> · <button class="link" data-menu="soundDialog">Ton</button></p>`);
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

  showSound(): void {
    const info = this.info();
    const rows = VOLUME_LABELS.map(([ch, label]) => {
      const v = Math.round(this.actions.getVolume(ch) * 100);
      return `<label class="volume"><span>${label}</span><input type="range" min="0" max="100" step="5" value="${v}" data-volume="${ch}" aria-label="${label}"><output>${v} %</output></label>`;
    }).join('');
    this.show(`
      <div class="card-head">Einstellungen</div>
      <h2>Ton</h2>
      <div class="volumes">${rows}</div>
      <div class="menu-buttons"><button class="btn wide" data-menu="sound">${info.sound ? 'Stumm schalten' : 'Ton wieder einschalten'}</button></div>
      <p class="fine"><button class="link" data-menu="back">Zurück</button></p>`);
  }

  /** Startwert aus dem Eingabefeld, oder null */
  private seed(): number | null {
    const n = Number(this.value('seed'));
    return this.value('seed') !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_SEED ? n : null;
  }

  /** Freies Spiel: bekanntes Tal oder Zufallsfluss mit Startwert und Vorschau */
  showFree(seed = this.lastSeed ?? randomSeed(), invalid = false): void {
    this.lastSeed = seed;
    const p = this.actions.mapPreview(seed);
    this.show(`
      <div class="card-head">Freies Spiel</div>
      <h2>Welcher Fluss?</h2>
      <div class="menu-buttons">
        <button class="btn wide" data-menu="freeValley">Das Tal der zwei Flüsse<small>Weißstrom und Erzbach, acht Städte, wie in der Kampagne</small></button>
        <button class="btn wide" data-menu="freeKanal">Zwei Täler und ein Kanal<small>Das Tal und die Schwarzach im Norden, 14 Städte. Verbinde sie mit dem Scheitelkanal.</small></button>
      </div>
      <h3>Zufallsfluss: ${esc(p.name)}</h3>
      ${p.svg}
      <p class="fine">${esc(p.text)}</p>
      <form class="inline-form seed-form">
        <label>Kartennummer<input name="seed" type="number" min="1" max="${MAX_SEED}" step="1" inputmode="numeric" value="${seed}"></label>
        <button type="button" class="btn" data-menu="freePreview">Zeigen</button>
        <button type="button" class="btn" data-menu="freeDice">Würfeln</button>
      </form>
      <div class="menu-buttons"><button class="btn primary wide" data-menu="freeRandom">Diesen Fluss befahren</button></div>
      ${invalid ? `<p class="fine">Bitte eine Kartennummer von 1 bis ${MAX_SEED.toLocaleString('de-DE')} eingeben.</p>` : '<p class="fine">Gleiche Nummer, gleicher Fluss: So lässt sich ein Tal mit anderen teilen.</p>'}
      <p class="fine"><button class="link" data-menu="main">Zurück</button></p>`);
    // die Nummer im Feld soll zur gezeigten Karte passen, auch wenn vorher etwas anderes darin stand
    const input = this.el.querySelector<HTMLInputElement>('input[name="seed"]');
    if (input) input.value = String(seed);
  }

  private lastSeed: number | null = null;

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
        <button class="btn wide" data-menu="leave">Hauptmenü</button>
      </div>`);
  }

  showChapterIntro(c: Chapter, challenge = false): void {
    this.show(`
      <div class="card-head">${challenge ? 'Herausforderung' : `Kapitel ${c.number}`}</div>
      <h2>${esc(c.title)}</h2>
      ${c.intro.map((p) => `<p>${esc(p)}</p>`).join('')}
      <h3>Ziele</h3>
      <ul class="goal-list">${c.goals.map((g) => `<li>${esc(g.text)}</li>`).join('')}</ul>
      ${c.deadlineDays ? `<p class="fine">Zeit: ${c.deadlineDays} Tage${seasonsText(c.deadlineDays)}</p>` : ''}
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
        <button class="btn wide" data-menu="leave">Hauptmenü</button>
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
      ${
        info.canSave
          ? `<h3>Speichern</h3>
      <div class="slot-grid">${saveButtons}</div>`
          : '<p class="fine">Herausforderungen und Tagesmarkt werden nur automatisch gespeichert, damit jeder Versuch zählt.</p>'
      }
      <div class="menu-buttons">
        ${slots.length ? '<button class="btn wide" data-menu="loadlist">Spielstand laden</button>' : ''}
        <button class="btn wide" data-menu="leave">Hauptmenü</button>
      </div>
      <p class="fine"><button class="link" data-menu="achievements">Erfolge</button> · <button class="link" data-menu="account">Konto und Cloud-Speicher</button></p>
      <p class="fine">Das Spiel speichert außerdem jeden Tag automatisch. <button class="link" data-menu="tilt">Tilt-Shift: ${info.tiltShift ? 'an' : 'aus'}</button> · <button class="link" data-menu="soundDialog">Ton</button></p>`);
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

/** Frist in Jahreszeiten zu je 30 Tagen, nur wenn es ungefähr aufgeht */
export function seasonsText(days: number): string {
  const n = days / 30;
  if (n < 1) return '';
  const whole = Math.round(n);
  const prefix = Math.abs(n - whole) < 0.01 ? 'also' : 'rund';
  return `, ${prefix} ${whole === 1 ? 'eine Jahreszeit' : `${whole} Jahreszeiten`}`;
}
