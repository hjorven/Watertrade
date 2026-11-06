import type { ShipType } from '../sim/river.ts';

export interface ShipClass extends ShipType {
  price: number; // Taler beim Kauf
  description: string;
}

/** Epoche 1 */
export const SHIPS: Record<string, ShipClass> = {
  floss: {
    id: 'floss',
    name: 'Floß',
    propulsion: 'drift',
    speed: 1,
    draft: 0.5,
    height: 1,
    capacity: 30,
    canGoUpstream: false,
    price: 60,
    description: 'Billig, treibt nur talwärts. Am Ziel wird es zerlegt und als Holz verkauft.',
  },
  plaette: {
    id: 'plaette',
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
    name: 'Segelkahn',
    propulsion: 'sail',
    speed: 8,
    draft: 1.4,
    height: 7,
    capacity: 60,
    canGoUpstream: true,
    price: 950,
    description: 'Schnell und geräumig bei gutem Wind, bei Flaute langsam. Der Mast passt nicht unter jede Brücke.',
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
