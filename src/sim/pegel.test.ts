import { describe, expect, it } from 'vitest';
import { VALLEY } from '../data/maps/valley.ts';
import { PROJECT_BY_ID } from '../data/projects.ts';
import { describeForecast, eventWaterOffset, FORECAST_MAX, FORECAST_MIN, visibleForecasts } from './events.ts';
import { advance, newGame } from './game.ts';
import { day, type GameState } from './state.ts';
import { gaugeCount, litSegments, startProject } from './works.ts';

const isWeather = (k: string) => k === 'hochwasser' || k === 'duerre';

function build(s: GameState, ids: string[]): void {
  for (const id of ids) s.works.push({ id, started: 1, done: true });
}

/** Ein Jahr spielen und festhalten, wann Wetterlagen angekündigt werden und wann sie beginnen */
function runYear(seed: number, gauges: string[]) {
  const s = newGame(VALLEY, { startTown: 'oberau', seed });
  build(s, gauges);
  const announced = new Map<number, { day: number; from: number }>();
  const started = new Map<number, number>();
  const warnings: { day: number; text: string }[] = [];
  let offsetWhilePending = 0;
  for (let i = 0; i < 360; i++) {
    const before = new Set(s.news);
    advance(s, VALLEY, 24);
    const d = day(s);
    for (const e of s.forecast ?? []) if (!announced.has(e.id)) announced.set(e.id, { day: d, from: e.from });
    for (const e of s.events) if (isWeather(e.kind) && !started.has(e.id)) started.set(e.id, d);
    for (const n of s.news) if (!before.has(n) && n.text.includes('Pegelstation')) warnings.push({ day: n.day, text: n.text });
    if ((s.forecast ?? []).length && !s.events.some((e) => isWeather(e.kind))) offsetWhilePending += Math.abs(eventWaterOffset(s));
  }
  return { s, announced, started, warnings, offsetWhilePending };
}

describe('Pegelstationen und Vorwarnung (6.2)', () => {
  it('Hochwasser und Dürre beginnen 3 bis 5 Tage nach der Ankündigung', () => {
    const { announced, started } = runYear(7, []);
    expect(announced.size).toBeGreaterThan(1);
    for (const [id, a] of announced) {
      const lead = a.from - a.day;
      expect(lead).toBeGreaterThanOrEqual(FORECAST_MIN);
      expect(lead).toBeLessThanOrEqual(FORECAST_MAX);
      // spätestens am Jahresende hat die angekündigte Lage begonnen
      if (a.from < 360) expect(started.get(id)).toBe(a.from);
    }
  });

  it('Ohne Pegelstation gibt es keine Vorwarnung, die Vorhersage bleibt verborgen', () => {
    const { s, warnings } = runYear(7, []);
    expect(warnings).toHaveLength(0);
    expect(gaugeCount(s)).toBe(0);
    s.forecast = [{ id: 999, kind: 'hochwasser', from: day(s) + 3, until: day(s) + 8, value: 1 }];
    expect(visibleForecasts(s)).toHaveLength(0);
  });

  it('Mit Pegelstation meldet der Flussbote jede Wetterlage am Tag der Ankündigung', () => {
    const { announced, warnings } = runYear(7, ['pegel-oberau']);
    expect(warnings.length).toBe(announced.size);
    for (const a of announced.values()) expect(warnings.some((w) => w.day === a.day)).toBe(true);
    expect(warnings.every((w) => /in Kürze|in etwa \d+ bis \d+ Tagen/.test(w.text))).toBe(true);
  });

  it('Eine angekündigte Lage verändert den Pegel erst, wenn sie beginnt', () => {
    const { offsetWhilePending } = runYear(11, ['pegel-oberau']);
    expect(offsetWhilePending).toBe(0);
  });

  it('Zwei Stationen nennen genauen Tag und Pegel', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', seed: 3 });
    const e = { id: 1, kind: 'hochwasser' as const, from: day(s) + 4, until: day(s) + 9, value: 1.23 };
    build(s, ['pegel-oberau']);
    expect(describeForecast(s, e)).toBe('Hochwasser in etwa 3 bis 5 Tagen');
    build(s, ['pegel-erzbach']);
    expect(describeForecast(s, e)).toBe(`Hochwasser in 4 Tagen (ab Tag ${day(s) + 4}): etwa 1,2 m über normal, rund 6 Tage lang`);
    const dry = { id: 2, kind: 'duerre' as const, from: day(s) + 1, until: day(s) + 10, value: -0.55 };
    expect(describeForecast(s, dry)).toBe('Dürre ab morgen: der Fluss fällt um etwa 0,6 m, rund 10 Tage lang');
  });

  it('Pegelstation und Leuchtfeuer lassen sich im Wasserbauamt bauen', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', seed: 5 });
    s.money = 20000;
    for (const id of ['pegel-oberau', 'leuchtfeuer-muehl']) expect(startProject(s, id).ok).toBe(true);
    expect(gaugeCount(s)).toBe(0);
    expect(litSegments(s)).toEqual([]);
    advance(s, VALLEY, 24 * 12);
    expect(gaugeCount(s)).toBe(1);
    expect(litSegments(s)).toEqual([PROJECT_BY_ID.get('leuchtfeuer-muehl')!.seg]);
  });

  it('Alte Spielstände ohne Vorhersageliste laufen weiter', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', seed: 9 });
    delete s.forecast;
    build(s, ['pegel-oberau']);
    expect(() => advance(s, VALLEY, 24 * 120)).not.toThrow();
  });
});
