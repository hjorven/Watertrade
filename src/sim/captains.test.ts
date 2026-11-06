import { describe, expect, it } from 'vitest';
import { MAX_WAGE, TRAITS, type Trait } from '../data/captains.ts';
import { VALLEY } from '../data/maps/valley.ts';
import { captainArrived, fairWage, LOYALTY_POACH, LOYALTY_START, setCaptainWage, SMUGGLE_FINE, tickCaptains } from './captains.ts';
import { dismissCaptain, hireCaptain, newCaptain } from './fleet.ts';
import { advance, buy, depart, newGame, type GameState } from './game.ts';
import type { Captain, Voyage } from './state.ts';
import { planVoyage } from './voyage.ts';

const fresh = (money = 5000, rivals = false): GameState => newGame(VALLEY, { startTown: 'oberau', money, rivals });

/** Einen Kapitän mit festen Werten an Bord des ersten Schiffs setzen */
function withCaptain(s: GameState, trait: Trait, extra: Partial<Captain> = {}): Captain {
  const c: Captain = { id: s.nextId++, name: 'Ole Kruse', trait, wage: 0, hire: 0, loyalty: LOYALTY_START, ...extra };
  if (!extra.wage) c.wage = fairWage(c);
  s.ships[0].captain = c;
  return c;
}

/** Eine Fahrt von Oberau nach Niedermünd über den ganzen Strom (190 km) */
function longVoyage(evaded = 0): Voyage {
  const segs = ['oberau-kessel', 'kessel-muehl', 'muehl-alten', 'alten-weiden', 'weiden-nieder'];
  return {
    from: 'oberau',
    to: 'niedermuend',
    legs: segs.map((seg) => ({ seg, from: '', to: '', hours: 5, downstream: true })),
    hours: 25,
    elapsed: 25,
    evaded,
  };
}

describe('Kapitäne: Lohn und Seltenheit', () => {
  it('Löhne liegen zwischen 15 und 40 Talern, Handgeld rund zehn Tageslöhne', () => {
    const s = fresh();
    for (let i = 0; i < 500; i++) {
      const c = newCaptain(s);
      expect(c.wage).toBeGreaterThanOrEqual(15);
      expect(c.wage).toBeLessThanOrEqual(MAX_WAGE);
      expect(c.hire).toBeGreaterThanOrEqual(c.wage * 10);
      if (c.trait2) expect(c.trait2).not.toBe(c.trait);
    }
  });

  it('Gute Kapitäne sind seltener als vorsichtige', () => {
    const s = fresh();
    const count: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) {
      const t = newCaptain(s).trait;
      count[t] = (count[t] ?? 0) + 1;
    }
    expect(count.vorsichtig).toBeGreaterThan(count.haendler * 2);
    expect(count.vorsichtig).toBeGreaterThan(count.schmuggler * 2);
  });

  it('Teurere Eigenschaften verlangen mehr Lohn', () => {
    expect(fairWage({ trait: 'haendler' })).toBeGreaterThan(fairWage({ trait: 'vorsichtig' }));
    expect(fairWage({ trait: 'vorsichtig', trait2: 'haendler', km: 500 })).toBeGreaterThan(fairWage({ trait: 'vorsichtig' }));
    expect(fairWage({ trait: 'haendler', trait2: 'schmuggler', km: 5000 })).toBeLessThanOrEqual(MAX_WAGE);
  });

  it('Wer in die Kneipe zurückgeht, verlangt wieder seinen Wert', () => {
    const s = fresh();
    const c = withCaptain(s, 'haendler', { wage: 5, loyalty: 10 });
    expect(dismissCaptain(s, 1).ok).toBe(true);
    expect(c.wage).toBe(TRAITS.haendler.wage);
    expect(c.loyalty).toBeUndefined();
    expect(hireCaptain(s, 1, c.id).ok).toBe(true);
    expect(s.ships[0].captain?.loyalty).toBe(LOYALTY_START);
  });
});

describe('Kapitäne: Erfahrung', () => {
  it('Nach 400 km lernt der Kapitän eine zweite Eigenschaft und will mehr Lohn', () => {
    const s = fresh();
    const c = withCaptain(s, 'vorsichtig');
    const before = fairWage(c);
    s.ships[0].port = 'niedermuend';
    captainArrived(s, VALLEY, s.ships[0], longVoyage());
    expect(c.km).toBe(190);
    expect(c.trait2).toBeUndefined();
    const news = [...captainArrived(s, VALLEY, s.ships[0], longVoyage()), ...captainArrived(s, VALLEY, s.ships[0], longVoyage())];
    expect(c.km).toBe(570);
    expect(c.trait2).toBeDefined();
    expect(c.trait2).not.toBe('vorsichtig');
    expect(fairWage(c)).toBeGreaterThan(before);
    expect(news.some((n) => n.text.includes('erfahren'))).toBe(true);
  });

  it('Echte Fahrten zählen Kilometer', () => {
    const s = fresh(5000);
    withCaptain(s, 'vorsichtig');
    expect(depart(s, VALLEY, 1, 'kesselbrueck')).not.toBeNull();
    advance(s, VALLEY, 48);
    expect(s.ships[0].port).toBe('kesselbrueck');
    expect(s.ships[0].captain?.km).toBe(40);
  });

  it('Altmeister fahren schneller', () => {
    const a = fresh();
    withCaptain(a, 'vorsichtig');
    const b = fresh();
    // nur der Rang zählt, deshalb ohne zweite Eigenschaft
    withCaptain(b, 'vorsichtig', { km: 2000 });
    const pa = planVoyage(a, VALLEY, 1, 'niedermuend');
    const pb = planVoyage(b, VALLEY, 1, 'niedermuend');
    expect(pa?.ok && pb?.ok).toBe(true);
    if (pa?.ok && pb?.ok) expect(pb.voyage.hours).toBeLessThan(pa.voyage.hours);
  });
});

