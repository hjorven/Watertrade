import { EPOCHS } from '../data/ships.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { canalAccepts, canalOf, canalProgress, stageNeeds } from '../sim/canal.ts';
import type { GameState } from '../sim/state.ts';

const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');
const goodName = (g: string) => GOOD_BY_ID.get(g)?.name ?? g;

/**
 * Abschnitt "Großprojekt Kanal" im Wasserbau-Reiter. Liefert leeren Text auf Karten ohne Kanal.
 * Befehle: cmd=canalStart, cmd=canalDeliver mit ship=<id> oder kontor=<stadt>, good, n.
 */
export function renderCanal(state: GameState, map: MapDef, townName: (id: string) => string): string {
  const def = canalOf(map);
  const prog = canalProgress(state, map);
  if (!def || !prog) return '';
  const c = state.canal?.id === def.id ? state.canal : undefined;
  const sites = def.sites.map(townName).join(' und ');
  const pct = Math.round(prog.total * 100);

  const stages = def.stages
    .map((st, i) => {
      const state_ = i < prog.stage ? 'fertig' : i === prog.stage && c?.active ? `läuft, ${Math.round(prog.stageShare * 100)} %` : 'offen';
      const goods = Object.entries(st.goods)
        .map(([g, n]) => `${n} t ${goodName(g)}`)
        .join(', ');
      return `<li class="${i < prog.stage ? 'done' : i === prog.stage ? 'now' : ''}"><b>${st.name}</b> <small>${fmt(st.cost)} Taler · ${st.days} Arbeitstage${goods ? ` · ${goods}` : ''} · ${state_}</small></li>`;
    })
    .join('');

  let action = '';
  if (prog.done) {
    action = `<p><span class="done-mark">fertig</span> Der Kanal ist offen. Im Winter friert er zu wie die Bäche.</p>`;
  } else if (def.epoch > state.epoch) {
    action = `<p class="note">Ab Epoche „${EPOCHS[def.epoch - 1].name}“.</p>`;
  } else if (!c?.active) {
    const st = def.stages[prog.stage];
    action = `<div class="yard-row"><div><b>Nächster Abschnitt: ${st.name}</b><small class="desc">${st.text}</small></div>
      <button class="btn" data-act="cmd" data-cmd="canalStart" ${state.money >= st.cost ? '' : 'disabled'}>${fmt(st.cost)} Taler</button></div>`;
  } else {
    const st = def.stages[prog.stage];
    const needs = stageNeeds(state, def);
    const stock = Object.entries(c.stock)
      .filter(([, n]) => n >= 0.5)
      .map(([g, n]) => `${fmt(n)} t ${goodName(g)}`)
      .join(', ');
    const needText = Object.entries(needs)
      .map(([g, n]) => `${fmt(n)} t ${goodName(g)}`)
      .join(', ');
    const waiting = c.frost
      ? '<p class="warn">Frostpause: Im Winter ruht dieser Abschnitt. Baustoffe kannst du trotzdem anliefern.</p>'
      : c.waiting.length
      ? `<p class="warn">Die Arbeit stockt, es fehlt an ${c.waiting.map(goodName).join(', ')}.</p>`
      : '';
    action = `<p><b>${st.name}</b> <small class="desc">${st.text}</small></p>${waiting}
      <p><small>Im Baulager: ${stock || 'nichts'}</small><br><small>Noch anzuliefern: ${needText || 'nichts, alles da'}</small></p>`;
  }

  // Lieferungen aus Schiffen und Kontoren an den Baustellen
  const rows: string[] = [];
  if (!prog.done) {
    const offer = (label: string, attr: string, cargo: Record<string, { amount: number }>) => {
      for (const [g, slot] of Object.entries(cargo)) {
        const n = Math.min(Math.floor(slot.amount), canalAccepts(state, def, g));
        if (n <= 0) continue;
        rows.push(`<div class="yard-row"><div><b>${fmt(n)} t ${goodName(g)}</b> <small>${label}</small></div>
          <button class="btn" data-act="cmd" data-cmd="canalDeliver" ${attr} data-good="${g}" data-n="${n}">Abliefern</button></div>`);
      }
    };
    for (const ship of state.ships) {
      if (ship.port && def.sites.includes(ship.port)) offer(`von „${ship.name}“ in ${townName(ship.port)}`, `data-ship="${ship.id}"`, ship.cargo);
    }
    for (const town of def.sites) {
      const k = state.kontore[town];
      if (k) offer(`aus dem Kontor in ${townName(town)}`, `data-kontor="${town}"`, k.stock);
    }
  }
  const deliver = prog.done
    ? ''
    : `<h3>Baustoffe abliefern</h3>${
        rows.join('') ||
        `<p class="note">Baustellen gibt es in ${sites}. Bring Baustoffe mit einem Schiff dorthin oder lagere sie im Kontor dort ein.</p>`
      }`;

  return `<h3>Großprojekt: ${def.name}</h3>
    <p><small class="desc">${def.text} Baustellen in ${sites}. Jeder Abschnitt wird erst bezahlt und dann mit Baustoffen versorgt; bei Frost ruhen Erd- und Mauerarbeiten.</small></p>
    <div class="progress" title="${pct} % gebaut"><div style="width:${pct}%"></div></div>
    <p><small>${pct} % gebaut · Abschnitt ${Math.min(prog.stage + 1, prog.stages)} von ${prog.stages}</small></p>
    <ol class="legs">${stages}</ol>
    ${action}
    <div class="yard">${deliver}</div>`;
}
