import { describe, expect, it } from 'vitest';
import { drapedFirst, drapeRuns } from '../src/drape.ts';

// A cut of the real order: winter lines with their lift-end circles and labels between them, then
// the via ferratas, a GPX track's end circles between its lines, and the place labels.
const layers = [
  { id: 'relief', type: 'color-relief' },
  { id: 'roads', type: 'line' },
  { id: 'buildings-3d', type: 'fill-extrusion' },
  { id: 'sun-night', type: 'fill' },
  { id: 'winter-piste', type: 'line' },
  { id: 'winter-lift-ends', type: 'circle' },
  { id: 'winter-label', type: 'symbol' },
  { id: 'winter-hit', type: 'line' },
  { id: 'winter-lift-3d', type: 'fill-extrusion' },
  { id: 'ferrata-line', type: 'line' },
  { id: 'gpx-line', type: 'line' },
  { id: 'gpx-ends', type: 'circle' },
  { id: 'gpx-hit', type: 'line' },
  { id: 'places', type: 'symbol' },
  { id: 'stations', type: 'circle' },
];

describe('drape', () => {
  it('counts a texture for each run of flat layers', () => {
    expect(drapeRuns(layers)).toBe(5);
    expect(drapeRuns([{ type: 'line' }, { type: 'fill' }, { type: 'symbol' }])).toBe(1);
    expect(drapeRuns([{ type: 'symbol' }])).toBe(0);
  });

  it('puts every flat layer first, each group in its own order', () => {
    const order = drapedFirst(layers);
    expect(order).toEqual([
      'relief', 'roads', 'sun-night', 'winter-piste', 'winter-hit', 'ferrata-line', 'gpx-line', 'gpx-hit',
      'buildings-3d', 'winter-lift-ends', 'winter-label', 'winter-lift-3d', 'gpx-ends', 'places', 'stations',
    ]);
    const byId = new Map(layers.map((l) => [l.id, l]));
    expect(drapeRuns(order.map((id) => byId.get(id)!))).toBe(1);
  });
});
