import type { MapDef } from '../data/maps/valley.ts';
import { BUILDING_BY_ID } from '../data/buildings.ts';
import { GOOD_BY_ID } from '../data/goods.ts';
import { SHIPS } from '../data/ships.ts';
import { playerWorth } from './house.ts';
import { segmentDepth } from './river.ts';
import { TIGHT_DEPTH, voyagePosition } from './voyage.ts';
import { effectiveSegments } from './works.ts';
import { addNews, day, effectiveDraft, fail, hasUpgrade, shipClass, type GameState, type NewsItem, type Ship, type TradeResult } from './state.ts';

/*
 * Stadtbank und Flussversicherung (Ausbauplan 6.1 und 6.3).
 *
 * Kredite: In größeren Städten leiht die Bank Geld gegen Zinsen. Alle zehn Tage wird eine Rate
 * fällig und automatisch aus der Kasse bezahlt. Reicht das Geld nicht, mahnt die Bank mit Gebühr;
 * nach drei verpassten Raten kündigt sie und pfändet Kasse, Betriebe und Schiffe.
 *
 * Versicherung: Ein versichertes Schiff zahlt während der Fahrt eine Prämie je Stunde, die mit
 * dem Risiko steigt (Eis, Hochwasser, knappe Tiefe). Dafür ersetzt die Versicherung Schäden durch
 * Eisgang, Grundberührung und verlorene Ladung.
 */

export interface Loan {
  id: number;
  /** ausgezahlter Betrag */
  principal: number;
  /** Zins für die ganze Laufzeit, 0.1 = 10 % */
  rate: number;
  /** Laufzeit in Tagen */
  term: number;
  /** Tag der Auszahlung */
  taken: number;
  /** Höhe einer Rate */
  installment: number;
  /** noch zu zahlen, mit Zinsen und Gebühren */
  remaining: number;
  /** fällig, aber noch nicht bezahlt */
  overdue: number;
  /** Tag der nächsten Rate */
  due: number;
  /** verpasste Raten (Mahnstufe) */
  missed: number;
}

export interface FinanceLedger {
  day: number;
  /** gestern an die Bank gezahlt */
  repaid: number;
  /** gestern gezahlte Versicherungsprämien */
  premiums: number;
  /** gestern ausgezahlte Schäden */
  payouts: number;
}

export interface Finance {
  loans: Loan[];
  /** bis zu diesem Tag leiht die Bank nichts (nach einer Pfändung) */
  banUntil: number;
  /** laufende Summen seit Mitternacht */
  repaidToday: number;
  premiumsToday: number;
  payoutsToday: number;
  ledger: FinanceLedger;
  /** Summen seit Spielbeginn */
  premiumsTotal: number;
  payoutsTotal: number;
}

/* ---------- Werte ---------- */

/** Ab dieser Einwohnerzahl hat eine Stadt eine Bank */
export const BANK_POPULATION = 700;
/** Abstand zwischen zwei Raten in Tagen */
export const RATE_DAYS = 10;
/** Mahngebühr auf den offenen Betrag einer verpassten Rate */
export const LATE_FEE = 0.1;
/** Nach so vielen verpassten Raten kündigt die Bank und pfändet */
export const MAX_MISSED = 3;
/** So lange leiht die Bank nach einer Pfändung nichts mehr */
export const BAN_DAYS = 180;
/** Höchstens so viele Kredite gleichzeitig */
export const MAX_LOANS = 3;
/** Kreditrahmen: Anteil am Vermögen, mindestens und höchstens */
export const CREDIT_SHARE = 0.5;
export const CREDIT_MIN = 1000;
export const CREDIT_MAX = 60000;
/** Bei vorzeitiger Tilgung erlässt die Bank diesen Anteil der noch nicht verdienten Zinsen */
export const EARLY_REBATE = 0.5;

export interface LoanTerm {
  days: number;
  rate: number;
  name: string;
}

/** Laufzeiten mit Zins für die ganze Laufzeit */
export const LOAN_TERMS: LoanTerm[] = [
  { days: 30, rate: 0.05, name: 'Kurzer Kredit' },
  { days: 60, rate: 0.11, name: 'Saisonkredit' },
  { days: 120, rate: 0.24, name: 'Langer Kredit' },
];

