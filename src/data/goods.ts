export interface Good {
  id: string;
  name: string;
  base: number; // Grundpreis in Talern je Tonne
  color: number; // Farbe der Ladung an Deck
}

export const GOODS: Good[] = [
  { id: 'holz', name: 'Holz', base: 10, color: 0x9a6a3c },
  { id: 'bretter', name: 'Bretter', base: 22, color: 0xc89a62 },
  { id: 'moebel', name: 'Möbel', base: 70, color: 0x6e3f22 },
  { id: 'getreide', name: 'Getreide', base: 8, color: 0xd9b45a },
  { id: 'mehl', name: 'Mehl', base: 16, color: 0xf3ead2 },
  { id: 'brot', name: 'Brot', base: 26, color: 0xb9773a },
  { id: 'fisch', name: 'Fisch', base: 14, color: 0x8fa9b5 },
  { id: 'salz', name: 'Salz', base: 20, color: 0xe9e4da },
  { id: 'erz', name: 'Erz', base: 18, color: 0x7a5f55 },
  { id: 'kohle', name: 'Kohle', base: 12, color: 0x2f2b2a },
  { id: 'werkzeug', name: 'Werkzeug', base: 60, color: 0x8a8f96 },
  { id: 'glas', name: 'Glas', base: 45, color: 0x9fd3d6 },
  { id: 'wolle', name: 'Wolle', base: 15, color: 0xf0ece0 },
  { id: 'stoff', name: 'Stoff', base: 40, color: 0x9c3b3b },
  { id: 'bier', name: 'Bier', base: 30, color: 0xc7862e },
  { id: 'arznei', name: 'Arznei', base: 55, color: 0x6a8f5a },
];

export const GOOD_BY_ID = new Map(GOODS.map((g) => [g.id, g]));
