import { describe, expect, it } from 'vitest';
import { COUNCIL, DAILY_SALE_CAP, FOUNDATION_BY_ID, RANKS, TOWNHOUSE } from '../data/foundations.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { acceptContract, deliverContract, tickContracts } from './contracts.ts';
import { advance, buy, kontorBuy, kontorSell, newGame, planVoyage, sell, upgradeState, type GameState } from './game.ts';
import { betriebSlots, buildKontor, playerWorth } from './house.ts';
import { deserialize, serialize, SAVE_VERSION } from './save.ts';
import {
  buildTownhouse,
  found,
  gainStanding,
  joinCouncil,
  rankIndex,
  standing,
  standingOf,
  standingUpkeep,
} from './standing.ts';
import { CLOSE_DAYS, MIN_POP_SHARE, needs, REOPEN_DAYS, tickTown } from './towns.ts';
import { SEASON_DAYS } from './calendar.ts';

const game = (town = 'altenfurt', money = 50_000): GameState => newGame(VALLEY, { startTown: town, money, rivals: false, seed: 3 });
const def = (id: string) => VALLEY.towns.find((t) => t.id === id)!;

/** Ansehen direkt auf einen Rang setzen */
const setRank = (s: GameState, town: string, rank: number) => {
  standingOf(s, town).earned = RANKS[rank].from + 1;
};

describe('Ansehen pro Stadt', () => {
  it('wächst durch Lieferung in echte Knappheit, nicht in einen vollen Markt', () => {
    const s = game();
    const ship = s.ships[0];
    ship.cargo.salz = { amount: 40, cost: 400 };
    s.markets.altenfurt.salz.stock = 60; // reichlich
    sell(s, ship.id, 'salz', 20);
    expect(standing(s, 'altenfurt')).toBe(0);
    s.markets.altenfurt.salz.stock = 5; // knapp
    sell(s, ship.id, 'salz', 20);
    expect(standing(s, 'altenfurt')).toBeGreaterThan(1);
  });

  it('selbst leer gekauft und zurückverkauft bringt kein Ansehen', () => {
    const s = game();
    const ship = s.ships[0];
    const m = s.markets.altenfurt.salz;
    m.stock = 30;
    const r = buy(s, ship.id, 'salz', 30);
    expect(r.amount).toBe(30);
    sell(s, ship.id, 'salz', 30);
    expect(standing(s, 'altenfurt')).toBe(0);
    // über Nacht nicht vergessen
    buy(s, ship.id, 'salz', 30);
    advance(s, VALLEY, 24);
    sell(s, ship.id, 'salz', 30);
    expect(standing(s, 'altenfurt')).toBeLessThan(1);
  });

  it('Kaufen und sofort Zurückverkaufen bringt nie Gewinn, auch mit Kontor, Händler und hohem Ansehen', () => {
    const s = game('altenfurt', 200_000);
    buildKontor(s, 'altenfurt');
    setRank(s, 'altenfurt', 4);
    const ship = s.ships[0];
    ship.captain = { id: 1, name: 'Test', trait: 'haendler', wage: 0, hire: 0 };
    s.markets.altenfurt.arznei = { good: 'arznei', stock: 80, target: 80 };
    const start = s.money;
    for (let i = 0; i < 30; i++) {
      buy(s, ship.id, 'arznei', 20);
      sell(s, ship.id, 'arznei', 20);
      kontorBuy(s, 'altenfurt', 'arznei', 20);
      kontorSell(s, 'altenfurt', 'arznei', 20);
    }
    expect(s.money).toBeLessThan(start);
  });

  it('hat eine Tagesgrenze für Verkäufe', () => {
    const s = game();
    const ship = s.ships[0];
    ship.cargo.salz = { amount: 400, cost: 0 };
    for (let i = 0; i < 10; i++) {
      s.markets.altenfurt.salz.stock = 0;
      sell(s, ship.id, 'salz', 30);
    }
    expect(standing(s, 'altenfurt')).toBeCloseTo(DAILY_SALE_CAP, 5);
    advance(s, VALLEY, 24);
    s.markets.altenfurt.salz.stock = 0;
    sell(s, ship.id, 'salz', 30);
    expect(standing(s, 'altenfurt')).toBeGreaterThan(DAILY_SALE_CAP);
  });

  it('zählt beim Stadtfest Bier doppelt und bis zum vollen Zielbestand', () => {
    const plain = game();
    const fest = game();
    fest.events.push({ id: 999, kind: 'stadtfest', from: 1, until: 9, town: 'altenfurt' });
    for (const s of [plain, fest]) {
      s.ships[0].cargo.bier = { amount: 20, cost: 0 };
      s.markets.altenfurt.bier.stock = 45; // über der halben, unter der vollen Zielmenge
      sell(s, s.ships[0].id, 'bier', 20);
    }
    expect(standing(plain, 'altenfurt')).toBe(0);
    expect(standing(fest, 'altenfurt')).toBeGreaterThan(0);
  });

  it('steigt mit erfüllten Aufträgen und fällt bei verpasster Frist', () => {
    const s = game();
    const ship = s.ships[0];
    s.contracts.push({ id: 500, town: 'altenfurt', good: 'salz', amount: 20, delivered: 0, reward: 900, issued: 1, offerUntil: 9, deadline: 20, accepted: false });
    acceptContract(s, 500);
    ship.cargo.salz = { amount: 20, cost: 200 };
    s.markets.altenfurt.salz.stock = 200; // keine Knappheit, nur der Auftrag zählt
    deliverContract(s, ship.id, 500);
    const after = standing(s, 'altenfurt');
    expect(after).toBeGreaterThanOrEqual(5);

    s.contracts.push({ id: 501, town: 'altenfurt', good: 'salz', amount: 20, delivered: 0, reward: 900, issued: 1, offerUntil: 2, deadline: 1, accepted: true });
    s.hour = 24 * 3;
    tickContracts(s, VALLEY);
    expect(standing(s, 'altenfurt')).toBeLessThan(after);
  });

  it('verblasst langsam, Stiftungen bleiben', () => {
    const s = game();
    gainStanding(s, 'altenfurt', 20);
    found(s, 'altenfurt', 'schule');
    advance(s, VALLEY, 24 * 60);
    const st = standingOf(s, 'altenfurt');
    expect(st.earned).toBeLessThan(16);
    expect(st.earned).toBeGreaterThan(10);
    expect(standing(s, 'altenfurt')).toBeGreaterThanOrEqual(FOUNDATION_BY_ID.get('schule')!.standing);
  });

  it('meldet einen neuen Rang im Flussboten', () => {
    const s = game();
    gainStanding(s, 'altenfurt', RANKS[2].from + 2);
    advance(s, VALLEY, 24);
    expect(s.news.some((n) => n.text.includes(RANKS[2].name))).toBe(true);
  });
});

