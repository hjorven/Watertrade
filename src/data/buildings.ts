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

/**
 * Zahlen nach der Balance-Runde (Phase 2): Rohstoffbetriebe zahlen sich zum Grundpreis erst
 * nach gut 30 Tagen ab, Verarbeiter schneller, und je länger die Kette, desto mehr Mehrwert.
 * Geprüft in balance.ts (paybackDays) und balance.test.ts.
 */
export const BUILDINGS: BuildingType[] = [
  { id: 'holzfaeller', name: 'Holzfällerei', price: 1300, wage: 8, inputs: {}, outputs: { holz: 5 }, rawFrom: 'holz', description: 'Schlägt Holz im Stadtwald.' },
  { id: 'bauernhof', name: 'Gutshof', price: 1300, wage: 9, inputs: {}, outputs: { getreide: 6 }, rawFrom: 'getreide', description: 'Getreide von eigenen Feldern.' },
  { id: 'fischerei', name: 'Fischerei', price: 1550, wage: 7, inputs: {}, outputs: { fisch: 4 }, rawFrom: 'fisch', description: 'Ein paar Boote und Reusen.' },
  { id: 'schaeferei', name: 'Schäferei', price: 1300, wage: 6, inputs: {}, outputs: { wolle: 3 }, rawFrom: 'wolle', description: 'Schafe auf den Hängen.' },
  { id: 'grube', name: 'Erzstollen', price: 2350, wage: 14, inputs: {}, outputs: { erz: 5 }, rawFrom: 'erz', description: 'Ein eigener Stollen im Berg.' },
  { id: 'koehlerei', name: 'Kohlenmeiler', price: 1950, wage: 10, inputs: {}, outputs: { kohle: 6 }, rawFrom: 'kohle', description: 'Kohle aus dem Meiler.' },
  { id: 'saline', name: 'Saline', price: 2350, wage: 10, inputs: {}, outputs: { salz: 4 }, rawFrom: 'salz', description: 'Siedet Salz aus Sole.' },
  { id: 'saegewerk', name: 'Sägewerk', price: 900, wage: 10, inputs: { holz: 6 }, outputs: { bretter: 5 }, description: '6 t Holz werden zu 5 t Brettern.' },
  { id: 'muehle', name: 'Mühle', price: 850, wage: 9, inputs: { getreide: 6 }, outputs: { mehl: 6 }, description: '6 t Getreide werden zu 6 t Mehl.' },
  { id: 'baeckerei', name: 'Bäckerei', price: 1050, wage: 10, inputs: { mehl: 4 }, outputs: { brot: 5 }, description: '4 t Mehl werden zu 5 t Brot.' },
  { id: 'brauerei', name: 'Brauerei', price: 1450, wage: 12, inputs: { getreide: 5 }, outputs: { bier: 4 }, description: '5 t Getreide werden zu 4 t Bier.' },
  { id: 'tischlerei', name: 'Tischlerei', price: 1300, wage: 14, inputs: { bretter: 4 }, outputs: { moebel: 2 }, description: '4 t Bretter werden zu 2 t Möbeln.' },
  { id: 'weberei', name: 'Weberei', price: 1150, wage: 13, inputs: { wolle: 4 }, outputs: { stoff: 3 }, description: '4 t Wolle werden zu 3 t Stoff.' },
  { id: 'schmiede', name: 'Schmiede', price: 1800, wage: 16, inputs: { erz: 3, kohle: 3 }, outputs: { werkzeug: 2 }, description: 'Erz und Kohle werden zu Werkzeug.' },
  { id: 'glashuette', name: 'Glashütte', price: 1150, wage: 14, inputs: { kohle: 3 }, outputs: { glas: 2 }, description: '3 t Kohle und Sand werden zu 2 t Glas.' },
  { id: 'apotheke', name: 'Apotheke', price: 1550, wage: 15, inputs: { glas: 1, salz: 2 }, outputs: { arznei: 2 }, description: 'Glas und Salz werden zu Arznei.' },
];

export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));

/** Kontor: Lager, besserer Verkaufspreis, Grundlage für Betriebe */
export const KONTOR_PRICE = 500;
export const KONTOR_CAPACITY = [0, 200, 500, 1200]; // je Ausbaustufe
export const KONTOR_UPGRADE = [0, 0, 900, 2200]; // Preis für Stufe 2 und 3
export const KONTOR_SELL_FACTOR = 0.95;
/** Betriebe pro Kontorstufe */
export const KONTOR_SLOTS = [0, 2, 4, 6];

/** Unterhalt eines Betriebs je Tag als Anteil am Kaufpreis (0,4 % am Tag, rund 2,8 % je Woche), dazu kommt der Lohn */
export const BETRIEB_UPKEEP_RATE = 0.004;

export function betriebUpkeep(b: BuildingType): number {
  return Math.round(b.price * BETRIEB_UPKEEP_RATE);
}

/** Tägliche Unterhaltskosten eines Kontors je Stufe, bevor der Aufschlag für viele Kontore dazukommt */
export const KONTOR_UPKEEP = [0, 5, 10, 18];

/** Jedes weitere Kontor macht alle teurer: +25 % Unterhalt je Kontor ab dem zweiten */
export const KONTOR_UPKEEP_STEP = 0.25;

/** Unterhalt eines Kontors der Stufe `level`, wenn das Haus insgesamt `count` Kontore hat */
export function kontorUpkeep(level: number, count: number): number {
  return Math.round(KONTOR_UPKEEP[level] * (1 + KONTOR_UPKEEP_STEP * Math.max(0, count - 1)));
}
