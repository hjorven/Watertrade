import { describe, expect, it } from 'vitest';
import { MAP_M1 } from '../data/maps/m1.ts';
import { SHIPS } from '../data/ships.ts';
import { advance, buy, cargoLoad, day, depart, newGame, sell } from './game.ts';

const start = () => newGame(MAP_M1, SHIPS.treidelkahn, 'oberau');

describe('Spielablauf M1', () => {
  it('Holz talwärts bringen ist profitabel', () => {
    const s = start();
    const b = buy(s, 'holz', 20);
    expect(b.ok).toBe(true);

    const v = depart(s, MAP_M1, 'niedermuend')!;
    expect(v.downstream).toBe(true);
    const events = advance(s, v.hours);
    expect(events.some((e) => e.type === 'arrived')).toBe(true);
    expect(s.port).toBe('niedermuend');

    const r = sell(s, 'holz', 20);
    expect(r.profit!).toBeGreaterThan(0);
    expect(r.firstProfit).toBe(true);
    expect(s.money).toBeGreaterThan(300);
  });

  it('bergwärts dauert länger als talwärts', () => {
    const s = start();
    const down = depart(s, MAP_M1, 'niedermuend')!;
    advance(s, down.hours);
    const up = depart(s, MAP_M1, 'oberau')!;
    expect(up.downstream).toBe(false);
    expect(up.hours).toBeGreaterThan(down.hours * 2);
  });

  it('Laderaum und Geld begrenzen den Kauf', () => {
    const s = start();
    buy(s, 'holz', 1000);
    expect(cargoLoad(s)).toBeLessThanOrEqual(SHIPS.treidelkahn.capacity);
    expect(s.money).toBeGreaterThanOrEqual(0);
  });

  it('unterwegs kein Handel', () => {
    const s = start();
    depart(s, MAP_M1, 'niedermuend');
    expect(buy(s, 'holz', 1).ok).toBe(false);
  });

  it('Märkte erholen sich über die Tage', () => {
    const s = start();
    buy(s, 'holz', 40);
    const after = s.markets.oberau.holz.stock;
    const events = advance(s, 24 * 5);
    expect(events.filter((e) => e.type === 'newDay')).toHaveLength(5);
    expect(day(s)).toBe(6);
    expect(s.markets.oberau.holz.stock).toBeGreaterThan(after);
  });
});
