export interface RivalDef {
  id: string;
  name: string;
  color: number; // Flagge und Rumpfstreifen
  description: string;
  home: string;
  money: number;
  startShips: string[];
  /** Vorliebe für Waren: Gewicht > 1 heißt bevorzugt */
  favorite: Record<string, number>;
  /** Anteil des Laderaums, den das Haus auf einmal kauft */
  greed: number;
  /** Ab welchem Vermögen ein neues Schiff gekauft wird */
  expandAt: number;
  preferredShip: string;
  /** Baut Kontore in Städten, die es oft anläuft */
  builds: boolean;
}

export const RIVALS: RivalDef[] = [
  {
    id: 'steinbrueck',
    name: 'Haus Steinbrück',
    color: 0x2f5f7a,
    description: 'Alteingesessen, kontrolliert die Holzroute vom Oberlauf zur Mündung.',
    home: 'oberau',
    money: 1500,
    startShips: ['treidelkahn', 'treidelkahn'],
    favorite: { holz: 1.6, bretter: 1.5, moebel: 1.4 },
    greed: 0.8,
    expandAt: 2500,
    preferredShip: 'treidelkahn',
    builds: false,
  },
  {
    id: 'kessler',
    name: 'Gebrüder Kessler',
    color: 0xb5452a,
    description: 'Aggressive Preise, kaufen Märkte leer.',
    home: 'niedermuend',
    money: 1200,
    startShips: ['treidelkahn'],
    favorite: {},
    greed: 1,
    expandAt: 1800,
    preferredShip: 'treidelkahn',
    builds: false,
  },
  {
    id: 'ahlers',
    name: 'Witwe Ahlers',
    color: 0x5b6b2f,
    description: 'Vorsichtig und sparsam, baut lieber Kontore als Schiffe.',
    home: 'altenfurt',
    money: 1000,
    startShips: ['plaette'],
    favorite: { brot: 1.3, fisch: 1.3, salz: 1.2 },
    greed: 0.5,
    expandAt: 4000,
    preferredShip: 'plaette',
    builds: true,
  },
  {
    id: 'nordstrom',
    name: 'Kompanie Nordstrom',
    color: 0x3b3b56,
    description: 'Setzen auf große, schnelle Schiffe und Technik.',
    home: 'niedermuend',
    money: 1600,
    startShips: ['segelkahn'],
    favorite: { werkzeug: 1.4, glas: 1.3 },
    greed: 0.7,
    expandAt: 3000,
    preferredShip: 'segelkahn',
    builds: false,
  },
];

export const RIVAL_BY_ID = new Map(RIVALS.map((r) => [r.id, r]));
