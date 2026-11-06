import { describe, expect, it } from 'vitest';
import { VALLEY } from '../data/maps/valley.ts';
import { ZWEI_TAELER } from '../data/maps/zwei-taeler.ts';
import { addShip, newGame } from '../sim/game.ts';
import { startCanalStage } from '../sim/canal.ts';
import { renderCanal } from './canal-panel.ts';

const name = (id: string) => ZWEI_TAELER.towns.find((t) => t.id === id)?.name ?? id;

describe('Kanal im Wasserbau-Reiter', () => {
  it('fehlt auf der Talkarte', () => {
    expect(renderCanal(newGame(VALLEY, 'oberau'), VALLEY, name)).toBe('');
  });

  it('zeigt Start, dann Lieferknöpfe für Schiffe an der Baustelle', () => {
    const s = newGame(ZWEI_TAELER, { startTown: 'altenfurt', money: 50000, rivals: false });
    let html = renderCanal(s, ZWEI_TAELER, name);
    expect(html).toContain('data-cmd="canalStart"');
    expect(html).toContain('Altenfurt und Tuchingen');
    startCanalStage(s, ZWEI_TAELER);
    s.canal!.stage = 1;
    const ship = s.ships[0] ?? addShip(s, 'treidelkahn', 'altenfurt');
    ship.port = 'altenfurt';
    ship.cargo = { holz: { amount: 40, cost: 400 }, salz: { amount: 5, cost: 100 } };
    html = renderCanal(s, ZWEI_TAELER, name);
    expect(html).not.toContain('data-cmd="canalStart"');
    expect(html).toContain(`data-cmd="canalDeliver" data-ship="${ship.id}" data-good="holz" data-n="40"`);
    expect(html).not.toContain('data-good="salz"');
    expect(html).toContain('Noch anzuliefern');
  });
});
