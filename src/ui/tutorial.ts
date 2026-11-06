/**
 * Hinweise für das erste Kapitel: Sie führen Schritt für Schritt vom ersten Floß
 * über die erste Fahrt bergwärts bis zum eigenen kleinen Handelshaus.
 */
import { CHAPTERS } from '../data/campaign.ts';
import { GOOD_BY_ID, GOODS } from '../data/goods.ts';
import type { MapDef } from '../data/maps/valley.ts';
import { timberPlan } from '../sim/fleet.ts';
import { bestRaftPlan } from '../sim/rafting.ts';
import { cargoLoad, capacityOf, type GameState, type Ship } from '../sim/state.ts';
import { needs, netFlow } from '../sim/towns.ts';
import { planVoyage } from '../sim/voyage.ts';

/** Getreide, das in Kapitel 1 bergwärts soll (aus den Kapitelzielen) */
const grainGoal = CHAPTERS.find((c) => c.id === 'k1')?.goals.find((g) => g.type === 'deliver' && g.good === 'getreide');
const K1_GRAIN = grainGoal?.type === 'deliver' ? grainGoal.amount : 60;
const supplyRaw = CHAPTERS.find((c) => c.id === 'k1')?.goals.find((g) => g.type === 'supply');
const supplyGoal = supplyRaw?.type === 'supply' ? supplyRaw : null;

const goodName = (id: string) => GOOD_BY_ID.get(id)?.name ?? id;

/** Nächstgelegene erreichbare Stadt mit Bedarf an einer Ware */
export function buyerFor(state: GameState, map: MapDef, ship: Ship, good: string): string | null {
  let best: { town: string; hours: number } | null = null;
  for (const def of map.towns) {
    if (def.id === ship.port || !state.markets[def.id][good]) continue;
    if (netFlow(def, good, state.towns[def.id]) >= 0) continue;
    const plan = planVoyage(state, map, ship.id, def.id);
    if (!plan?.ok) continue;
    if (!best || plan.voyage.hours < best.hours) best = { town: def.id, hours: plan.voyage.hours };
  }
  return best?.town ?? null;
}

/** Erster Handel: Überschussware hier, mit einem nahen Abnehmer */
export function bestFirstTrade(state: GameState, map: MapDef, ship: Ship): { good: string; town: string; surplus: number } | null {
  const here = map.towns.find((t) => t.id === ship.port);
  if (!here) return null;
  for (const g of GOODS) {
    if (!state.markets[here.id][g.id]) continue;
    const surplus = netFlow(here, g.id, state.towns[here.id]);
    if (surplus <= 0) continue;
    const town = buyerFor(state, map, ship, g.id);
    if (town) return { good: g.id, town, surplus };
  }
  return null;
}

/** Erster Gewinn mit einem normalen Schiff (falls das Geld fürs Floß nicht reicht) */
function tradeHint(state: GameState, map: MapDef, ship: Ship, townName: (id: string) => string): string {
  if (ship.voyage) return 'Unterwegs. Oben rechts lässt sich die Zeit mit <b>4×</b> beschleunigen.';
  const aboard = Object.entries(ship.cargo).find(([, c]) => c.amount > 0)?.[0];
  if (!aboard) {
    const tip = bestFirstTrade(state, map, ship);
    return tip
      ? `Kauf eine Ware, die hier im <b>Überschuss</b> ist, denn dann ist sie billig. Zum Beispiel <b>${goodName(tip.good)}</b> (+${Math.round(tip.surplus)} t am Tag), das wird in <b>${townName(tip.town)}</b> gebraucht.`
      : 'Kauf eine Ware, die hier im <b>Überschuss</b> ist, denn dann ist sie billig, und bring sie in eine Stadt mit <b>Bedarf</b>.';
  }
  const dest = buyerFor(state, map, ship, aboard);
  return `Liegt der Verkaufspreis über deinem Einkauf (ø), verkauf mit <b>Verkaufen</b>. Sonst leg ab${dest ? ` nach <b>${townName(dest)}</b>, dort wird ${goodName(aboard)} gebraucht` : ' zu einer Stadt mit <b>Bedarf</b> an der Ware'}.`;
}

