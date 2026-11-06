/**
 * Eigene Kompositionen für Watertrade. Melodien in Stufen-Kurzschrift (siehe theory.ts),
 * Begleitung als Muster über leitereigene Akkorde. Jede Stimmung hat eine eigene Besetzung:
 *
 * - epoche1 "Am alten Furt": D-dorisch, 6/8, Bordun, Harfe, Flöte, Rahmentrommel (mittelalterlich)
 * - epoche2 "Markttag": G-Dur, 4/4, Laute, Blockflöte, Bass, Schellen (Renaissance)
 * - epoche3 "Dampf und Walzer": F-Dur, 3/4, Harmonium, Oom-pa-pa-Bass (19. Jahrhundert)
 * - ruhig "Stilles Wasser": C-Dur pentatonisch, 4/4 langsam, Flächen, Glocken, frei erzeugte Melodie
 */
import { MODES, type Mode } from './theory.ts';

export type MusicMood = 'epoche1' | 'epoche2' | 'epoche3' | 'ruhig';

export type Instrument =
  | 'laute'
  | 'harfe'
  | 'floete'
  | 'bordun'
  | 'harmonium'
  | 'flaeche'
  | 'glocke'
  | 'bass'
  | 'trommel'
  | 'schellen'
  | 'holz';

export const PERCUSSION: readonly Instrument[] = ['trommel', 'schellen', 'holz'];

/** Ein Anschlag im Begleitmuster */
export interface PatternNote {
  /** Schritt im Takt */
  s: number;
  /** Akkordton (0 Grundton, 1 Terz, 2 Quinte); als Liste wechselt er je Takt */
  t?: number | readonly number[];
  /** Oktavverschiebung relativ zum Grundton der Tonart */
  o?: number;
  /** Länge in Schritten */
  l?: number;
  /** Lautstärke 0..1 */
  v?: number;
}

export interface Part {
  instrument: Instrument;
  notes: readonly PatternNote[];
  /** Fester Akkord statt des Taktakkords (z. B. Bordun auf dem Grundton) */
  fixedDegree?: number;
  /** Nur jeden n-ten Takt eines Abschnitts spielen */
  every?: number;
  /** In diesen Abschnitten schweigt die Stimme */
  notIn?: readonly string[];
  /** Setzt erst ab diesem Durchlauf ein */
  from?: number;
  gain?: number;
}

export interface Section {
  /** Akkordstufe pro Takt */
  chords: readonly number[];
  /** Melodie pro Takt; fehlt sie, wird eine Melodie erfunden (oder es bleibt still, siehe `silent`) */
  melody?: readonly string[];
  /** Kein Melodieinstrument in diesem Abschnitt */
  silent?: boolean;
}

export interface Composition {
  id: MusicMood;
  title: string;
  root: number;
  mode: Mode;
  stepsPerBar: number;
  stepsPerMinute: number;
  sections: Readonly<Record<string, Section>>;
  form: readonly string[];
  /** Melodieinstrumente, wechseln je Durchlauf */
  lead: readonly Instrument[];
  /** Oktavlage der Melodie relativ zum Grundton */
  leadOctave: number;
  parts: readonly Part[];
  /** Erlaubte Stufen für erfundene Melodien und Varianten */
  scale: readonly number[];
  /** Pegelausgleich zwischen den Stücken */
  level?: number;
}