export const LOAN_AMOUNTS = [1000, 2500, 5000, 10000, 25000, 50000];

/** Gefahren, gegen die die Versicherung zahlt */
export type Peril = 'ladung' | 'grund' | 'eis';

export const PERIL_NAME: Record<Peril, string> = { ladung: 'Ladungsverlust', grund: 'Grundberührung', eis: 'Eisgang' };

/** Chance je Fahrstunde auf Eisgang, solange Treibeis auf dem Fluss ist */
export const ICE_CHANCE = 0.012;
/** Zustand, den ein Eisstoß kostet: zwischen ICE_DAMAGE und dem Doppelten */
export const ICE_DAMAGE = 0.04;
/** Chance, dass beim Eisstoß auch Ladung über Bord geht */
export const ICE_CARGO_CHANCE = 0.4;
/** Chance je Fahrstunde im Hochwasser, dass Ladung über Bord geht */
export const FLOOD_CHANCE = 0.005;
/** Geschätzte Chance je Stunde auf Grundberührung in knappem Wasser (für die Prämie) */
export const GROUND_RISK = 0.02;
/** Geschätzter Zustandsverlust einer Grundberührung (für die Prämie) */
export const GROUND_DAMAGE = 0.03;
/** Aufschlag der Versicherung auf den erwarteten Schaden */
export const PREMIUM_LOADING = 1.3;
/** Grundprämie je Fahrstunde: Anteil am Schiffspreis und am Ladungswert */
export const PREMIUM_HULL_BASE = 0.00003;
export const PREMIUM_CARGO_BASE = 0.0001;

/* ---------- Zustand ---------- */

export function newFinance(): Finance {
  return {
    loans: [],
    banUntil: 0,
    repaidToday: 0,
    premiumsToday: 0,
    payoutsToday: 0,
    ledger: { day: 0, repaid: 0, premiums: 0, payouts: 0 },
    premiumsTotal: 0,
    payoutsTotal: 0,
  };
}

export function finance(state: GameState): Finance {
  return (state.finance ??= newFinance());
}

/** Gesamte Restschuld bei der Bank */
export function totalDebt(state: GameState): number {
  return (state.finance?.loans ?? []).reduce((s, l) => s + l.remaining, 0);
}

export function hasBank(state: GameState, town: string): boolean {
  return (state.towns[town]?.population ?? 0) >= BANK_POPULATION;
}

export function bankTowns(state: GameState, map: MapDef): string[] {
  return map.towns.filter((t) => hasBank(state, t.id)).map((t) => t.id);
}

/** Kreditrahmen insgesamt: ein Teil des Vermögens nach Abzug der Schulden, damit geliehenes Geld den Rahmen nicht aufbläht */
export function creditLine(state: GameState): number {
  const line = Math.floor((Math.max(0, playerWorth(state)) * CREDIT_SHARE) / 500) * 500;
  return Math.min(CREDIT_MAX, Math.max(CREDIT_MIN, line));
}

/** Was die Bank jetzt noch leiht, 0 wenn gesperrt */
export function creditLeft(state: GameState): number {
  const f = state.finance;
  if (f && (f.banUntil > day(state) || f.loans.some((l) => l.overdue > 0) || f.loans.length >= MAX_LOANS)) return 0;
  return Math.max(0, creditLine(state) - totalDebt(state));
}

/** Warum die Bank gerade nichts leiht, oder null */
export function creditProblem(state: GameState, town: string): string | null {
  const f = state.finance;
  if (!hasBank(state, town)) return 'Hier gibt es keine Bank.';
  if (f && f.banUntil > day(state)) return `Nach der Pfändung leiht dir die Bank bis Tag ${f.banUntil} nichts.`;
  if (f?.loans.some((l) => l.overdue > 0)) return 'Erst die offene Rate bezahlen.';
  if (f && f.loans.length >= MAX_LOANS) return `Mehr als ${MAX_LOANS} Kredite gleichzeitig gibt die Bank nicht.`;
  if (creditLeft(state) < LOAN_AMOUNTS[0]) return 'Dein Kreditrahmen ist ausgeschöpft.';
  return null;
}

