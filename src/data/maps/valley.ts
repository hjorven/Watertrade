import type { Segment } from '../../sim/river.ts';
import type { ProjectDef } from '../projects.ts';

export interface RiverDef {
  id: string;
  name: string;
  halfWidth: number; // halbe Breite in Welteinheiten
  /** Kontrollpunkte in der Ebene (x, z) von der Quelle zur Mündung */
  points: [number, number][];
  /** Nebenfluss: mündet an Position t in den genannten Fluss */
  joins?: { river: string; t: number };
  /** Gemauerter Kanal statt natürlichem Fluss (gerade, ohne Mündung, Schleusen) */
  canal?: boolean;
}

/** Ein Betrieb in der Stadt: verbraucht Eingangswaren und erzeugt Ausgangswaren, einmal pro Tag */
export interface Industry {
  name: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
}

export interface TownDef {
  id: string;
  name: string;
  description: string;
  river: string;
  riverT: number; // 0 = Quelle, 1 = Mündung
  side: -1 | 1; // Uferseite in Fließrichtung: -1 links, 1 rechts
  houses: number;
  population: number; // Einwohner zu Spielbeginn
  fields?: boolean; // Äcker rund um die Stadt
  target: number; // Zielbestand je Ware (Größe des Marktes)
  produces: Record<string, number>; // Tonnen pro Tag
  consumes: Record<string, number>; // Tonnen pro Tag bei Zielbestand
  industries: Industry[];
  shipyard: string[]; // Schiffstypen, die hier gebaut werden
  /** Baustil aus render/townstyles.ts, wenn er nicht der Stadt-Id entspricht (erzeugte Karten) */
  style?: string;
}

/** Abschnitt mit Lage auf der Karte */
export interface SegmentDef extends Segment {
  river: string;
  fromT: number;
  toT: number;
  /** Kanalabschnitt (für Anzeige und Rendering) */
  canal?: boolean;
  /** Der Abschnitt existiert erst, wenn dieses Bauvorhaben fertig ist (Eintrag in state.works) */
  requires?: string;
}

export interface MapDef {
  /** Kennung für Spielstände: 'tal', 'zufall-<seed>' oder die Id einer weiteren Karte */
  id?: string;
  /** Startwert, aus dem eine Zufallskarte erzeugt wurde */
  seed?: number;
  name: string;
  /** Ausdehnung der Welt in Welteinheiten, wenn sie vom Tal (220 x 140) abweicht */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  rivers: RiverDef[];
  towns: TownDef[];
  segments: SegmentDef[];
  /** Wasserbauten dieser Karte; ohne Angabe gilt die Liste des Tals (data/projects.ts) */
  projects?: ProjectDef[];
  /** Starthafen im freien Spiel */
  start?: string;
}

