import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../data/campaign.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { newGame, upgradeState, type GameState } from './game.ts';
import { goalProgress } from './goals.ts';
import { playerWorth } from './house.ts';
import {
  ANGER_REFUSE,
  BANKRUPT_DAYS,
  buyShares,
  canOfferPact,
  endPact,
  findRival,
  houseAvoids,
  LOT_MIN,
  nextBid,
  offerPact,
  PACT_DAYS,
  PACT_TOLERANCE,
  pactPenalty,
  placeBid,
  buyHouse,
  takeoverCost,
  sharePrice,
  sharesWorth,
  tickRivalry,
} from './rivalry.ts';
import { rivalWorth } from './rivals.ts';
import { day } from './state.ts';

function game(): GameState {
  return newGame(VALLEY, { startTown: 'oberau', money: 200_000, rivals: true, seed: 7 });
}

/** Verkäufe des Spielers nachbilden: genau das, was trade.ts in stats.delivered schreibt */
function sold(state: GameState, town: string, good: string, tons: number): void {
  const d = (state.stats.delivered[town] ??= {});
  d[good] = (d[good] ?? 0) + tons;
}

/** Einen Tag weiter, nur die Hausdiplomatie */
function nextDay(state: GameState): ReturnType<typeof tickRivalry> {
  state.hour += 24;
  return tickRivalry(state, VALLEY);
}

describe('KI-Häuser reagieren auf den Spieler', () => {
  it('wer viel im Revier verkauft, wird unterboten', () => {
    const s = game();
    const r = findRival(s, 'steinbrueck')!;
    r.money = 20_000;
    nextDay(s); // Ausgangsstand merken
    const stockBefore = s.markets.niedermuend.moebel.stock;
    let started = false;
    for (let i = 0; i < 10 && !started; i++) {
      sold(s, 'niedermuend', 'moebel', 20);
      const news = nextDay(s);
      started = news.some((n) => n.text.includes('Steinbrück') && n.text.includes('Niedermünd'));
    }
    expect(started).toBe(true);
    expect(r.retaliation?.kind).toBe('unterbieten');
    expect(r.retaliation?.town).toBe('niedermuend');
    expect(s.markets.niedermuend.moebel.stock).toBeGreaterThan(stockBefore);
  });

  it('sehr verärgerte Häuser kaufen die Lieferstadt leer', () => {
    const s = game();
    const r = findRival(s, 'steinbrueck')!;
    r.money = 50_000;
    nextDay(s);
    r.anger = 90;
    sold(s, 'niedermuend', 'holz', 200);
    const before = s.markets.oberau.holz.stock;
    nextDay(s);
    expect(r.retaliation?.kind).toBe('leerkaufen');
    expect(r.retaliation?.town).toBe('oberau'); // dort wächst das Holz
    expect(s.markets.oberau.holz.stock).toBeLessThan(before);
  });

  it('Vergeltung kostet nie mehr als ein kleiner Teil der Rücklagen', () => {
    const s = game();
    const r = findRival(s, 'nordstrom')!;
    r.money = 6000;
    nextDay(s);
    r.anger = 95;
    sold(s, 'niedermuend', 'werkzeug', 100);
    let before = r.money;
    for (let i = 0; i < 30; i++) {
      nextDay(s);
      if (i === 0) expect(r.retaliation?.kind).toBe('leerkaufen'); // sie läuft wirklich
      // Tagesbudget: 3 % über der Reserve (Schiffsunterhalt läuft hier nicht mit)
      expect(before - r.money).toBeLessThanOrEqual(Math.max(0, (before - 1500) * 0.03) + 1);
      before = r.money;
    }
    expect(r.money).toBeGreaterThan(1400);
  });

  it('Ärger verfliegt, wenn man das Revier in Ruhe lässt', () => {
    const s = game();
    const r = findRival(s, 'ahlers')!;
    r.anger = 30;
    for (let i = 0; i < 12; i++) nextDay(s);
    expect(r.anger).toBe(0);
  });
});

