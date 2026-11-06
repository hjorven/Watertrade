import type { MapDef } from '../data/maps/valley.ts';
import { baseBerths, HARBOR_DEPTH, HARBOR_LEVELS, LIGHTER_FEE } from '../data/harbors.ts';
import { PROJECT_BY_ID, PROJECTS, type ProjectDef } from '../data/projects.ts';
import { RIVAL_BY_ID } from '../data/rivals.ts';
import {
  addNews,
  day,
  fail,
  rand,
  type FeeItem,
  type FeeLevel,
  type GameState,
  type Harbor,
  type NewsItem,
  type RivalState,
  type TradeResult,
  type Voyage,
  type Work,
  type WorkPartner,
} from './state.ts';
import { startProject } from './works.ts';

/**
 * Wasserbau als Investition (Plan 5.6) und Hafenausbau (Plan 6.4).
 *
 * - Eigene Bauwerke kassieren von fremden Schiffen eine Durchfahrtsgebühr.
 * - Gemeinschaftsbau: Stadt oder KI-Haus zahlt die Hälfte und bekommt die Hälfte der Gebühren.
 * - Ausgebaggerte Rinnen verlanden ohne Pflege langsam wieder.
 * - Häfen lassen sich ausbauen: schneller umschlagen, mehr Liegeplätze, tieferes Wasser am Kai.
 *
 * Öffentliche Bauten (ohne `owner`, etwa zu Kapitelbeginn) bleiben gebührenfrei und verlanden nicht.
 */

/** Bauarten, die Gebühren erheben dürfen */
export const FEE_KINDS = new Set<string>(['schleuse', 'bruecke', 'vertiefung', 'kanal']);
/** Bauarten, die verlanden */
export const SILT_KINDS = new Set<string>(['vertiefung']);

export const FEE_FACTOR: Record<FeeLevel, number> = { frei: 0, normal: 1, hoch: 2 };
export const FEE_LABEL: Record<FeeLevel, string> = { frei: 'keine Gebühr', normal: 'übliche Gebühr', hoch: 'hohe Gebühr' };

/** Anteil des Partners an Baukosten, Gebühren und Unterhalt */
export const PARTNER_SHARE = 0.5;
/** Verlandung je Tag ohne Pflege (nach 250 Tagen ist die Rinne zu) */
export const SILT_PER_DAY = 0.004;
/** Hochwasser schwemmt dreimal so schnell Sand an */
export const FLOOD_SILT = 3;
/** Pflege kostet täglich diesen Anteil der Baukosten */
export const UPKEEP_RATE = 0.001;
/** Nachbaggern kostet diesen Anteil der Baukosten mal Verlandung */
export const DREDGE_RATE = 0.5;
/** Liegegeld je Hafenstufe, das fremde Schiffe im ausgebauten Hafen zahlen */
export const DOCK_FEE = 3;
/** KI-Häuser bauen frühestens ab diesem Tag selbst */
export const RIVAL_BUILD_FROM = 60;
/** Mindestgröße einer Stadt, die sich an einem Bau beteiligt */
export const TOWN_PARTNER_POP = 600;

const isPlayer = (owner: string | undefined) => owner === 'spieler';

/* ---------- Gebühren ---------- */

/** Grundgebühr eines Bauwerks je Durchfahrt bei mittlerer Schiffsgröße */
export function baseFee(p: ProjectDef): number {
  return Math.round(p.cost / 400);
}

/** Größere Schiffe zahlen mehr: halbe Gebühr für kleine Kähne, doppelte für Schleppverbände */
export function sizeFactor(capacity: number): number {
  return Math.min(2, Math.max(0.5, capacity / 60));
}

/** Gebühr eines Bauwerks für eine Durchfahrt mit einem Schiff dieser Ladefähigkeit */
export function passageFee(w: Work, capacity: number): number {
  const p = PROJECT_BY_ID.get(w.id);
  if (!p || !w.done || !w.owner || !FEE_KINDS.has(p.kind)) return 0;
  return Math.round(baseFee(p) * FEE_FACTOR[w.fee ?? 'normal'] * sizeFactor(capacity));
}