/** Beträge, die die Bank gerade anbietet */
export function loanAmounts(state: GameState): number[] {
  const left = creditLeft(state);
  const list = LOAN_AMOUNTS.filter((a) => a <= left);
  const top = Math.floor(left / 500) * 500;
  if (top >= LOAN_AMOUNTS[0] && !list.includes(top)) list.push(top);
  return list.slice(-4);
}

/** Rückzahlung insgesamt und Rate für einen Kredit */
export function loanQuote(amount: number, term: LoanTerm): { total: number; installment: number; count: number } {
  const total = Math.round(amount * (1 + term.rate));
  const count = Math.max(1, Math.round(term.days / RATE_DAYS));
  return { total, installment: Math.ceil(total / count), count };
}

export function takeLoan(state: GameState, town: string, amount: number, days: number): TradeResult {
  const term = LOAN_TERMS.find((t) => t.days === days);
  if (!term) return fail('Diese Laufzeit bietet die Bank nicht an.');
  const problem = creditProblem(state, town);
  if (problem) return fail(problem);
  if (!Number.isFinite(amount) || amount < LOAN_AMOUNTS[0]) return fail(`Die Bank leiht ab ${LOAN_AMOUNTS[0]} Taler.`);
  if (amount > creditLeft(state)) return fail(`Die Bank leiht dir höchstens ${creditLeft(state)} Taler.`);
  const f = finance(state);
  const q = loanQuote(amount, term);
  const d = day(state);
  f.loans.push({
    id: state.nextId++,
    principal: amount,
    rate: term.rate,
    term: term.days,
    taken: d,
    installment: q.installment,
    remaining: q.total,
    overdue: 0,
    due: d + RATE_DAYS,
    missed: 0,
  });
  state.money += amount;
  return {
    ok: true,
    message: `${amount} Taler geliehen. ${q.count} Raten zu ${q.installment} Taler, die erste an Tag ${d + RATE_DAYS}.`,
    amount: 0,
    taler: amount,
  };
}

/** Betrag, mit dem ein Kredit heute ganz getilgt wäre */
export function payoffAmount(state: GameState, loan: Loan): number {
  const interest = loan.principal * loan.rate;
  const left = Math.max(0, loan.taken + loan.term - day(state));
  const rebate = Math.floor(EARLY_REBATE * interest * Math.min(1, left / loan.term));
  return Math.max(0, loan.remaining - Math.min(rebate, Math.max(0, loan.remaining - loan.overdue)));
}

export function repayLoan(state: GameState, id: number): TradeResult {
  const f = finance(state);
  const loan = f.loans.find((l) => l.id === id);
  if (!loan) return fail('Diesen Kredit gibt es nicht.');
  const pay = payoffAmount(state, loan);
  if (state.money < pay) return fail(`Zum Tilgen fehlen ${Math.ceil(pay - state.money)} Taler.`);
  state.money -= pay;
  f.repaidToday += pay;
  f.loans = f.loans.filter((l) => l !== loan);
  return { ok: true, message: `Kredit getilgt, ${pay} Taler an die Bank.`, amount: 0, taler: pay };
}

/** Offene Rate bezahlen, soweit die Kasse reicht. Gibt den gezahlten Betrag zurück. */
function payOverdue(state: GameState, f: Finance, loan: Loan, partial: boolean): number {
  if (loan.overdue <= 0) return 0;
  const pay = partial ? Math.min(loan.overdue, Math.max(0, Math.floor(state.money))) : state.money >= loan.overdue ? loan.overdue : 0;
  if (pay <= 0) return 0;
  state.money -= pay;
  loan.overdue -= pay;
  loan.remaining -= pay;
  f.repaidToday += pay;
  return pay;
}

/** Offene Rate von Hand begleichen (Bankreiter) */
export function payOverdueNow(state: GameState, id: number): TradeResult {
  const f = finance(state);
  const loan = f.loans.find((l) => l.id === id);
  if (!loan || loan.overdue <= 0) return fail('Hier ist nichts offen.');
  const owed = loan.overdue;
  if (state.money < owed) return fail(`Die offene Rate beträgt ${owed} Taler.`);
  payOverdue(state, f, loan, false);
  if (loan.remaining <= 0.5) f.loans = f.loans.filter((l) => l !== loan);
  return { ok: true, message: `Rückstand von ${owed} Taler beglichen.`, amount: 0, taler: owed };
}

