export type Trait = 'vorsichtig' | 'schnell' | 'haendler' | 'schmuggler' | 'treidelmeister';

export const TRAITS: Record<Trait, { name: string; text: string }> = {
  vorsichtig: { name: 'vorsichtig', text: 'Halber Verschleiß am Schiff' },
  schnell: { name: 'schneidig', text: '12 % schneller' },
  haendler: { name: 'Händlerblut', text: '4 % bessere Preise' },
  schmuggler: { name: 'Schmuggler', text: 'Kennt Schleichwege: kein Zoll, selten erwischt' },
  treidelmeister: { name: 'Treidelmeister', text: 'Bergwärts 20 % schneller' },
};

export const CAPTAIN_FIRST = ['Hinnerk', 'Jule', 'Fiete', 'Marta', 'Ole', 'Hedda', 'Jasper', 'Liese', 'Klaas', 'Trine', 'Momme', 'Wiebke', 'Anton', 'Frieda', 'Bendix', 'Gesche'];
export const CAPTAIN_LAST = ['Kranz', 'Haverkamp', 'Lüders', 'Ostermann', 'Tiedje', 'Brandt', 'Wessel', 'Kruse', 'Behrens', 'Petersen', 'Albers', 'Rieck'];
