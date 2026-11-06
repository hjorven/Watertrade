export interface Good {
  id: string;
  name: string;
  base: number; // Grundpreis in Talern je Tonne
  color: number; // Farbe der Ladung an Deck
  /** erst ab dieser Epoche im Handel (Diesel) */
  epoch?: number;
}

export const GOODS: Good[] = [
  { id: 'holz', name: 'Holz', base: 10, color: 0x9a6a3c },
  { id: 'bretter', name: 'Bretter', base: 22, color: 0xc89a62 },
  { id: 'moebel', name: 'Möbel', base: 85, color: 0x6e3f22 },
  { id: 'getreide', name: 'Getreide', base: 8, color: 0xd9b45a },
  { id: 'mehl', name: 'Mehl', base: 16, color: 0xf3ead2 },
  { id: 'brot', name: 'Brot', base: 26, color: 0xb9773a },
  { id: 'fisch', name: 'Fisch', base: 14, color: 0x8fa9b5 },
  { id: 'salz', name: 'Salz', base: 20, color: 0xe9e4da },
  { id: 'erz', name: 'Erz', base: 18, color: 0x7a5f55 },
  { id: 'kohle', name: 'Kohle', base: 12, color: 0x2f2b2a },
  { id: 'werkzeug', name: 'Werkzeug', base: 95, color: 0x8a8f96 },
  { id: 'glas', name: 'Glas', base: 50, color: 0x9fd3d6 },
  { id: 'wolle', name: 'Wolle', base: 15, color: 0xf0ece0 },
  { id: 'stoff', name: 'Stoff', base: 40, color: 0x9c3b3b },
  { id: 'bier', name: 'Bier', base: 30, color: 0xc7862e },
  { id: 'arznei', name: 'Arznei', base: 90, color: 0x6a8f5a },
  // Ergänzung Plan 7: Baustoffe, Milchwirtschaft, Luxusware und Brennstoff der Motorzeit
  { id: 'lehm', name: 'Lehm', base: 6, color: 0xa8683f },
  { id: 'ziegel', name: 'Ziegel', base: 24, color: 0xb5482f },
  { id: 'milch', name: 'Milch', base: 9, color: 0xf7f5ee },
  { id: 'kaese', name: 'Käse', base: 50, color: 0xe8b93c },
  { id: 'wein', name: 'Wein', base: 60, color: 0x7b1f3d },
  { id: 'diesel', name: 'Diesel', base: 40, color: 0x3d4a3a, epoch: 3 },
];

export const GOOD_BY_ID = new Map(GOODS.map((g) => [g.id, g]));