describe('Freischaltungen', () => {
  it('Nachlass beim Einkauf je nach Rang', () => {
    const a = game();
    const b = game();
    setRank(b, 'altenfurt', 3);
    const ra = buy(a, a.ships[0].id, 'salz', 10);
    const rb = buy(b, b.ships[0].id, 'salz', 10);
    expect(ra.ok && rb.ok).toBe(true);
    expect(rb.taler).toBeLessThan(ra.taler);
    expect(rb.taler).toBeCloseTo(ra.taler * (1 - RANKS[3].discount), -1);
  });

  it('ein zusätzlicher Bauplatz ab "Angesehen"', () => {
    const s = game();
    buildKontor(s, 'altenfurt');
    const before = betriebSlots(s, 'altenfurt');
    setRank(s, 'altenfurt', 3);
    expect(betriebSlots(s, 'altenfurt')).toBe(before + 1);
  });

  it('bessere und häufigere Aufträge in angesehenen Städten', () => {
    let plain = 0;
    let favoured = 0;
    let rewardPlain = 0;
    let rewardFav = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const fav of [false, true]) {
        const s = newGame(VALLEY, { startTown: 'altenfurt', rivals: false, seed });
        if (fav) {
          setRank(s, 'altenfurt', 4);
          standingOf(s, 'altenfurt').council = true;
        }
        for (let i = 0; i < 30; i++) {
          s.hour += 24;
          tickContracts(s, VALLEY);
        }
        const mine = s.contracts.filter((c) => c.town === 'altenfurt');
        if (fav) {
          favoured += mine.length;
          rewardFav += mine.reduce((x, c) => x + c.reward / c.amount, 0);
        } else {
          plain += mine.length;
          rewardPlain += mine.reduce((x, c) => x + c.reward / c.amount, 0);
        }
      }
    }
    expect(favoured).toBeGreaterThan(plain);
    expect(rewardFav / favoured).toBeGreaterThan(rewardPlain / plain);
  });
});

