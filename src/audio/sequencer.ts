/**
 * Erzeugt aus einer Komposition die Noten eines beliebigen Takts. Rein (ohne WebAudio),
 * deterministisch über den Taktindex, damit die Musik bei jedem Durchlauf leicht variiert,
 * aber testbar bleibt.
 */
import { PERCUSSION, type Composition, type Instrument } from './compositions.ts';
import { hashString, mulberry32, pick, type Rng } from './rng.ts';
import { chordTone, degreeToMidi, parseBar, type MelodyNote } from './theory.ts';

export interface NoteEvent {
  /** Beginn in Schritten ab Taktanfang */
  step: number;
  /** Dauer in Schritten */
  len: number;
  midi: number;
  instrument: Instrument;
  /** 0..1 */
  vel: number;
}

export interface BarInfo {
  section: string;
  barInSection: number;
  cycle: number;
  chord: number;
}

/** Takte eines Formdurchlaufs, flach */
export function flattenForm(c: Composition): { section: string; barInSection: number }[] {
  const out: { section: string; barInSection: number }[] = [];
  for (const name of c.form) {
    const sec = c.sections[name];
    if (!sec) throw new Error(`Abschnitt ${name} fehlt in ${c.id}`);
    sec.chords.forEach((_, i) => out.push({ section: name, barInSection: i }));
  }
  return out;
}

const formCache = new WeakMap<Composition, { section: string; barInSection: number }[]>();

export function barInfo(c: Composition, barIndex: number): BarInfo {
  let flat = formCache.get(c);
  if (!flat) formCache.set(c, (flat = flattenForm(c)));
  const cycle = Math.floor(barIndex / flat.length);
  const pos = flat[((barIndex % flat.length) + flat.length) % flat.length];
  return { ...pos, cycle, chord: c.sections[pos.section].chords[pos.barInSection] };
}

export function secondsPerBar(c: Composition): number {
  return (c.stepsPerBar * 60) / c.stepsPerMinute;
}

export function secondsPerStep(c: Composition): number {
  return 60 / c.stepsPerMinute;
}

const RHYTHMS: Record<number, number[][]> = {
  6: [[3, 3], [2, 1, 3], [3, 1, 2], [2, 2, 2], [6], [4, 2]],
  8: [[4, 4], [2, 2, 4], [6, 2], [3, 1, 4], [8], [2, 2, 2, 2], [4, 2, 2]],
};

function nearest(scale: readonly number[], target: number, lo: number, hi: number): number {
  let best = target;
  let dist = Infinity;
  for (let oct = -1; oct <= 2; oct++) {
    for (const d of scale) {
      const deg = d + 7 * oct;
      if (deg < lo || deg > hi) continue;
      const dd = Math.abs(deg - target);
      if (dd < dist) {
        dist = dd;
        best = deg;
      }
    }
  }
  return best;
}

/** Erfindet einen Melodietakt: Akkordton auf der Eins, danach Schritte innerhalb der Tonleiter. */
export function inventBar(rng: Rng, c: Composition, chord: number, prev: number): MelodyNote[] {
  const rhythm = pick(rng, RHYTHMS[c.stepsPerBar] ?? [[c.stepsPerBar]]);
  const notes: MelodyNote[] = [];
  let step = 0;
  let deg = prev;
  rhythm.forEach((len, i) => {
    if (i === 0) {
      // Akkordton nahe der letzten Note
      const tones = [chord, chord + 2, chord + 4].flatMap((t) => [t, t + 7, t - 7]);
      deg = tones.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
      deg = nearest(c.scale, deg, 1, 10);
    } else {
      deg = nearest(c.scale, deg + pick(rng, [-2, -1, -1, 1, 1, 2]), 1, 10);
    }
    const rest = i > 0 && rng() < 0.18;
    notes.push({ step, len, degree: rest ? null : deg, accidental: 0 });
    step += len;
  });
  return notes;
}

/** Kleine Verzierung: eine lange Note bekommt einen Vorschlag/Nachbarton. */
function ornament(rng: Rng, c: Composition, notes: MelodyNote[]): MelodyNote[] {
  const out: MelodyNote[] = [];
  for (const n of notes) {
    if (n.degree !== null && n.len >= 2 && rng() < 0.3) {
      const neighbor = nearest(c.scale, n.degree + (rng() < 0.5 ? 1 : -1), -6, 15);
      out.push({ ...n, len: n.len - 1 }, { step: n.step + n.len - 1, len: 1, degree: neighbor, accidental: 0 });
    } else out.push(n);
  }
  return out;
}

function clampMidi(m: number): number {
  while (m > 96) m -= 12;
  while (m < 28) m += 12;
  return m;
}

/**
 * Alle Noten eines Takts. Variation je Durchlauf:
 * Durchlauf 0 spielt die Melodie wie notiert, spätere Durchläufe wechseln das Melodieinstrument,
 * verzieren und lassen gelegentlich einen Abschnitt frei erfinden.
 */
export function renderBar(c: Composition, barIndex: number): NoteEvent[] {
  const info = barInfo(c, barIndex);
  const sec = c.sections[info.section];
  const rng = mulberry32(hashString(c.id) ^ Math.imul(barIndex + 1, 0x9e3779b1));
  const sectionRng = mulberry32(hashString(c.id + info.section) ^ Math.imul(info.cycle + 7, 0x85ebca6b));
  const events: NoteEvent[] = [];

  // --- Begleitung ---
  for (const part of c.parts) {
    if (part.notIn?.includes(info.section)) continue;
    if (part.from !== undefined && info.cycle < part.from) continue;
    if (part.every && info.barInSection % part.every !== 0) continue;
    const chord = part.fixedDegree ?? info.chord;
    const isPerc = PERCUSSION.includes(part.instrument);
    for (const n of part.notes) {
      const tone = Array.isArray(n.t) ? n.t[info.barInSection % n.t.length] : ((n.t as number | undefined) ?? 0);
      const midi = isPerc ? c.root - 24 : clampMidi(chordTone(c.root, c.mode, chord, tone, n.o ?? 0));
      events.push({
        step: n.s,
        len: n.l ?? 1,
        midi,
        instrument: part.instrument,
        vel: (n.v ?? 0.7) * (part.gain ?? 1) * (0.9 + 0.2 * rng()),
      });
    }
  }

  // --- Melodie ---
  if (!sec.silent) {
    const lead = c.lead[info.cycle % c.lead.length];
    let notes: MelodyNote[];
    const inventSection = !sec.melody || (info.cycle >= 2 && info.cycle % 3 === 2 && sectionRng() < 0.5);
    if (inventSection) {
      // Lage pendelt langsam über den Abschnitt, damit die Linie einen Bogen hat
      const prev = 5 + [0, 2, 3, 1][info.barInSection % 4];
      notes = inventBar(rng, c, info.chord, prev);
      // In ruhigen Stücken bleibt jeder dritte Takt leer, das lässt Luft
      if (!sec.melody && rng() < 0.3) notes = [];
    } else {
      notes = parseBar(sec.melody![info.barInSection]);
      if (info.cycle > 0) notes = ornament(rng, c, notes);
    }
    for (const n of notes) {
      if (n.degree === null) continue;
      events.push({
        step: n.step,
        len: n.len,
        midi: clampMidi(degreeToMidi(c.root, c.mode, n.degree, n.accidental) + 12 * c.leadOctave),
        instrument: lead,
        vel: (n.step === 0 ? 0.85 : 0.7) * (0.9 + 0.2 * rng()),
      });
    }
  }
  return events;
}
