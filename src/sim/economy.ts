/** Preisspanne relativ zum Grundpreis. Der Plan hatte 0.3 bis 3, das machte jeden Handel zur Goldgrube. */
export const MIN_FACTOR = 0.5;
export const MAX_FACTOR = 2;

/** Preis abhängig vom Lager: knapp = teuer, voll = billig */
export function price(base: number, stock: number, target: number): number {
  const ratio = target / Math.max(1, stock);
  const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, ratio));
  return Math.max(1, Math.round(base * factor));
}

/** Händleraufschlag: Die Stadt kauft unter dem Marktpreis an, sonst wäre Kaufen und sofort Zurückverkaufen Gewinn */
export const SELL_FACTOR = 0.9;

export interface MarketEntry {
  good: string;
  stock: number; // aktueller Bestand in Tonnen (mit Nachkommastellen durch Tagesproduktion)
  target: number; // Bezugsgröße der Preisformel
}

/** Ganze Tonnen, die gehandelt werden können */
export function available(m: MarketEntry): number {
  return Math.floor(m.stock);
}

/** Preis, den der Spieler für die nächste Einheit zahlt */
export function buyPrice(base: number, m: MarketEntry): number {
  return price(base, m.stock - 1, m.target);
}

/** Preis, den die Stadt für die nächste Einheit zahlt */
export function sellPrice(base: number, m: MarketEntry): number {
  return Math.floor(price(base, m.stock + 1, m.target) * SELL_FACTOR);
}

/**
 * Gesamtkosten für den Kauf von `amount` Einheiten.
 * Jede Einheit wird zum Preis nach ihrer Entnahme bezahlt, große Käufe werden also teurer.
 */
export function buyCost(base: number, m: MarketEntry, amount: number): number {
  let sum = 0;
  for (let i = 1; i <= amount; i++) sum += price(base, m.stock - i, m.target);
  return sum;
}

/** Erlös für den Verkauf von `amount` Einheiten, große Verkäufe drücken den Preis */
export function sellRevenue(base: number, m: MarketEntry, amount: number): number {
  let sum = 0;
  for (let i = 1; i <= amount; i++) {
    sum += Math.floor(price(base, m.stock + i, m.target) * SELL_FACTOR);
  }
  return sum;
}