describe('Geld für Ansehen', () => {
  it('Stiftungen kosten Geld und Unterhalt und bringen dauerhaft Ansehen', () => {
    const s = game();
    const money = s.money;
    const r = found(s, 'altenfurt', 'kirche');
    expect(r.ok).toBe(true);
    expect(s.money).toBe(money - FOUNDATION_BY_ID.get('kirche')!.price);
    expect(standing(s, 'altenfurt')).toBe(FOUNDATION_BY_ID.get('kirche')!.standing);
    expect(found(s, 'altenfurt', 'kirche').ok).toBe(false);
    expect(standingUpkeep(s)).toBe(FOUNDATION_BY_ID.get('kirche')!.upkeep);
    advance(s, VALLEY, 24);
    expect(s.ledger.upkeep).toBeGreaterThanOrEqual(FOUNDATION_BY_ID.get('kirche')!.upkeep);
  });

  it('eine Kirche erst ab Marktflecken', () => {
    const s = game('oberau');
    expect(found(s, 'oberau', 'kirche').ok).toBe(false);
    expect(found(s, 'oberau', 'armenhaus').ok).toBe(true);
  });

  it('Stiftungen verbessern die Versorgung der Stadt', () => {
    const a = game();
    const b = game();
    found(b, 'altenfurt', 'kirche');
    found(b, 'altenfurt', 'schule');
    advance(a, VALLEY, 24 * 30);
    advance(b, VALLEY, 24 * 30);
    expect(b.towns.altenfurt.satisfaction).toBeGreaterThan(a.towns.altenfurt.satisfaction + 0.04);
  });

  it('Stadthaus erst ab "Geschätzt", zählt zum Vermögen', () => {
    const s = game();
    expect(buildTownhouse(s, 'altenfurt').ok).toBe(false);
    setRank(s, 'altenfurt', TOWNHOUSE.minRank);
    const worth = playerWorth(s);
    expect(buildTownhouse(s, 'altenfurt').ok).toBe(true);
    expect(standingOf(s, 'altenfurt').townhouse).toBe(true);
    expect(playerWorth(s)).toBe(worth - TOWNHOUSE.price + TOWNHOUSE.price * 0.5);
  });

  it('Ratssitz erst ab "Angesehen", halbiert den Zoll an der Stadt', () => {
    const s = game('muehlheim');
    s.events.push({ id: 900, kind: 'zoll', from: 1, until: 30, seg: 'muehl-alten', value: 60 });
    const toll = () => {
      const p = planVoyage(s, VALLEY, s.ships[0].id, 'altenfurt');
      return p && p.ok ? p.voyage.toll : -1;
    };
    expect(toll()).toBe(60);
    expect(joinCouncil(s, 'altenfurt').ok).toBe(false);
    setRank(s, 'altenfurt', COUNCIL.minRank);
    expect(joinCouncil(s, 'altenfurt').ok).toBe(true);
    expect(toll()).toBe(60 * COUNCIL.tollShare);
    expect(rankIndex(standing(s, 'altenfurt'))).toBeGreaterThanOrEqual(COUNCIL.minRank);
  });
});

