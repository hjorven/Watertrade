import type { ShipType } from '../sim/river.ts';

export const SHIPS: Record<string, ShipType> = {
  treidelkahn: {
    id: 'treidelkahn',
    name: 'Treidelkahn',
    speed: 5,
    draft: 1.0,
    height: 3,
    capacity: 40,
    canGoUpstream: true,
  },
};
