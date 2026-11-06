/** Preis abhängig vom Lager: knapp = teuer, voll = billig */
export function price(base: number, stock: number, target: number): number {
  const ratio = target / Math.max(1, stock);
  const factor = Math.min(3, Math.max(0.3, ratio));
  return Math.max(1, Math.round(base * factor));
}

/** Händleraufschlag: Die Stadt kauft unter dem Marktpreis an, sonst wäre Kaufen und sofort Zurückverkaufen Gewinn */
export const SELL_FACTOR = 0.9;

export interface MarketEntry {
  good: string;
  stock: number; // aktueller Bestand
  target: number; // Bezugsgröße der Preisformel
  rest: number; // Bestand, zu dem der Markt ohne Handel zurückkehrt (Produktion/Verbrauch)
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

/** Ein Tag Produktion und Verbrauch: Der Bestand bewegt sich um 15 % Richtung Ruhebestand, mindestens 1 */
export function dailyTick(m: MarketEntry): void {
  const diff = m.rest - m.stock;
  if (diff === 0) return;
  const step = Math.sign(diff) * Math.max(1, Math.round(Math.abs(diff) * 0.15));
  m.stock = Math.max(0, Math.abs(step) > Math.abs(diff) ? m.rest : m.stock + step);
}
