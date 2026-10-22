import { describe, expect, it } from 'vitest';
import { cellCenter, rowCellSizes, sampleGrid } from '../../shared/grid.ts';
import { horizonAngle } from '../../shared/horizon.ts';
import { AWAY, CAST, castShadows, LIT, shadowTerrain } from '../../shared/shadow.ts';
import { loadDemGrid } from '../src/dem.ts';

const CELL = 10;

/** Flat ground with a wall `height` m tall along one column or row through the middle. */
function wall(w: number, h: number, height: number, axis: 'col' | 'row') {
  const values = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (axis === 'col' ? c === w / 2 : r === h / 2) values[r * w + c] = height;
    }
  }
  return shadowTerrain(w, h, values, new Float64Array(h).fill(CELL));
}

/** Length in cells of the run of CAST cells starting next to the wall and going `step` away from it. */
function shadowRun(mask: Uint8Array, start: number, step: number): number {
  let n = 0;
  for (let i = start; i >= 0 && i < mask.length && mask[i] === CAST; i += step) n++;
  return n;
}

describe('cast shadows', () => {
  it('casts a shadow height / tan(altitude) long, away from the sun, for E, W, S and N', () => {
    const alt = 10;
    const length = 100 / Math.tan((alt * Math.PI) / 180) / CELL; // 56.7 cells
    for (const [azimuth, axis, dir] of [
      [90, 'col', -1],
      [270, 'col', 1],
      [180, 'row', -1],
      [0, 'row', 1],
    ] as const) {
      const g = wall(200, 200, 100, axis);
      const mask = castShadows(g, { azimuth, altitude: alt });
      const mid = 100 * 200 + 100;
      // From the second cell beside the wall, away from the sun; the first one leans against the
      // wall in the slope estimate and counts as turned away.
      const step = axis === 'col' ? dir : dir * 200;
      expect(mask[mid + step]).toBe(AWAY);
      const run = shadowRun(mask, mid + 2 * step, step);
      expect(Math.abs(run + 1 - length), `azimuth ${azimuth}`).toBeLessThan(1.5);
      // The sunny side of the wall stays lit.
      expect(mask[mid - step]).toBe(LIT);
    }
  });

  it('casts a diagonal shadow for a diagonal sun', () => {
    // A single 100 m pillar; sun from the south-east at 20°: the shadow runs to the north-west.
    const w = 120;
    const values = new Float32Array(w * w);
    values[60 * w + 60] = 100;
    const mask = castShadows(shadowTerrain(w, w, values, new Float64Array(w).fill(CELL)), { azimuth: 135, altitude: 20 });
    const reach = 100 / Math.tan((20 * Math.PI) / 180) / CELL / Math.SQRT2; // cells along each axis
    expect(mask[(60 - 5) * w + (60 - 5)]).toBe(CAST);
    expect(mask[(60 - Math.floor(reach) + 2) * w + (60 - Math.floor(reach) + 2)]).toBe(CAST);
    expect(mask[(60 - Math.ceil(reach) - 3) * w + (60 - Math.ceil(reach) - 3)]).toBe(LIT);
    // Nothing on the sunny side.
    expect(mask[(60 + 5) * w + (60 + 5)]).toBe(LIT);
  });

  it('marks slopes turned away from the sun, and everything once the sun is down', () => {
    // A ramp rising 1 m per metre to the east, sun low in the east: faces it. Sun low in the west: away.
    const w = 20;
    const values = new Float32Array(w * w);
    for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) values[r * w + c] = c * CELL;
    const g = shadowTerrain(w, w, values, new Float64Array(w).fill(CELL));
    expect(castShadows(g, { azimuth: 270, altitude: 30 })[10 * w + 10]).toBe(LIT);
    expect(castShadows(g, { azimuth: 90, altitude: 30 })[10 * w + 10]).toBe(AWAY);
    expect(castShadows(g, { azimuth: 270, altitude: -1 })[10 * w + 10]).toBe(AWAY);
  });

  it('interpolates the sun altitude across the grid', () => {
    // Flat ground with a wall; the sun is higher in the south, so the shadow is shorter there.
    const g = wall(200, 200, 100, 'col');
    const mask = castShadows(g, { azimuth: 90, altitude: { cols: 2, rows: 2, values: [5, 5, 20, 20] } });
    const north = shadowRun(mask, 10 * 200 + 98, -1);
    const south = shadowRun(mask, 190 * 200 + 98, -1);
    expect(north).toBeGreaterThan(south * 2);
  });
});

describe('cast shadows on the real terrain grid', async () => {
  const dem = await loadDemGrid();
  const { grid, values } = dem;
  const cellSize = rowCellSizes(grid);
  const terrain = shadowTerrain(grid.width, grid.height, values, cellSize);
  let zMax = -Infinity;
  for (const v of values) zMax = Math.max(zMax, v);

  it('has cells of about 250 m', () => {
    expect(cellSize[0]).toBeGreaterThan(240);
    expect(cellSize[grid.height - 1]).toBeLessThan(260);
  });

  it('agrees with the horizon traced cell by cell, an independent method', () => {
    const sampler = (lon: number, lat: number) => sampleGrid(grid, values, lon, lat);
    let checked = 0;
    let agree = 0;
    for (const [azimuth, alt] of [
      [130, 8],
      [180, 20],
      [235, 5],
    ]) {
      const mask = castShadows(terrain, { azimuth, altitude: alt });
      // Every 37th cell away from the edges, where the shadow can come from outside the grid.
      for (let i = 0; i < mask.length; i += 37) {
        const col = i % grid.width;
        const row = Math.floor(i / grid.width);
        if (col < 120 || row < 120 || col > grid.width - 120 || row > grid.height - 120 || mask[i] === AWAY) continue;
        const { lon, lat } = cellCenter(grid, col, row);
        const sky = horizonAngle(lon, lat, values[i], azimuth, {
          bands: [{ sampler, until: 60_000, step: 125 }],
          zMax,
          observerHeight: 0,
          curvature: false,
        }).angle;
        // Leave out the cells within half a degree of the sun, where 125 m steps decide.
        if (Math.abs(sky - alt) < 0.5) continue;
        checked++;
        if ((sky > alt) === (mask[i] === CAST)) agree++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(agree / checked).toBeGreaterThan(0.97);
  });

  it('runs in a few tens of milliseconds for the whole grid', () => {
    // The sun's altitude across the region at a December sunrise: about a degree higher in the east.
    const altitude = { cols: 2, rows: 2, values: [5.5, 6.5, 5.6, 6.6] };
    castShadows(terrain, { azimuth: 120, altitude });
    const t0 = performance.now();
    const mask = castShadows(terrain, { azimuth: 120, altitude });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(100);
    // A low morning sun puts a real share of the region in cast shadow.
    const cast = mask.reduce((n, v) => n + (v === CAST ? 1 : 0), 0) / mask.length;
    expect(cast).toBeGreaterThan(0.05);
    expect(cast).toBeLessThan(0.6);
  });
});