/** Zahlt `payer` (Spieler = 'spieler', sonst Haus-ID) für dieses Bauwerk? */
function exempt(w: Work, payer: string): boolean {
  return w.owner === payer || (w.partner?.kind === 'haus' && w.partner.id === payer);
}

/** Gebühren für fremde Bauwerke auf den Abschnitten einer Fahrt */
export function worksFees(state: GameState, segs: string[], payer: string, capacity: number): FeeItem[] {
  const out: FeeItem[] = [];
  for (const seg of segs) {
    for (const w of state.works) {
      if (PROJECT_BY_ID.get(w.id)?.seg !== seg || exempt(w, payer)) continue;
      const amount = passageFee(w, capacity);
      if (amount > 0) out.push({ work: w.id, amount });
    }
  }
  return out;
}

export const feeSum = (items: FeeItem[] | undefined) => (items ?? []).reduce((s, f) => s + f.amount, 0);

function today(state: GameState): { income: number; cost: number } {
  return (state.worksToday ??= { income: 0, cost: 0 });
}

/** Einnahme an Bauherrn und Partner verteilen */
function credit(state: GameState, owner: string | undefined, partner: WorkPartner | undefined, amount: number, rec?: { earned?: number }): void {
  const share = partner ? partner.share : 0;
  const ownPart = amount * (1 - share);
  const partPart = amount * share;
  const toRival = (id: string, x: number) => {
    const r = state.rivals.find((y) => y.id === id);
    if (r) r.money += x;
  };
  if (isPlayer(owner)) {
    state.money += ownPart;
    today(state).income += ownPart;
    if (rec) rec.earned = (rec.earned ?? 0) + ownPart;
  } else if (owner) toRival(owner, ownPart);
  if (partner?.kind === 'haus') toRival(partner.id, partPart);
  // Anteil einer Stadt geht in die Stadtkasse
}

/** Gebühren, die beim Ablegen gezahlt wurden, an die Bauherren auszahlen */
export function distributeFees(state: GameState, items: FeeItem[] | undefined): void {
  for (const f of items ?? []) {
    if (f.work === 'leichtern') continue;
    if (f.work.startsWith('hafen:')) {
      const h = state.harbors?.[f.work.slice(6)];
      if (h) credit(state, 'spieler', h.partner, f.amount, h);
      continue;
    }
    const w = state.works.find((x) => x.id === f.work);
    if (w) credit(state, w.owner, w.partner, f.amount, w);
  }
}

/** Gebühren eines Spielerschiffs beim Ablegen verbuchen (das Geld ist über `toll` schon abgezogen) */
export function playerPaidFees(state: GameState, v: Voyage): void {
  const sum = feeSum(v.fees);
  if (sum > 0) today(state).cost += sum;
  distributeFees(state, v.fees);
}

/** Ein KI-Schiff zahlt Gebühren für fremde Bauwerke auf seiner Fahrt */
export function chargeRival(state: GameState, r: RivalState, v: Voyage, capacity: number): number {
  const items = worksFees(
    state,
    v.legs.map((l) => l.seg),
    r.id,
    capacity,
  );
  const sum = feeSum(items);
  if (sum <= 0) return 0;
  r.money -= sum;
  distributeFees(state, items);
  return sum;
}

/** Gebühr, die ein KI-Haus für diese Abschnitte erwarten muss (für die Planung) */
export function rivalFeeFor(state: GameState, r: RivalState, segs: string[], capacity: number): number {
  return feeSum(worksFees(state, segs, r.id, capacity));
}

