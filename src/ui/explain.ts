/**
 * Längere Erklärungen eingeklappt, damit Zahlen und Knöpfe oben bleiben.
 * key hält den Klappzustand beim Neuzeichnen des Kontorbuchs (siehe keepForms in hud.ts).
 */
export function explain(key: string, html: string, summary = 'Wie funktioniert das?'): string {
  return `<details class="explain" data-open-key="${key}"><summary>${summary}</summary><div>${html}</div></details>`;
}
