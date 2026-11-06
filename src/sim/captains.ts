import { CAPTAIN_RANKS, captainRank, isMaster, MAX_WAGE, TRAITS, type Trait } from '../data/captains.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { RIVAL_BY_ID } from '../data/rivals.ts';
import { addNews, day, fail, getShip, rand, type Captain, type GameState, type NewsItem, type Ship, type TradeResult, type Voyage } from './state.ts';
import { effectiveSegments } from './works.ts';

/* ---------- Lohn ---------- */

/** Treue beim Anheuern */
export const LOYALTY_START = 60;
/** Unter dieser Treue warnt das Handelshaus, dass der Kapitän unzufrieden ist */
export const LOYALTY_WARN = 45;
/** Unter dieser Treue nimmt der Kapitän Angebote anderer Reeder an */
export const LOYALTY_POACH = 30;

/** Chance, an einer Zollstelle vorbei erwischt zu werden; Altmeister halb so oft */
export const SMUGGLE_CATCH = 0.1;
/** Strafe in Vielfachen des umgangenen Zolls */
export const SMUGGLE_FINE = 3;
/** Anteil der Ladung, den der Zoll beschlagnahmt */
export const SMUGGLE_SEIZE = 0.5;

/** Lohn, den ein Kapitän mit seinen Eigenschaften und seiner Erfahrung erwarten kann */
export function fairWage(c: Pick<Captain, 'trait' | 'trait2' | 'km'>): number {
  const w = TRAITS[c.trait].wage + (c.trait2 ? Math.round(TRAITS[c.trait2].wage / 2) : 0) + CAPTAIN_RANKS[captainRank(c.km)].wage;
  return Math.min(MAX_WAGE, w);
}

/** Zufällige Eigenschaft nach Seltenheit, ohne die ausgeschlossene */
export function rollTrait(state: GameState, not?: Trait): Trait {
  const list = (Object.keys(TRAITS) as Trait[]).filter((t) => t !== not);
  const total = list.reduce((s, t) => s + TRAITS[t].weight, 0);
  let r = rand(state) * total;
  for (const t of list) {
    r -= TRAITS[t].weight;
    if (r < 0) return t;
  }
  return list[list.length - 1];
}

/** Lohn eines eigenen Kapitäns ändern. Mehr Lohn macht ihn treuer, weniger kränkt ihn. */
export function setCaptainWage(state: GameState, shipId: number, wage: number): TradeResult {
  const ship = getShip(state, shipId);
  const c = ship.captain;
  if (!c) return fail('Kein Kapitän an Bord.');
  wage = Math.round(wage);
  if (!Number.isFinite(wage) || wage < 1) return fail('So wenig fährt niemand.');
  if (wage > MAX_WAGE * 2) return fail(`Mehr als ${MAX_WAGE * 2} Taler am Tag sind zu viel.`);
  const old = c.wage;
  if (wage === old) return fail('Der Lohn bleibt gleich.');
  c.wage = wage;
  const loyalty = c.loyalty ?? LOYALTY_START;
  c.loyalty = clamp(wage > old ? loyalty + (wage - old) * 2 : loyalty - (old - wage) * 3);
  let message = wage > old ? `${c.name} bekommt jetzt ${wage} Taler am Tag.` : `${c.name} bekommt nur noch ${wage} Taler am Tag und ist verstimmt.`;
  if (c.offer && wage >= c.offer.wage) {
    c.offer = undefined;
    c.loyalty = Math.max(c.loyalty, LOYALTY_START);
    message = `${c.name} bleibt für ${wage} Taler am Tag an Bord der ${ship.name}.`;
  }
  return { ok: true, message, amount: 0, taler: 0 };
}

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x * 10) / 10));

/* ---------- Treue und Abwerbung ---------- */

/** Wer wirbt ab: ein Haus der Konkurrenz, wenn sie mitspielt, sonst ein namenloser Reeder */
function poacher(state: GameState, hire: number): string {
  if (!state.rivalsActive) return '';
  const rich = state.rivals.filter((r) => r.money > hire * 2);
  if (!rich.length) return '';
  return rich[Math.floor(rand(state) * rich.length)].id;
}

function poacherName(id: string): string {
  return RIVAL_BY_ID.get(id)?.name ?? 'ein anderer Reeder';
}

/**
 * Hat der Kapitän ein Angebot und liegt im Hafen, geht er von Bord, sofern du nicht nachgezogen hast.
 * Das Angebot muss mindestens einen Tag alt sein, damit du Zeit zum Reagieren hast.
 */
function settleOffer(state: GameState, ship: Ship, town: string): NewsItem | null {
  const c = ship.captain;
  if (!c?.offer || !ship.port || ship.voyage) return null;
  if (c.wage >= c.offer.wage) {
    c.offer = undefined;
    c.loyalty = Math.max(c.loyalty ?? 0, LOYALTY_START);
    return addNews(state, 'haus', `${c.name} schlägt das fremde Angebot aus und bleibt auf der ${ship.name}.`);
  }
  if (day(state) <= c.offer.day) return null;
  const from = c.offer.from;
  const rival = state.rivals.find((r) => r.id === from);
  if (rival) rival.money -= c.offer.wage * 10;
  ship.captain = null;
  if (ship.route) ship.route.active = false;
  const who = from ? `wechselt zu ${poacherName(from)}` : 'heuert bei einem anderen Reeder an';
  return addNews(state, 'haus', `${c.name} geht in ${town} von Bord der ${ship.name} und ${who}.${ship.route ? ' Die Route ruht.' : ''}`);
}

