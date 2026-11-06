import type { Segment } from '../../sim/river.ts';

export interface TownDef {
  id: string;
  name: string;
  description: string;
  /** Position auf dem Flusslauf: 0 = Quelle, 1 = Mündung */
  riverT: number;
  /** Seite des Ufers: -1 links, 1 rechts (in Fließrichtung) */
  side: -1 | 1;
  houses: number;
  /** Ruhebestand je Ware relativ zum Zielbestand: > 1 billig (wird hier erzeugt), < 1 teuer (wird gebraucht) */
  market: Record<string, number>;
}

export interface MapDef {
  name: string;
  target: number; // Zielbestand je Ware
  towns: TownDef[];
  segments: Segment[];
}

export const MAP_M1: MapDef = {
  name: 'Das obere Tal',
  target: 100,
  towns: [
    {
      id: 'oberau',
      name: 'Oberau',
      description: 'Holzfällerdorf am Waldhang. Viel Holz, aber kaum Salz.',
      riverT: 0.08,
      side: 1,
      houses: 14,
      market: { holz: 2.2, getreide: 0.75, salz: 0.6 },
    },
    {
      id: 'niedermuend',
      name: 'Niedermünd',
      description: 'Marktflecken in der Flussaue. Getreide und Salz von der Küste, Bauholz ist knapp.',
      riverT: 0.92,
      side: -1,
      houses: 24,
      market: { holz: 0.55, getreide: 1.8, salz: 1.9 },
    },
  ],
  segments: [
    {
      id: 'oberau-niedermuend',
      from: 'oberau',
      to: 'niedermuend',
      length: 60,
      current: 2,
      baseDepth: 2,
    },
  ],
};
