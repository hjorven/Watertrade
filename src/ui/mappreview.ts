import type { MapDef } from '../data/maps/valley.ts';
import { HALF_D, HALF_W, riversGeo, townFootprint } from '../data/maps/random.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Kleine Papierkarte einer Karte für das Menü: Flussläufe, Städte und Brücken */
export function mapPreviewSvg(map: MapDef): string {
  const geos = riversGeo(map.rivers);
  const f = (n: number) => n.toFixed(1);
  const rivers = [...geos.values()]
    .map((g) => `<path d="M${g.samples.map((p) => `${f(p.x)} ${f(p.z)}`).join(' L')}" class="m-river" style="stroke-width:${f(g.def.halfWidth * 0.9)}"/>`)
    .join('');
  const bridges = map.segments
    .filter((s) => s.bridgeHeight !== undefined)
    .map((s) => {
      const g = geos.get(s.river)!;
      const t = s.fromT + (s.toT - s.fromT) * 0.3;
      const p = g.curve.getPointAt(t);
      const tan = g.curve.getTangentAt(t);
      const w = g.def.halfWidth + 2;
      return `<line x1="${f(p.x + tan.z * w)}" y1="${f(p.z - tan.x * w)}" x2="${f(p.x - tan.z * w)}" y2="${f(p.z + tan.x * w)}" class="m-bridge"/>`;
    })
    .join('');
  const towns = map.towns
    .map((t) => {
      const c = townFootprint(geos.get(t.river)!, t.riverT, t.side, t.houses);
      const below = c.z < HALF_D - 12;
      return `<circle cx="${f(c.x)}" cy="${f(c.z)}" r="3.2" class="m-town${t.id === map.start ? ' m-start' : ''}"/>
        <text x="${f(c.x)}" y="${f(c.z + (below ? 10 : -6))}" class="m-label" text-anchor="middle">${esc(t.name)}</text>`;
    })
    .join('');
  return `<svg class="paper-map map-preview" viewBox="${-HALF_W} ${-HALF_D} ${HALF_W * 2} ${HALF_D * 2}" role="img" aria-label="Karte: ${esc(map.name)}">${rivers}${bridges}${towns}</svg>`;
}