describe('Städte: Jahreszeit und Schrumpfen', () => {
  it('im Winter mehr Kohle und Stoff, im Sommer mehr Bier', () => {
    const d = def('niedermuend');
    const t = { population: d.population, satisfaction: 0.75 };
    const spring = needs(d, t, 1);
    const summer = needs(d, t, 1 + SEASON_DAYS);
    const winter = needs(d, t, 1 + 3 * SEASON_DAYS);
    expect(winter.kohle).toBeGreaterThan(summer.kohle);
    expect(winter.stoff).toBeGreaterThan(spring.stoff);
    expect(summer.bier).toBeGreaterThan(winter.bier);
    // ohne Tag bleibt alles wie bisher
    expect(needs(d, t).kohle).toBe(d.consumes.kohle);
  });

  it('in der Not schrumpft die Stadt unter ihre Startgröße und schließt Betriebe, später öffnen sie wieder', () => {
    const d = def('altenfurt');
    const s = game();
    const town = s.towns.altenfurt;
    const market = s.markets.altenfurt;
    let closed: string | undefined;
    // alles leer kaufen: Hunger in der Stadt
    for (let i = 0; i < CLOSE_DAYS * 3 && !closed; i++) {
      for (const m of Object.values(market)) m.stock = 0;
      closed = tickTown(d, market, town, { day: 10 }).closed ?? closed;
    }
    expect(closed).toBeDefined();
    expect(town.closed).toContain(closed);
    expect(town.population).toBeLessThan(d.population);
    expect(town.population).toBeGreaterThanOrEqual(d.population * MIN_POP_SHARE);
    // geschlossene Betriebe arbeiten nicht: Bretter bleiben liegen, wenn die Tischlerei zu ist
    if (closed === 'Tischlerei') {
      market.bretter.stock = 50;
      market.moebel.stock = 0;
      tickTown(d, market, town, { day: 10 });
      expect(market.moebel.stock).toBe(0);
    }
    // gut versorgt erholt sich die Stadt
    let reopened: string | undefined;
    for (let i = 0; i < REOPEN_DAYS * 4 && !reopened; i++) {
      for (const m of Object.values(market)) m.stock = m.target * 1.5;
      reopened = tickTown(d, market, town, { day: 10 }).reopened;
    }
    expect(reopened).toBe(closed);
  });

  it('eine gewachsene Stadt, die nur eine Stufe verliert, schließt bei mittlerer Versorgung keinen Betrieb', () => {
    const d = def('kesselbrueck');
    const s = game('kesselbrueck');
    const town = s.towns.kesselbrueck;
    town.population = 2001; // knapp über "Stadt"
    town.satisfaction = 0.66;
    const r = tickTown(d, s.markets.kesselbrueck, town, { day: 10 });
    expect(r.levelDown).toBeDefined();
    expect(r.closed).toBeUndefined();
  });

  it('nach der Not wächst eine geschrumpfte Stadt auf ihre Startgröße zurück', () => {
    const d = def('altenfurt');
    const s = game();
    const town = s.towns.altenfurt;
    town.population = d.population * 0.8;
    for (let i = 0; i < 120; i++) {
      town.satisfaction = 0.6;
      tickTown(d, s.markets.altenfurt, town, { day: 10 });
    }
    expect(town.population).toBeGreaterThan(d.population * 0.95);
    expect(town.population).toBeLessThanOrEqual(d.population);
  });

  it('ohne Spieler schrumpft im ersten Jahr keine Stadt unter ihre Startgröße', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', seed: 11 });
    advance(s, VALLEY, 24 * 120);
    for (const d of VALLEY.towns) {
      expect(s.towns[d.id].population, d.id).toBeGreaterThanOrEqual(d.population);
      expect(s.towns[d.id].closed ?? [], d.id).toEqual([]);
    }
  });

  it('schreibt geschlossene Betriebe in den Flussboten', () => {
    const s = game();
    // Altenfurt dauerhaft aushungern
    for (let i = 0; i < CLOSE_DAYS * 3; i++) {
      for (const m of Object.values(s.markets.altenfurt)) m.stock = 0;
      advance(s, VALLEY, 24);
    }
    expect(s.news.some((n) => n.kind === 'stadt' && n.text.includes('schließt'))).toBe(true);
  });
});

describe('Spielstände', () => {
  it('alte Stände ohne Ansehen laufen weiter, neue speichern es mit', () => {
    const s = game();
    delete s.standing;
    upgradeState(s, VALLEY);
    advance(s, VALLEY, 48);
    expect(standing(s, 'altenfurt')).toBe(0);
    found(s, 'altenfurt', 'armenhaus');
    const text = serialize({ version: SAVE_VERSION, state: s } as never);
    const back = deserialize(text);
    expect(back).not.toBeNull();
    expect(standing((back as { state: GameState }).state, 'altenfurt')).toBe(FOUNDATION_BY_ID.get('armenhaus')!.standing);
  });
});