/** Eigene Gebührenstufe für ein Bauwerk oder einen Hafen ('hafen:<stadt>') setzen */
export function setFee(state: GameState, id: string, level: FeeLevel): TradeResult {
  if (!(level in FEE_FACTOR)) return fail('Unbekannte Gebührenstufe.');
  if (id.startsWith('hafen:')) {
    const h = state.harbors?.[id.slice(6)];
    if (!h || h.level <= 0) return fail('Dieser Hafen ist nicht ausgebaut.');
    h.fee = level;
  } else {
    const w = state.works.find((x) => x.id === id);
    if (!w || !isPlayer(w.owner)) return fail('Das ist nicht dein Bauwerk.');
    w.fee = level;
  }
  return { ok: true, message: `Ab sofort: ${FEE_LABEL[level]}.`, amount: 0, taler: 0 };
}

/* ---------- Gemeinschaftsbau ---------- */

export interface PartnerOffer {
  partner: WorkPartner;
  name: string;
}

/** Wer sich an einem Bauvorhaben beteiligen würde */
export function partnerOffer(state: GameState, map: MapDef, projectId: string, kind: 'stadt' | 'haus'): PartnerOffer | null {
  const p = PROJECT_BY_ID.get(projectId);
  if (!p) return null;
  if (kind === 'stadt') {
    const seg = map.segments.find((s) => s.id === p.seg);
    if (!seg) return null;
    return townPartner(state, map, [seg.from, seg.to]);
  }
  return rivalPartner(state, p.cost);
}

function townPartner(state: GameState, map: MapDef, towns: string[]): PartnerOffer | null {
  let best: string | null = null;
  for (const t of towns) {
    const pop = state.towns[t]?.population ?? 0;
    if (pop >= TOWN_PARTNER_POP && (!best || pop > state.towns[best].population)) best = t;
  }
  if (!best) return null;
  const name = map.towns.find((t) => t.id === best)?.name ?? best;
  return { partner: { kind: 'stadt', id: best, share: PARTNER_SHARE }, name: `Stadt ${name}` };
}

function rivalPartner(state: GameState, cost: number): PartnerOffer | null {
  if (!state.rivalsActive) return null;
  const need = cost * PARTNER_SHARE + 1000;
  const r = [...state.rivals].sort((a, b) => b.money - a.money).find((x) => x.money >= need);
  if (!r) return null;
  return { partner: { kind: 'haus', id: r.id, share: PARTNER_SHARE }, name: RIVAL_BY_ID.get(r.id)?.name ?? r.id };
}

/** Bauvorhaben beginnen, allein oder mit Stadt bzw. KI-Haus als Partner */
export function startProjectWith(state: GameState, map: MapDef, id: string, kind?: 'stadt' | 'haus'): TradeResult {
  if (!kind) return startProject(state, id);
  const offer = partnerOffer(state, map, id, kind);
  if (!offer) return fail(kind === 'stadt' ? 'Keine Stadt an diesem Abschnitt ist groß genug, um mitzubauen.' : 'Kein Handelshaus hat gerade genug Geld für einen Gemeinschaftsbau.');
  const res = startProject(state, id, offer.partner);
  if (!res.ok) return res;
  const p = PROJECT_BY_ID.get(id)!;
  if (offer.partner.kind === 'haus') {
    const r = state.rivals.find((x) => x.id === offer.partner.id);
    if (r) r.money -= Math.round(p.cost * offer.partner.share);
  }
  addNews(state, 'haus', `${offer.name} trägt die Hälfte der Kosten für ${p.name} und erhält dafür die Hälfte der Gebühren.`);
  return { ...res, message: `${p.name}: Gemeinschaftsbau mit ${offer.name}. Die Arbeiten beginnen.` };
}

/* ---------- Verlandung und Unterhalt ---------- */

/** Restwirkung einer Vertiefung, 1 = volle Tiefe */
export function depthFactor(w: Work): number {
  return 1 - Math.min(1, Math.max(0, w.silt ?? 0));
}

/** Tägliche Pflegekosten eines Bauwerks für den Spieler (sein Anteil) */
export function upkeepCost(w: Work): number {
  const p = PROJECT_BY_ID.get(w.id);
  if (!p || !SILT_KINDS.has(p.kind)) return 0;
  return Math.round(p.cost * UPKEEP_RATE * (1 - (w.partner?.share ?? 0)));
}

