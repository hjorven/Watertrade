/** Hafenausbau (Plan 6.4): schnelleres Laden und Löschen, mehr Liegeplätze, tieferes Wasser am Kai */

export interface HarborLevel {
  level: number;
  name: string;
  text: string;
  cost: number;
  days: number;
  epoch: number;
  /** Umschlag in Tonnen je Stunde */
  rate: number;
  /** zusätzliche Liegeplätze gegenüber dem natürlichen Hafen */
  berths: number;
  /** zusätzliche Wassertiefe am Kai in m */
  depth: number;
}

/** Stufe 0 ist der natürliche Hafen jeder Stadt */
export const HARBOR_LEVELS: HarborLevel[] = [
  { level: 0, name: 'Natürlicher Hafen', text: 'Ein Anleger aus Holz, geladen wird mit Schubkarren und Tragkörben.', cost: 0, days: 0, epoch: 1, rate: 40, berths: 0, depth: 0 },
  {
    level: 1,
    name: 'Ladekran und Steg',
    text: 'Ein Tretradkran und ein zweiter Steg: schneller umschlagen, zwei Liegeplätze mehr.',
    cost: 1800,
    days: 10,
    epoch: 1,
    rate: 70,
    berths: 2,
    depth: 0.3,
  },
  {
    level: 2,
    name: 'Kaimauer mit Tiefwasser',
    text: 'Eine gemauerte Kaimauer, davor ausgebaggertes Hafenbecken: tiefe Schiffe legen ohne Leichtern an.',
    cost: 4500,
    days: 18,
    epoch: 1,
    rate: 100,
    berths: 4,
    depth: 0.8,
  },
  {
    level: 3,
    name: 'Dampfkräne und Hafenbecken',
    text: 'Dampfkräne, Gleise bis an die Kante und ein eigenes Becken: Umschlag wie in einer Hafenstadt.',
    cost: 9500,
    days: 28,
    epoch: 2,
    rate: 150,
    berths: 7,
    depth: 1.3,
  },
];

/** Wassertiefe am Kai bei Normalpegel, je Stadt */
export const HARBOR_DEPTH: Record<string, number> = {
  oberau: 1.4,
  kesselbrueck: 1.8,
  muehlheim: 1.8,
  altenfurt: 2.0,
  weidenhof: 1.9,
  niedermuend: 2.2,
  erzgrube: 1.0,
  glashuette: 1.2,
};

/** Liegeplätze im natürlichen Hafen nach Einwohnern */
export function baseBerths(population: number): number {
  return population >= 1500 ? 4 : population >= 800 ? 3 : 2;
}

/** Leichtergeld: Taler je Tonne, wenn ein Schiff zu tief für den Kai ist und über Schuten umgeschlagen wird */
export const LIGHTER_FEE = 0.5;
