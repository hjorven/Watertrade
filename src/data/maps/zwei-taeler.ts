import { VALLEY, type MapDef, type RiverDef, type SegmentDef, type TownDef } from './valley.ts';

/**
 * Zweite Karte: das bekannte Tal des Weißstroms und nördlich dahinter, jenseits des
 * Waldrückens, das Flusssystem der Schwarzach. Beide Netze sind getrennt, bis der
 * Scheitelkanal von Altenfurt nach Tuchingen fertig ist (Großprojekt, siehe data/canal.ts).
 *
 * Koordinaten: Das Tal bleibt, wo es ist (z etwa -40 bis 70). Die Schwarzach liegt bei
 * z etwa -100 bis -205 und fließt von Osten nach Westen zur Nordsee.
 */

/** Projekt-ID des Kanals; der Kanalabschnitt existiert erst, wenn das Projekt fertig ist */
export const CANAL_ID = 'scheitelkanal';

/** Orte an beiden Enden des Kanals, dort liegen die Baustellen */
export const CANAL_ENDS = ['altenfurt', 'tuchingen'] as const;

const NORTH_RIVERS: RiverDef[] = [
  {
    id: 'schwarzach',
    name: 'Schwarzach',
    halfWidth: 3.2,
    points: [
      [112, -150],
      [85, -160],
      [60, -140],
      [35, -118],
      [8, -110],
      [-18, -124],
      [-45, -112],
      [-75, -124],
      [-112, -110],
    ],
  },
  {
    id: 'moorbach',
    name: 'Moorbach',
    halfWidth: 2.2,
    points: [
      [-10, -205],
      [-30, -188],
      [-20, -168],
      [-28, -145],
    ],
    joins: { river: 'schwarzach', t: 0.62 },
  },
  {
    // Gemauerter Kanal über den Waldrücken: Altenfurt (Weißstrom) bis Tuchingen (Schwarzach).
    // Wird erst nach Fertigstellung mit Wasser gezeigt; vorher Baustelle (siehe canalProgress).
    id: 'kanal',
    name: 'Scheitelkanal',
    halfWidth: 1.8,
    canal: true,
    points: [
      [9, 6],
      [7, -20],
      [4, -48],
      [6, -76],
      [9, -104],
    ],
  },
];

const NORTH_TOWNS: TownDef[] = [
  {
    id: 'krummfels',
    name: 'Krummfels',
    description: 'Bergstädtchen an der Schwarzachquelle. Erz aus dem Stollen, Wolle von den Hochweiden.',
    river: 'schwarzach',
    riverT: 0.08,
    side: 1,
    houses: 9,
    population: 320,
    target: 50,
    produces: { erz: 9, wolle: 4, wein: 1.5 },
    consumes: { getreide: 3, brot: 2, salz: 1, bier: 1.5, holz: 2 },
    industries: [],
    shipyard: [],
  },
  {
    id: 'russheim',
    name: 'Rußheim',
    description: 'Kohlenrevier mit Zechen und Hammerwerk. Viel Kohle, großer Hunger nach Brot und Holz.',
    river: 'schwarzach',
    riverT: 0.3,
    side: -1,
    houses: 17,
    population: 950,
    target: 75,
    produces: { kohle: 16 },
    consumes: { brot: 4, bier: 3, holz: 4, getreide: 2, salz: 1.5, stoff: 1 },
    industries: [{ name: 'Hammerwerk', inputs: { erz: 3, kohle: 3 }, outputs: { werkzeug: 2 } }],
    shipyard: ['plaette', 'treidelkahn', 'raddampfer', 'schleppverband'],
  },
  {
    id: 'tuchingen',
    name: 'Tuchingen',
    description: 'Tuchmacherstadt am Ende des geplanten Kanals. Webt Wolle zu Stoff und braucht Korn.',
    river: 'schwarzach',
    riverT: 0.48,
    side: -1,
    houses: 15,
    population: 800,
    target: 75,
    produces: { wolle: 3 },
    consumes: { getreide: 3, brot: 2, bier: 2, fisch: 1.5, moebel: 0.5, glas: 0.4, kohle: 1, milch: 1, ziegel: 0.8 },
    industries: [
      { name: 'Tuchweberei', inputs: { wolle: 4 }, outputs: { stoff: 3 } },
      { name: 'Brauerei', inputs: { getreide: 2 }, outputs: { bier: 2 } },
    ],
    shipyard: [],
  },
  {
    id: 'moorwalde',
    name: 'Moorwalde',
    description: 'Dorf am Moorbach zwischen Wald und Moor. Holz, Schafe, Hafer und die einzige Mühle im Norden.',
    river: 'moorbach',
    riverT: 0.15,
    side: 1,
    houses: 9,
    population: 300,
    fields: true,
    target: 50,
    produces: { holz: 8, wolle: 3, getreide: 7, milch: 4, lehm: 6 },
    consumes: { salz: 1.5, werkzeug: 0.5, brot: 1, stoff: 0.5 },
    industries: [
      { name: 'Käserei', inputs: { milch: 2.5 }, outputs: { kaese: 1 } },
      { name: 'Sägemühle', inputs: { holz: 3 }, outputs: { bretter: 2 } },
      { name: 'Mühle', inputs: { getreide: 3 }, outputs: { mehl: 2 } },
    ],
    shipyard: ['floss'],
  },
  {
    id: 'lindenbrueck',
    name: 'Lindenbrück',
    description: 'Alte Residenz mit niedriger Zollbrücke. Glasbläser und Tischler für den Hof.',
    river: 'schwarzach',
    riverT: 0.72,
    side: 1,
    houses: 14,
    population: 700,
    target: 70,
    produces: {},
    consumes: { brot: 2, bier: 2, fisch: 1, salz: 1, stoff: 1, arznei: 0.3, getreide: 1, kaese: 0.4, wein: 0.4 },
    industries: [
      { name: 'Glasofen', inputs: { kohle: 2 }, outputs: { glas: 1 } },
      { name: 'Ziegelei', inputs: { lehm: 4, kohle: 1.5 }, outputs: { ziegel: 4 } },
      { name: 'Tischlerei', inputs: { bretter: 2 }, outputs: { moebel: 1 } },
    ],
    shipyard: [],
  },
  {
    id: 'nordhafen',
    name: 'Nordhafen',
    description: 'Seehafen an der Schwarzachmündung. Fisch und Salz von der Nordsee, Werft für Seegänger.',
    river: 'schwarzach',
    riverT: 0.94,
    side: -1,
    houses: 22,
    population: 1500,
    target: 100,
    produces: { fisch: 12, salz: 8 },
    consumes: { getreide: 3, holz: 3, bretter: 2, werkzeug: 1, kohle: 2, moebel: 0.8, bier: 2, ziegel: 1.2, milch: 1.5, kaese: 0.5, wein: 0.5 },
    industries: [
      { name: 'Bäckerei', inputs: { mehl: 2 }, outputs: { brot: 3 } },
      { name: 'Apotheke', inputs: { glas: 0.5, salz: 1 }, outputs: { arznei: 1 } },
    ],
    shipyard: ['plaette', 'treidelkahn', 'segelkahn', 'raddampfer', 'motorschiff', 'kuehlschiff'],
  },
];

