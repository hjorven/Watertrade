import { GOOD_BY_ID, GOODS } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { RIVAL_BY_ID } from '../data/rivals.ts';
import {
  canBid,
  buyoutCost,
  canBuyShares,
  canOfferPact,
  moodOf,
  nextBid,
  nextShareCost,
  pactUsed,
  PACT_DAYS,
  PACT_TOLERANCE,
  pactPenalty,
  pactWith,
  SHARE_BLOCK,
  shareSaleValue,
  TAKEOVER_SHARE,
} from '../sim/rivalry.ts';
import { day, type GameState, type RivalState } from '../sim/state.ts';

/** Abschnitt im Handelsregister: Verhältnis zu den Häusern, Abkommen, Anteile, Versteigerung */

const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const goodName = (id: string) => GOOD_BY_ID.get(id)?.name ?? id;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const MOOD_TEXT: Record<ReturnType<typeof moodOf>, string> = {
  freundlich: 'freundlich',
  neutral: 'neutral',
  verärgert: 'verärgert',
  feindselig: 'feindselig',
};

function houseCard(state: GameState, map: MapDef, r: RivalState): string {
  const def = RIVAL_BY_ID.get(r.id)!;
  const townName = (id: string) => map.towns.find((t) => t.id === id)?.name ?? id;
  const lines: string[] = [];
  lines.push(`Stimmung: <b>${MOOD_TEXT[moodOf(r)]}</b> · Revier: ${def.turf.map(goodName).join(', ')}`);
  const v = r.retaliation;
  if (v) {
    lines.push(
      v.kind === 'unterbieten'
        ? `Drückt in ${townName(v.town)} die Preise für ${goodName(v.good)}, bis Tag ${v.until}.`
        : `Kauft in ${townName(v.town)} ${goodName(v.good)} leer, bis Tag ${v.until}.`,
    );
  }
  lines.push(r.money >= 0 ? `Kasse: ${fmt(r.money)} Taler` : `Schulden: ${fmt(-r.money)} Taler, seit ${r.debtDays === 1 ? 'einem Tag' : `${r.debtDays ?? 0} Tagen`}`);

  // Abkommen
  const p = pactWith(state, r.id);
  let pact: string;
  if (p) {
    pact = `<p class="note">Abkommen bis Tag ${p.until}: Du lässt <b>${goodName(p.playerGood)}</b> in Ruhe (verkauft seitdem ${Math.floor(pactUsed(state, p))} von ${PACT_TOLERANCE} t Restposten), sie lassen <b>${goodName(p.houseGood)}</b> in Ruhe.</p>
      <div class="row-btns"><button class="btn" data-act="cmd" data-cmd="pactEnd" data-house="${r.id}">Abkommen kündigen</button></div>`;
  } else {
    const mine = def.turf.map((g) => `<option value="${g}">${goodName(g)}</option>`).join('');
    const theirs = GOODS.filter((g) => !def.turf.includes(g.id))
      .map((g) => `<option value="${g.id}">${g.name}</option>`)
      .join('');
    const why = canOfferPact(state, r.id, def.turf[0], GOODS.find((g) => !def.turf.includes(g.id))!.id);
    const blocked = why && !why.includes('Revier von') && !why.includes('Kerngeschäft') ? why : null;
    pact = `<div class="order-form" data-form>
        <span>Ich lasse</span><select name="mine" aria-label="Ware, die du in Ruhe lässt">${mine}</select>
        <span>in Ruhe, ihr</span><select name="theirs" aria-label="Ware, die das Haus in Ruhe lässt">${theirs}</select>
        <button class="btn" data-act="cmd" data-cmd="pactOffer" data-house="${r.id}" ${blocked ? `disabled title="${esc(blocked)}"` : ''}>Abkommen anbieten</button>
      </div>${blocked ? `<p class="fine">${blocked}</p>` : ''}`;
  }

  // Anteile
  const shares = r.shares ?? 0;
  const price = nextShareCost(r);
  const last = shares + SHARE_BLOCK > TAKEOVER_SHARE;
  const why = canBuyShares(state, r.id);
  const buyLabel = shares + SHARE_BLOCK > TAKEOVER_SHARE ? 'Übernehmen' : `${SHARE_BLOCK} % kaufen`;
  const sharesHtml = `<p class="note">Deine Anteile: <b>${shares} %</b>${shares ? `, Wert ${fmt(shareSaleValue(r) * (shares / SHARE_BLOCK))} Taler` : ''}. Ab mehr als ${TAKEOVER_SHARE} % gehört dir das Haus mit Schiffen, Kontoren und Kasse (oder Schulden), die übrigen Teilhaber werden dann ausgezahlt.${last ? ` Im Preis stecken ${fmt(buyoutCost(r))} Taler Auszahlung.` : ''}</p>
    <div class="row-btns">
      <button class="btn ${shares + SHARE_BLOCK > TAKEOVER_SHARE ? 'primary' : ''}" data-act="cmd" data-cmd="buyShares" data-house="${r.id}" ${why ? `disabled title="${esc(why)}"` : ''}>${buyLabel}<small>${fmt(price)} Taler</small></button>
      ${shares ? `<button class="btn" data-act="cmd" data-cmd="sellShares" data-house="${r.id}">${SHARE_BLOCK} % verkaufen<small>${fmt(shareSaleValue(r))} Taler</small></button>` : ''}
    </div>${why && !why.startsWith('Das kostet') ? `<p class="fine">${why}</p>` : ''}`;

  return `<div class="contract-box house-box">
      <h3><span class="flag" style="background:${hex(def.color)}"></span>${def.name}</h3>
      <p class="note">${lines.join('<br>')}</p>
      ${pact}
      ${sharesHtml}
    </div>`;
}

