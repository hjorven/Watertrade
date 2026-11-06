import { describe, expect, it } from 'vitest';
import { buyCost, dailyTick, price, sellRevenue, type MarketEntry } from './economy.ts';

const entry = (stock: number): MarketEntry => ({ good: 'holz', stock, target: 100, rest: 100 });

describe('price', () => {
  it('Grundpreis bei Zielbestand, teuer wenn knapp, billig wenn voll', () => {
    expect(price(10, 100, 100)).toBe(10);
    expect(price(10, 50, 100)).toBe(20);
    expect(price(10, 0, 100)).toBe(30);
    expect(price(10, 1000, 100)).toBe(3);
  });
});

describe('Handel', () => {
  it('große Käufe werden teurer als viele Einzelpreise zum Startpreis', () => {
    expect(buyCost(10, entry(100), 40)).toBeGreaterThan(40 * price(10, 100, 100));
  });

  it('Kaufen und sofort Zurückverkaufen bringt nie Gewinn', () => {
    for (const stock of [5, 30, 100, 250]) {
      for (const n of [1, 10, 40]) {
        if (n > stock) continue;
        const m = entry(stock);
        const cost = buyCost(20, m, n);
        m.stock -= n;
        expect(sellRevenue(20, m, n)).toBeLessThan(cost);
      }
    }
  });
});

describe('dailyTick', () => {
  it('bewegt den Bestand Richtung Ruhebestand und erreicht ihn', () => {
    const m = { ...entry(20), rest: 100 };
    dailyTick(m);
    expect(m.stock).toBe(32);
    for (let i = 0; i < 100; i++) dailyTick(m);
    expect(m.stock).toBe(100);
  });

  it('funktioniert auch von oben', () => {
    const m = { ...entry(300), rest: 100 };
    for (let i = 0; i < 100; i++) dailyTick(m);
    expect(m.stock).toBe(100);
  });
});
