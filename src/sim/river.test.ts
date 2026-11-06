import { describe, expect, it } from 'vitest';
import { explainBlock, findRoute, travelTime, windOfDay, withWind, type Segment, type ShipType } from './river.ts';

const kahn: ShipType = { id: 'k', name: 'Kahn', propulsion: 'tow', speed: 5, draft: 1, height: 3, capacity: 40, canGoUpstream: true };
const floss: ShipType = { ...kahn, id: 'f', name: 'Floß', canGoUpstream: false };
const seg: Segment = { id: 'ab', from: 'a', to: 'b', length: 60, current: 2, baseDepth: 2 };

describe('travelTime', () => {
  it('talwärts schneller als bergwärts', () => {
    expect(travelTime(seg, kahn, true, 0)).toBeCloseTo(60 / 7);
    expect(travelTime(seg, kahn, false, 0)).toBeCloseTo(20);
  });

  it('Niedrigwasser sperrt bei zu großem Tiefgang', () => {
    expect(travelTime(seg, kahn, true, -1.2)).toBeNull();
    expect(travelTime(seg, kahn, true, -0.9)).not.toBeNull();
  });

  it('Hochwasser sperrt niedrige Brücken', () => {
    const bruecke = { ...seg, bridgeHeight: 4 };
    expect(travelTime(bruecke, kahn, true, 0)).not.toBeNull();
    expect(travelTime(bruecke, kahn, true, 1.5)).toBeNull();
  });

  it('zu starke Strömung macht Bergfahrt unmöglich', () => {
    expect(travelTime({ ...seg, current: 4.6 }, kahn, false, 0)).toBeNull();
  });

  it('Floß fährt nur talwärts', () => {
    expect(travelTime(seg, floss, true, 0)).not.toBeNull();
    expect(travelTime(seg, floss, false, 0)).toBeNull();
  });
});

describe('findRoute', () => {
  const net: Segment[] = [
    { id: 'ab', from: 'a', to: 'b', length: 30, current: 1, baseDepth: 3 },
    { id: 'bc', from: 'b', to: 'c', length: 30, current: 1, baseDepth: 3 },
    { id: 'ac', from: 'a', to: 'c', length: 100, current: 1, baseDepth: 3 },
    { id: 'bd', from: 'b', to: 'd', length: 10, current: 1, baseDepth: 0.5 },
  ];

  it('findet den schnellsten Weg', () => {
    const r = findRoute(net, 'a', 'c', kahn, 0)!;
    expect(r.path).toEqual(['ab', 'bc']);
    expect(r.hours).toBeCloseTo(60 / 6);
  });

  it('fährt auch flussaufwärts', () => {
    expect(findRoute(net, 'c', 'a', kahn, 0)!.path).toEqual(['bc', 'ab']);
  });

  it('liefert null, wenn das Ziel nicht erreichbar ist', () => {
    expect(findRoute(net, 'a', 'd', kahn, 0)).toBeNull();
  });

  it('Start gleich Ziel ist eine leere Route', () => {
    expect(findRoute(net, 'a', 'a', kahn, 0)).toEqual({ path: [], hours: 0 });
  });
});

describe('Wind und Sperrgründe', () => {
  it('Segler hängen vom Wind ab, andere nicht', () => {
    const segler: ShipType = { ...kahn, propulsion: 'sail', speed: 8 };
    expect(withWind(segler, 1).speed).toBe(8);
    expect(withWind(segler, 0.5).speed).toBe(4);
    expect(withWind(segler, 0).speed).toBe(4); // Mindestwind: auch bei Flaute halbe Fahrt
    expect(withWind(kahn, 0.5).speed).toBe(5);
  });

  it('Wind liegt immer im gültigen Bereich', () => {
    for (let d = 1; d < 400; d++) {
      const w = windOfDay(d);
      expect(w).toBeGreaterThanOrEqual(0.25);
      expect(w).toBeLessThanOrEqual(1.25);
    }
  });

  it('erklärt, warum ein Ziel nicht erreichbar ist', () => {
    const net: Segment[] = [
      { id: 'ab', from: 'a', to: 'b', length: 30, current: 1, baseDepth: 3, bridgeHeight: 2 },
      { id: 'bc', from: 'b', to: 'c', length: 30, current: 1, baseDepth: 0.5 },
    ];
    const r = explainBlock(net, 'a', 'c', kahn, 0);
    expect(r.map((x) => x.reason)).toEqual(['bruecke', 'tiefgang']);
    expect(explainBlock(net, 'c', 'a', floss, 0)[0].reason).toBe('nurTalwaerts');
  });
});
