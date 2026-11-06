import { describe, expect, it } from 'vitest';
import { dateText, dayInSeason, isIce, season, waterLevel, year, YEAR_DAYS } from './calendar.ts';

describe('Kalender', () => {
  it('Jahreszeiten und Jahre', () => {
    expect(season(1)).toBe('fruehling');
    expect(season(31)).toBe('sommer');
    expect(season(61)).toBe('herbst');
    expect(season(91)).toBe('winter');
    expect(season(121)).toBe('fruehling');
    expect(year(120)).toBe(1);
    expect(year(121)).toBe(2);
    expect(dayInSeason(32)).toBe(2);
    expect(dateText(1)).toBe('1. Frühling, Jahr 1');
  });

  it('Hochwasser im Frühling, Niedrigwasser im Sommer', () => {
    expect(waterLevel(13)).toBeGreaterThan(1);
    expect(waterLevel(51)).toBeLessThan(-0.5);
    expect(Math.abs(waterLevel(81))).toBeLessThan(0.4);
  });

  it('Wasserstand ist stetig, auch über den Jahreswechsel', () => {
    for (let d = 1; d < YEAR_DAYS * 3; d += 0.25) {
      expect(Math.abs(waterLevel(d + 0.25) - waterLevel(d))).toBeLessThan(0.3);
    }
  });

  it('Eis nur im Winter', () => {
    expect(isIce(100)).toBe(true);
    expect(isIce(50)).toBe(false);
    expect(isIce(220)).toBe(true);
  });
});
