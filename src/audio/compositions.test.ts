import { describe, expect, it } from 'vitest';
import { COMPOSITIONS, MUSIC_MOODS, PERCUSSION } from './compositions.ts';
import { barInfo, flattenForm, inventBar, renderBar, secondsPerBar } from './sequencer.ts';
import { mulberry32 } from './rng.ts';
import { barLength } from './theory.ts';

describe('Kompositionen', () => {
  it('gibt es für alle vier Stimmungen', () => {
    expect(MUSIC_MOODS.sort()).toEqual(['epoche1', 'epoche2', 'epoche3', 'ruhig']);
  });

  for (const c of Object.values(COMPOSITIONS)) {
    describe(c.title, () => {
      it('jeder Melodietakt füllt genau einen Takt', () => {
        for (const [name, sec] of Object.entries(c.sections)) {
          if (sec.melody) expect(sec.melody.length, name).toBe(sec.chords.length);
          sec.melody?.forEach((bar, i) => expect(barLength(bar), `${name} Takt ${i + 1}: ${bar}`).toBe(c.stepsPerBar));
        }
      });

      it('Form verweist nur auf vorhandene Abschnitte, Begleitmuster bleiben im Takt', () => {
        expect(flattenForm(c).length).toBeGreaterThan(8);
        for (const p of c.parts) for (const n of p.notes) expect(n.s).toBeLessThan(c.stepsPerBar);
      });

      it('ein Durchlauf dauert zwischen 30 s und 2 min', () => {
        const sec = flattenForm(c).length * secondsPerBar(c);
        expect(sec).toBeGreaterThan(30);
        expect(sec).toBeLessThan(120);
      });

      it('Noten liegen im hörbaren, angenehmen Bereich und im Takt', () => {
        for (let bar = 0; bar < flattenForm(c).length * 4; bar++) {
          for (const e of renderBar(c, bar)) {
            expect(e.step).toBeGreaterThanOrEqual(0);
            expect(e.step).toBeLessThan(c.stepsPerBar);
            expect(e.len).toBeGreaterThan(0);
            expect(e.vel).toBeGreaterThan(0);
            expect(e.vel).toBeLessThanOrEqual(1.2);
            if (!PERCUSSION.includes(e.instrument)) {
              expect(e.midi).toBeGreaterThanOrEqual(28);
              expect(e.midi).toBeLessThanOrEqual(96);
            }
          }
        }
      });

      it('ist deterministisch und variiert zwischen Durchläufen', () => {
        const len = flattenForm(c).length;
        expect(renderBar(c, 3)).toEqual(renderBar(c, 3));
        const sig = (bar: number) => JSON.stringify(renderBar(c, bar).map((e) => [e.step, e.midi, e.instrument]));
        let differs = 0;
        for (let b = 0; b < len; b++) if (sig(b) !== sig(b + len)) differs++;
        expect(differs).toBeGreaterThan(0);
      });
    });
  }

  it('erste Durchlauf spielt die notierte Melodie', () => {
    const c = COMPOSITIONS.epoche1;
    const flute = renderBar(c, 0).filter((e) => e.instrument === 'floete');
    // 5_3 4 3_2 in D-dorisch eine Oktave höher: A5 G5 F5
    expect(flute.map((e) => e.midi)).toEqual([81, 79, 77]);
    expect(barInfo(c, 0).section).toBe('A');
  });

  it('erfundene Takte füllen den Takt und bleiben in der Tonleiter', () => {
    const c = COMPOSITIONS.ruhig;
    const rng = mulberry32(5);
    for (let i = 0; i < 200; i++) {
      const notes = inventBar(rng, c, 1 + (i % 6), 5);
      expect(notes.reduce((s, n) => s + n.len, 0)).toBe(c.stepsPerBar);
      for (const n of notes) if (n.degree !== null) expect(c.scale).toContain(((n.degree - 1) % 7) + 1);
    }
  });
});