describe('Kapitäne: Treue und Abwerbung', () => {
  it('Gut bezahlte Kapitäne bleiben über ein Jahr', () => {
    const s = fresh(50_000, true);
    const c = withCaptain(s, 'haendler');
    for (let d = 0; d < 360; d++) tickCaptains(s, VALLEY);
    expect(s.ships[0].captain).toBe(c);
    expect(c.loyalty).toBe(100);
    expect(c.offer).toBeUndefined();
  });

  it('Unterbezahlte Kapitäne werden gewarnt, abgeworben und gehen im Hafen von Bord', () => {
    const s = fresh(50_000, true);
    const c = withCaptain(s, 'haendler', { wage: 15 });
    s.ships[0].route = { active: true, next: 0, stops: [] };
    const news: string[] = [];
    for (let d = 0; d < 40 && s.ships[0].captain; d++) {
      s.hour += 24;
      news.push(...tickCaptains(s, VALLEY).map((n) => n.text));
    }
    expect(news.some((n) => n.includes('murrt'))).toBe(true);
    expect(news.some((n) => n.includes('bietet'))).toBe(true);
    expect(s.ships[0].captain).toBeNull();
    expect(s.ships[0].route?.active).toBe(false);
    expect(c.offer?.from).toMatch(/.+/);
  });

  it('Ohne Konkurrenz wirbt ein anderer Reeder ab', () => {
    const s = fresh(50_000, false);
    withCaptain(s, 'haendler', { wage: 10, loyalty: 0 });
    s.ships[0].port = null;
    s.ships[0].voyage = longVoyage();
    for (let d = 0; d < 30 && !s.ships[0].captain?.offer; d++) tickCaptains(s, VALLEY);
    expect(s.ships[0].captain?.offer?.from).toBe('');
  });

  it('Wer rechtzeitig mehr zahlt, behält den Kapitän', () => {
    const s = fresh(50_000, true);
    const c = withCaptain(s, 'haendler', { wage: 10, loyalty: LOYALTY_POACH - 20 });
    // auf Fahrt: das Angebot kommt, aber gehen kann er erst im Hafen
    s.ships[0].port = null;
    s.ships[0].voyage = longVoyage();
    for (let d = 0; d < 30 && !c.offer; d++) {
      s.hour += 24;
      tickCaptains(s, VALLEY);
    }
    expect(c.offer).toBeDefined();
    expect(setCaptainWage(s, 1, c.offer!.wage).ok).toBe(true);
    expect(c.offer).toBeUndefined();
    s.hour += 24;
    s.ships[0].voyage = null;
    s.ships[0].port = 'niedermuend';
    captainArrived(s, VALLEY, s.ships[0], longVoyage());
    expect(s.ships[0].captain).toBe(c);
  });

  it('Lohn senken kostet Treue, erhöhen bringt sie', () => {
    const s = fresh();
    const c = withCaptain(s, 'schnell');
    expect(setCaptainWage(s, 1, c.wage - 2).ok).toBe(true);
    expect(c.loyalty).toBe(LOYALTY_START - 6);
    expect(setCaptainWage(s, 1, c.wage + 5).ok).toBe(true);
    expect(c.loyalty).toBe(LOYALTY_START - 6 + 10);
    expect(setCaptainWage(s, 1, 0).ok).toBe(false);
  });

  it('Alte Spielstände ohne Treue laufen weiter', () => {
    const s = fresh();
    const c = withCaptain(s, 'schnell', { wage: 6 });
    delete c.loyalty;
    advance(s, VALLEY, 24 * 3);
    expect(c.loyalty).toBeDefined();
    expect(c.loyalty!).toBeLessThan(70);
  });
});

describe('Kapitäne: Schmuggel', () => {
  it('Der Schmuggler zahlt keinen Zoll, merkt sich aber, was er umgeht', () => {
    const s = fresh();
    s.events.push({ id: 99, kind: 'zoll', from: 1, until: 99, seg: 'oberau-kessel', value: 30 });
    withCaptain(s, 'schmuggler');
    const plan = planVoyage(s, VALLEY, 1, 'kesselbrueck');
    expect(plan?.ok).toBe(true);
    if (plan?.ok) {
      expect(plan.voyage.toll).toBe(0);
      expect(plan.voyage.evaded).toBe(30);
    }
  });

  it('Bei einer Kontrolle gibt es Strafe und Beschlagnahme, meistens aber nicht', () => {
    let caught = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = fresh();
      s.rng = seed * 7919;
      withCaptain(s, 'schmuggler');
      buy(s, 1, 'holz', 20);
      const money = s.money;
      s.ships[0].port = 'niedermuend';
      const news = captainArrived(s, VALLEY, s.ships[0], longVoyage(30));
      if (news.some((n) => n.text.includes('Zollkontrolle'))) {
        caught++;
        expect(s.money).toBe(money - 30 * SMUGGLE_FINE);
        expect(s.ships[0].cargo.holz.amount).toBe(10);
      } else {
        expect(s.money).toBe(money);
        expect(s.ships[0].cargo.holz.amount).toBe(20);
      }
    }
    expect(caught).toBeGreaterThan(15);
    expect(caught).toBeLessThan(80);
  });
});