const epoche1: Composition = {
  id: 'epoche1',
  title: 'Am alten Furt',
  root: 62, // D4
  mode: MODES.dorisch,
  stepsPerBar: 6,
  stepsPerMinute: 200,
  lead: ['floete', 'harfe', 'floete'],
  leadOctave: 1,
  scale: [1, 2, 3, 4, 5, 6, 7],
  sections: {
    A: {
      chords: [1, 1, 7, 1],
      melody: ['5_3 4 3_2', '1_2 2 3_3', '4_2 3 2_2 1', '2_2 7, 1_3'],
    },
    A2: {
      chords: [1, 4, 7, 1],
      melody: ['5_3 6 5_2', '4_2 6 5_3', '5_2 4 3_2 2', '1_6'],
    },
    B: {
      chords: [3, 7, 4, 5],
      melody: ['5_2 6 7_3', "2'_2 1' 7_3", '6_2 5 4_3', '5_2 3 2_3'],
    },
    B2: {
      chords: [3, 7, 4, 1],
      melody: ['5_2 6 7_3', "2'_3 1' 7_2", '6_2 4 6_3', "1'_6"],
    },
    atem: { chords: [1, 1], silent: true },
  },
  form: ['A', 'A2', 'B', 'B2', 'A', 'A2', 'atem'],
  parts: [
    { instrument: 'bordun', fixedDegree: 1, every: 2, notes: [{ s: 0, t: 0, o: -1, l: 12, v: 0.8 }, { s: 0, t: 2, o: -1, l: 12, v: 0.6 }] },
    {
      instrument: 'harfe',
      notes: [
        { s: 0, t: 0, o: 0, l: 3, v: 0.7 },
        { s: 2, t: 2, o: 0, l: 1, v: 0.4 },
        { s: 3, t: [1, 2], o: 0, l: 3, v: 0.55 },
        { s: 5, t: 0, o: 1, l: 1, v: 0.35 },
      ],
      notIn: ['atem'],
    },
    { instrument: 'trommel', notes: [{ s: 0, v: 0.8 }, { s: 3, v: 0.45 }, { s: 5, v: 0.25 }], notIn: ['atem'], from: 0 },
  ],
};

const epoche2: Composition = {
  id: 'epoche2',
  title: 'Markttag',
  level: 0.65,
  root: 67, // G4
  mode: MODES.ionisch,
  stepsPerBar: 8,
  stepsPerMinute: 300,
  lead: ['floete', 'laute', 'floete'],
  leadOctave: 0,
  scale: [1, 2, 3, 4, 5, 6, 7],
  sections: {
    A: {
      chords: [1, 4, 5, 1],
      melody: ['1_2 3_2 5_3 4', '6_2 5 4 3_2 4_2', '5_3 4 3_2 2_2', '3 2 1_6'],
    },
    A2: {
      chords: [1, 4, 5, 1],
      melody: ['1_2 3_2 5_3 6', "1'_3 7 6_2 4_2", '5_2 6 5 4_2 2_2', '1_6 r_2'],
    },
    B: {
      chords: [6, 3, 4, 5],
      melody: ['3_2 5_2 6_3 5', '7_3 6 5_2 3_2', "4_2 6_2 1'_3 7", '6_2 5_2 4 3 2_2'],
    },
    B2: {
      chords: [6, 3, 4, 5],
      melody: ['3_2 5_2 6_3 7', "1'_3 7 6_2 5_2", '4_2 3 4 6_2 4_2', '5_4 7,_2 2_2'],
    },
    atem: { chords: [4, 1], silent: true },
  },
  form: ['A', 'A2', 'B', 'B2', 'A', 'A2', 'atem'],
  parts: [
    {
      instrument: 'laute',
      notes: [
        { s: 0, t: 0, o: -1, l: 2, v: 0.7 },
        { s: 2, t: 1, o: -1, l: 2, v: 0.45 },
        { s: 4, t: 2, o: -1, l: 2, v: 0.55 },
        { s: 6, t: 1, o: -1, l: 2, v: 0.4 },
      ],
    },
    { instrument: 'bass', notes: [{ s: 0, t: 0, o: -2, l: 4, v: 0.8 }, { s: 4, t: 2, o: -2, l: 4, v: 0.6 }] },
    { instrument: 'trommel', notes: [{ s: 0, v: 0.6 }, { s: 4, v: 0.35 }, { s: 7, v: 0.2 }], notIn: ['atem'], from: 1 },
    { instrument: 'schellen', notes: [{ s: 2, v: 0.35 }, { s: 3, v: 0.15 }, { s: 6, v: 0.35 }, { s: 7, v: 0.15 }], notIn: ['atem'] },
  ],
};