/** Kosten, um eine verlandete Rinne wieder freizubaggern (Anteil des Spielers) */
export function dredgeCost(w: Work): number {
  const p = PROJECT_BY_ID.get(w.id);
  if (!p || !SILT_KINDS.has(p.kind) || !(w.silt ?? 0)) return 0;
  return Math.max(50, Math.round(p.cost * DREDGE_RATE * (w.silt ?? 0) * (1 - (w.partner?.share ?? 0))));
}

export function dredge(state: GameState, id: string): TradeResult {
  const w = state.works.find((x) => x.id === id);
  const p = PROJECT_BY_ID.get(id);
  if (!w || !p || !w.done || !isPlayer(w.owner)) return fail('Das ist nicht deine Fahrrinne.');
  const cost = dredgeCost(w);
  if (!cost) return fail('Die Rinne ist frei.');
  if (state.money < cost) return fail(`Das Nachbaggern kostet ${cost} Taler.`);
  state.money -= cost;
  today(state).cost += cost;
  if (w.partner?.kind === 'haus') {
    const r = state.rivals.find((x) => x.id === w.partner!.id);
    if (r) r.money -= Math.round(p.cost * DREDGE_RATE * (w.silt ?? 0) * w.partner.share);
  }
  w.silt = 0;
  return { ok: true, message: `${p.name}: Die Baggerschiffe haben die Rinne wieder frei geräumt.`, amount: 0, taler: cost };
}

export function setUpkeep(state: GameState, id: string, on: boolean): TradeResult {
  const w = state.works.find((x) => x.id === id);
  const p = PROJECT_BY_ID.get(id);
  if (!w || !p || !isPlayer(w.owner) || !SILT_KINDS.has(p.kind)) return fail('Hier gibt es nichts zu pflegen.');
  w.upkeep = on;
  return {
    ok: true,
    message: on ? `${p.name}: Baggerschiffe halten die Rinne frei, ${upkeepCost(w)} Taler am Tag.` : `${p.name}: Keine Pflege mehr, die Rinne verlandet langsam.`,
    amount: 0,
    taler: 0,
  };
}

/* ---------- Häfen ---------- */

export function harborOf(state: GameState, town: string): Harbor {
  return state.harbors?.[town] ?? { level: 0 };
}

export function harborLevelDef(state: GameState, town: string) {
  return HARBOR_LEVELS[Math.min(HARBOR_LEVELS.length - 1, harborOf(state, town).level)];
}

/** Liegeplätze eines Hafens */
export function berths(state: GameState, town: string): number {
  return baseBerths(state.towns[town]?.population ?? 0) + harborLevelDef(state, town).berths;
}

/** Schiffe, die gerade in diesem Hafen liegen (eigene und fremde) */
export function shipsInPort(state: GameState, town: string): number {
  let n = state.ships.filter((s) => s.port === town).length;
  for (const r of state.rivals) n += r.ships.filter((s) => s.port === town).length;
  return n;
}

/** Wassertiefe am Kai beim aktuellen Pegel */
export function quayDepth(state: GameState, town: string): number {
  return (HARBOR_DEPTH[town] ?? 2) + harborLevelDef(state, town).depth + state.waterLevel;
}

export interface DockInfo {
  hours: number;
  /** zu tief für den Kai: über Schuten umschlagen */
  lighter: boolean;
  /** mehr Schiffe als Liegeplätze */
  crowded: boolean;
}

/**
 * Liegezeit für den Umschlag von `tons` Tonnen in einem Hafen.
 * `extra` zählt Schiffe, die noch dazukommen (das ankommende Schiff selbst).
 */
export function dockTime(state: GameState, town: string, tons: number, draft: number, extra = 0): DockInfo {
  const lighter = draft > quayDepth(state, town);
  const ships = shipsInPort(state, town) + extra;
  const room = berths(state, town);
  const crowded = ships > room;
  let rate = harborLevelDef(state, town).rate;
  if (crowded) rate *= room / ships;
  if (lighter) rate *= 0.5;
  const hours = tons > 0 ? Math.round((tons / rate) * 10) / 10 : 0;
  return { hours, lighter, crowded };
}