/** Wert, den die Bank bei einer Pfändung für ein Schiff anrechnet (Versteigerung) */
export function seizeValue(ship: Ship): number {
  const cargo = Object.values(ship.cargo).reduce((s, c) => s + c.cost, 0);
  return Math.round(SHIPS[ship.type].price * 0.35 * (0.5 + 0.5 * ship.condition) + cargo * 0.5);
}

/** Bank kündigt den Kredit und holt sich die ganze Restschuld */
function seize(state: GameState, map: MapDef, f: Finance, loan: Loan): string {
  let debt = loan.remaining;
  const taken: string[] = [];
  const cash = Math.min(debt, Math.max(0, Math.floor(state.money)));
  if (cash > 0) {
    state.money -= cash;
    debt -= cash;
    taken.push(`${cash} Taler aus der Kasse`);
  }
  // Betriebe zum halben Preis, die teuersten zuerst
  const betriebe = [...state.betriebe].sort((a, b) => (BUILDING_BY_ID.get(b.type)?.price ?? 0) - (BUILDING_BY_ID.get(a.type)?.price ?? 0));
  for (const b of betriebe) {
    if (debt <= 0) break;
    const t = BUILDING_BY_ID.get(b.type);
    const value = Math.round((t?.price ?? 0) * 0.5);
    state.betriebe = state.betriebe.filter((x) => x !== b);
    debt -= value;
    taken.push(`${t?.name ?? 'Betrieb'} in ${map.towns.find((x) => x.id === b.town)?.name ?? b.town}`);
  }
  // Schiffe im Hafen, das letzte Schiff bleibt; erst die ohne Ladung, dann die wertvollsten
  const ships = state.ships
    .filter((s) => s.port && !s.voyage)
    .sort((a, b) => Object.keys(a.cargo).length - Object.keys(b.cargo).length || seizeValue(b) - seizeValue(a));
  for (const s of ships) {
    if (debt <= 0 || state.ships.length <= 1) break;
    state.ships = state.ships.filter((x) => x !== s);
    debt -= seizeValue(s);
    taken.push(`das Schiff ${s.name}`);
  }
  if (debt > 0) {
    // Rest bleibt als Minus in der Kasse stehen
    state.money -= debt;
    taken.push(`${Math.round(debt)} Taler Schulden in der Kasse`);
  } else if (debt < 0) {
    // Überschuss aus der Versteigerung geht zurück
    state.money += -debt;
  }
  f.loans = f.loans.filter((l) => l !== loan);
  f.banUntil = day(state) + BAN_DAYS;
  return taken.join(', ');
}

/** Ein Tag bei der Bank: Raten einziehen, mahnen, pfänden. Gibt neue Nachrichten zurück. */
export function tickFinance(state: GameState, map: MapDef): NewsItem[] {
  const f = state.finance;
  if (!f) return [];
  const news: NewsItem[] = [];
  const d = day(state);
  for (const loan of [...f.loans]) {
    // alte Rückstände zuerst, sobald wieder Geld da ist
    if (loan.overdue > 0 && loan.due > d) {
      const owed = loan.overdue;
      if (payOverdue(state, f, loan, false) > 0) news.push(addNews(state, 'haus', `Die Stadtbank hat den Rückstand von ${owed} Taler eingezogen.`));
    }
    if (d >= loan.due) {
      loan.overdue += Math.min(loan.installment, Math.max(0, loan.remaining - loan.overdue));
      loan.due += RATE_DAYS;
      payOverdue(state, f, loan, true);
      if (loan.overdue > 0.5) {
        const fee = Math.ceil(loan.overdue * LATE_FEE);
        loan.overdue += fee;
        loan.remaining += fee;
        loan.missed++;
        if (loan.missed >= MAX_MISSED) {
          const what = seize(state, map, f, loan);
          news.push(addNews(state, 'haus', `Die Stadtbank hat den Kredit gekündigt und gepfändet: ${what}. Bis Tag ${f.banUntil} leiht sie dir nichts mehr.`));
          continue;
        }
        news.push(
          addNews(
            state,
            'haus',
            `Rate verpasst! Die Stadtbank verlangt ${Math.ceil(loan.overdue)} Taler samt ${fee} Taler Mahngebühr. Mahnung ${loan.missed} von ${MAX_MISSED - 1}, danach wird gepfändet.`,
          ),
        );
      }
    }
    if (loan.remaining <= 0.5 && loan.overdue <= 0.5) {
      f.loans = f.loans.filter((l) => l !== loan);
      news.push(addNews(state, 'haus', `Der Kredit über ${loan.principal} Taler ist abbezahlt.`));
    }
  }
  return news;
}

