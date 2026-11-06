export interface Good {
  id: string;
  name: string;
  unit: string;
  base: number; // Grundpreis in Talern
  color: number; // Farbe der Ladung an Deck
}

export const GOODS: Good[] = [
  { id: 'holz', name: 'Holz', unit: 't', base: 10, color: 0x9a6a3c },
  { id: 'getreide', name: 'Getreide', unit: 't', base: 8, color: 0xd9b45a },
  { id: 'salz', name: 'Salz', unit: 't', base: 20, color: 0xe9e4da },
];

export const GOOD_BY_ID = new Map(GOODS.map((g) => [g.id, g]));