export function lighterFee(tons: number): number {
  return Math.round(tons * LIGHTER_FEE);
}

/** Liegegeld für ein fremdes Schiff in einem ausgebauten Hafen des Spielers */
export function dockFee(state: GameState, town: string): number {
  const h = harborOf(state, town);
  if (h.level <= 0) return 0;
  return Math.round(DOCK_FEE * h.level * FEE_FACTOR[h.fee ?? 'normal']);
}

/** Ein KI-Schiff legt an: Liegegeld zahlen und Liegezeit nach Hafenstufe */
export function rivalDocks(state: GameState, r: RivalState, town: string): number {
  const fee = dockFee(state, town);
  if (fee > 0) {
    r.money -= fee;
    distributeFees(state, [{ work: `hafen:${town}`, amount: fee }]);
  }
  return HARBOR_LEVELS[0].rate / harborLevelDef(state, town).rate;
}

export function nextHarborLevel(state: GameState, town: string) {
  const h = harborOf(state, town);
  if (h.building) return null;
  return HARBOR_LEVELS[h.level + 1] ?? null;
}

/** Wer beim Hafenausbau mitzahlt: die Stadt selbst, wenn sie groß genug ist */
export function harborPartner(state: GameState, map: MapDef, town: string): PartnerOffer | null {
  return townPartner(state, map, [town]);
}

export function harborCost(state: GameState, map: MapDef, town: string, withTown: boolean): number {
  const next = nextHarborLevel(state, town);
  if (!next) return 0;
  return withTown && harborPartner(state, map, town) ? Math.round(next.cost * (1 - PARTNER_SHARE)) : next.cost;
}

export function buildHarbor(state: GameState, map: MapDef, town: string, withTown = false): TradeResult {
  const def = map.towns.find((t) => t.id === town);
  if (!def) return fail('Unbekannte Stadt.');
  const h = harborOf(state, town);
  if (h.building) return fail('Am Hafen wird schon gebaut.');
  const next = HARBOR_LEVELS[h.level + 1];
  if (!next) return fail('Der Hafen ist voll ausgebaut.');
  if (next.epoch > state.epoch) return fail('Dafür fehlt noch die Technik.');
  const offer = withTown ? harborPartner(state, map, town) : null;
  if (withTown && !offer) return fail(`${def.name} ist zu klein, um sich am Hafen zu beteiligen.`);
  const cost = harborCost(state, map, town, withTown);
  if (state.money < cost) return fail(`${next.name} kostet ${cost} Taler.`);
  state.money -= cost;
  const harbors = (state.harbors ??= {});
  harbors[town] = { ...h, building: { level: next.level, started: day(state) } };
  // Eine Beteiligung der Stadt gilt für den ganzen Hafen, eine frühere bleibt bestehen
  if (offer) harbors[town].partner = offer.partner;
  addNews(state, 'haus', `Hafenausbau in ${def.name}: ${next.name}. Fertig in ${next.days} Tagen.`);
  return { ok: true, message: `${def.name}: ${next.name} wird gebaut.`, amount: 0, taler: cost };
}

export function harborDaysLeft(state: GameState, town: string): number {
  const b = harborOf(state, town).building;
  if (!b) return 0;
  return Math.max(0, b.started + HARBOR_LEVELS[b.level].days - day(state));
}

/* ---------- Täglicher Ablauf ---------- */

function floodOn(state: GameState): boolean {
  return state.events.some((e) => e.kind === 'hochwasser');
}

