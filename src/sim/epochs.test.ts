import { describe, expect, it } from 'vitest';
import { VALLEY } from '../data/maps/valley.ts';
import { buyShip } from './fleet.ts';
import { advance, depart, newGame, planVoyage, upgradeState, type GameState } from './game.ts';
import { dueEpoch, EPOCH_RULES, epochProgress, epochProgressText, TOW_FEE_PER_HOUR } from './epochs.ts';

const free = () => newGame(VALLEY, { startTown: 'niedermuend', money: 50000, rivals: false });

function meetRule(s: GameState, epoch: number): void {
  const rule = EPOCH_RULES.find((r) => r.epoch === epoch)!;
  s.towns.niedermuend.population = rule.population + 200; // Puffer: tickTown läuft vor der Prüfung
  s.stats.delivered.oberau = { [rule.good]: rule.amount };
}

describe('Epochen nach Fortschritt (freies Spiel)', () => {
  it('Dampf kommt, sobald eine Stadt 2000 Einwohner hat und Werkzeug verkauft wurde', () => {
    const s = free();
    expect(s.epoch).toBe(1);
    expect(s.epochDay).toBe(1);
    s.towns.niedermuend.population = 2200;
    advance(s, VALLEY, 24);
    expect(s.epoch).toBe(1); // Werkzeug fehlt noch
    s.stats.delivered.kesselbrueck = { werkzeug: 25 };
    s.stats.delivered.oberau = { werkzeug: 15 };
    s.towns.niedermuend.population = 2200; // tickTown kann leicht schrumpfen lassen
    const ev = advance(s, VALLEY, 24);
    expect(ev.some((e) => e.type === 'epoch' && e.epoch === 2)).toBe(true);
    expect(s.epoch).toBe(2);
    expect(s.epochDay).toBe(3);
    expect(buyShip(s, VALLEY, 'niedermuend', 'raddampfer').ok).toBe(true);
  });

  it('Motor braucht zusätzlich ein Jahr Dampfzeit, eine Großstadt und Kohle', () => {
    const s = free();
    meetRule(s, 2);
    advance(s, VALLEY, 24);
    expect(s.epoch).toBe(2);
    // sofort alles für Epoche 3 erfüllt, aber die Dampfzeit ist noch zu kurz
    meetRule(s, 3);
    advance(s, VALLEY, 24 * 10);
    expect(s.epoch).toBe(2);
    const p = epochProgress(s);
    expect(p.next?.name).toBe('Motor');
    expect(p.conditions.find((c) => c.label.includes('Tage'))!.value).toBeLessThan(120);
    s.towns.niedermuend.population = 4700;
    s.hour += 115 * 24;
    s.towns.niedermuend.population = 4700;
    advance(s, VALLEY, 24);
    expect(s.epoch).toBe(3);
    expect(epochProgress(s).next).toBeNull();
  });

  it('nur eine Epoche je Schritt durch Fortschritt', () => {
    const s = free();
    meetRule(s, 2);
    s.towns.niedermuend.population = 5000;
    s.stats.delivered.oberau.kohle = 1000;
    s.epochDay = -1000;
    expect(dueEpoch(s)).toBe(2);
  });

  it('die Jahreszahl bleibt spätester Zeitpunkt', () => {
    const s = free();
    s.hour = 120 * 24 * 4 - 12; // kurz vor Jahr 5
    advance(s, VALLEY, 24);
    expect(s.epoch).toBe(2);
    s.hour = 120 * 24 * 9 - 12; // kurz vor Jahr 10
    advance(s, VALLEY, 24);
    expect(s.epoch).toBe(3);
  });

  it('Kampagne mit fester Epoche bleibt unberührt', () => {
    const s = newGame(VALLEY, { startTown: 'niedermuend', money: 500, rivals: false, epoch: 1 });
    meetRule(s, 2);
    advance(s, VALLEY, 48);
    expect(s.epoch).toBe(1);
    expect(epochProgressText(s)).toBe('Treidelzeit');
  });

  it('alte Spielstände ohne Epochenbeginn bekommen einen', () => {
    const s = free();
    s.hour = 120 * 24 * 6; // Jahr 7, Dampfzeit seit Jahr 5
    advance(s, VALLEY, 24);
    expect(s.epoch).toBe(2);
    delete s.epochDay;
    const t = upgradeState(JSON.parse(JSON.stringify(s)), VALLEY);
    expect(t.epochDay).toBe(4 * 120 + 1);
    meetRule(t, 3);
    expect(dueEpoch(t)).toBe(3); // Dampfzeit lang genug
    expect(epochProgressText(t)).toContain('Spätestens im Jahr 10');
  });
});

describe('Treidelgeld ab der Motorzeit', () => {
  function towTrip(epoch: number) {
    const s = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'treidelkahn', money: 5000, rivals: false, epoch });
    return { s, plan: planVoyage(s, VALLEY, s.ships[0].id, 'oberau') };
  }

  it('bergauf treideln kostet in Epoche 3 je Fahrstunde', () => {
    const before = towTrip(2);
    const after = towTrip(3);
    expect(before.plan?.ok && after.plan?.ok).toBe(true);
    if (!before.plan?.ok || !after.plan?.ok) return;
    expect(before.plan.voyage.towFee).toBeUndefined();
    const up = after.plan.voyage.legs.filter((l) => !l.downstream).reduce((n, l) => n + l.hours, 0);
    expect(up).toBeGreaterThan(0);
    expect(after.plan.voyage.towFee).toBe(Math.round(up * TOW_FEE_PER_HOUR));
    expect(after.plan.voyage.toll).toBe((before.plan.voyage.toll ?? 0) + after.plan.voyage.towFee!);
    const money = after.s.money;
    depart(after.s, VALLEY, after.s.ships[0].id, 'oberau');
    expect(after.s.money).toBe(money - after.plan.voyage.toll!);
  });

  it('talwärts und mit Motorschiff kein Treidelgeld', () => {
    const s = newGame(VALLEY, { startTown: 'oberau', startShip: 'treidelkahn', money: 5000, rivals: false, epoch: 3 });
    const down = planVoyage(s, VALLEY, s.ships[0].id, 'niedermuend');
    expect(down?.ok && down.voyage.towFee).toBeFalsy();
    const m = newGame(VALLEY, { startTown: 'niedermuend', startShip: 'motorschiff', money: 5000, rivals: false, epoch: 3 });
    const up = planVoyage(m, VALLEY, m.ships[0].id, 'oberau');
    expect(up?.ok && up.voyage.towFee).toBeFalsy();
  });
});
