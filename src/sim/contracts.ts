import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { price } from './economy.ts';
import { addNews, day, fail, getShip, rand, randInt, type Contract, type GameState, type NewsItem, type TradeResult } from './state.ts';
import { contractBonus, noteContractDone, noteContractFailed, offerWeight } from './standing.ts';
import { needs } from './towns.ts';

const MAX_OFFERS = 4;
export const MAX_ACCEPTED = 3;
/** Vertragsstrafe in Anteilen der Belohnung */
export const PENALTY = 0.25;

function townName(map: MapDef, id: string): string {
  return map.towns.find((t) => t.id === id)?.name ?? id;
}

/** Neues Angebot: eine Stadt sucht eine knappe Ware */
function offer(state: GameState, map: MapDef): Contract | null {
  const d = day(state);
  const options: { town: string; good: string; weight: number }[] = [];
  for (const def of map.towns) {
    const want = needs(def, state.towns[def.id], d);
    // Städte, in denen du angesehen bist oder im Rat sitzt, vergeben öfter Aufträge an dich
    const favour = offerWeight(state, def.id);
    const m = state.markets[def.id];
    for (const g of Object.keys(m)) {
      if (!GOOD_BY_ID.has(g)) continue;
      const ratio = m[g].stock / m[g].target;
      if (ratio > 0.9) continue;
      if (state.contracts.some((c) => c.town === def.id && c.good === g)) continue;
      options.push({ town: def.id, good: g, weight: (want[g] ? 2 : 1) * (1.2 - ratio) * favour });
    }
  }
  if (!options.length) return null;
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = rand(state) * total;
  let o = options[0];
  for (const x of options) {
    r -= x.weight;
    if (r <= 0) {
      o = x;
      break;
    }
  }
  const good = GOOD_BY_ID.get(o.good)!;
  const amount = randInt(state, 3, 10) * 5;
  const m = state.markets[o.town][o.good];
  const unit = Math.max(good.base, price(good.base, m.stock, m.target));
  const c: Contract = {
    id: state.nextId++,
    town: o.town,
    good: o.good,
    amount,
    delivered: 0,
    reward: Math.round((unit * amount * (1.3 + rand(state) * 0.4) * (1 + contractBonus(state, o.town))) / 10) * 10,
    issued: d,
    offerUntil: d + randInt(state, 6, 10),
    deadline: d + randInt(state, 14, 26),
    accepted: false,
  };
  state.contracts.push(c);
  return c;
}

/** Täglich: Angebote erneuern, Fristen prüfen */
export function tickContracts(state: GameState, map: MapDef): NewsItem[] {
  const d = day(state);
  const news: NewsItem[] = [];
  for (const c of state.contracts) {
    if (c.accepted && d > c.deadline) {
      const penalty = Math.round(c.reward * PENALTY);
      state.money -= penalty;
      noteContractFailed(state, c.town);
      news.push(
        addNews(state, 'auftrag', `Frist verpasst: ${c.amount} t ${GOOD_BY_ID.get(c.good)?.name} für ${townName(map, c.town)}. ${penalty} Taler Vertragsstrafe.`),
      );
    }
  }
  state.contracts = state.contracts.filter((c) => (c.accepted ? d <= c.deadline : d <= c.offerUntil));
  const open = state.contracts.filter((c) => !c.accepted).length;
  if (open < MAX_OFFERS && rand(state) < 0.35) {
    const c = offer(state, map);
    if (c) news.push(addNews(state, 'auftrag', `${townName(map, c.town)} sucht ${c.amount} t ${GOOD_BY_ID.get(c.good)?.name}, zahlt ${c.reward} Taler.`));
  }
  return news;
}

export function acceptContract(state: GameState, id: number): TradeResult {
  const c = state.contracts.find((x) => x.id === id);
  if (!c || c.accepted) return fail('Das Angebot gibt es nicht mehr.');
  if (state.contracts.filter((x) => x.accepted).length >= MAX_ACCEPTED) return fail(`Höchstens ${MAX_ACCEPTED} Aufträge gleichzeitig.`);
  c.accepted = true;
  return { ok: true, message: 'Auftrag angenommen.', amount: 0, taler: 0 };
}

/** Ware vom Schiff an den Auftraggeber übergeben */
export function deliverContract(state: GameState, shipId: number, id: number): TradeResult {
  const ship = getShip(state, shipId);
  const c = state.contracts.find((x) => x.id === id);
  if (!c || !c.accepted) return fail('Kein solcher Auftrag.');
  if (ship.port !== c.town) return fail('Das Schiff liegt nicht beim Auftraggeber.');
  const slot = ship.cargo[c.good];
  const amount = Math.min(c.amount - c.delivered, slot?.amount ?? 0);
  const name = GOOD_BY_ID.get(c.good)?.name;
  if (amount <= 0) return fail(`Kein ${name} an Bord.`);
  const costShare = Math.round((slot.cost * amount) / slot.amount);
  slot.amount -= amount;
  slot.cost -= costShare;
  if (slot.amount === 0) delete ship.cargo[c.good];
  c.delivered += amount;
  // Die Ware landet auf dem Markt der Stadt
  const m = state.markets[c.town][c.good];
  if (m) m.stock += amount;
  const delivered = (state.stats.delivered[c.town] ??= {});
  delivered[c.good] = (delivered[c.good] ?? 0) + amount;
  if (c.delivered < c.amount) {
    state.totalProfit -= costShare;
    return { ok: true, message: `${amount} t ${name} übergeben, noch ${c.amount - c.delivered} t.`, amount, taler: 0 };
  }
  state.money += c.reward;
  state.totalProfit += c.reward - costShare;
  state.stats.contracts++;
  noteContractDone(state, c.town, c.amount);
  state.contracts = state.contracts.filter((x) => x.id !== id);
  return { ok: true, message: `Auftrag erfüllt: ${c.reward} Taler.`, amount, taler: c.reward, profit: c.reward - costShare };
}