const NORTH_SEGMENTS: SegmentDef[] = [
  { id: 'krumm-russ', river: 'schwarzach', fromT: 0.08, toT: 0.3, from: 'krummfels', to: 'russheim', length: 38, current: 2.1, baseDepth: 1.5, freezes: true, lowWater: 0.7 },
  { id: 'russ-tuch', river: 'schwarzach', fromT: 0.3, toT: 0.48, from: 'russheim', to: 'tuchingen', length: 30, current: 1.6, baseDepth: 2.1 },
  // Die alte Zollbrücke von Lindenbrück liegt oberhalb der Stadt
  { id: 'tuch-linden', river: 'schwarzach', fromT: 0.48, toT: 0.72, from: 'tuchingen', to: 'lindenbrueck', length: 36, current: 1.3, baseDepth: 2.6, bridgeHeight: 5 },
  { id: 'linden-nord', river: 'schwarzach', fromT: 0.72, toT: 0.94, from: 'lindenbrueck', to: 'nordhafen', length: 42, current: 1.0, baseDepth: 3.2 },
  // Moorbach: dunkel und langsam, aber flach
  { id: 'moor-tuch', river: 'moorbach', fromT: 0.15, toT: 1, from: 'moorwalde', to: 'tuchingen', length: 28, current: 1.2, baseDepth: 1.1, freezes: true, lowWater: 0.6 },
];

/** Der Kanal: ohne Strömung, tief, friert im Winter zu. Erst befahrbar, wenn der Kanal fertig ist. */
export const CANAL_SEGMENT: SegmentDef = {
  id: 'scheitelkanal',
  river: 'kanal',
  fromT: 0,
  toT: 1,
  from: 'altenfurt',
  to: 'tuchingen',
  // 55 km Strecke, dazu 14 Schleusen über den Scheitel, eingerechnet als Fahrtlänge
  length: 70,
  current: 0.3,
  baseDepth: 2.4,
  freezes: true,
  lowWater: 0.2,
  canal: true,
  requires: CANAL_ID,
};

export const ZWEI_TAELER: MapDef = {
  id: 'zwei-taeler',
  name: 'Zwei Täler und ein Kanal',
  bounds: { minX: -112, maxX: 112, minZ: -210, maxZ: 72 },
  rivers: [...VALLEY.rivers, ...NORTH_RIVERS],
  towns: [...VALLEY.towns, ...NORTH_TOWNS],
  segments: [...VALLEY.segments, ...NORTH_SEGMENTS, CANAL_SEGMENT],
};

/** Städte des zweiten Flusssystems (für Tests und Kapitelaufbau) */
export const NORTH_TOWN_IDS = NORTH_TOWNS.map((t) => t.id);
