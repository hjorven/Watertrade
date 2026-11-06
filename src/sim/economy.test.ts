import { describe, expect, it } from 'vitest';
import { buyCost, price, sellRevenue, type MarketEntry } from './economy.ts';

const entry = (stock: number): MarketEntry => ({ good: 'holz', stock, target: 100 });

describe('price', () => {
  it('Grundpreis bei Zielbestand, teuer wenn knapp, billig wenn voll', () => {
    expect(price(10, 100, 100)).toBe(10);
    expect(price(10, 80, 100)).toBe(13);
    expect(price(10, 0, 100)).toBe(20);
    expect(price(10, 1000, 100)).toBe(5);
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
