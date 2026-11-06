/**
 * Kleine Bildzeichen für die Waren, im Stil eines Holzschnitts: dunkle Kontur, Füllung in der Warenfarbe.
 * Alle Zeichen sind 16 × 16 Einheiten groß und werden inline als SVG eingesetzt.
 */
import { GOOD_BY_ID } from '../data/goods.ts';

const INK = '#2b2118';

/** Zeichenwege je Ware. `F` steht für die Warenfarbe, `D` für eine dunklere Abstufung. */
const ICONS: Record<string, string> = {
  holz: '<rect x="3" y="4" width="11.5" height="8" rx="1" fill="F"/><circle cx="4" cy="8" r="4" fill="D"/><circle cx="4" cy="8" r="1.6" fill="F"/><path d="M7 6h7M7 10h7" stroke="INK" stroke-width=".6"/>',
  bretter: '<rect x="1.5" y="3" width="13" height="3" fill="F"/><rect x="1.5" y="6.5" width="13" height="3" fill="D"/><rect x="1.5" y="10" width="13" height="3" fill="F"/>',
  moebel: '<path d="M4 2v12M4 8h8v6M12 8V5" stroke="INK" stroke-width="1.6" fill="none"/><rect x="3.5" y="7" width="9" height="2" fill="F"/><rect x="3.5" y="2" width="1.5" height="6" fill="D"/>',
  getreide: '<path d="M8 15V4" stroke="INK" stroke-width="1"/><g fill="F"><ellipse cx="6.3" cy="5" rx="1.3" ry="2.2" transform="rotate(-25 6.3 5)"/><ellipse cx="9.7" cy="5" rx="1.3" ry="2.2" transform="rotate(25 9.7 5)"/><ellipse cx="6.3" cy="8.5" rx="1.3" ry="2.2" transform="rotate(-25 6.3 8.5)"/><ellipse cx="9.7" cy="8.5" rx="1.3" ry="2.2" transform="rotate(25 9.7 8.5)"/><ellipse cx="8" cy="2.5" rx="1.1" ry="2"/></g>',
  mehl: '<path d="M4 5c0-2 8-2 8 0l1.5 8c0 1.5-11 1.5-11 0z" fill="F"/><path d="M5.5 4l-1-2M10.5 4l1-2" stroke="INK" stroke-width=".8"/><path d="M6 9h4" stroke="D" stroke-width="1.2"/>',
  brot: '<path d="M1.5 12c0-4.5 3-7.5 6.5-7.5s6.5 3 6.5 7.5z" fill="F"/><path d="M5 7l1.5 3M8 6v3.5M11 7l-1.5 3" stroke="D" stroke-width="1"/>',
  fisch: '<path d="M2 8c2.5-4 7.5-4 10 0-2.5 4-7.5 4-10 0z" fill="F"/><path d="M12 8l2.5-3v6z" fill="D"/><circle cx="4.8" cy="7.3" r=".8" fill="INK"/>',
  salz: '<path d="M2 13l3-6 3 3 2-5 4 8z" fill="F"/><path d="M5 7l1 6M10 5l1 8" stroke="D" stroke-width=".7"/>',
  erz: '<path d="M2 12l2-5 4-2 3 2 3 1-1 4z" fill="F"/><path d="M5 8l2 1 1 3M9 6l1 3 3 1" stroke="D" stroke-width=".8" fill="none"/><circle cx="10.5" cy="10.5" r=".8" fill="#c99a45"/>',
  kohle: '<path d="M2 13l1.5-4 3-1 2 2-1 3z" fill="F"/><path d="M7 13l1.5-5 3-2 2.5 3-1 4z" fill="F"/><path d="M4 6l2-3 3 1-1 3z" fill="F"/><path d="M9 7l2 2" stroke="#6b6460" stroke-width=".7"/>',
  werkzeug: '<path d="M8.5 6.5l5.5 7" stroke="D" stroke-width="2" stroke-linecap="round"/><path d="M2.5 5l4-3.5 4 4-4 3.5z" fill="F"/>',
  glas: '<path d="M6 1.5h4v3l2 2.5v7.5H4V7l2-2.5z" fill="F" fill-opacity=".85"/><path d="M5.5 9h5" stroke="#fff" stroke-width=".8" opacity=".8"/>',
  wolle: '<circle cx="8" cy="8.5" r="5.5" fill="F"/><path d="M3.5 6.5c3 1 6 1 9 0M3 9.5c3.5 1 6.5 1 10 0M5 12.5c2 .5 4 .5 6 0M6 3.5c-1 3-1 7 0 10" stroke="D" stroke-width=".7" fill="none"/>',
  stoff: '<rect x="2" y="4" width="9" height="9" rx="1" fill="F"/><ellipse cx="11.5" cy="8.5" rx="2.5" ry="4.5" fill="D"/><path d="M4 6.5h5M4 9h5M4 11.5h5" stroke="#f0ece0" stroke-width=".6" opacity=".7"/>',
  bier: '<rect x="3" y="4.5" width="7.5" height="10" rx="1" fill="F"/><path d="M10.5 6.5h2a1.5 1.5 0 0 1 1.5 1.5v2.5a1.5 1.5 0 0 1-1.5 1.5h-2" stroke="INK" stroke-width="1.2" fill="none"/><path d="M2.5 5c0-2.5 8.5-2.5 8.5 0z" fill="#fbf6e8"/>',
  arznei: '<path d="M6.5 1.5h3v3.5l3.5 5v4.5H3V10l3.5-5z" fill="F"/><path d="M8 8.5v4.5M5.75 10.75h4.5" stroke="#fbf6e8" stroke-width="1.4"/>',
  lehm: '<path d="M1.5 14c.5-3.5 3-6 6.5-6s6 2.5 6.5 6z" fill="F"/><path d="M10 9.5L12.5 2" stroke="INK" stroke-width="1.1"/><path d="M9 8.5l1.5-3.5 2.5 1-1 3.5z" fill="#8a8f96"/><path d="M4 12l2-1.2M8 12.5l1.5-1" stroke="D" stroke-width=".8"/>',
  ziegel: '<rect x="1.5" y="3" width="13" height="10" fill="F"/><path d="M1.5 6.3h13M1.5 9.7h13M6 3v3.3M11 3v3.3M3.5 6.3v3.4M8.5 6.3v3.4M13.2 6.3v3.4M6 9.7V13M11 9.7V13" stroke="#e8d9bf" stroke-width=".8"/>',
  milch: '<path d="M5.5 1.5h5v2l1.5 1.5v9.5H4V5l1.5-1.5z" fill="F"/><rect x="4" y="7" width="8" height="2.5" fill="D"/><path d="M5.5 3.5h5" stroke="INK" stroke-width=".7"/>',
  kaese: '<path d="M1.5 12V8l11-5 2 5v4z" fill="F"/><path d="M1.5 8h13" stroke="D" stroke-width=".8"/><circle cx="5" cy="10.3" r="1" fill="D"/><circle cx="10" cy="10.6" r="1.2" fill="D"/><circle cx="11" cy="6" r=".7" fill="D"/>',
  wein: '<path d="M6.5 1.5h3v3c2 1 2.5 2.5 2.5 4v6H4v-6c0-1.5.5-3 2.5-4z" fill="F"/><rect x="5.5" y="8" width="5" height="3.5" fill="#f3e8cf"/><rect x="6.5" y="1" width="3" height="1.3" fill="INK"/>',
  diesel: '<rect x="3" y="2.5" width="10" height="12" rx="1.2" fill="F"/><path d="M3 6h10M3 11h10" stroke="D" stroke-width="1"/><circle cx="10.5" cy="4.2" r=".8" fill="#c9b27a"/>',
};

function darker(color: number, f = 0.7): string {
  const r = Math.round(((color >> 16) & 255) * f);
  const g = Math.round(((color >> 8) & 255) * f);
  const b = Math.round((color & 255) * f);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const cache = new Map<string, string>();

/** Inline-SVG für eine Ware, oder ein leerer Text, wenn es kein Zeichen gibt */
export function goodIcon(id: string): string {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const good = GOOD_BY_ID.get(id);
  const body = ICONS[id];
  if (!good || !body) {
    cache.set(id, '');
    return '';
  }
  const fill = `#${good.color.toString(16).padStart(6, '0')}`;
  const inner = body.replace(/"F"/g, `"${fill}"`).replace(/"D"/g, `"${darker(good.color)}"`).replace(/"INK"/g, `"${INK}"`);
  // Kontur um alle Füllflächen, damit auch helle Waren (Milch, Salz) auf Papier sichtbar bleiben
  const svg = `<svg class="good-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g stroke="${INK}" stroke-width=".5" stroke-linejoin="round">${inner}</g></svg>`;
  cache.set(id, svg);
  return svg;
}

/** Waren, für die es ein Zeichen gibt (für Tests) */
export function iconGoods(): string[] {
  return Object.keys(ICONS);
}
