import { GOOD_BY_ID, GOODS } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { day, type GameState, type Ship } from '../sim/game.ts';
import { knownPrices, priceHistory, tripProfit, trips, type PricePoint, type TripRecord } from '../sim/market-info.ts';

/** Oberfläche für Preisbuch, Preisverlauf und Schiffsbuch (Ausbauplan 5.1). Liefert nur HTML-Text. */

const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const goodName = (id: string) => GOOD_BY_ID.get(id)?.name ?? id;
const swatch = (id: string) => `<span class="swatch" style="background:${hex(GOOD_BY_ID.get(id)?.color ?? 0x999999)}"></span>`;
const townName = (map: MapDef, id: string) => map.towns.find((t) => t.id === id)?.name ?? id;

/** Alter einer Beobachtung in Worten */
function stand(today: number, seen: number, live: boolean): string {
  if (live) return 'live';
  const age = today - seen;
  return age <= 0 ? 'heute' : age === 1 ? 'gestern' : `vor ${age} Tagen`;
}

/**
 * Kleines Liniendiagramm: Kauf- und Verkaufspreis je Tonne über die beobachteten Tage.
 * Eine Achse, dünne Linien, Punkte mit Tooltip, Legende über dem Diagramm.
 */
export function priceChart(points: PricePoint[], label: string): string {
  if (points.length < 2) {
    return `<p class="note pb-empty">${points.length ? 'Erst eine Beobachtung, der Verlauf füllt sich mit jedem Besuch.' : 'Hier noch nichts beobachtet.'}</p>`;
  }
  const W = 300;
  const H = 120;
  const L = 30; // Platz für die Preisachse
  const R = 8;
  const T = 8;
  const B = 18;
  const d0 = points[0][0];
  const d1 = points[points.length - 1][0];
  const lo = Math.min(...points.map((p) => p[2]));
  const hi = Math.max(...points.map((p) => p[1]));
  // etwas Luft und runde Grenzen
  const step = hi - lo > 40 ? 10 : hi - lo > 12 ? 5 : 2;
  const yMin = Math.max(0, Math.floor((lo - 1) / step) * step);
  const yMax = Math.ceil((hi + 1) / step) * step;
  const x = (dd: number) => L + ((dd - d0) / Math.max(1, d1 - d0)) * (W - L - R);
  const y = (p: number) => T + (1 - (p - yMin) / Math.max(1, yMax - yMin)) * (H - T - B);
  const line = (i: 1 | 2) => points.map((p) => `${x(p[0]).toFixed(1)},${y(p[i]).toFixed(1)}`).join(' ');
  const ticks = [yMin, Math.round((yMin + yMax) / 2), yMax]
    .map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="pc-grid"/><text x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="pc-axis">${v}</text>`)
    .join('');
  const dots = points
    .map(
      (p) => `<g class="pc-hit"><rect x="${(x(p[0]) - 5).toFixed(1)}" y="${T}" width="10" height="${H - T - B}" fill="transparent"/>
        <circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="2.5" class="pc-buy"/><circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[2]).toFixed(1)}" r="2.5" class="pc-sell"/>
        <title>Tag ${p[0]}: Kauf ${p[1]}, Verkauf ${p[2]} Taler</title></g>`,
    )
    .join('');
  return `<div class="pc">
      <div class="pc-legend"><span><i class="pc-key buy"></i>Kauf</span><span><i class="pc-key sell"></i>Verkauf</span><small>Taler je Tonne, Tag ${d0} bis ${d1}</small></div>
      <svg viewBox="0 0 ${W} ${H}" class="pc-svg" role="img" aria-label="${label}">
        ${ticks}
        <text x="${L}" y="${H - 4}" class="pc-axis">Tag ${d0}</text><text x="${W - R}" y="${H - 4}" text-anchor="end" class="pc-axis">Tag ${d1}</text>
        <polyline points="${line(1)}" class="pc-line buy"/><polyline points="${line(2)}" class="pc-line sell"/>
        ${dots}
      </svg>
    </div>`;
}

/**
 * Preisbuch für eine Ware: bekannte Preise aller Städte mit Stand, darunter der Verlauf
 * in der gewählten Stadt. Städte ohne Besuch bleiben leer.
 */
export function priceBookPanel(state: GameState, map: MapDef, good: string, town: string): string {
  const today = day(state);
  const rows = map.towns
    .map((t) => {
      const k = knownPrices(state, t.id);
      const q = k?.prices[good];
      const on = t.id === town ? ' on' : '';
      if (!k) return `<tr class="muted${on}"><th scope="row"><button class="link" data-act="bookTown" data-town="${t.id}">${t.name}</button></th><td class="num">?</td><td class="num">?</td><td><small>nie besucht</small></td></tr>`;
      if (!q) return `<tr class="muted${on}"><th scope="row"><button class="link" data-act="bookTown" data-town="${t.id}">${t.name}</button></th><td class="num">–</td><td class="num">–</td><td><small>kein Handel</small></td></tr>`;
      return `<tr class="${on.trim()}"><th scope="row"><button class="link" data-act="bookTown" data-town="${t.id}">${t.name}</button></th><td class="num">${q.buy}</td><td class="num">${q.sell}</td><td><small class="${k.live ? 'live' : ''}">${stand(today, k.day, k.live)}</small></td></tr>`;
    })
    .join('');
  return `<div class="pricebook">
      <h3>${swatch(good)}${goodName(good)} im Preisbuch</h3>
      <p class="note">Fremde Preise kennst du nur vom letzten Besuch. Mit eigenem Kontor oder einem Schiff im Hafen siehst du sie live.</p>
      <table class="market pb-table"><thead><tr><th>Stadt</th><th title="Preis je Tonne beim Kauf">Kauf</th><th title="Preis je Tonne beim Verkauf">Verkauf</th><th>Stand</th></tr></thead><tbody>${rows}</tbody></table>
      <h3 class="pb-sub">Verlauf in ${townName(map, town)}</h3>
      ${priceChart(priceHistory(state, town, good), `Preisverlauf ${goodName(good)} in ${townName(map, town)}`)}
    </div>`;
}

/** Warenwahl als Knöpfe */
export function goodPicker(state: GameState, selected: string): string {
  const known = new Set<string>();
  for (const page of Object.values(state.priceBook ?? {})) Object.keys(page.prices).forEach((g) => known.add(g));
  for (const town of Object.keys(state.markets)) {
    const k = knownPrices(state, town);
    if (k) Object.keys(k.prices).forEach((g) => known.add(g));
  }
  return `<div class="pb-goods">${GOODS.filter((g) => known.has(g.id))
    .map((g) => `<button class="btn pb-good ${g.id === selected ? 'on' : ''}" data-act="bookGood" data-good="${g.id}">${swatch(g.id)}${g.name}</button>`)
    .join('')}</div>`;
}

function tripRow(map: MapDef, t: TripRecord, inPort: boolean): string {
  const open = t.arrived === undefined;
  const p = tripProfit(t);
  const parts = [`Einstand ${fmt(t.cost)}`];
  if (t.fuel >= 0.5) parts.push(`Brennstoff ${fmt(t.fuel)}`);
  if (t.toll) parts.push(`Zoll ${fmt(t.toll)}`);
  if (t.wage >= 0.5) parts.push(`Lohn ${fmt(t.wage)}`);
  const when = open ? `seit Tag ${t.day} unterwegs` : `Tag ${t.day}${t.arrived !== t.day ? ` bis ${t.arrived}` : ''}${inPort ? ', Verkäufe im Hafen zählen noch dazu' : ''}`;
  return `<tr>
      <th scope="row">${townName(map, t.from)} → ${townName(map, t.to)}<small>${when}${t.tons ? ` · ${fmt(t.tons)} t ${t.stored ? `abgesetzt, ${fmt(t.stored)} t davon ins Kontor (zum Marktwert)` : 'verkauft'}` : ''}${t.partial ? ' · Teillieferung, Auftrag noch offen' : ''}</small></th>
      <td class="num">${fmt(t.sell)}</td>
      <td class="num">${fmt(t.sell - p)}<small>${parts.join(' · ')}</small></td>
      <td class="num ${p > 0 ? 'gain' : p < 0 ? 'loss' : ''}">${p > 0 ? '+' : p < 0 ? '−' : ''}${fmt(Math.abs(p))}</td>
    </tr>`;
}

/** Schiffsbuch: Gewinn je Fahrt nach allen Kosten */
export function shipBook(map: MapDef, ship: Ship): string {
  const list = trips(ship);
  if (!list.length) {
    return `<h3>Schiffsbuch der ${ship.name}</h3><p class="note">Noch keine Fahrt. Nach dem ersten Ablegen steht hier, was jede Fahrt eingebracht hat.</p>`;
  }
  const done = list.filter((t) => t.arrived !== undefined);
  const sum = done.reduce((s, t) => s + tripProfit(t), 0);
  return `<h3>Schiffsbuch der ${ship.name}</h3>
    <p class="note">Gewinn je Fahrt: Erlös im Zielhafen minus Einkaufswert der verkauften Ware, Brennstoff, Zoll und Kapitänslohn für die Fahrzeit. Ware, die ins eigene Kontor geht, zählt zum Marktwert. Verkäufe zählen zur Fahrt, bis das Schiff wieder ablegt.</p>
    <table class="market tripbook"><thead><tr><th>Fahrt</th><th>Erlös</th><th>Kosten</th><th>Gewinn</th></tr></thead><tbody>${list.map((t) => tripRow(map, t, t === ship.trip && t.arrived !== undefined && ship.port === t.to)).join('')}</tbody></table>
    <p class="note">${done.length} ${done.length === 1 ? 'Fahrt' : 'Fahrten'} im Buch, zusammen <b class="${sum >= 0 ? 'gain' : 'loss'}">${sum >= 0 ? '+' : '−'}${fmt(Math.abs(sum))} Taler</b>${done.length ? `, im Schnitt ${sum >= 0 ? '+' : '−'}${fmt(Math.abs(sum / done.length))}` : ''}.</p>`;
}
