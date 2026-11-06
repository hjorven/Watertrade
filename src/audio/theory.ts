/** Musiktheorie ohne WebAudio: Tonleitern, Stufen, Melodie-Notation. Rein und testbar. */

export const MODES = {
  ionisch: [0, 2, 4, 5, 7, 9, 11],
  dorisch: [0, 2, 3, 5, 7, 9, 10],
  mixolydisch: [0, 2, 4, 5, 7, 9, 10],
  aeolisch: [0, 2, 3, 5, 7, 8, 10],
} as const;

export type Mode = readonly number[];

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Stufe (1 = Grundton, 8 = Oktave, 0 = Septime darunter) in einer Tonart als MIDI-Nummer.
 * `accidental` verschiebt chromatisch (+1 = Kreuz, -1 = B).
 */
export function degreeToMidi(root: number, mode: Mode, degree: number, accidental = 0): number {
  const d = degree - 1;
  const octave = Math.floor(d / 7);
  const idx = ((d % 7) + 7) % 7;
  return root + octave * 12 + mode[idx] + accidental;
}

/**
 * Akkordton eines leitereigenen Dreiklangs: tone 0 = Grundton, 1 = Terz, 2 = Quinte, 3 = Septime.
 */
export function chordTone(root: number, mode: Mode, chordDegree: number, tone: number, octave = 0): number {
  return degreeToMidi(root, mode, chordDegree + 2 * tone) + 12 * octave;
}

/** Eine Note der Melodie innerhalb eines Takts, Zeiten in Schritten (meist Achteln). */
export interface MelodyNote {
  step: number;
  len: number;
  /** Stufe oder null für Pause */
  degree: number | null;
  accidental: number;
}

const TOKEN = /^(r|-?\d+)([',]*)([#b]?)(?:_(\d+(?:\.\d+)?))?$/;

/**
 * Liest einen Takt in Kurzschrift. Beispiel: `5_3 4 3_2` = Stufe 5 für drei Schritte, dann 4, dann 3 für zwei.
 * `'` hebt um eine Oktave, `,` senkt um eine Oktave, `#`/`b` verändern chromatisch, `r` ist eine Pause.
 */
export function parseBar(src: string): MelodyNote[] {
  const notes: MelodyNote[] = [];
  let step = 0;
  for (const tok of src.trim().split(/\s+/).filter(Boolean)) {
    const m = TOKEN.exec(tok);
    if (!m) throw new Error(`Unbekanntes Melodie-Zeichen: "${tok}"`);
    const [, deg, marks, acc, len] = m;
    const length = len ? Number(len) : 1;
    let degree: number | null = null;
    if (deg !== 'r') {
      degree = Number(deg);
      for (const c of marks) degree += c === "'" ? 7 : -7;
    }
    notes.push({ step, len: length, degree, accidental: acc === '#' ? 1 : acc === 'b' ? -1 : 0 });
    step += length;
  }
  return notes;
}

export function barLength(src: string): number {
  return parseBar(src).reduce((sum, n) => sum + n.len, 0);
}
