import type { ShipType } from '../sim/river.ts';

export interface ShipClass extends ShipType {
  price: number; // Taler beim Kauf
  description: string;
  /** ab welcher Epoche die Werften diesen Typ bauen */
  epoch: number;
  /** Dieselverbrauch in Tonnen je Fahrstunde (Motorschiffe). Der Diesel kommt aus dem Tank (`bunker`). */
  diesel?: number;
  /** Kohleverbrauch in Tonnen je Fahrstunde (Dampfer). Die Kohle kommt aus dem Bunker. */
  coal?: number;
  /** Fassungsvermögen des Kohlebunkers oder Dieseltanks in Tonnen, getrennt vom Laderaum */
  bunker?: number;
  /** Kühlraum: verderbliche Ware bleibt frisch und bringt diesen Aufpreis */
  fresh?: number;
  /** Bauholz in Tonnen, das zum Bau nötig ist (Floß). Der Preis ist dann nur der Lohn. */
  timber?: number;
}

/** Verderbliche Ware: Wertverlust je Fahrtag ohne Kühlung. Milch hält kaum, Käse ist die haltbare Form. */
export const PERISH: Record<string, number> = { fisch: 0.06, brot: 0.04, bier: 0.01, milch: 0.12, kaese: 0.015 };

/** Brennstoff eines Schiffs: Kohle für Dampfer, Diesel für Motorschiffe, sonst keiner */
export function fuelOf(cls: ShipClass): { good: 'kohle' | 'diesel'; rate: number; name: string } | null {
  if (cls.coal) return { good: 'kohle', rate: cls.coal, name: 'Kohle' };
  if (cls.diesel) return { good: 'diesel', rate: cls.diesel, name: 'Diesel' };
  return null;
}

/** Waren, die im Kühlraum frisch bleiben */
export const FRESH_GOODS = Object.keys(PERISH);

/** Frische fällt nie unter diesen Wert, auch alter Fisch findet noch einen Käufer */
export const MIN_FRESH = 0.4;

export const EPOCHS = [
  { number: 1, name: 'Treidelzeit', from: 1 },
  { number: 2, name: 'Dampf', from: 5 },
  { number: 3, name: 'Motor', from: 10 },
];

/** Epoche nach Spieljahr im freien Spiel */
export function epochOfYear(year: number): number {
  let e = 1;
  for (const x of EPOCHS) if (year >= x.from) e = x.number;
  return e;
}

/** Epoche 1 */
export const SHIPS: Record<string, ShipClass> = {
  floss: {
    id: 'floss',
    epoch: 1,
    name: 'Floß',
    propulsion: 'drift',
    speed: 1,
    draft: 0.5,
    height: 1,
    capacity: 30,
    canGoUpstream: false,
    price: 20,
    timber: 20,
    description: 'Aus 20 t Holz gezimmert, dazu 20 Taler Lohn. Treibt nur talwärts und trägt sein Holz selbst zum Ziel, wo es zerlegt und verkauft wird.',
  },
  plaette: {
    id: 'plaette',
    epoch: 1,
    name: 'Plätte',
    propulsion: 'tow',
    speed: 4,
    draft: 0.6,
    height: 2,
    capacity: 25,
    canGoUpstream: true,
    price: 280,
    description: 'Flacher Kahn mit wenig Ladung, kommt aber auch über seichte Stellen.',
  },
  treidelkahn: {
    id: 'treidelkahn',
    epoch: 1,
    name: 'Treidelkahn',
    propulsion: 'tow',
    speed: 5,
    draft: 1.0,
    height: 3,
    capacity: 40,
    canGoUpstream: true,
    price: 450,
    description: 'Das Arbeitspferd am Fluss. Bergwärts ziehen Pferde vom Treidelpfad.',
  },
  segelkahn: {
    id: 'segelkahn',
    epoch: 1,
    name: 'Segelkahn',
    propulsion: 'sail',
    speed: 8,
    draft: 1.4,
    height: 7,
    mastHeight: 3,
    capacity: 60,
    canGoUpstream: true,
    price: 950,
    description: 'Schnell und geräumig bei gutem Wind, bei Flaute nur halb so schnell. Vor niedrigen Brücken wird der Mast gelegt, das kostet 2 Stunden.',
  },
  // Epoche 2: Dampf
  raddampfer: {
    id: 'raddampfer',
    epoch: 2,
    name: 'Raddampfer',
    propulsion: 'steam',
    speed: 10,
    draft: 1.2,
    height: 6,
    capacity: 70,
    canGoUpstream: true,
    price: 2600,
    coal: 0.6,
    bunker: 25,
    description: 'Schaufelräder und Kohle: schnell gegen jede Strömung, ohne Pferde und Wind. Verbrennt 0,6 t Kohle je Stunde aus dem Bunker. Der Schornstein ist hoch.',
  },
  schleppverband: {
    id: 'schleppverband',
    epoch: 2,
    name: 'Schleppverband',
    propulsion: 'steam',
    speed: 6,
    draft: 1.7,
    height: 5,
    capacity: 180,
    canGoUpstream: true,
    price: 4200,
    coal: 1.0,
    bunker: 45,
    description: 'Ein Schlepper zieht zwei Kähne. Riesige Ladung, aber tief und langsam: nur auf dem Hauptstrom sinnvoll. Verbrennt 1 t Kohle je Stunde.',
  },
  // Epoche 3: Motor
  motorschiff: {
    id: 'motorschiff',
    epoch: 3,
    name: 'Motorschiff',
    propulsion: 'motor',
    speed: 14,
    draft: 1.5,
    height: 4,
    capacity: 110,
    canGoUpstream: true,
    price: 6500,
    diesel: 0.25,
    bunker: 12,
    description: 'Dieselmotor, Steuerhaus achtern, flacher Aufbau: schnell, groß und passt unter die meisten Brücken. Verbraucht 0,25 t Diesel je Stunde aus dem Tank.',
  },
  kuehlschiff: {
    id: 'kuehlschiff',
    epoch: 3,
    name: 'Kühlschiff',
    propulsion: 'motor',
    speed: 12,
    draft: 1.4,
    height: 4,
    capacity: 80,
    canGoUpstream: true,
    price: 7200,
    diesel: 0.28,
    bunker: 12,
    fresh: 0.1,
    description: 'Kühlraum für Fisch, Milch, Käse, Brot und Bier: nichts verdirbt unterwegs, und ganz frische Ware bringt 10 % mehr. Verbraucht 0,28 t Diesel je Stunde.',
  },
};

export interface Upgrade {
  id: string;
  name: string;
  text: string;
  /** Anteil am Schiffspreis */
  cost: number;
}

export const UPGRADES: Upgrade[] = [
  { id: 'laderaum', name: 'Erweiterter Laderaum', text: '+20 % Ladung', cost: 0.35 },
  { id: 'antrieb', name: 'Stärkerer Antrieb', text: '+12 % Geschwindigkeit (bessere Pferde oder Segel)', cost: 0.3 },
  { id: 'kiel', name: 'Flacher Kiel', text: '15 % weniger Tiefgang', cost: 0.4 },
  { id: 'beschlag', name: 'Kupferbeschlag', text: '40 % weniger Verschleiß', cost: 0.25 },
];

export const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));
