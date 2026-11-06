import type { MapDef } from '../data/maps/valley.ts';
import { season } from './calendar.ts';
import { addNews, day, pick, rand, randInt, type GameState, type NewsItem, type WorldEvent, type WorldEventKind } from './state.ts';
import { gaugeCount } from './works.ts';

/** Wahrscheinlichkeit für ein neues Ereignis pro Tag */
const EVENT_CHANCE = 0.08;
const MAX_EVENTS = 2;
/** Hochwasser und Dürre kündigen sich so viele Tage vorher an (sichtbar nur mit Pegelstation) */
export const FORECAST_MIN = 3;
export const FORECAST_MAX = 5;

const isWeather = (k: WorldEventKind) => k === 'hochwasser' || k === 'duerre';

/** Vorhersagen, die der Spieler sieht: nur mit mindestens einer fertigen Pegelstation */
export function visibleForecasts(state: GameState): WorldEvent[] {
  return gaugeCount(state) > 0 ? (state.forecast ?? []) : [];
}

const meters = (v: number) => Math.abs(v).toFixed(1).replace('.', ',');

/** Mit nur einer Station kennt man den Tag nicht genau: Spanne aus dem Ankündigungstag, ohne den echten Tag zu verraten */
function roughWhen(d: number, e: WorldEvent): string {
  const elapsed = d - (e.announced ?? d);
  const lo = Math.max(1, FORECAST_MIN - elapsed);
  const hi = Math.max(1, FORECAST_MAX - elapsed);
  if (e.from <= d) return 'ab heute';
  if (hi <= 1) return 'ab morgen';
  return lo === hi ? `in ${lo} Tagen` : `in ${lo} bis ${hi} Tagen`;
}

/** Text der Pegelmeldung; ab zwei Stationen mit genauem Tag und Pegel */
export function describeForecast(state: GameState, e: WorldEvent): string {
  const d = day(state);
  const inDays = e.from - d;
  const exact = gaugeCount(state) >= 2;
  const when = exact
    ? inDays <= 0
      ? 'ab heute'
      : inDays === 1
        ? 'ab morgen'
        : `in ${inDays} Tagen (ab Tag ${e.from})`
    : roughWhen(d, e);
  const days = e.until - e.from + 1;
  if (e.kind === 'hochwasser') {
    return exact
      ? `Hochwasser ${when}: etwa ${meters(e.value ?? 0)} m über normal, rund ${days} Tage lang`
      : `Hochwasser ${when}`;
  }
  return exact ? `Dürre ${when}: der Fluss fällt um etwa ${meters(e.value ?? 0)} m, rund ${days} Tage lang` : `Dürre ${when}`;
}

/** Pegelverschiebung durch Hochwasser oder Dürre */
export function eventWaterOffset(state: GameState): number {
  return state.events.reduce((s, e) => s + (e.kind === 'hochwasser' || e.kind === 'duerre' ? (e.value ?? 0) : 0), 0);
}

export const EVENT_TITLE: Record<WorldEventKind, string> = {
  hochwasser: 'Hochwasser',
  duerre: 'Dürre',
  zoll: 'Zollstreit',
  bruecke: 'Brückeneinsturz',
  stadtfest: 'Stadtfest',
  seuche: 'Fieber',
};

function townName(map: MapDef, id?: string): string {
  return map.towns.find((t) => t.id === id)?.name ?? '';
}

function segName(map: MapDef, id?: string): string {
  const s = map.segments.find((x) => x.id === id);
  return s ? `${townName(map, s.from)} und ${townName(map, s.to)}` : '';
}

export function describeEvent(map: MapDef, e: WorldEvent): string {
  switch (e.kind) {
    case 'hochwasser':
      return 'Hochwasser: schnelle Strömung, niedrige Brücken';
    case 'duerre':
      return 'Dürre: der Fluss fällt, seichte Stellen';
    case 'zoll':
      return `Zoll zwischen ${segName(map, e.seg)}: ${e.value} Taler je Durchfahrt`;
    case 'bruecke':
      return `Brücke eingestürzt, gesperrt zwischen ${segName(map, e.seg)}`;
    case 'stadtfest':
      return `Stadtfest in ${townName(map, e.town)}: Bier und Brot gefragt`;
    case 'seuche':
      return `Fieber in ${townName(map, e.town)}: Arznei gesucht`;
  }
}

