/**
 * Ansehen in den Städten (Plan 5.5 und 6.5): Ränge mit Freischaltungen, Stiftungen,
 * Stadthaus und Sitz im Stadtrat. Nur Zahlen und Texte, die Regeln stehen in sim/standing.ts.
 */

export interface StandingRank {
  name: string;
  /** ab diesem Ansehen (0..100) */
  from: number;
  /** Nachlass beim Einkauf in dieser Stadt */
  discount: number;
  /** Aufschlag auf die Belohnung von Aufträgen dieser Stadt */
  contractBonus: number;
  /** Zusätzliche Bauplätze für Betriebe am eigenen Kontor */
  extraSlots: number;
  /** Was dieser Rang neu bringt, für die Anzeige */
  unlocks: string;
}

export const RANKS: StandingRank[] = [
  { name: 'Fremder', from: 0, discount: 0, contractBonus: 0, extraSlots: 0, unlocks: 'Noch kennt dich hier niemand.' },
  { name: 'Bekannt', from: 10, discount: 0.02, contractBonus: 0, extraSlots: 0, unlocks: '2 % Nachlass beim Einkauf' },
  { name: 'Geschätzt', from: 25, discount: 0.03, contractBonus: 0.1, extraSlots: 0, unlocks: '3 % Nachlass, Aufträge zahlen 10 % mehr und kommen öfter, Stadthaus erlaubt' },
  { name: 'Angesehen', from: 45, discount: 0.04, contractBonus: 0.15, extraSlots: 1, unlocks: '4 % Nachlass, Aufträge +15 %, ein zusätzlicher Bauplatz am Kontor, Sitz im Stadtrat möglich' },
  { name: 'Ehrenbürger', from: 70, discount: 0.06, contractBonus: 0.2, extraSlots: 1, unlocks: '6 % Nachlass, Aufträge +20 %' },
];

export type FoundationId = 'armenhaus' | 'schule' | 'kirche';

export interface FoundationDef {
  id: FoundationId;
  name: string;
  price: number;
  /** Taler am Tag für Lehrer, Pfarrer, Pflege */
  upkeep: number;
  /** dauerhaftes Ansehen, solange die Stiftung besteht */
  standing: number;
  /** dauerhaft bessere Versorgung (Zufriedenheit) der Stadt */
  satisfaction: number;
  /** ab dieser Bevölkerungsstufe (0 Dorf, 1 Marktflecken, ...) */
  minLevel: number;
  description: string;
}

export const FOUNDATIONS: FoundationDef[] = [
  {
    id: 'armenhaus',
    name: 'Armenhaus',
    price: 1500,
    upkeep: 4,
    standing: 8,
    satisfaction: 0.02,
    minLevel: 0,
    description: 'Ein Dach und Suppe für die Ärmsten. In schlechten Zeiten schrumpft die Stadt nur halb so schnell.',
  },
  {
    id: 'schule',
    name: 'Schule',
    price: 3000,
    upkeep: 6,
    standing: 12,
    satisfaction: 0.03,
    minLevel: 0,
    description: 'Lesen, Schreiben, Rechnen. Die Stadt wächst schneller, wenn sie gut versorgt ist.',
  },
  {
    id: 'kirche',
    name: 'Kirche',
    price: 5000,
    upkeep: 8,
    standing: 18,
    satisfaction: 0.04,
    minLevel: 1,
    description: 'Ein neuer Kirchturm mit deinem Wappen über dem Portal. Bringt das meiste Ansehen.',
  },
];

export const FOUNDATION_BY_ID = new Map(FOUNDATIONS.map((f) => [f.id, f]));

/** Wie viel schneller eine Stadt mit Schule wächst */
export const SCHOOL_GROWTH = 1.15;
/** Wie stark ein Armenhaus das Schrumpfen bremst */
export const POORHOUSE_SHRINK = 0.5;

/** Eigenes Stadthaus: Prestigebau im Diorama */
export const TOWNHOUSE = { price: 6000, upkeep: 10, standing: 10, minRank: 2 };

/** Sitz im Stadtrat: halber Zoll auf den Flussabschnitten an der Stadt, mehr und bessere Aufträge */
export const COUNCIL = { price: 4000, upkeep: 12, standing: 10, minRank: 3, tollShare: 0.5, contractBonus: 0.1, offerWeight: 2 };

/** Verdientes Ansehen verblasst langsam (Anteil je Tag), Stiftungen und Bauten bleiben */
export const STANDING_DECAY = 0.005;
/** Höchstens so viel verdientes Ansehen je Stadt und Tag aus Verkäufen */
export const DAILY_SALE_CAP = 4;
/** Ansehen je Tonne, die in eine echte Knappheit geliefert wird */
export const SCARCE_GAIN = 0.08;
/** Unterhalb dieses Anteils am Zielbestand gilt eine Bedarfsware als knapp */
export const SCARCE_SHARE = 0.5;
/** Anteil der zuletzt gekauften Tonnen, der über Nacht als "eigene Ware" vergessen wird */
export const BOUGHT_FADE = 0.2;
/** Zurückverkaufte eigene Ware bringt höchstens so viel wie der günstigste Einkauf hier, abzüglich 2 % */
export const ROUNDTRIP_MARGIN = 0.98;

/** Erfüllter Auftrag: fest plus je 10 t */
export const CONTRACT_GAIN = { base: 3, per10t: 1, max: 9 };
/** Verpasste Frist */
export const CONTRACT_LOSS = 8;
