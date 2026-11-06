import { describe, expect, it } from 'vitest';
import { MODES, barLength, chordTone, degreeToMidi, midiToFreq, parseBar } from './theory.ts';

describe('Tonhöhen', () => {
  it('A4 = 440 Hz, Oktave verdoppelt', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(81)).toBeCloseTo(880);
  });

  it('Stufen in D-dorisch', () => {
    const d = 62;
    expect(degreeToMidi(d, MODES.dorisch, 1)).toBe(62); // D
    expect(degreeToMidi(d, MODES.dorisch, 3)).toBe(65); // F
    expect(degreeToMidi(d, MODES.dorisch, 6)).toBe(71); // H (dorische Sexte)
    expect(degreeToMidi(d, MODES.dorisch, 8)).toBe(74); // D eine Oktave höher
    expect(degreeToMidi(d, MODES.dorisch, 0)).toBe(60); // C darunter
  });

  it('leitereigene Dreiklänge', () => {
    // G-Dur, Stufe 5 = D-Dur: D Fis A
    const tones = [0, 1, 2].map((t) => chordTone(67, MODES.ionisch, 5, t));
    expect(tones).toEqual([74, 78, 81]);
  });
});

describe('Melodie-Kurzschrift', () => {
  it('liest Längen, Oktaven, Pausen und Vorzeichen', () => {
    const notes = parseBar("5_3 1' r 4#_2 7,");
    expect(notes.map((n) => n.degree)).toEqual([5, 8, null, 4, 0]);
    expect(notes.map((n) => n.step)).toEqual([0, 3, 4, 5, 7]);
    expect(notes[3].accidental).toBe(1);
    expect(barLength("5_3 1' r 4#_2 7,")).toBe(8);
  });

  it('lehnt Unsinn ab', () => {
    expect(() => parseBar('x_2')).toThrow();
  });
});