const epoche3: Composition = {
  id: 'epoche3',
  title: 'Dampf und Walzer',
  level: 0.85,
  root: 65, // F4
  mode: MODES.ionisch,
  stepsPerBar: 6,
  stepsPerMinute: 264,
  lead: ['harmonium', 'floete', 'harmonium'],
  leadOctave: 0,
  scale: [1, 2, 3, 4, 5, 6, 7],
  sections: {
    A: {
      chords: [1, 1, 5, 5, 5, 5, 1, 1],
      melody: ['1_2 3_2 5_2', '6_4 5_2', '5_2 4_2 2_2', '7,_2 1_2 2_2', '5_4 4_2', '2_2 7,_2 2_2', '3_2 2_2 1_2', '1_6'],
    },
    B: {
      chords: [4, 4, 1, 1, 2, 5, 1, 1],
      melody: ["4_2 6_2 1'_2", "2'_4 1'_2", '6_2 5_2 3_2', '5_4 r_2', '6_2 4_2 2_2', "5_2 7_2 2'_2", "1'_4 5_2", "1'_6"],
    },
    atem: { chords: [1, 5], silent: true },
  },
  form: ['A', 'B', 'A', 'atem'],
  parts: [
    { instrument: 'bass', notes: [{ s: 0, t: [0, 2], o: -2, l: 2, v: 0.85 }] },
    {
      instrument: 'harmonium',
      gain: 0.45,
      notes: [
        { s: 2, t: 1, o: -1, l: 1.5, v: 0.6 },
        { s: 2, t: 2, o: -1, l: 1.5, v: 0.6 },
        { s: 4, t: 1, o: -1, l: 1.5, v: 0.5 },
        { s: 4, t: 2, o: -1, l: 1.5, v: 0.5 },
      ],
    },
    { instrument: 'schellen', notes: [{ s: 2, v: 0.2 }, { s: 4, v: 0.2 }], notIn: ['atem'], from: 1 },
    { instrument: 'glocke', every: 4, notes: [{ s: 0, t: 0, o: 1, l: 6, v: 0.35 }], notIn: ['A'] },
  ],
};

const ruhig: Composition = {
  id: 'ruhig',
  title: 'Stilles Wasser',
  root: 60, // C4
  mode: MODES.ionisch,
  stepsPerBar: 8,
  stepsPerMinute: 160,
  lead: ['glocke', 'floete', 'harfe'],
  leadOctave: 1,
  scale: [1, 2, 3, 5, 6],
  sections: {
    A: { chords: [1, 6, 4, 5] },
    B: { chords: [4, 1, 2, 5] },
    C: { chords: [1, 3, 4, 1] },
    atem: { chords: [4, 1], silent: true },
  },
  form: ['A', 'B', 'A', 'C', 'atem'],
  parts: [
    {
      instrument: 'flaeche',
      notes: [
        { s: 0, t: 0, o: -1, l: 8, v: 0.7 },
        { s: 0, t: 1, o: -1, l: 8, v: 0.55 },
        { s: 0, t: 2, o: -1, l: 8, v: 0.55 },
      ],
    },
    {
      instrument: 'harfe',
      notes: [
        { s: 0, t: 0, o: -1, l: 4, v: 0.5 },
        { s: 3, t: 2, o: -1, l: 3, v: 0.35 },
        { s: 6, t: 1, o: 0, l: 2, v: 0.3 },
      ],
      from: 1,
    },
    { instrument: 'bass', notes: [{ s: 0, t: 0, o: -2, l: 8, v: 0.5 }] },
  ],
};

export const COMPOSITIONS: Readonly<Record<MusicMood, Composition>> = { epoche1, epoche2, epoche3, ruhig };
export const MUSIC_MOODS = Object.keys(COMPOSITIONS) as MusicMood[];