describe('Gebietsabkommen', () => {
  it('prüft Revier, Kerngeschäft und Laune', () => {
    const s = game();
    expect(canOfferPact(s, 'steinbrueck', 'salz', 'fisch')).toContain('nicht zum Revier');
    expect(canOfferPact(s, 'steinbrueck', 'holz', 'bretter')).toContain('Kerngeschäft');
    findRival(s, 'steinbrueck')!.anger = ANGER_REFUSE;
    expect(canOfferPact(s, 'steinbrueck', 'holz', 'salz')).toContain('verärgert');
    findRival(s, 'steinbrueck')!.anger = 0;
    expect(canOfferPact(s, 'steinbrueck', 'holz', 'salz')).toBeNull();
  });

  it('das Haus lässt die zugesagte Ware liegen, und das Abkommen läuft aus', () => {
    const s = game();
    const res = offerPact(s, VALLEY, 'steinbrueck', 'holz', 'salz');
    expect(res.ok).toBe(true);
    expect(houseAvoids(s, 'steinbrueck', 'salz')).toBe(true);
    expect(houseAvoids(s, 'kessler', 'salz')).toBe(false);
    expect(offerPact(s, VALLEY, 'steinbrueck', 'bretter', 'fisch').ok).toBe(false); // nur eines je Haus
    for (let i = 0; i < PACT_DAYS; i++) nextDay(s);
    expect(s.pacts).toHaveLength(0);
    expect(houseAvoids(s, 'steinbrueck', 'salz')).toBe(false);
  });

  it('Restposten sind erlaubt, Vertragsbruch kostet Strafe und Vertrauen', () => {
    const s = game();
    findRival(s, 'steinbrueck')!.money = 20_000;
    offerPact(s, VALLEY, 'steinbrueck', 'holz', 'salz');
    sold(s, 'niedermuend', 'holz', PACT_TOLERANCE);
    nextDay(s);
    expect(s.pacts).toHaveLength(1);
    const money = s.money;
    sold(s, 'niedermuend', 'holz', 5);
    const news = nextDay(s);
    expect(news.some((n) => n.text.startsWith('Vertragsbruch'))).toBe(true);
    expect(s.pacts).toHaveLength(0);
    expect(s.money).toBe(money - pactPenalty(s));
    expect(findRival(s, 'steinbrueck')!.retaliation?.kind).toBe('leerkaufen');
    // danach schließt auch kein anderes Haus ein Abkommen
    expect(canOfferPact(s, 'ahlers', 'salz', 'holz')).toContain('Vertragsbruch');
  });

  it('ein Haus in Geldnot kann selbst brechen und zahlt dann Strafe', () => {
    const s = game();
    offerPact(s, VALLEY, 'kessler', 'getreide', 'holz');
    const r = findRival(s, 'kessler')!;
    const money = s.money;
    let broken = false;
    for (let i = 0; i < 100 && !broken; i++) {
      r.money = -100;
      r.debtDays = 0;
      broken = nextDay(s).some((n) => n.text.includes('bricht das Abkommen'));
    }
    expect(broken).toBe(true);
    expect(s.money).toBe(money + pactPenalty(s));
  });

  it('kündigen ist kein Bruch, aber man kann nicht sofort neu verhandeln', () => {
    const s = game();
    offerPact(s, VALLEY, 'ahlers', 'fisch', 'holz');
    expect(endPact(s, 'ahlers').ok).toBe(true);
    expect(s.pacts).toHaveLength(0);
    expect(s.pactBanUntil).toBeUndefined();
    expect(offerPact(s, VALLEY, 'ahlers', 'fisch', 'holz').ok).toBe(false);
    for (let i = 0; i < 31; i++) nextDay(s);
    expect(offerPact(s, VALLEY, 'ahlers', 'fisch', 'holz').ok).toBe(true);
  });

  it('ein Abkommen über eine Ware schützt nicht das übrige Revier', () => {
    const s = game();
    const r = findRival(s, 'steinbrueck')!;
    r.money = 20_000;
    offerPact(s, VALLEY, 'steinbrueck', 'holz', 'arznei');
    nextDay(s);
    let started = false;
    for (let i = 0; i < 10 && !started; i++) {
      sold(s, 'niedermuend', 'moebel', 20);
      started = nextDay(s).some((n) => n.text.includes('Möbel'));
    }
    expect(started).toBe(true);
    expect(r.retaliation?.good).toBe('moebel');
  });
});