/** Tageszahlen der Bank und Versicherung festhalten (einmal um Mitternacht) */
export function closeFinanceDay(state: GameState): void {
  const f = state.finance;
  if (!f) return;
  f.ledger = { day: day(state), repaid: Math.round(f.repaidToday), premiums: Math.round(f.premiumsToday), payouts: Math.round(f.payoutsToday) };
  f.repaidToday = 0;
  f.premiumsToday = 0;
  f.payoutsToday = 0;
}

/* ---------- Versicherung ---------- */

const goodName = (g: string) => GOOD_BY_ID.get(g)?.name ?? g;

export function cargoCost(ship: Ship): number {
  return Object.values(ship.cargo).reduce((s, c) => s + c.cost, 0);
}

/** Schaden am Rumpf in Talern, gerechnet wie die Reparatur in der Werft */
export function hullDamageValue(ship: Ship, condition: number): number {
  return condition * shipClass(ship).price * 0.5;
}

/** Wie stark Schäden am Rumpf ausfallen: Kupferbeschlag und vorsichtiger Kapitän mildern */
function hullFactor(ship: Ship): number {
  if (ship.type === 'floss') return 0;
  let f = 1;
  if (hasUpgrade(ship, 'beschlag')) f *= 0.6;
  if (ship.captain?.trait === 'vorsichtig') f *= 0.5;
  return f;
}

function floodActive(state: GameState): boolean {
  const d = day(state);
  return state.events.some((e) => e.kind === 'hochwasser' && e.from <= d && e.until >= d);
}

/** Liegt das Schiff gerade knapp über Grund (weniger als 20 cm Wasser unter dem Kiel)? */
function tightWater(state: GameState, map: MapDef, ship: Ship): boolean {
  if (!ship.voyage) return false;
  const { leg } = voyagePosition(ship.voyage);
  const seg = effectiveSegments(state, map).find((s) => s.id === leg.seg);
  return !!seg && segmentDepth(seg, state.waterLevel) - effectiveDraft(ship) < TIGHT_DEPTH;
}

/** Prämie je Fahrstunde bei der aktuellen Lage (im Hafen ohne die Gefahr knapper Tiefe) */
export function premiumPerHour(state: GameState, map: MapDef, ship: Ship): number {
  const price = shipClass(ship).price;
  const cargo = cargoCost(ship);
  const hull = price * 0.5 * hullFactor(ship);
  let expected = 0;
  if (state.ice) expected += ICE_CHANCE * (hull * ICE_DAMAGE * 1.5 + cargo * ICE_CARGO_CHANCE * 0.175);
  if (floodActive(state)) expected += FLOOD_CHANCE * cargo * 0.2;
  if (tightWater(state, map, ship)) expected += GROUND_RISK * hull * GROUND_DAMAGE;
  return PREMIUM_LOADING * expected + PREMIUM_HULL_BASE * price + PREMIUM_CARGO_BASE * cargo;
}

export function setInsured(state: GameState, shipId: number, on: boolean): TradeResult {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return fail('Unbekanntes Schiff.');
  if (on && !ship.port) return fail('Versichern geht nur im Hafen.');
  ship.insured = on;
  finance(state);
  return {
    ok: true,
    message: on ? `${ship.name} ist versichert. Die Prämie wird während der Fahrt fällig.` : `Die Versicherung für ${ship.name} ist gekündigt.`,
    amount: 0,
    taler: 0,
  };
}

/**
 * Einen Schaden melden, direkt nachdem er eingetreten ist. Ist das Schiff versichert, wird erstattet:
 * `condition` ist der verlorene Zustand (0.03 = 3 %), `cargoValue` der Einkaufswert verlorener Ladung.
 * Gibt die Auszahlung zurück, 0 ohne Versicherung.
 */