export const VALLEY: MapDef = {
  id: 'tal',
  name: 'Das Tal der zwei Flüsse',
  start: 'oberau',
  rivers: [
    {
      id: 'strom',
      name: 'Weißstrom',
      halfWidth: 3.6,
      points: [
        [-110, -38],
        [-80, -30],
        [-55, -8],
        [-28, -18],
        [0, 4],
        [28, 22],
        [55, 8],
        [82, 26],
        [110, 34],
      ],
    },
    {
      id: 'erzbach',
      name: 'Erzbach',
      halfWidth: 2.3,
      points: [
        [-78, 70],
        [-62, 56],
        [-40, 58],
        [-22, 44],
        [-14, 28],
      ],
      joins: { river: 'strom', t: 0.53 },
    },
  ],
  towns: [
    {
      id: 'oberau',
      name: 'Oberau',
      description: 'Holzfällerdorf am Waldhang. Viel Holz und Wolle, ein Sägewerk.',
      river: 'strom',
      riverT: 0.06,
      side: 1,
      houses: 11,
      population: 350,
      target: 60,
      produces: { holz: 14, wolle: 3 },
      consumes: { getreide: 3, salz: 1.5, werkzeug: 0.5, brot: 2, bier: 1 },
      industries: [{ name: 'Sägewerk', inputs: { holz: 4 }, outputs: { bretter: 2 } }],
      shipyard: ['floss'],
    },
    {
      id: 'kesselbrueck',
      name: 'Kesselbrück',
      description: 'Schmiedestadt an der alten Steinbrücke. Braucht Erz und Kohle für Werkzeug.',
      river: 'strom',
      riverT: 0.22,
      side: -1,
      houses: 16,
      population: 900,
      target: 70,
      produces: {},
      consumes: { getreide: 3, brot: 2, bier: 2, moebel: 0.4, glas: 0.6 },
      industries: [{ name: 'Schmiede', inputs: { erz: 2, kohle: 2 }, outputs: { werkzeug: 1 } }],
      shipyard: [],
    },
    {
      id: 'muehlheim',
      name: 'Mühlheim',
      description: 'Kornkammer mit Mühle, Brauerei und einer kleinen Werft.',
      river: 'strom',
      riverT: 0.38,
      side: 1,
      houses: 15,
      population: 700,
      fields: true,
      target: 80,
      produces: { getreide: 12 },
      consumes: { salz: 2, werkzeug: 0.5, stoff: 1, fisch: 1, holz: 2 },
      industries: [
        { name: 'Mühle', inputs: { getreide: 4 }, outputs: { mehl: 3 } },
        { name: 'Brauerei', inputs: { getreide: 2 }, outputs: { bier: 2 } },
      ],
      shipyard: ['plaette', 'treidelkahn', 'raddampfer', 'motorschiff'],
    },
    {
      id: 'altenfurt',
      name: 'Altenfurt',
      description: 'Marktflecken an der Erzbachmündung. Tischler und Weber.',
      river: 'strom',
      riverT: 0.55,
      side: -1,
      houses: 18,
      population: 1000,
      target: 80,
      produces: {},
      consumes: { brot: 3, fisch: 2, bier: 2, salz: 2, glas: 0.5, kohle: 2, arznei: 0.4 },
      industries: [
        { name: 'Tischlerei', inputs: { bretter: 2 }, outputs: { moebel: 1 } },
        { name: 'Weberei', inputs: { wolle: 3 }, outputs: { stoff: 2 } },
      ],
      shipyard: [],
    },
    {
      id: 'weidenhof',
      name: 'Weidenhof',
      description: 'Bauern und Fischer in der Aue, mit Bäckerei.',
      river: 'strom',
      riverT: 0.74,
      side: 1,
      houses: 12,
      population: 450,
      fields: true,
      target: 70,
      produces: { getreide: 8, fisch: 6, wolle: 3 },
      consumes: { salz: 2, werkzeug: 0.5, bretter: 1, stoff: 1 },
      industries: [{ name: 'Bäckerei', inputs: { mehl: 2 }, outputs: { brot: 3 } }],
      shipyard: [],
    },
    {
      id: 'niedermuend',
      name: 'Niedermünd',
      description: 'Hafenstadt an der Mündung. Salz von der Küste, großer Bedarf an Baustoffen.',
      river: 'strom',
      riverT: 0.93,
      side: -1,
      houses: 26,
      population: 1800,
      target: 110,
      produces: { salz: 12, fisch: 8 },
      consumes: { holz: 4, bretter: 3, moebel: 1, werkzeug: 1, glas: 1, stoff: 2, kohle: 3 },
      industries: [
        { name: 'Brauerei', inputs: { getreide: 3 }, outputs: { bier: 2 } },
        { name: 'Bäckerei', inputs: { mehl: 3 }, outputs: { brot: 4 } },
        { name: 'Apotheke', inputs: { glas: 0.5, salz: 1 }, outputs: { arznei: 1 } },
      ],
      shipyard: ['plaette', 'treidelkahn', 'segelkahn', 'raddampfer', 'schleppverband', 'motorschiff', 'kuehlschiff'],
    },
    {
      id: 'erzgrube',
      name: 'Erzgrube',
      description: 'Bergwerk am oberen Erzbach. Erz und Kohle, aber der Bach ist seicht.',
      river: 'erzbach',
      riverT: 0.1,
      side: -1,
      houses: 9,
      population: 300,
      target: 50,
      produces: { erz: 10, kohle: 8 },
      consumes: { brot: 3, werkzeug: 1, bier: 2, holz: 3, salz: 1 },
      industries: [],
      shipyard: [],
    },
    {
      id: 'glashuette',
      name: 'Glashütte',
      description: 'Glasbläser am Erzbach, heizen mit Kohle.',
      river: 'erzbach',
      riverT: 0.55,
      side: 1,
      houses: 10,
      population: 320,
      target: 50,
      produces: { wolle: 3 },
      consumes: { brot: 2, salz: 1, fisch: 1, stoff: 1 },
      industries: [{ name: 'Glasofen', inputs: { kohle: 2 }, outputs: { glas: 1 } }],
      shipyard: [],
    },
  ],
  segments: [
    { id: 'oberau-kessel', river: 'strom', fromT: 0.06, toT: 0.22, from: 'oberau', to: 'kesselbrueck', length: 40, current: 2.2, baseDepth: 1.8, freezes: true },
    // Die alte Steinbrücke liegt direkt unterhalb von Kesselbrück
    { id: 'kessel-muehl', river: 'strom', fromT: 0.22, toT: 0.38, from: 'kesselbrueck', to: 'muehlheim', length: 35, current: 1.8, baseDepth: 2, bridgeHeight: 4.5 },
    { id: 'muehl-alten', river: 'strom', fromT: 0.38, toT: 0.55, from: 'muehlheim', to: 'altenfurt', length: 30, current: 1.5, baseDepth: 2.2 },
    { id: 'alten-weiden', river: 'strom', fromT: 0.55, toT: 0.74, from: 'altenfurt', to: 'weidenhof', length: 45, current: 1.3, baseDepth: 3 },
    { id: 'weiden-nieder', river: 'strom', fromT: 0.74, toT: 0.93, from: 'weidenhof', to: 'niedermuend', length: 40, current: 1.0, baseDepth: 3.5 },
    // Erzbach: oben sehr seicht, nur flache Boote
    { id: 'grube-glas', river: 'erzbach', fromT: 0.1, toT: 0.55, from: 'erzgrube', to: 'glashuette', length: 25, current: 2.4, baseDepth: 0.8, freezes: true, lowWater: 0.5 },
    { id: 'glas-alten', river: 'erzbach', fromT: 0.55, toT: 1, from: 'glashuette', to: 'altenfurt', length: 30, current: 2.0, baseDepth: 1.3, freezes: true, lowWater: 0.5 },
  ],
};