function auctionBox(state: GameState, map: MapDef): string {
  const a = state.auction;
  if (!a) return '';
  const townName = (id: string) => map.towns.find((t) => t.id === id)?.name ?? id;
  const left = Math.max(0, a.until - day(state) + 1);
  const rows = a.lots
    .map((lot) => {
      const who = lot.bidder === 'player' ? 'du' : lot.bidder ? (RIVAL_BY_ID.get(lot.bidder)?.name ?? lot.bidder) : 'niemand';
      const why = canBid(state, lot.town);
      return `<div class="contract-row"><span><b>Kontor ${townName(lot.town)}</b>
          <small>${lot.bid ? `Höchstgebot ${fmt(lot.bid)} Taler (${who})` : `Mindestgebot ${fmt(lot.min)} Taler`}</small></span>
          <button class="btn" data-act="cmd" data-cmd="bid" data-town="${lot.town}" ${why ? `disabled title="${esc(why)}"` : ''}>Bieten<small>${fmt(nextBid(lot))} Taler</small></button></div>`;
    })
    .join('');
  return `<div class="contract-box"><h3>Versteigerung: Kontore von ${a.house}</h3>
      <p class="note">Zuschlag am Ende von Tag ${a.until}, ${left === 1 ? 'nur noch heute' : `noch ${left} Tage`}. Dein Gebot wird hinterlegt und bei Überbietung zurückgezahlt.</p>${rows}</div>`;
}

export function renderRivalry(state: GameState, map: MapDef): string {
  if (!state.rivalsActive) return '';
  const gone = (state.housesGone ?? [])
    .map((h) => `<li>${RIVAL_BY_ID.get(h.id)?.name ?? h.id}: ${h.how === 'konkurs' ? 'pleite' : 'von dir übernommen'} am Tag ${h.day}</li>`)
    .join('');
  const ban = (state.pactBanUntil ?? 0) >= day(state) ? `<p class="note">Nach deinem Vertragsbruch schließt bis Tag ${state.pactBanUntil} niemand ein Abkommen mit dir.</p>` : '';
  return `<h3>Die anderen Häuser</h3>
    <p class="fine">Wer einem Haus in seinem Revier Konkurrenz macht, bekommt Ärger: Erst drückt es die Preise, dann kauft es die Märkte leer. Ein Abkommen gilt ${PACT_DAYS} Tage. Wer es bricht, zahlt ${fmt(pactPenalty(state))} Taler Strafe und verliert das Vertrauen am Fluss.</p>
    ${ban}
    ${auctionBox(state, map)}
    ${state.rivals.map((r) => houseCard(state, map, r)).join('')}
    ${gone ? `<ul class="plain">${gone}</ul>` : ''}`;
}
