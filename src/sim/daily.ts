import { DAILY_DAYS, dailySetup } from '../data/challenges.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { newGame, type NewGameOptions } from './game.ts';
import { addNews, type GameState, type WorldEvent } from './state.ts';

/**
 * Tagesmarkt: Jeder Kalendertag bekommt eine Tagesregel. Alles hier hängt nur vom Tag und vom
 * Startwert ab, nicht vom Spieler. Die Regeln drehen sich reihum, zwei Tage hintereinander
 * haben nie dieselbe Regel.
 */

export type DailyRuleId =
  | 'duerre_sommer'
  | 'nur_plaetten'
  | 'zollkrieg'
  | 'fruehjahrsflut'
  | 'fieberherbst'
  | 'stadtfeste'
  | 'dampfzeit'
  | 'reiche_konkurrenz';

export interface DailyRule {
  id: DailyRuleId;
  name: string;
  /** kurzer Satz für Menü und Flussboten */
  text: string;
}

export const DAILY_RULES: DailyRule[] = [
  { id: 'duerre_sommer', name: 'Dürre-Sommer', text: 'Der Sommer beginnt mit einer langen Dürre. Flache Boote sind Gold wert, du startest mit einer Plätte.' },
  { id: 'nur_plaetten', name: 'Nur Plätten', text: 'Die Werften bauen heute nur Plätten und Flöße. Du startest mit einer Plätte.' },
  { id: 'zollkrieg', name: 'Zollkrieg', text: 'Drei Abschnitte des Stroms verlangen den ganzen Markt lang hohen Zoll.' },
  { id: 'fruehjahrsflut', name: 'Frühjahrsflut', text: 'Die Schneeschmelze bringt gleich zu Beginn Hochwasser: schnelle Talfahrt, niedrige Brücken.' },
  { id: 'fieberherbst', name: 'Fieberherbst', text: 'Im Herbst grassiert in zwei Städten das Fieber, Arznei ist gesucht. Danach kommt der Winter.' },
  { id: 'stadtfeste', name: 'Stadtfeste', text: 'Zwei Städte feiern zu Beginn ihr Fest und brauchen Bier und Brot.' },
  { id: 'dampfzeit', name: 'Dampfzeit', text: 'Die Dampfer sind schon da. Mehr Startgeld, und die Konkurrenz rüstet auf.' },
  { id: 'reiche_konkurrenz', name: 'Reiche Konkurrenz', text: 'Die anderen Handelshäuser starten mit doppeltem Geld.' },
];

/** Tage seit 1970-01-01 für einen Tag im Format YYYY-MM-DD (UTC) */
export function dayNumber(day: string): number {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / 86400000) : 0;
}

/** Tagesregel eines Kalendertags. Schritt 3 ist teilerfremd zu 8, also wechselt die Regel jeden Tag. */
export function dailyRule(day: string): DailyRule {
  const n = DAILY_RULES.length;
  const i = (((dayNumber(day) * 3 + 1) % n) + n) % n;
  return DAILY_RULES[i];
}

/** Startoptionen des Tagesmarkts: gemeinsamer Aufbau plus Tagesregel */
export function dailyOptions(day: string, seed: number): NewGameOptions {
  const setup = dailySetup(seed);
  const rule = dailyRule(day);
  const opts: NewGameOptions = {
    startTown: setup.startTown,
    money: setup.money,
    startYear: setup.startYear,
    seed,
    fairSeed: seed,
    rivals: true,
  };
  switch (rule.id) {
    case 'duerre_sommer':
      opts.startDay = 30;
      opts.startShip = 'plaette';
      break;
    case 'nur_plaetten':
      opts.startShip = 'plaette';
      opts.allowedShips = ['plaette', 'floss'];
      opts.money = setup.money + 200;
      break;
    case 'fieberherbst':
      opts.startDay = 60;
      break;
    case 'dampfzeit':
      opts.epoch = 2;
      opts.money = setup.money + 1500;
      break;
    default:
      break;
  }
  return opts;
}

/** Spielstand des Tagesmarkts: für alle Spieler mit demselben Tag gleich */
export function newDailyGame(map: MapDef, day: string, seed: number): GameState {
  const state = newGame(map, dailyOptions(day, seed));
  applyDailyRule(state, map, dailyRule(day), seed);
  return state;
}

/** Feste Auswahl ohne Zufallsstrom: k Einträge aus list, durch den Startwert gemischt */
function chooseFixed<T>(list: T[], k: number, seed: number): T[] {
  const rest = [...list];
  const out: T[] = [];
  let x = seed >>> 0;
  while (out.length < k && rest.length) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out.push(rest.splice((x >>> 8) % rest.length, 1)[0]);
  }
  return out;
}

function startDay(state: GameState): number {
  return Math.floor(state.hour / 24) + 1;
}

/** Ereignisse der Tagesregel zu Spielbeginn anlegen */
export function applyDailyRule(state: GameState, map: MapDef, rule: DailyRule, seed: number): void {
  const d = startDay(state);
  const last = d + DAILY_DAYS;
  const add = (e: Omit<WorldEvent, 'id' | 'from'>) => state.events.push({ id: state.nextId++, from: d, ...e });
  switch (rule.id) {
    case 'duerre_sommer':
      add({ kind: 'duerre', until: last, value: -0.3 });
      break;
    case 'zollkrieg': {
      const segs = chooseFixed(map.segments.filter((s) => s.river === 'strom'), 3, seed);
      segs.forEach((s, i) => add({ kind: 'zoll', seg: s.id, until: last, value: 40 + ((seed >>> (4 + i * 3)) % 5) * 10 }));
      break;
    }
    case 'fruehjahrsflut':
      add({ kind: 'hochwasser', until: d + 9, value: 1.2 });
      break;
    case 'fieberherbst':
      for (const t of chooseFixed(map.towns.filter((x) => x.population >= 600), 2, seed)) {
        const m = state.markets[t.id];
        const target = Object.values(m)[0]?.target ?? 60;
        m.arznei ??= { good: 'arznei', stock: 0, target };
        add({ kind: 'seuche', town: t.id, until: d + 20 });
      }
      break;
    case 'stadtfeste':
      for (const t of chooseFixed(map.towns, 2, seed)) {
        const m = state.markets[t.id];
        const target = Object.values(m)[0]?.target ?? 60;
        for (const g of ['bier', 'brot']) m[g] ??= { good: g, stock: target * 0.5, target };
        add({ kind: 'stadtfest', town: t.id, until: d + 12 });
      }
      break;
    case 'reiche_konkurrenz':
      for (const r of state.rivals) r.money *= 2;
      break;
    default:
      break;
  }
  addNews(state, 'ereignis', `Tagesregel ${rule.name}: ${rule.text}`);
}
