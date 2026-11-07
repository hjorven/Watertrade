/**
 * Rathaus-Reiter: Ansehen in der Stadt, was es freischaltet, Stiftungen und Ratssitz (Stadthaus und Stadtrat).
 * Liefert nur HTML; die Knöpfe schicken Befehle über data-cmd an main.ts (found, seat, leaveCouncil).
 */
import { COUNCIL, FOUNDATIONS, RANKS, TOWNHOUSE } from '../data/foundations.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import type { TownDef } from '../data/maps/valley.ts';
import { season, SEASON_NAME } from '../sim/calendar.ts';
import { day, type GameState } from '../sim/state.ts';
import { foundationAllowed, rankIndex, seatAllowed, seatPrice, standing } from '../sim/standing.ts';
import { SEASON_NEEDS, needs } from '../sim/towns.ts';
import { explain } from './explain.ts';

const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');
const goodName = (id: string) => GOOD_BY_ID.get(id)?.name ?? id;
const esc = (s: string) => s.replace(/"/g, '&quot;');

/** Ansehen als kurze Zeile für die Stadtinfo im Markt-Reiter */
export function standingLine(state: GameState, town: TownDef): string {
  const pts = standing(state, town.id);
  const r = rankIndex(pts);
  const extra: string[] = [];
  const s = state.standing?.[town.id];
  if (s?.townhouse) extra.push('Stadthaus');
  if (s?.council) extra.push('Ratssitz');
  const discount = RANKS[r].discount ? ` · ${Math.round(RANKS[r].discount * 100)} % Nachlass beim Einkauf` : '';
  return `<small class="standing-line">Ansehen: <b>${RANKS[r].name}</b> (${Math.round(pts)})${discount}${extra.length ? ` · ${extra.join(', ')}` : ''}</small>`;
}

/** Was die Stadt in dieser Jahreszeit stärker oder schwächer verlangt, nur Waren, die sie braucht */
export function seasonLine(state: GameState, town: TownDef): string {
  const d = day(state);
  const s = season(d);
  const want = needs(town, state.towns[town.id], d);
  const more = Object.entries(SEASON_NEEDS[s])
    .filter(([g, f]) => f > 1 && g in want)
    .map(([g]) => goodName(g));
  const less = Object.entries(SEASON_NEEDS[s])
    .filter(([g, f]) => f < 1 && g in want)
    .map(([g]) => goodName(g));
  if (!more.length && !less.length) return '';
  const parts = [];
  if (more.length) parts.push(`mehr ${more.join(', ')}`);
  if (less.length) parts.push(`weniger ${less.join(', ')}`);
  return `<small>Im ${SEASON_NAME[s]} braucht ${town.name} ${parts.join(', ')}.</small>`;
}

/** Hinweis auf geschlossene Stadtbetriebe */
export function closedLine(state: GameState, town: TownDef): string {
  const closed = state.towns[town.id].closed ?? [];
  if (!closed.length) return '';
  return `<b class="event">Geschlossen: ${closed.join(', ')}. Ausreichend versorgt öffnet die Stadt sie nach einigen Wochen wieder.</b>`;
}

function button(cmd: string, label: string, sub: string, why: string | null, extra = ''): string {
  return `<button class="btn wide" data-act="cmd" data-cmd="${cmd}" ${extra} ${why ? `disabled title="${esc(why)}"` : ''}>${label}<small>${why ?? sub}</small></button>`;
}

/** Inhalt des Rathaus-Reiters (ohne Kopf) */
export function renderRathaus(state: GameState, town: TownDef): string {
  const pts = standing(state, town.id);
  const r = rankIndex(pts);
  const next = RANKS[r + 1];
  const s = state.standing?.[town.id];
  const pct = Math.round(pts);

  const ranks = RANKS.slice(1)
    .map((x, i) => `<li class="${i + 1 <= r ? 'done' : ''}"><b>${x.name}</b> ab ${x.from}: ${x.unlocks}</li>`)
    .join('');

  const foundations = FOUNDATIONS.map((f) => {
    const have = s?.foundations.includes(f.id);
    if (have) return `<div class="yard-row"><div><b>${f.name}</b> <small>gestiftet · +${f.standing} Ansehen · Unterhalt ${f.upkeep} am Tag</small></div></div>`;
    const why = foundationAllowed(state, town.id, f.id);
    return `<div class="yard-row">
      <div><b>${f.name}</b> <small>+${f.standing} Ansehen, Versorgung +${Math.round(f.satisfaction * 100)} %, Unterhalt ${f.upkeep} am Tag</small>
      <small class="desc">${f.description}${why ? ` <b>${why}</b>` : ''}</small></div>
      <button class="btn" data-act="cmd" data-cmd="found" data-id="${f.id}" ${why ? `disabled title="${esc(why)}"` : ''}>${fmt(f.price)} Taler</button></div>`;
  }).join('');

  const seat = s?.council
    ? `<p class="note">Du sitzt im Rat von ${town.name}${s.townhouse ? ' und hast ein Stadthaus am Markt' : ''}: halber Zoll auf den Abschnitten an der Stadt, mehr und besser bezahlte Aufträge. Aufwand ${COUNCIL.upkeep + (s.townhouse ? TOWNHOUSE.upkeep : 0)} Taler am Tag.</p>
       <button class="btn wide" data-act="cmd" data-cmd="leaveCouncil">Ratssitz aufgeben<small>spart ${COUNCIL.upkeep} Taler am Tag, kostet ${COUNCIL.standing} Ansehen, das Stadthaus bleibt</small></button>`
    : button(
        'seat',
        'Stadthaus und Ratssitz',
        `${fmt(seatPrice(state, town.id))} Taler, +${COUNCIL.standing + (s?.townhouse ? 0 : TOWNHOUSE.standing)} Ansehen. Halber Zoll an der Stadt, mehr und besser bezahlte Aufträge. Aufwand ${COUNCIL.upkeep + TOWNHOUSE.upkeep} am Tag.`,
        seatAllowed(state, town.id),
      );

  return `<div class="town-info">
      <span>Ansehen <b>${RANKS[r].name}</b> · ${pct} von 100</span>
      <div class="meter" title="Ansehen ${pct}"><div style="width:${pct}%"></div>${next ? `<i style="left:${next.from}%"></i>` : ''}</div>
      <small>${next ? `Noch ${Math.ceil(next.from - pts)} bis "${next.name}": ${next.unlocks}.` : 'Höchster Rang erreicht.'}</small>
    </div>
    ${explain('ansehen', `<p>Ansehen bringen Lieferungen in knappe Märkte, erfüllte Aufträge und Bier und Brot beim Stadtfest. Verdientes Ansehen verblasst langsam, gestiftetes bleibt.</p><ul class="plain ranks">${ranks}</ul>`, 'Was bringt Ansehen?')}
    <h3>Stiftungen</h3>
    ${foundations}
    <h3>Ratssitz</h3>
    ${seat}`;
}
