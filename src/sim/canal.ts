import { CANALS, type CanalDef, type CanalStageDef } from '../data/canal.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { season } from './calendar.ts';
import { addNews, day, fail, getShip, type CargoSlot, type GameState, type NewsItem, type TradeResult } from './state.ts';

/**
 * Großprojekt Kanal: mehrere Bauabschnitte, jeder wird bezahlt und dann über viele
 * Arbeitstage mit Baustoffen versorgt. Die Baustoffe liegen im Baulager an den
 * Kanalenden und werden gleichmäßig verbraucht. Fehlt etwas, ruht die Arbeit anteilig.
 * Ist der letzte Abschnitt fertig, landet der Kanal als erledigtes Bauvorhaben in
 * state.works, damit Kanalabschnitt (SegmentDef.requires) und Kapitelziele greifen.
 */

export interface CanalState {
  id: string;
  /** Index des laufenden Abschnitts; gleich der Anzahl fertiger Abschnitte */
  stage: number;
  /** laufender Abschnitt ist bezahlt und in Arbeit */
  active: boolean;
  /** geleistete Arbeitstage im laufenden Abschnitt */
  worked: number;
  /** Baulager: angelieferte, noch nicht verbaute Baustoffe in t */
  stock: Record<string, number>;
  /** insgesamt angeliefert, für die Anzeige */
  delivered: Record<string, number>;
  /** Tag des ersten Spatenstichs */
  startedDay: number;
  /** Waren, auf die die Baustelle gerade wartet (für Anzeige und einmalige Meldung) */
  waiting: string[];
  done: boolean;
}

const EPS = 1e-6;

/** Kanal, der auf dieser Karte gebaut werden kann, oder null */
export function canalOf(map: MapDef): CanalDef | null {
  return CANALS.find((c) => map.segments.some((s) => s.id === c.segment && s.requires === c.id)) ?? null;
}

/** Spielstand des Kanals; legt ihn bei Bedarf an */
function ensure(state: GameState, def: CanalDef): CanalState {
  if (!state.canal || state.canal.id !== def.id) {
    state.canal = { id: def.id, stage: 0, active: false, worked: 0, stock: {}, delivered: {}, startedDay: 0, waiting: [], done: false };
  }
  return state.canal;
}

export function canalDone(state: GameState): boolean {
  return !!state.canal?.done;
}

/** Anzahl fertiger Bauabschnitte */
export function canalStagesDone(state: GameState): number {
  return state.canal?.stage ?? 0;
}

/** laufender bzw. nächster Abschnitt, oder null, wenn alles fertig ist */
export function currentStage(state: GameState, def: CanalDef): CanalStageDef | null {
  return def.stages[state.canal?.stage ?? 0] ?? null;
}

/** Gesamtfortschritt 0..1 und Stand für Anzeige und Rendering */
export function canalProgress(state: GameState, map: MapDef): { stage: number; stages: number; stageShare: number; total: number; done: boolean } | null {
  const def = canalOf(map);
  if (!def) return null;
  const c = state.canal?.id === def.id ? state.canal : undefined;
  const stages = def.stages.length;
  if (!c) return { stage: 0, stages, stageShare: 0, total: 0, done: false };
  if (c.done) return { stage: stages, stages, stageShare: 1, total: 1, done: true };
  const st = def.stages[c.stage];
  const stageShare = c.active && st ? Math.min(1, c.worked / st.days) : 0;
  const totalDays = def.stages.reduce((s, x) => s + x.days, 0);
  const doneDays = def.stages.slice(0, c.stage).reduce((s, x) => s + x.days, 0) + (st ? stageShare * st.days : 0);
  return { stage: c.stage, stages, stageShare, total: doneDays / totalDays, done: false };
}

/** Restbedarf an Baustoffen im laufenden Abschnitt (abzüglich Baulager), in t */
export function stageNeeds(state: GameState, def: CanalDef): Record<string, number> {
  const c = state.canal?.id === def.id ? state.canal : undefined;
  const st = def.stages[c?.stage ?? 0];
  if (!st || c?.done) return {};
  const left = c?.active ? Math.max(0, 1 - c.worked / st.days) : 1;
  const out: Record<string, number> = {};
  for (const [g, total] of Object.entries(st.goods)) {
    const need = total * left - (c?.stock[g] ?? 0);
    if (need > EPS) out[g] = Math.ceil(need - EPS);
  }
  return out;
}

/** Wie viel von einer Ware die Baustelle noch annimmt: Rest dieses und aller folgenden Abschnitte */
export function canalAccepts(state: GameState, def: CanalDef, good: string): number {
  const c = state.canal?.id === def.id ? state.canal : undefined;
  if (c?.done) return 0;
  const from = c?.stage ?? 0;
  let total = 0;
  def.stages.forEach((st, i) => {
    if (i < from || !st.goods[good]) return;
    const left = i === from && c?.active ? Math.max(0, 1 - c.worked / st.days) : 1;
    total += st.goods[good] * left;
  });
  return Math.max(0, Math.floor(total - (c?.stock[good] ?? 0) + EPS));
}