export function reportDamage(state: GameState, ship: Ship, peril: Peril, damage: { condition?: number; cargoValue?: number }): number {
  if (!ship.insured) return 0;
  const pay = Math.round(hullDamageValue(ship, Math.max(0, damage.condition ?? 0)) + Math.max(0, damage.cargoValue ?? 0));
  if (pay <= 0) return 0;
  const f = finance(state);
  state.money += pay;
  f.payoutsToday += pay;
  f.payoutsTotal += pay;
  addNews(state, 'haus', `Die Flussversicherung ersetzt ${pay} Taler für ${PERIL_NAME[peril]} der ${ship.name}.`);
  return pay;
}

/** Zufall je Schiff und Spielstunde, unabhängig vom gemeinsamen Zufallsstrom */
export function hourRoll(ship: Ship, hour: number, salt: number): number {
  let h = Math.imul(ship.id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(hour | 0, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Ein Teil der wertvollsten Ladung geht über Bord. Gibt Ware, Menge und Einkaufswert zurück. */
function loseCargo(ship: Ship, share: number): { good: string; amount: number; value: number } | null {
  const entries = Object.entries(ship.cargo).filter(([, c]) => c.amount >= 1);
  if (!entries.length) return null;
  const [good, slot] = entries.sort((a, b) => b[1].cost - a[1].cost)[0];
  const amount = Math.max(1, Math.round(slot.amount * share));
  const value = (slot.cost * amount) / slot.amount;
  slot.amount -= amount;
  slot.cost -= value;
  if (slot.amount < 0.001) delete ship.cargo[good];
  return { good, amount, value };
}

/**
 * Gefahren während einer Fahrstunde: Eisgang und Ladungsverlust im Hochwasser.
 * `hour` ist die ganze Spielstunde, in der gewürfelt wird.
 */
function perilsAt(state: GameState, ship: Ship, hour: number): void {
  if (state.ice && hourRoll(ship, hour, 1) < ICE_CHANCE) {
    const hit = ICE_DAMAGE * (1 + hourRoll(ship, hour, 2)) * hullFactor(ship);
    const before = ship.condition;
    ship.condition = Math.max(0, ship.condition - hit);
    const lost = hourRoll(ship, hour, 3) < ICE_CARGO_CHANCE ? loseCargo(ship, 0.1 + 0.15 * hourRoll(ship, hour, 4)) : null;
    const parts = [];
    if (before - ship.condition > 0) parts.push(`Rumpf beschädigt (${Math.round((before - ship.condition) * 100)} % Zustand)`);
    if (lost) parts.push(`${lost.amount} t ${goodName(lost.good)} verloren`);
    if (parts.length) {
      addNews(state, 'haus', `Eisgang! Treibeis rammt die ${ship.name}: ${parts.join(', ')}.`);
      reportDamage(state, ship, 'eis', { condition: before - ship.condition, cargoValue: lost?.value ?? 0 });
    }
  }
  if (floodActive(state) && hourRoll(ship, hour, 5) < FLOOD_CHANCE) {
    const lost = loseCargo(ship, 0.1 + 0.2 * hourRoll(ship, hour, 6));
    if (lost) {
      addNews(state, 'haus', `Im Hochwasser geht auf der ${ship.name} Ladung über Bord: ${lost.amount} t ${goodName(lost.good)}.`);
      reportDamage(state, ship, 'ladung', { cargoValue: lost.value });
    }
  }
}

/**
 * Eine Fahrstrecke von `dt` Stunden ab Spielstunde `from`: Prämie zahlen und je angefangener
 * voller Stunde die Gefahren würfeln. Wird für jedes fahrende Schiff aufgerufen.
 */
export function sailFinance(state: GameState, map: MapDef, ship: Ship, from: number, dt: number): void {
  if (dt <= 0) return;
  if (ship.insured) {
    const premium = premiumPerHour(state, map, ship) * dt;
    const f = finance(state);
    state.money -= premium;
    f.premiumsToday += premium;
    f.premiumsTotal += premium;
  }
  for (let h = Math.floor(from) + 1; h <= from + dt; h++) perilsAt(state, ship, h);
}