/** Erstes Floß: zimmern, beladen, treiben lassen, verkaufen, zerlegen */
function raftHint(state: GameState, map: MapDef, ship: Ship, townName: (id: string) => string): string | null {
  // ein Floß im Hafen braucht eine Anweisung, eins auf dem Wasser nicht
  const rafts = state.ships.filter((s) => s.type === 'floss');
  const raft = rafts.find((s) => s.id === ship.id) ?? rafts.find((s) => s.port) ?? rafts[0];
  if (!raft) {
    const yard = map.towns.find((t) => t.shipyard.includes('floss'));
    if (!yard) return null;
    if (ship.port !== yard.id) {
      if (!state.firstProfitDone) return tradeHint(state, map, ship, townName);
      return ship.voyage ? null : `Flöße zimmert nur die Werft in <b>${yard.name}</b>. Fahr mit Ladung dorthin, dann bau dort dein erstes Floß.`;
    }
    const plan = timberPlan(state, yard.id, 'floss');
    if (plan.problem) {
      // zu wenig Geld oder Holz: erst einmal mit dem Kahn handeln
      return state.firstProfitDone ? `Fürs Floß fehlt noch etwas: ${plan.problem}` : tradeHint(state, map, ship, townName);
    }
    return `${yard.name} hat Holz im <b>Überschuss</b>, darum ist es hier billig. Zimmere in der <b>Werft</b> ein <b>Floß</b> aus 20 t Holz (${plan.cost} Taler mit Lohn). Es treibt talwärts, nimmt Ladung mit und wird am Ziel zerlegt und als Holz verkauft.`;
  }
  if (raft.voyage) {
    const kahn = state.ships.find((s) => s.type !== 'floss' && s.port && !s.voyage);
    return `Das Floß treibt nach <b>${townName(raft.voyage.to)}</b>. Mit <b>4×</b> oben rechts geht es schneller.${kahn ? ' Derweil kann der Treidelkahn eigene Geschäfte machen.' : ''}`;
  }
  if (ship.id !== raft.id) return `Dein Floß liegt in <b>${townName(raft.port!)}</b>. Wähl es oben in der Flotte aus.`;
  const load = cargoLoad(raft);
  const builtHere = map.towns.find((t) => t.id === raft.port)?.shipyard.includes('floss');
  if (builtHere) {
    const plan = bestRaftPlan(state, map, raft);
    if (!plan) return 'Gerade kommt das Floß nirgends hin. Warte auf besseres Wasser.';
    if (load === 0 && plan.good) {
      return `Das Floß trägt noch ${capacityOf(raft)} t. Am meisten bringen gerade <b>${plan.amount} t ${goodName(plan.good)}</b> nach <b>${townName(plan.to)}</b>. Mit dem Floßholz bringt das etwa ${Math.round(plan.profit)} Taler ein. Kauf die Ladung im <b>Markt</b>.`;
    }
    const more = plan.good && load > 0 ? `Es passen noch ${plan.amount} t ${goodName(plan.good)} dazu. ` : '';
    return `${more}Leg ab nach <b>${townName(plan.to)}</b>. Ein Floß treibt nur mit der Strömung und kommt nicht zurück.`;
  }
  if (load > 0) return 'Angekommen. Verkauf die Ladung im <b>Markt</b> mit <b>Verkaufen</b>.';
  if (!state.markets[raft.port!]?.holz) {
    const dest = buyerFor(state, map, raft, 'holz');
    return `Hier kauft niemand Holz. Lass das Floß weiter treiben${dest ? ` nach <b>${townName(dest)}</b>` : ''}.`;
  }
  return 'Jetzt <b>Floß zerlegen</b>: Sein Holz wird hier verkauft, und der Lohn für die Zimmerleute ist wieder drin.';
}

/** Erste Fahrt bergwärts: Getreide für Oberau */
function grainHint(state: GameState, map: MapDef, ship: Ship, townName: (id: string) => string): string | null {
  const home = map.towns.find((t) => t.shipyard.includes('floss'));
  if (!home) return null;
  const delivered = state.stats.delivered[home.id]?.getreide ?? 0;
  if (delivered >= K1_GRAIN) return null;
  if (ship.type === 'floss') return null;
  const aboard = ship.cargo.getreide?.amount ?? 0;
  if (ship.voyage) return null;
  if (aboard > 0 && ship.port === home.id) return `Verkauf das Getreide hier mit <b>Verkaufen</b>. Noch ${Math.ceil(K1_GRAIN - delivered)} t fehlen.`;
  if (aboard > 0) return `Leg ab nach <b>${home.name}</b>. Bergwärts ziehen Pferde den Kahn, das dauert länger als talwärts.`;
  const source = map.towns.find((t) => state.markets[t.id].getreide && netFlow(t, 'getreide', state.towns[t.id]) > 0);
  return `Der Treidelkahn fährt auch <b>bergwärts</b>. ${home.name} braucht <b>Getreide</b>${source ? `, in <b>${townName(source.id)}</b> gibt es viel davon` : ''}. Bring ${K1_GRAIN} t hinauf.`;
}

/** Danach: Oberau rundum versorgen, bis die Leiste im Stadtfenster das Ziel erreicht */
function supplyHint(state: GameState, map: MapDef, townName: (id: string) => string): string | null {
  const home = map.towns.find((t) => t.shipyard.includes('floss'));
  if (!home || !supplyGoal) return null;
  const town = state.towns[home.id];
  const percent = Math.round(town.satisfaction * 100);
  if (percent >= supplyGoal.percent) return null;
  const short = Object.keys(needs(home, town))
    .filter((g) => { const m = state.markets[home.id][g]; return m && m.stock < m.target; })
    .map((g) => {
      const from = map.towns.find((t) => t.id !== home.id && state.markets[t.id][g] && netFlow(t, g, state.towns[t.id]) > 0);
      return `<b>${goodName(g)}</b>${from ? ` (${townName(from.id)})` : ''}`;
    });
  if (!short.length) return `${home.name} ist zu ${percent} % versorgt. Halte die Lager noch ein paar Tage voll.`;
  return `${home.name} ist erst zu ${percent} % versorgt (Leiste im Stadtfenster). Knapp sind ${short.join(', ')}. Was knapp ist, verkauft sich dort teuer.`;
}

/** Nächster Schritt im ersten Kapitel, oder null, wenn der Spieler allein weiterkommt */
export function chapterOneHint(state: GameState, map: MapDef, ship: Ship, townName: (id: string) => string): string | null {
  if (state.stats.rafts < 1) return raftHint(state, map, ship, townName);
  const home = map.towns.find((t) => t.shipyard.includes('floss'));
  if (home && (state.stats.delivered[home.id]?.getreide ?? 0) < K1_GRAIN) return grainHint(state, map, ship, townName);
  return supplyHint(state, map, townName);
}