/** Welche Ereignisse in welcher Jahreszeit möglich sind, mit Gewicht */
function candidates(d: number): [WorldEventKind, number][] {
  const s = season(d);
  return [
    ['hochwasser', s === 'fruehling' ? 3 : s === 'herbst' ? 1.5 : 0.3],
    ['duerre', s === 'sommer' ? 3 : 0],
    ['zoll', 1.5],
    ['bruecke', 0.8],
    ['stadtfest', s === 'winter' ? 0.5 : 2],
    ['seuche', s === 'winter' || s === 'herbst' ? 1.5 : 0.6],
  ];
}

function startEvent(state: GameState, map: MapDef, kind: WorldEventKind): WorldEvent | null {
  const d = day(state);
  const e: WorldEvent = { id: state.nextId++, kind, from: d, until: d };
  // angekündigte Wetterlagen zählen schon mit, damit sich Hochwasser und Dürre nicht überlagern
  const busy = (k: WorldEventKind) => state.events.some((x) => x.kind === k) || (state.forecast ?? []).some((x) => x.kind === k);
  switch (kind) {
    case 'hochwasser':
      if (busy('hochwasser') || busy('duerre')) return null;
      e.value = 0.9 + rand(state) * 0.6;
      e.until = d + randInt(state, 4, 7);
      break;
    case 'duerre':
      if (busy('hochwasser') || busy('duerre')) return null;
      e.value = -(0.4 + rand(state) * 0.3);
      e.until = d + randInt(state, 8, 14);
      break;
    case 'zoll': {
      const segs = map.segments.filter((s) => !state.events.some((x) => x.seg === s.id));
      if (!segs.length) return null;
      e.seg = pick(state, segs).id;
      e.value = randInt(state, 3, 8) * 10;
      e.until = d + randInt(state, 12, 20);
      break;
    }
    case 'bruecke': {
      const segs = map.segments.filter((s) => s.bridgeHeight !== undefined && !state.events.some((x) => x.seg === s.id));
      if (!segs.length) return null;
      e.seg = pick(state, segs).id;
      e.until = d + randInt(state, 5, 9);
      break;
    }
    case 'stadtfest':
    case 'seuche': {
      const towns = map.towns.filter(
        (t) => !state.events.some((x) => x.town === t.id) && (kind === 'stadtfest' || state.towns[t.id].population >= 600),
      );
      if (!towns.length) return null;
      e.town = pick(state, towns).id;
      e.until = d + (kind === 'stadtfest' ? randInt(state, 4, 6) : randInt(state, 14, 20));
      const m = state.markets[e.town];
      const target = Object.values(m)[0]?.target ?? 60;
      if (kind === 'seuche') m.arznei ??= { good: 'arznei', stock: 0, target };
      else for (const g of ['bier', 'brot']) m[g] ??= { good: g, stock: target * 0.5, target };
      break;
    }
  }
  if (isWeather(kind)) {
    // Hochwasser und Dürre kommen nicht über Nacht: sie beginnen erst nach einigen Tagen
    const lead = randInt(state, FORECAST_MIN, FORECAST_MAX);
    e.announced = d;
    e.from += lead;
    e.until += lead;
    (state.forecast ??= []).push(e);
  } else {
    state.events.push(e);
  }
  return e;
}

/** Laufende Ereignisse wirken lassen */
function applyEvent(state: GameState, e: WorldEvent): void {
  if (!e.town) return;
  const m = state.markets[e.town];
  const town = state.towns[e.town];
  if (e.kind === 'stadtfest') {
    let served = 0;
    for (const g of ['bier', 'brot']) {
      const entry = m[g];
      if (!entry) continue;
      const take = Math.min(entry.stock, 3);
      entry.stock -= take;
      served += take / 3;
    }
    town.satisfaction = Math.min(1, town.satisfaction + 0.02 * served);
  }
  if (e.kind === 'seuche') {
    const a = m.arznei;
    if (a && a.stock >= 1.5) a.stock -= 1.5;
    else town.satisfaction = Math.max(0, town.satisfaction - 0.04);
  }
}