describe('Konkurs und Versteigerung', () => {
  it('ein überschuldetes Haus geht pleite, seine Kontore werden versteigert', () => {
    const s = game();
    const r = findRival(s, 'ahlers')!;
    r.kontore = ['kesselbrueck', 'weidenhof'];
    r.money = -100_000;
    const news = nextDay(s);
    expect(findRival(s, 'ahlers')).toBeUndefined();
    expect(news.some((n) => n.text.includes('pleite'))).toBe(true);
    expect(s.auction?.lots.map((l) => l.town)).toEqual(['kesselbrueck', 'weidenhof']);
    expect(s.housesGone).toEqual([{ id: 'ahlers', how: 'konkurs', day: day(s) }]);
  });

  it('wer lange in Schulden steckt und nichts mehr zu verkaufen hat, ist auch pleite', () => {
    const s = game();
    const r = findRival(s, 'kessler')!;
    r.ships = r.ships.slice(0, 1);
    for (let i = 0; i < BANKRUPT_DAYS; i++) {
      expect(findRival(s, 'kessler')).toBeDefined();
      r.money = -50;
      nextDay(s);
    }
    expect(findRival(s, 'kessler')).toBeUndefined();
  });

  it('Gebote hinterlegen Geld, Überbieten zahlt zurück, der Zuschlag bringt das Kontor', () => {
    const s = game();
    const r = findRival(s, 'ahlers')!;
    r.kontore = ['weidenhof'];
    r.money = -100_000;
    nextDay(s);
    const lot = s.auction!.lots[0];
    const money = s.money;
    expect(placeBid(s, 'weidenhof').ok).toBe(true);
    expect(s.money).toBe(money - LOT_MIN);
    expect(placeBid(s, 'weidenhof').ok).toBe(false); // schon Höchstbietender
    // ein reiches Haus bietet mit und überbietet irgendwann
    for (const x of s.rivals) x.money = 100_000;
    let outbid = false;
    for (let i = 0; i < 9 && !outbid; i++) outbid = nextDay(s).some((n) => n.text.includes('überbietet'));
    expect(outbid).toBe(true);
    expect(s.money).toBe(money); // Geld zurück
    expect(lot.bid).toBe(nextBid({ min: LOT_MIN, bid: LOT_MIN }));
    // zurückbieten und bis zum Ende halten
    for (const x of s.rivals) x.money = 0;
    expect(placeBid(s, 'weidenhof').ok).toBe(true);
    const paid = lot.bid;
    while (s.auction) nextDay(s);
    expect(s.kontore.weidenhof).toBeDefined();
    expect(s.money).toBe(money - paid);
  });

  it('ein alter Spielstand legt keine Häuser neu an, wenn alle verschwunden sind', () => {
    const s = game();
    for (const r of [...s.rivals]) {
      r.money = -100_000;
    }
    nextDay(s);
    expect(s.rivals).toHaveLength(0);
    const loaded = upgradeState(JSON.parse(JSON.stringify(s)), VALLEY);
    expect(loaded.rivals).toHaveLength(0);
  });
});