/**
 * Ein Tag für alle eigenen Kapitäne: Treue steigt bei gutem Lohn und sinkt bei schlechtem.
 * Wer zu unzufrieden ist, bekommt Angebote, auch von der KI-Konkurrenz.
 */
export function tickCaptains(state: GameState, map: MapDef): NewsItem[] {
  const news: NewsItem[] = [];
  const townName = (id: string) => map.towns.find((t) => t.id === id)?.name ?? id;
  for (const ship of state.ships) {
    const c = ship.captain;
    if (!c) continue;
    const settled = settleOffer(state, ship, townName(ship.port ?? ''));
    if (settled) {
      news.push(settled);
      if (!ship.captain) continue;
    }
    const fair = fairWage(c);
    const diff = c.wage - fair;
    let loyalty = c.loyalty ?? 70;
    if (state.money < 0) loyalty -= 4;
    else if (diff >= 0) loyalty += 1 + Math.min(4, diff);
    else loyalty += Math.max(-12, diff * 1.5);
    c.loyalty = clamp(loyalty);
    if (c.loyalty >= LOYALTY_START) c.warned = false;
    if (c.offer) continue;
    if (c.loyalty < LOYALTY_WARN && !c.warned) {
      c.warned = true;
      const why = state.money < 0 ? 'Die Kasse ist leer' : `Er bekommt ${c.wage} Taler, wert ist er ${fair}`;
      news.push(addNews(state, 'haus', `${c.name} auf der ${ship.name} murrt über den Lohn. ${why}. Andere Reeder hören sich schon um.`));
    }
    if (c.loyalty < LOYALTY_POACH && rand(state) < 0.1 + (LOYALTY_POACH - c.loyalty) / 100) {
      const wage = Math.min(MAX_WAGE * 2, Math.max(fair, c.wage) + 2);
      const from = poacher(state, wage * 10);
      c.offer = { wage, from, day: day(state) };
      news.push(
        addNews(
          state,
          from ? 'konkurrenz' : 'haus',
          `${from ? poacherName(from) : 'Ein anderer Reeder'} bietet ${c.name} ${wage} Taler am Tag. Zahlst du nicht mindestens so viel, geht ${c.name} im nächsten Hafen von Bord der ${ship.name}.`,
        ),
      );
    }
  }
  return news;
}

/* ---------- Ankunft: Erfahrung und Zoll ---------- */

/** Länge einer Fahrt in km */
export function voyageKm(state: GameState, map: MapDef, v: Voyage): number {
  const segs = effectiveSegments(state, map);
  return v.legs.reduce((s, l) => s + (segs.find((x) => x.id === l.seg)?.length ?? 0), 0);
}

/**
 * Ein Schiff ist angekommen: Der Kapitän sammelt Erfahrung, ein Schmuggler kann kontrolliert werden,
 * und wer abgeworben ist, geht hier von Bord.
 */
export function captainArrived(state: GameState, map: MapDef, ship: Ship, v: Voyage): NewsItem[] {
  const news: NewsItem[] = [];
  const c = ship.captain;
  if (!c) return news;
  const town = map.towns.find((t) => t.id === v.to)?.name ?? v.to;

  // Schmuggel: Kontrolle an der Zollstelle, an der er vorbeiwollte
  if (v.evaded && v.evaded > 0) {
    const chance = isMaster(c) ? SMUGGLE_CATCH / 2 : SMUGGLE_CATCH;
    if (rand(state) < chance) {
      const fine = Math.round(v.evaded * SMUGGLE_FINE);
      state.money -= fine;
      let seized = 0;
      for (const [g, slot] of Object.entries(ship.cargo)) {
        const take = Math.round(slot.amount * SMUGGLE_SEIZE * 10) / 10;
        if (take <= 0) continue;
        slot.cost -= (slot.cost * take) / slot.amount;
        slot.amount -= take;
        seized += take;
        if (slot.amount < 0.001) delete ship.cargo[g];
      }
      news.push(
        addNews(
          state,
          'haus',
          `Zollkontrolle vor ${town}: ${c.name} wird beim Schmuggeln erwischt. Strafe ${fine} Taler${seized ? `, ${fmtT(seized)} t Ladung beschlagnahmt` : ''}.`,
        ),
      );
    }
  }

  // Erfahrung
  const rankBefore = captainRank(c.km);
  c.km = Math.round((c.km ?? 0) + voyageKm(state, map, v));
  const rank = captainRank(c.km);
  if (rank > rankBefore) {
    if (rank >= 1 && !c.trait2) c.trait2 = rollTrait(state, c.trait);
    const fair = fairWage(c);
    const what =
      rank === 1 && c.trait2
        ? `ist jetzt erfahren und hat dazugelernt: ${TRAITS[c.trait2].name} (${TRAITS[c.trait2].text})`
        : `ist jetzt Altmeister: 5 % schneller und seltener beim Zoll erwischt`;
    news.push(addNews(state, 'haus', `${c.name} hat ${c.km} km auf dem Fluss und ${what}. Gute Leute wollen ${fair} Taler am Tag.`));
  }

  // Abwerbung
  const settled = settleOffer(state, ship, town);
  if (settled) news.push(settled);
  return news;
}

const fmtT = (x: number) => (Math.round(x * 10) / 10).toString().replace('.', ',');
