/**
 * Kleine Strichzeichen für Kopfzeile und Knöpfe, als Inline-SVG (16 × 16, Linienstärke 1,6, Farbe erbt der Text).
 * Alle Zeichen sind dekorativ; die Beschriftung steht daneben oder im aria-label des Knopfs.
 */
const PATHS: Record<string, string> = {
  // Aufträge: Frachtbrief mit Zeilen
  contracts: '<path d="M4.5 2.5h7l3 3v10h-10z"/><path d="M11.5 2.5v3h3"/><path d="M7 8.5h5M7 11h5"/>',
  // Flussbote: Zeitung
  news: '<path d="M3 4.5h11.5v8.5a1.5 1.5 0 0 1-1.5 1.5H3z"/><path d="M14.5 5.5h2.5v7.5a1.5 1.5 0 0 1-1.5 1.5"/><path d="M5.5 7h3v3h-3zM10 7.5h2.5M10 10h2.5M5.5 12.5h7"/>',
  // Wasserbau: Brücke mit Bogen
  works: '<path d="M2 13h16"/><path d="M4 13V7"/><path d="M16 13V7"/><path d="M4 9.5q6-6 12 0"/><path d="M10 13v-3"/>',
  // Register: aufgeschlagenes Buch
  register: '<path d="M10 5.5c-1.5-1.2-4-1.4-7-1v10c3-.4 5.5-.2 7 1 1.5-1.2 4-1.4 7-1v-10c-3-.4-5.5-.2-7 1z"/><path d="M10 5.5v10"/>',
  // Karte: gefaltete Karte
  map: '<path d="M2.5 5.5l5-2 5 2 5-2v11l-5 2-5-2-5 2z"/><path d="M7.5 3.5v11M12.5 5.5v11"/>',
  // Menü
  menu: '<path d="M3 5h14M3 10h14M3 15h14"/>',
  // Tempo
  pause: '<path d="M6.5 4.5v11M13.5 4.5v11"/>',
  play: '<path d="M6 4.5l9 5.5-9 5.5z"/>',
  fast: '<path d="M3 4.5l7 5.5-7 5.5zM10 4.5l7 5.5-7 5.5z"/>',
  // Kontorbuch ein- und ausklappen
  fold: '<path d="M5 8l5 5 5-5"/>',
  // Schiff für die Flotte
  ship: '<path d="M3 12.5h14l-2 3.5H5z"/><path d="M6.5 12.5v-4h7v4"/><path d="M10 3v5.5"/>',
  // Schließen
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
};

/** Zeichen als Inline-SVG; name muss in PATHS stehen, sonst leer */
export function icon(name: keyof typeof PATHS | string): string {
  const d = PATHS[name];
  if (!d) return '';
  return `<svg class="ico" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

/**
 * Wappen des Handelshauses: Siegelring mit Welle und Segel. Steht in der Kopfzeile und im Hauptmenü.
 * Nutzt die Textfarbe für die Linien und die Wasserfarbe für die Welle.
 */
export function brandMark(size = 28): string {
  return `<svg class="mark" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <circle cx="20" cy="20" r="18.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="20" cy="20" r="15.5" fill="none" stroke="currentColor" stroke-width="0.8" opacity="0.6"/>
    <path d="M14 26v-13l9 11h-9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M14 13v13" stroke="currentColor" stroke-width="1.6"/>
    <path d="M9 29c2.5-2 5-2 7.5 0s5 2 7.5 0 5-2 7 0" fill="none" stroke="var(--water)" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