/** Täglich: Häfen fertigstellen, Rinnen verlanden lassen, Pflege bezahlen, KI-Häuser bauen lassen */
export function tickWaterworks(state: GameState, map: MapDef): NewsItem[] {
  const news: NewsItem[] = [];
  const d = day(state);

  for (const [town, h] of Object.entries(state.harbors ?? {})) {
    if (!h.building || d < h.building.started + HARBOR_LEVELS[h.building.level].days) continue;
    h.level = h.building.level;
    h.building = undefined;
    h.fee ??= 'normal';
    const name = map.towns.find((t) => t.id === town)?.name ?? town;
    news.push(addNews(state, 'ereignis', `Hafen ${name} eingeweiht: ${HARBOR_LEVELS[h.level].name}.`));
  }

  const flood = floodOn(state);
  for (const w of state.works) {
    const p = PROJECT_BY_ID.get(w.id);
    if (!p || !w.done || !w.owner || !SILT_KINDS.has(p.kind)) continue;
    if (!isPlayer(w.owner)) {
      // KI-Häuser pflegen ihre Rinnen selbst
      const r = state.rivals.find((x) => x.id === w.owner);
      if (r) r.money -= Math.round(p.cost * UPKEEP_RATE);
      w.silt = 0;
      continue;
    }
    if (w.upkeep) {
      const cost = upkeepCost(w);
      state.money -= cost;
      today(state).cost += cost;
      if (w.partner?.kind === 'haus') {
        const r = state.rivals.find((x) => x.id === w.partner!.id);
        if (r) r.money -= Math.round(p.cost * UPKEEP_RATE * w.partner.share);
      }
      w.silt = 0;
      continue;
    }
    const before = w.silt ?? 0;
    w.silt = Math.min(1, before + SILT_PER_DAY * (flood ? FLOOD_SILT : 1));
    for (const mark of [0.25, 0.5, 0.75, 1]) {
      if (before < mark && w.silt >= mark) {
        const left = Math.round((p.effect.depth ?? 0) * depthFactor(w) * 10) / 10;
        news.push(
          addNews(
            state,
            'haus',
            mark >= 1
              ? `${p.name} ist ganz verlandet. Nur Nachbaggern hilft noch.`
              : `${p.name} verlandet: Die Rinne bringt nur noch ${left.toLocaleString('de-DE')} m mehr Tiefe.`,
          ),
        );
      }
    }
  }

  if (state.rivalsActive && state.epochAuto && d >= RIVAL_BUILD_FROM) news.push(...rivalsBuild(state, map));

  const t = today(state);
  state.ledger.works = { income: Math.round(t.income), cost: Math.round(t.cost) };
  state.worksToday = { income: 0, cost: 0 };
  return news;
}

/** Reiche KI-Häuser errichten im freien Spiel selbst Wasserbauten und nehmen Gebühren */
function rivalsBuild(state: GameState, map: MapDef): NewsItem[] {
  const news: NewsItem[] = [];
  const open = PROJECTS.filter((p) => FEE_KINDS.has(p.kind) && p.epoch <= state.epoch && !state.works.some((w) => w.id === p.id)).sort(
    (a, b) => a.cost - b.cost,
  );
  if (!open.length) return news;
  for (const r of state.rivals) {
    const p = open.find((x) => r.money > x.cost * 2 + 2000);
    if (!p || rand(state) > 1 / 60) continue;
    r.money -= p.cost;
    state.works.push({ id: p.id, started: day(state), done: false, owner: r.id, fee: 'normal' });
    open.splice(open.indexOf(p), 1);
    const seg = map.segments.find((s) => s.id === p.seg);
    const where = seg ? ` zwischen ${map.towns.find((t) => t.id === seg.from)?.name} und ${map.towns.find((t) => t.id === seg.to)?.name}` : '';
    news.push(addNews(state, 'konkurrenz', `${RIVAL_BY_ID.get(r.id)?.name ?? r.id} baut ${p.name}${where}. Wer dort fährt, zahlt künftig Gebühr.`));
    if (!open.length) break;
  }
  return news;
}

/** Name des Bauherrn für die Anzeige */
export function ownerName(w: Work): string {
  if (!w.owner) return 'öffentlich';
  if (isPlayer(w.owner)) return 'dein Bau';
  return RIVAL_BY_ID.get(w.owner)?.name ?? w.owner;
}