/** Ein Tag: Ereignisse wirken, enden oder beginnen. Gibt neue Nachrichten zurück. */
export function tickEvents(state: GameState, map: MapDef): NewsItem[] {
  const news: NewsItem[] = [];
  const d = day(state);
  for (const e of state.events) applyEvent(state, e);
  const ended = state.events.filter((e) => e.until < d);
  state.events = state.events.filter((e) => e.until >= d);
  const begun = (state.forecast ?? []).filter((e) => e.from <= d);
  if (begun.length) {
    state.forecast = state.forecast!.filter((e) => e.from > d);
    state.events.push(...begun);
  }
  for (const e of ended) {
    const text: Record<WorldEventKind, string> = {
      hochwasser: 'Das Hochwasser geht zurück.',
      duerre: 'Endlich Regen: der Fluss steigt wieder.',
      zoll: `Der Zollstreit ist beigelegt, freie Fahrt zwischen ${segName(map, e.seg)}.`,
      bruecke: `Die Brücke zwischen ${segName(map, e.seg)} ist notdürftig geräumt, die Durchfahrt wieder frei.`,
      stadtfest: `Das Fest in ${townName(map, e.town)} ist vorbei.`,
      seuche: `Das Fieber in ${townName(map, e.town)} klingt ab.`,
    };
    news.push(addNews(state, 'ereignis', text[e.kind]));
  }
  for (const e of begun) news.push(addNews(state, 'ereignis', startText(map, e)));
  if (state.events.length + (state.forecast?.length ?? 0) < MAX_EVENTS && rand(state) < EVENT_CHANCE) {
    const list = candidates(d).filter(([, w]) => w > 0);
    const total = list.reduce((s, [, w]) => s + w, 0);
    let r = rand(state) * total;
    let kind = list[0][0];
    for (const [k, w] of list) {
      r -= w;
      if (r <= 0) {
        kind = k;
        break;
      }
    }
    const e = startEvent(state, map, kind);
    if (e && !isWeather(e.kind)) news.push(addNews(state, 'ereignis', startText(map, e)));
    // Wetter kündigt sich an: nur wer eine Pegelstation hat, erfährt es vorher
    if (e && isWeather(e.kind) && gaugeCount(state) > 0) news.push(addNews(state, 'ereignis', warningText(state, e)));
  }
  return news;
}

function startText(map: MapDef, e: WorldEvent): string {
  const text: Record<WorldEventKind, string> = {
    hochwasser: 'Schneeschmelze in den Bergen: Hochwasser! Die Strömung ist reißend, unter Brücken wird es eng.',
    duerre: 'Seit Wochen kein Regen. Der Fluss fällt, tiefe Kähne bleiben liegen.',
    zoll: `Streit um Uferrechte: zwischen ${segName(map, e.seg)} wird ${e.value} Taler Zoll je Durchfahrt verlangt.`,
    bruecke: `Die Brücke zwischen ${segName(map, e.seg)} ist eingestürzt! Trümmer sperren den Fluss.`,
    stadtfest: `${townName(map, e.town)} feiert Kirmes. Bier und Brot werden knapp.`,
    seuche: `In ${townName(map, e.town)} geht ein Fieber um. Die Apotheke sucht Arznei.`,
  };
  return text[e.kind];
}

function warningText(state: GameState, e: WorldEvent): string {
  const cause =
    e.kind === 'hochwasser'
      ? 'Die Pegelstation meldet steigendes Wasser in den Bergen.'
      : 'Die Pegelstation meldet: Die Quellen in den Bergen werden schwach.';
  return `${cause} ${describeForecast(state, e)}.`;
}
