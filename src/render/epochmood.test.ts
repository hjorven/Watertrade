import { describe, expect, it } from 'vitest';
import { easeEpoch, EPOCH_MOODS, moodAt } from './epochmood.ts';

describe('Farbstimmung je Epoche', () => {
  it('ganze Epochen ergeben genau ihre Stimmung, auch an den Rändern', () => {
    for (let e = 1; e <= 3; e++) {
      const m = moodAt(e);
      expect(m.saturation).toBeCloseTo(EPOCH_MOODS[e - 1].saturation);
      expect(m.sky.getHex()).toBe(EPOCH_MOODS[e - 1].sky.getHex());
    }
    expect(moodAt(0).saturation).toBeCloseTo(EPOCH_MOODS[0].saturation);
    expect(moodAt(9).saturation).toBeCloseTo(EPOCH_MOODS[2].saturation);
  });

  it('dazwischen wird gemischt', () => {
    const m = moodAt(1.5);
    expect(m.fog).toBeCloseTo((EPOCH_MOODS[0].fog + EPOCH_MOODS[1].fog) / 2);
  });

  it('Rauch macht dumpfer, Motorzeit kräftiger; Nebel bleibt weit genug für den größten Zoom', () => {
    expect(EPOCH_MOODS[1].saturation).toBeLessThan(EPOCH_MOODS[0].saturation);
    expect(EPOCH_MOODS[2].saturation).toBeGreaterThan(EPOCH_MOODS[0].saturation);
    for (const m of EPOCH_MOODS) expect(m.fog).toBeGreaterThanOrEqual(0.85);
  });

  it('Überblenden läuft in Schritten bis zum Ziel', () => {
    let e = 1;
    for (let i = 0; i < 100; i++) e = easeEpoch(e, 2, 0.1);
    expect(e).toBe(2);
    expect(easeEpoch(1, 2, 0.1)).toBeGreaterThan(1);
    expect(easeEpoch(3, 2, 0.1)).toBeLessThan(3);
  });
});
