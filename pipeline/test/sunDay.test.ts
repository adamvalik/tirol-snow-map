import { describe, expect, it } from 'vitest';
import { getPosition } from 'suncalc';
import { cellAt, cellCenter, MODEL_GRID, rowCellSizes, sampleGrid } from '../../shared/grid.ts';
import { horizonProfile, sunWindows } from '../../shared/horizon.ts';
import { shadowTerrain, type ShadowSun } from '../../shared/shadow.ts';
import { sunDayMaps } from '../../shared/sunDay.ts';
import { loadDemGrid } from '../src/dem.ts';

const MINUTE = 60_000;

describe('sun over a day on a synthetic grid', () => {
  // Flat ground, the sun climbing from 1° to 31° over five hours, always from the south.
  const w = 40;
  const h = 40;
  const t0 = Date.UTC(2026, 11, 21, 8);
  const times = Array.from({ length: 31 }, (_, k) => t0 + k * 10 * MINUTE);
  const sunAt = (t: number): ShadowSun => ({ azimuth: 180, altitude: 1 + (t - t0) / (10 * MINUTE) });

  it('lights flat ground from the start and sums the whole span', () => {
    const g = shadowTerrain(w, h, new Float32Array(w * h), new Float64Array(h).fill(10));
    const m = sunDayMaps(g, times, sunAt);
    const i = 20 * w + 20;
    expect(m.firstSun[i]).toBe(0);
    expect(m.lastSun[i]).toBe(300);
    expect(m.sunMinutes[i]).toBeCloseTo(300, 0);
  });

  it('delays the first sun behind a wall to the minute the sun clears it', () => {
    // A 100 m wall 30 cells (300 m) south of the point: the sun clears it at atan(100 / 300) = 18.4°,
    // 174 minutes after the start.
    const values = new Float32Array(w * h);
    for (let c = 0; c < w; c++) values[35 * w + c] = 100;
    const g = shadowTerrain(w, h, values, new Float64Array(h).fill(10));
    const m = sunDayMaps(g, times, sunAt);
    const i = 5 * w + 20;
    const clears = (Math.atan(100 / 300) * 180) / Math.PI - 1;
    expect(Math.abs(m.firstSun[i] - clears * 10)).toBeLessThan(4);
    expect(m.lastSun[i]).toBe(300);
    expect(Math.abs(m.sunMinutes[i] - (300 - clears * 10))).toBeLessThan(5);
  });

  it('leaves a cell that never sees the sun without times', () => {
    const values = new Float32Array(w * h);
    for (let c = 0; c < w; c++) values[30 * w + c] = 2000;
    const g = shadowTerrain(w, h, values, new Float64Array(h).fill(10));
    const m = sunDayMaps(g, times, sunAt);
    const i = 10 * w + 20;
    expect(m.firstSun[i]).toBeNaN();
    expect(m.lastSun[i]).toBeNaN();
    expect(m.sunMinutes[i]).toBe(0);
  });
});

describe('sun over a day on the real terrain grid', async () => {
  const { grid, values } = await loadDemGrid();
  const terrain = shadowTerrain(grid.width, grid.height, values, rowCellSizes(grid));
  let zMax = -Infinity;
  for (const v of values) zMax = Math.max(zMax, v);
  const date = Date.UTC(2026, 11, 21);
  // 06:30 to 16:30 UTC, every 10 minutes.
  const times = Array.from({ length: 61 }, (_, k) => date + 6.5 * 3_600_000 + k * 10 * MINUTE);
  const c = cellCenter(grid, grid.width / 2, grid.height / 2);
  const sunAt = (t: number): ShadowSun => {
    const corner = (col: number, row: number) => {
      const p = cellCenter(grid, col, row);
      return getPosition(new Date(t), p.lat, p.lon).altitude;
    };
    const [W, H] = [grid.width - 1, grid.height - 1];
    return { azimuth: getPosition(new Date(t), c.lat, c.lon).azimuth, altitude: { cols: 2, rows: 2, values: [corner(0, 0), corner(W, 0), corner(0, H), corner(W, H)] } };
  };
  const t0 = performance.now();
  const maps = sunDayMaps(terrain, times, sunAt);
  const ms = performance.now() - t0;

  it('works out a winter day in a few seconds', () => {
    expect(ms).toBeLessThan(10_000);
  });

  it('agrees with the skyline traced from a few points, an independent method', () => {
    const sampler = (lon: number, lat: number) => sampleGrid(grid, values, lon, lat);
    // Bolzano, Merano, the Val Venosta floor at Silandro, Brunico.
    for (const [lon, lat] of [
      [11.354, 46.498],
      [11.16, 46.67],
      [10.77, 46.628],
      [11.936, 46.796],
    ]) {
      const cell = cellAt(MODEL_GRID, lon, lat)!;
      const i = cell.row * grid.width + cell.col;
      const p = cellCenter(grid, cell.col, cell.row);
      const sky = horizonProfile(p.lon, p.lat, values[i], { bands: [{ sampler, until: 100_000, step: 125 }], zMax, observerHeight: 0 });
      const windows = sunWindows(sky, (t) => getPosition(new Date(t), p.lat, p.lon), times[0], times.at(-1)!);
      expect(windows.length, `${lon}, ${lat}`).toBeGreaterThan(0);
      const first = (windows[0].start - times[0]) / MINUTE;
      const last = (windows.at(-1)!.end - times[0]) / MINUTE;
      // Within a quarter of an hour: the two differ in how they treat the sun's disc and the slope.
      expect(Math.abs(maps.firstSun[i] - first), `first sun at ${lon}, ${lat}`).toBeLessThan(15);
      expect(Math.abs(maps.lastSun[i] - last), `last sun at ${lon}, ${lat}`).toBeLessThan(15);
    }
  });

  it('gives south slopes more sun than north slopes in winter', () => {
    let south = 0;
    let north = 0;
    let ns = 0;
    let nn = 0;
    const cell = rowCellSizes(grid);
    for (let row = 1; row < grid.height - 1; row++) {
      for (let col = 1; col < grid.width - 1; col++) {
        const i = row * grid.width + col;
        // Ground falling to the south: higher to the north.
        const slope = (values[i - grid.width] - values[i + grid.width]) / (2 * cell[row]);
        if (slope > 0.3) {
          south += maps.sunMinutes[i];
          ns++;
        } else if (slope < -0.3) {
          north += maps.sunMinutes[i];
          nn++;
        }
      }
    }
    expect(south / ns).toBeGreaterThan(2 * (north / nn));
  });
});