/** Nächsten Bauabschnitt bezahlen und beginnen */
export function startCanalStage(state: GameState, map: MapDef): TradeResult {
  const def = canalOf(map);
  if (!def) return fail('Auf dieser Karte gibt es keinen Kanal zu bauen.');
  if (def.epoch > state.epoch) return fail('Für den Kanalbau fehlt noch die Technik.');
  const c = ensure(state, def);
  if (c.done) return fail(`${def.name} ist schon fertig.`);
  if (c.active) return fail('Der laufende Bauabschnitt ist noch nicht fertig.');
  const st = def.stages[c.stage];
  if (state.money < st.cost) return fail(`${st.name} kostet ${st.cost} Taler.`);
  state.money -= st.cost;
  c.active = true;
  c.worked = 0;
  c.waiting = [];
  if (c.stage === 0) c.startedDay = day(state);
  addNews(state, 'haus', `${def.name}, Abschnitt ${c.stage + 1} von ${def.stages.length}: ${st.name} beginnt.`);
  return { ok: true, message: `${st.name}: Die Arbeiten beginnen.`, amount: 0, taler: st.cost };
}

function takeFrom(cargo: Record<string, CargoSlot>, good: string, amount: number): void {
  const slot = cargo[good];
  slot.cost -= Math.round((slot.cost * amount) / slot.amount);
  slot.amount -= amount;
  if (slot.amount < 0.001) delete cargo[good];
}

/**
 * Baustoffe an die Baustelle liefern, aus dem Laderaum eines Schiffs im Hafen einer
 * Kanalstadt oder aus dem eigenen Kontor dort.
 */
export function deliverToCanal(
  state: GameState,
  map: MapDef,
  from: { ship: number } | { kontor: string },
  good: string,
  wanted: number,
): TradeResult {
  const def = canalOf(map);
  if (!def) return fail('Auf dieser Karte gibt es keinen Kanal zu bauen.');
  const name = GOOD_BY_ID.get(good)?.name ?? good;
  let cargo: Record<string, CargoSlot>;
  let town: string | null;
  if ('ship' in from) {
    const ship = getShip(state, from.ship);
    town = ship.port;
    cargo = ship.cargo;
  } else {
    town = from.kontor;
    const k = state.kontore[town];
    if (!k) return fail('Hier gibt es kein eigenes Kontor.');
    cargo = k.stock;
  }
  if (!town || !def.sites.includes(town)) return fail('Baustoffe nimmt nur die Baustelle an den Kanalenden an.');
  const c = ensure(state, def);
  if (c.done) return fail(`${def.name} ist schon fertig.`);
  const accepts = canalAccepts(state, def, good);
  if (accepts <= 0) return fail(`Die Baustelle braucht kein ${name} mehr.`);
  const have = Math.floor(cargo[good]?.amount ?? 0);
  if (have <= 0) return fail(`Kein ${name} vorhanden.`);
  const amount = Math.min(wanted, have, accepts);
  if (amount <= 0) return fail('Nichts geliefert.');
  takeFrom(cargo, good, amount);
  c.stock[good] = (c.stock[good] ?? 0) + amount;
  c.delivered[good] = (c.delivered[good] ?? 0) + amount;
  if (c.waiting.includes(good)) c.waiting = c.waiting.filter((g) => g !== good);
  return { ok: true, message: `${amount} t ${name} an die Kanalbaustelle geliefert.`, amount, taler: 0 };
}

/** Täglich: Arbeit nach Versorgung voranbringen, Abschnitte und Kanal fertigstellen */
export function tickCanal(state: GameState, map: MapDef): NewsItem[] {
  const c = state.canal;
  const def = canalOf(map);
  if (!c || !def || c.id !== def.id || c.done || !c.active) return [];
  const st = def.stages[c.stage];
  const out: NewsItem[] = [];
  const pace = season(day(state)) === 'winter' ? st.winterWork : 1;
  if (pace <= 0) return out;
  const planned = Math.min(pace, st.days - c.worked);
  let work = planned;
  // Baustoffe begrenzen die Arbeit: je Arbeitstag ein gleicher Anteil jeder Ware
  const short: string[] = [];
  for (const [g, total] of Object.entries(st.goods)) {
    const can = (c.stock[g] ?? 0) / (total / st.days);
    if (can + EPS < planned) {
      short.push(g);
      work = Math.min(work, Math.max(0, can));
    }
  }
  for (const [g, total] of Object.entries(st.goods)) {
    c.stock[g] = Math.max(0, (c.stock[g] ?? 0) - (total / st.days) * work);
    if (c.stock[g] < EPS) delete c.stock[g];
  }
  c.worked += work;
  const fresh = short.filter((g) => !c.waiting.includes(g));
  c.waiting = short;
  if (fresh.length) {
    const names = fresh.map((g) => GOOD_BY_ID.get(g)?.name ?? g).join(', ');
    out.push(addNews(state, 'haus', `Kanalbaustelle: Es fehlt an ${names}. Die Arbeit stockt.`));
  }
  if (c.worked >= st.days - EPS) {
    c.stage += 1;
    c.active = false;
    c.worked = 0;
    c.waiting = [];
    if (c.stage >= def.stages.length) {
      c.done = true;
      c.stock = {};
      if (!state.works.some((w) => w.id === def.id)) state.works.push({ id: def.id, started: c.startedDay, done: true });
      out.push(addNews(state, 'ereignis', `Eingeweiht: ${def.name}. ${def.text}`));
    } else {
      out.push(addNews(state, 'haus', `${def.name}: ${st.name} ist fertig. Der nächste Abschnitt wartet auf Geld.`));
    }
  }
  return out;
}
