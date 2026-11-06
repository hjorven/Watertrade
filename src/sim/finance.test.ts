import { describe, expect, it } from 'vitest';
import { VALLEY } from '../data/maps/valley.ts';
import { SHIPS } from '../data/ships.ts';
import {
  BAN_DAYS,
  creditLeft,
  creditProblem,
  FLOOD_CHANCE,
  hasBank,
  hourRoll,
  ICE_CHANCE,
  LATE_FEE,
  loanAmounts,
  loanQuote,
  LOAN_TERMS,
  MAX_MISSED,
  payOverdueNow,
  payoffAmount,
  premiumPerHour,
  RATE_DAYS,
  repayLoan,
  reportDamage,
  sailFinance,
  setInsured,
  takeLoan,
  totalDebt,
} from './finance.ts';
import { advance, addShip, newGame, upgradeState, type GameState } from './game.ts';
import { playerWorth } from './house.ts';
import { goalProgress } from './goals.ts';
import { deserialize, SAVE_VERSION, serialize } from './save.ts';

const BANK = 'altenfurt';
const game = (money = 5000) => newGame(VALLEY, { startTown: BANK, money, rivals: false, seed: 3 });
const days = (s: GameState, n: number) => advance(s, VALLEY, n * 24);

describe('Stadtbank', () => {
  it('gibt es nur in größeren Städten', () => {
    const s = game();
    expect(hasBank(s, BANK)).toBe(true);
    expect(hasBank(s, 'erzgrube')).toBe(false);
    expect(creditProblem(s, 'erzgrube')).toMatch(/keine Bank/);
    expect(takeLoan(s, 'erzgrube', 1000, 30).ok).toBe(false);
  });

  it('zahlt aus, zieht Raten ein und rechnet die Schuld vom Vermögen ab', () => {
    const s = game();
    const worth = playerWorth(s);
    const r = takeLoan(s, BANK, 2500, 60);
    expect(r.ok).toBe(true);
    expect(s.money).toBe(7500);
    const q = loanQuote(2500, LOAN_TERMS[1]);
    expect(q.total).toBe(Math.round(2500 * 1.11));
    expect(totalDebt(s)).toBe(q.total);
    // die Schuld mit Zinsen steht gegen das geliehene Geld
    expect(playerWorth(s)).toBe(worth + 2500 - q.total);
    days(s, RATE_DAYS);
    expect(s.finance!.loans[0].remaining).toBe(q.total - q.installment);
    days(s, 60);
    expect(s.finance!.loans.length).toBe(0);
    expect(s.news.some((n) => n.text.includes('abbezahlt'))).toBe(true);
  });

  it('begrenzt den Kredit auf einen Teil des Vermögens', () => {
    const s = game(500);
    const left = creditLeft(s);
    expect(left).toBeGreaterThanOrEqual(1000);
    expect(loanAmounts(s).every((a) => a <= left)).toBe(true);
    expect(takeLoan(s, BANK, left + 500, 30).ok).toBe(false);
    expect(takeLoan(s, BANK, left, 30).ok).toBe(true);
    expect(creditLeft(s)).toBe(0);
  });

  it('erlässt bei vorzeitiger Tilgung einen Teil der Zinsen', () => {
    const s = game(30000);
    expect(takeLoan(s, BANK, 10000, 120).ok).toBe(true);
    const loan = s.finance!.loans[0];
    const pay = payoffAmount(s, loan);
    expect(pay).toBeLessThan(loan.remaining);
    expect(pay).toBeGreaterThan(10000);
    const before = s.money;
    expect(repayLoan(s, loan.id).ok).toBe(true);
    expect(before - s.money).toBe(pay);
    expect(totalDebt(s)).toBe(0);
  });

  it('mahnt bei leerer Kasse und pfändet nach drei verpassten Raten', () => {
    const s = game(1000);
    addShip(s, 'treidelkahn', BANK);
    takeLoan(s, BANK, 1000, 30);
    s.money = -50; // Kasse leer, etwa nach einem Hochwasser
    days(s, RATE_DAYS);
    const loan = s.finance!.loans[0];
    expect(loan.missed).toBe(1);
    const rate = loanQuote(1000, LOAN_TERMS[0]).installment;
    expect(loan.overdue).toBe(rate + Math.ceil(rate * LATE_FEE));
    expect(s.news[0].text).toMatch(/Rate verpasst/);
    expect(creditLeft(s)).toBe(0);
    s.money = -50;
    days(s, RATE_DAYS * (MAX_MISSED - 1));
    expect(s.finance!.loans.length).toBe(0);
    expect(s.ships.length).toBe(1); // ein Schiff gepfändet, das letzte bleibt
    expect(s.finance!.banUntil).toBeGreaterThanOrEqual(BAN_DAYS);
    expect(creditProblem(s, BANK)).toMatch(/Pfändung/);
    expect(s.news.some((n) => n.text.includes('gepfändet'))).toBe(true);
  });

  it('zieht einen Rückstand ein, sobald wieder Geld da ist', () => {
    const s = game(1000);
    takeLoan(s, BANK, 1000, 30);
    s.money = 0;
    days(s, RATE_DAYS);
    const loan = s.finance!.loans[0];
    expect(loan.overdue).toBeGreaterThan(0);
    s.money = 5000;
    days(s, 1);
    expect(loan.overdue).toBe(0);
    expect(loan.missed).toBe(0);
  });

  it('setzt die Mahnstufe zurück, wenn der Rückstand bezahlt ist', () => {
    const s = game(1000);
    addShip(s, 'treidelkahn', BANK);
    takeLoan(s, BANK, 1000, 120);
    for (let i = 0; i < MAX_MISSED + 1; i++) {
      s.money = 0;
      days(s, RATE_DAYS);
      expect(s.finance!.loans[0].missed).toBe(1);
      s.money = 5000;
      days(s, 1);
      expect(s.finance!.loans[0].missed).toBe(0);
      days(s, RATE_DAYS - 1);
    }
    expect(s.ships.length).toBe(2);
  });

  it('nimmt einen Rückstand von Hand an und zählt Schulden gegen das Geldziel', () => {
    const s = game(2000);
    takeLoan(s, BANK, 1000, 30);
    expect(goalProgress(s, { type: 'money', amount: 3000, text: '' }).value).toBeLessThan(3000);
    s.money = 0;
    days(s, RATE_DAYS);
    const loan = s.finance!.loans[0];
    expect(payOverdueNow(s, loan.id).ok).toBe(false);
    s.money = 1000;
    expect(payOverdueNow(s, loan.id).ok).toBe(true);
    expect(loan.overdue).toBe(0);
    expect(loan.missed).toBe(0);
  });

  it('übersteht Speichern und Laden', () => {
    const s = game();
    takeLoan(s, BANK, 2500, 30);
    s.ships[0].insured = true;
    const save = deserialize(serialize({ version: SAVE_VERSION, savedAt: '', mode: 'frei', completedGoals: [], state: s }))!;
    const t = upgradeState(save.state, VALLEY);
    expect(t.finance!.loans.length).toBe(1);
    expect(t.ships[0].insured).toBe(true);
  });
});

