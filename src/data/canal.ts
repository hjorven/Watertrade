import { CANAL_ENDS, CANAL_ID } from './maps/zwei-taeler.ts';

/** Ein Bauabschnitt des Kanals: erst bezahlen, dann mit Baustoffen versorgen, bis die Arbeitstage voll sind */
export interface CanalStageDef {
  name: string;
  text: string;
  /** Taler beim Beginn des Abschnitts */
  cost: number;
  /** Arbeitstage bei voller Versorgung */
  days: number;
  /** Baustoffe für den ganzen Abschnitt; werden gleichmäßig über die Arbeitstage verbraucht */
  goods: Record<string, number>;
  /** Anteil der Arbeit, die im Winter weitergeht (0 = Frostpause) */
  winterWork: number;
}

export interface CanalDef {
  id: string;
  name: string;
  /** Abschnitt der Karte, der nach Fertigstellung befahrbar wird */
  segment: string;
  /** Städte mit Baustelle, dort werden Baustoffe angeliefert */
  sites: readonly string[];
  /** frühestmögliche Epoche */
  epoch: number;
  stages: CanalStageDef[];
  text: string;
}

/**
 * Der Scheitelkanal über den Waldrücken zwischen Weißstrom und Schwarzach.
 * Zusammen rund 52.000 Taler und 235 Arbeitstage; mit Frostpausen und Lieferlücken
 * dauert der Bau zwei bis drei Spieljahre.
 */
export const SCHEITELKANAL: CanalDef = {
  id: CANAL_ID,
  name: 'Scheitelkanal',
  segment: 'scheitelkanal',
  sites: CANAL_ENDS,
  epoch: 1,
  text: 'Ein Kanal über den Waldrücken verbindet Weißstrom und Schwarzach: Kohle und Tuch aus dem Norden, Korn und Holz aus dem Tal.',
  stages: [
    {
      name: 'Vermessung und Landkauf',
      text: 'Landmesser stecken die Trasse ab, die Bauern am Rücken werden ausbezahlt.',
      cost: 6000,
      days: 25,
      goods: {},
      winterWork: 1,
    },
    {
      name: 'Durchstich am Scheitel',
      text: 'Hunderte Erdarbeiter graben das Kanalbett durch den Rücken. Sie brauchen Brot, Werkzeug und Holz für Verbau und Baracken. Bei Frost ruht die Arbeit.',
      cost: 18000,
      days: 100,
      goods: { brot: 150, werkzeug: 30, holz: 120 },
      winterWork: 0,
    },
    {
      name: 'Schleusentreppe',
      text: 'Vierzehn Schleusen heben die Schiffe über den Scheitel. Bretter für Tore und Schalung, Kohle für die Kalköfen.',
      cost: 24000,
      days: 90,
      goods: { bretter: 120, kohle: 90, werkzeug: 25 },
      winterWork: 0,
    },
    {
      name: 'Flutung und Einweihung',
      text: 'Die Speicherteiche füllen das Bett, dann wird gefeiert: Brot und Bier für alle, die gebaut haben.',
      cost: 4000,
      days: 20,
      goods: { brot: 30, bier: 40 },
      winterWork: 0,
    },
  ],
};

export const CANALS: CanalDef[] = [SCHEITELKANAL];
