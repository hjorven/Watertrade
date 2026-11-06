/** Eigene Betriebe des Spielers. Sie arbeiten mit dem Lager des Kontors in derselben Stadt. */
export interface BuildingType {
  id: string;
  name: string;
  price: number;
  wage: number; // Taler pro Tag
  inputs: Record<string, number>; // pro Tag bei voller Arbeit
  outputs: Record<string, number>;
  /** Rohstoffbetrieb: nur in Städten, die diese Ware selbst erzeugen */
  rawFrom?: string;
  description: string;
}

export const BUILDINGS: BuildingType[] = [
  { id: 'holzfaeller', name: 'Holzfällerei', price: 500, wage: 8, inputs: {}, outputs: { holz: 8 }, rawFrom: 'holz', description: 'Schlägt Holz im Stadtwald.' },
  { id: 'bauernhof', name: 'Gutshof', price: 600, wage: 9, inputs: {}, outputs: { getreide: 9 }, rawFrom: 'getreide', description: 'Getreide von eigenen Feldern.' },
  { id: 'fischerei', name: 'Fischerei', price: 450, wage: 7, inputs: {}, outputs: { fisch: 7 }, rawFrom: 'fisch', description: 'Ein paar Boote und Reusen.' },
  { id: 'schaeferei', name: 'Schäferei', price: 450, wage: 6, inputs: {}, outputs: { wolle: 5 }, rawFrom: 'wolle', description: 'Schafe auf den Hängen.' },
  { id: 'grube', name: 'Erzstollen', price: 900, wage: 14, inputs: {}, outputs: { erz: 7 }, rawFrom: 'erz', description: 'Ein eigener Stollen im Berg.' },
  { id: 'koehlerei', name: 'Kohlenmeiler', price: 700, wage: 10, inputs: {}, outputs: { kohle: 7 }, rawFrom: 'kohle', description: 'Kohle aus dem Meiler.' },
  { id: 'saline', name: 'Saline', price: 800, wage: 10, inputs: {}, outputs: { salz: 8 }, rawFrom: 'salz', description: 'Siedet Salz aus Sole.' },
  { id: 'saegewerk', name: 'Sägewerk', price: 700, wage: 10, inputs: { holz: 6 }, outputs: { bretter: 4 }, description: '6 t Holz werden zu 4 t Brettern.' },
  { id: 'muehle', name: 'Mühle', price: 750, wage: 9, inputs: { getreide: 6 }, outputs: { mehl: 5 }, description: '6 t Getreide werden zu 5 t Mehl.' },
  { id: 'baeckerei', name: 'Bäckerei', price: 650, wage: 10, inputs: { mehl: 4 }, outputs: { brot: 5 }, description: '4 t Mehl werden zu 5 t Brot.' },
  { id: 'brauerei', name: 'Brauerei', price: 900, wage: 12, inputs: { getreide: 5 }, outputs: { bier: 4 }, description: '5 t Getreide werden zu 4 t Bier.' },
  { id: 'tischlerei', name: 'Tischlerei', price: 1000, wage: 14, inputs: { bretter: 4 }, outputs: { moebel: 2 }, description: '4 t Bretter werden zu 2 t Möbeln.' },
  { id: 'weberei', name: 'Weberei', price: 950, wage: 13, inputs: { wolle: 5 }, outputs: { stoff: 3 }, description: '5 t Wolle werden zu 3 t Stoff.' },
  { id: 'schmiede', name: 'Schmiede', price: 1400, wage: 16, inputs: { erz: 3, kohle: 3 }, outputs: { werkzeug: 2 }, description: 'Erz und Kohle werden zu Werkzeug.' },
  { id: 'glashuette', name: 'Glashütte', price: 1100, wage: 14, inputs: { kohle: 3 }, outputs: { glas: 2 }, description: '3 t Kohle und Sand werden zu 2 t Glas.' },
  { id: 'apotheke', name: 'Apotheke', price: 1200, wage: 15, inputs: { glas: 1, salz: 2 }, outputs: { arznei: 2 }, description: 'Glas und Salz werden zu Arznei.' },
];

export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));

/** Kontor: Lager, besserer Verkaufspreis, Grundlage für Betriebe */
export const KONTOR_PRICE = 500;
export const KONTOR_CAPACITY = [0, 200, 500, 1200]; // je Ausbaustufe
export const KONTOR_UPGRADE = [0, 0, 900, 2200]; // Preis für Stufe 2 und 3
export const KONTOR_SELL_FACTOR = 0.95;
/** Betriebe pro Kontorstufe */
export const KONTOR_SLOTS = [0, 2, 4, 6];