describe('Anteile und Übernahme', () => {
  it('ein Haus lässt sich in einem Zug zum Gesamtpreis übernehmen', () => {
    const s = game();
    const r = findRival(s, 'ahlers')!;
    r.money = 1000;
    const cost = takeoverCost(r);
    s.money = cost - 1;
    expect(buyHouse(s, VALLEY, 'ahlers').ok).toBe(false);
    expect(findRival(s, 'ahlers')).toBeDefined();
    s.money = cost;
    expect(buyHouse(s, VALLEY, 'ahlers').ok).toBe(true);
    expect(findRival(s, 'ahlers')).toBeUndefined();
    expect(s.money).toBe(1000);
  });

  it('Anteile werden mit jedem Block teurer und zählen zum Vermögen', () => {
    const s = game();
    const r = findRival(s, 'nordstrom')!;
    const first = sharePrice(r);
    const worth = playerWorth(s);
    expect(buyShares(s, VALLEY, 'nordstrom').ok).toBe(true);
    expect(r.shares).toBe(10);
    expect(sharePrice(r)).toBeGreaterThan(first);
    expect(sharesWorth(s)).toBe(Math.round(rivalWorth(r) * 0.1));
    // gekauft mit Aufschlag: ein kleiner Verlust, aber nicht der ganze Preis
    expect(playerWorth(s)).toBeGreaterThan(worth - first);
  });

  it('verärgerte Häuser verkaufen keine Anteile, außer sie brauchen Geld', () => {
    const s = game();
    const r = findRival(s, 'kessler')!;
    r.anger = 80;
    expect(buyShares(s, VALLEY, 'kessler').ok).toBe(false);
    r.money = -10;
    expect(buyShares(s, VALLEY, 'kessler').ok).toBe(true);
  });

  it('mit mehr als der Hälfte gehört das Haus dem Spieler', () => {
    const s = game();
    const r = findRival(s, 'ahlers')!;
    r.kontore = ['weidenhof', 'oberau'];
    s.kontore.oberau = { level: 2, stock: {} };
    const ships = s.ships.length;
    const rivalShips = r.ships.length;
    r.money = 5000;
    const worthBefore = rivalWorth(r);
    let paid = 0;
    const k6 = { type: 'takeover' as const, count: 1, text: '' };
    expect(goalProgress(s, k6).value).toBe(0);
    for (let i = 0; i < 6; i++) {
      const before = s.money;
      expect(buyShares(s, VALLEY, 'ahlers').ok).toBe(true);
      paid += before - s.money;
    }
    // paid ist schon abzüglich der übernommenen Kasse; die übrigen 40 % wurden ausgezahlt,
    // also kostet das Haus netto mehr als Schiffe und Kontore wert sind
    expect(paid).toBeGreaterThan(worthBefore - 5000);
    expect(findRival(s, 'ahlers')).toBeUndefined();
    expect(s.ships.length).toBe(ships + rivalShips);
    expect(s.kontore.weidenhof).toBeDefined();
    expect(s.kontore.oberau.level).toBe(2); // eigenes Kontor bleibt, wie es war
    expect(new Set(s.ships.map((x) => x.id)).size).toBe(s.ships.length);
    expect(goalProgress(s, k6).value).toBe(1);
  });
});

describe('Einbindung', () => {
  it('die Diplomatie zieht nicht am Zufallsstrom', () => {
    const s = game();
    sold(s, 'niedermuend', 'moebel', 500);
    const rng = s.rng;
    for (let i = 0; i < 40; i++) nextDay(s);
    expect(s.rng).toBe(rng);
  });

  it('ein geschwächtes Haus startet arm, mit einem Schiff, und verkauft Anteile billig', () => {
    const k6 = CHAPTERS.find((c) => c.id === 'k6')!;
    const s = newGame(VALLEY, { startTown: k6.startTown, money: k6.money, rivals: true, epoch: 3, startYear: k6.startYear, weakHouse: 'ahlers' });
    const r = findRival(s, 'ahlers')!;
    expect(r.ships).toHaveLength(1);
    expect(r.money).toBe(300);
    expect(r.kontore.length).toBeGreaterThan(0);
    const strong = s.rivals.filter((x) => x.id !== 'ahlers').map(sharePrice);
    expect(Math.max(...strong.map((p) => -p))).toBeLessThan(-sharePrice(r));
  });
});
