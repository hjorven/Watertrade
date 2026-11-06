export type Trait = 'vorsichtig' | 'schnell' | 'haendler' | 'schmuggler' | 'treidelmeister';

/**
 * Eigenschaften der Kapitäne.
 * wage: Grundlohn in Talern am Tag, den ein Kapitän mit dieser Eigenschaft verlangt.
 * weight: wie oft so jemand in der Hafenkneipe sitzt (gute Leute sind selten).
 */
export const TRAITS: Record<Trait, { name: string; text: string; wage: number; weight: number }> = {
  vorsichtig: { name: 'vorsichtig', text: 'Halber Verschleiß am Schiff', wage: 15, weight: 34 },
  treidelmeister: { name: 'Treidelmeister', text: 'Bergwärts 20 % schneller', wage: 18, weight: 24 },
  schnell: { name: 'schneidig', text: '12 % schneller', wage: 20, weight: 20 },
  schmuggler: { name: 'Schmuggler', text: 'Fährt am Zoll vorbei, kann aber erwischt werden: Strafe und Beschlagnahme', wage: 22, weight: 12 },
  haendler: { name: 'Händlerblut', text: '4 % bessere Preise', wage: 26, weight: 10 },
};

/** Höchster Tageslohn, den ein Kapitän verlangt */
export const MAX_WAGE = 40;

/**
 * Erfahrung: Ab diesen gefahrenen Kilometern steigt ein Kapitän auf.
 * Stufe 1 lernt eine zweite Eigenschaft, Stufe 2 ist Altmeister (5 % schneller, seltener erwischt).
 */
export const CAPTAIN_RANKS = [
  { name: 'Jungkapitän', km: 0, wage: 0 },
  { name: 'erfahren', km: 400, wage: 0 },
  { name: 'Altmeister', km: 1500, wage: 4 },
] as const;

export function captainRank(km = 0): number {
  let r = 0;
  CAPTAIN_RANKS.forEach((x, i) => {
    if (km >= x.km) r = i;
  });
  return r;
}

/** Hat der Kapitän diese Eigenschaft, als erste oder als zweite? */
export function hasTrait(c: { trait: Trait; trait2?: Trait } | null | undefined, t: Trait): boolean {
  return !!c && (c.trait === t || c.trait2 === t);
}

/** Ist der Kapitän ein Altmeister? */
export function isMaster(c: { km?: number } | null | undefined): boolean {
  return !!c && captainRank(c.km) >= 2;
}

/** Name und Wirkung aller Eigenschaften eines Kapitäns als Text */
export function traitText(c: { trait: Trait; trait2?: Trait; km?: number }): string {
  const parts = [c.trait, c.trait2].filter((t): t is Trait => !!t).map((t) => `${TRAITS[t].name}: ${TRAITS[t].text}`);
  if (isMaster(c)) parts.push('Altmeister: 5 % schneller, seltener erwischt');
  return parts.join(' · ');
}

export const CAPTAIN_FIRST = ['Hinnerk', 'Jule', 'Fiete', 'Marta', 'Ole', 'Hedda', 'Jasper', 'Liese', 'Klaas', 'Trine', 'Momme', 'Wiebke', 'Anton', 'Frieda', 'Bendix', 'Gesche'];
export const CAPTAIN_LAST = ['Kranz', 'Haverkamp', 'Lüders', 'Ostermann', 'Tiedje', 'Brandt', 'Wessel', 'Kruse', 'Behrens', 'Petersen', 'Albers', 'Rieck'];