describe('Versicherung', () => {
  it('ersetzt gemeldete Schäden nur versicherten Schiffen', () => {
    const s = game();
    const ship = s.ships[0];
    expect(reportDamage(s, ship, 'grund', { condition: 0.04 })).toBe(0);
    setInsured(s, ship.id, true);
    const before = s.money;
    const pay = reportDamage(s, ship, 'grund', { condition: 0.04, cargoValue: 100 });
    expect(pay).toBe(Math.round(0.04 * SHIPS[ship.type].price * 0.5 + 100));
    expect(s.money).toBe(before + pay);
  });

  it('verlangt im Eis und Hochwasser mehr Prämie', () => {
    const s = game();
    const ship = s.ships[0];
    ship.cargo.holz = { amount: 40, cost: 800 };
    const calm = premiumPerHour(s, VALLEY, ship);
    s.ice = true;
    const ice = premiumPerHour(s, VALLEY, ship);
    s.ice = false;
    s.events.push({ id: 99, kind: 'hochwasser', from: 1, until: 9, value: 1 });
    const flood = premiumPerHour(s, VALLEY, ship);
    expect(calm).toBeGreaterThan(0);
    expect(ice).toBeGreaterThan(calm * 2);
    expect(flood).toBeGreaterThan(calm * 2);
  });

  it('Prämien decken auf Dauer die Schäden aus Eisgang und Hochwasser', () => {
    const s = game(100000);
    const ship = s.ships[0];
    setInsured(s, ship.id, true);
    s.ice = true;
    s.events.push({ id: 99, kind: 'hochwasser', from: 1, until: 100000, value: 0 });
    ship.voyage = { from: BANK, to: 'weidenhof', legs: [{ seg: 'alten-weiden', from: BANK, to: 'weidenhof', hours: 1e6, downstream: true }], hours: 1e6, elapsed: 0 };
    ship.port = null;
    const f = () => s.finance!;
    for (let h = 0; h < 20000; h++) {
      ship.condition = 1;
      ship.cargo = { holz: { amount: 40, cost: 800 } };
      sailFinance(s, VALLEY, ship, s.hour, 1);
      s.hour += 1;
    }
    // Schäden kommen vor, die Versicherung macht im Schnitt keinen Verlust, ist aber auch nicht teurer als das Doppelte
    expect(f().payoutsTotal).toBeGreaterThan(0);
    expect(f().premiumsTotal).toBeGreaterThan(f().payoutsTotal);
    expect(f().premiumsTotal).toBeLessThan(f().payoutsTotal * 2);
  });

  it('würfelt unabhängig vom gemeinsamen Zufallsstrom und gleichmäßig', () => {
    const s = game();
    const ship = s.ships[0];
    let ice = 0;
    let flood = 0;
    for (let h = 0; h < 50000; h++) {
      if (hourRoll(ship, h, 1) < ICE_CHANCE) ice++;
      if (hourRoll(ship, h, 5) < FLOOD_CHANCE) flood++;
    }
    expect(ice / 50000).toBeGreaterThan(ICE_CHANCE * 0.8);
    expect(ice / 50000).toBeLessThan(ICE_CHANCE * 1.2);
    expect(flood / 50000).toBeGreaterThan(FLOOD_CHANCE * 0.7);
    expect(flood / 50000).toBeLessThan(FLOOD_CHANCE * 1.3);
    const rng = s.rng;
    sailFinance(s, VALLEY, ship, 0, 5);
    expect(s.rng).toBe(rng);
  });
});
