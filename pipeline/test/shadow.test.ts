import { describe, expect, it } from 'vitest';
import { cellCenter, rowCellSizes, sampleGrid } from '../../shared/grid.ts';
import { horizonAngle } from '../../shared/horizon.ts';
import { castShadows, horizonDip, shadowTerrain } from '../../shared/shadow.ts';
import { loadDemGrid } from '../src/dem.ts';

const CELL = 10;
/** A cell counts as shaded once it misses half the sun or more. */
const SHADED = 128;

/** Flat ground with a wall `height` m tall along one column or row through the middle. */
function wall(w: number, h: number, height: number, axis: 'col' | 'row', cell = CELL) {
  const values = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (axis === 'col' ? c === w / 2 : r === h / 2) values[r * w + c] = height;
    }
  }
  return shadowTerrain(w, h, values, new Float64Array(h).fill(cell));
}

/** Length in cells of the run of shaded cells starting at `start` and going `step` on. */
function shadowRun(shade: Uint8Array, start: number, step: number): number {
  let n = 0;
  for (let i = start; i >= 0 && i < shade.length && shade[i] >= SHADED; i += step) n++;
  return n;
}

/** Whether the slope at a cell turns away from the sun, by the same central differences as the sweep. */
function turnedAway(values: ArrayLike<number>, w: number, h: number, cellSize: ArrayLike<number>, i: number, azimuth: number, alt: number) {
  const col = i % w;
  const row = Math.floor(i / w);
  const size = cellSize[row];
  const slopeE = (values[col + 1 < w ? i + 1 : i] - values[col > 0 ? i - 1 : i]) / (2 * size);
  const slopeN = (values[row > 0 ? i - w : i] - values[row + 1 < h ? i + w : i]) / (2 * size);
  const az = (azimuth * Math.PI) / 180;
  const a = (alt * Math.PI) / 180;
  return (-slopeE * Math.sin(az) - slopeN * Math.cos(az)) * Math.cos(a) + Math.sin(a) < 0.03;
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
      const shade = castShadows(g, { azimuth, altitude: alt });
      const mid = 100 * 200 + 100;
      const step = axis === 'col' ? dir : dir * 200;
      // The first cell beside the wall leans against it in the slope estimate and turns away.
      expect(shade[mid + step]).toBe(255);
      const run = shadowRun(shade, mid + 2 * step, step);
      expect(Math.abs(run + 1 - length), `azimuth ${azimuth}`).toBeLessThan(1.5);
      // The sunny side of the wall, and the ground beyond the shadow, are in full sun.
      expect(shade[mid - step]).toBe(0);
      expect(shade[mid + Math.ceil(length + 4) * step]).toBe(0);
    }
  });

  it('casts a diagonal shadow for a diagonal sun', () => {
    // A single 100 m pillar; sun from the south-east at 20°: the shadow runs to the north-west.
    const w = 120;
    const values = new Float32Array(w * w);
    values[60 * w + 60] = 100;
    const shade = castShadows(shadowTerrain(w, w, values, new Float64Array(w).fill(CELL)), { azimuth: 135, altitude: 20 });
    const reach = 100 / Math.tan((20 * Math.PI) / 180) / CELL / Math.SQRT2; // cells along each axis
    expect(shade[(60 - 5) * w + (60 - 5)]).toBeGreaterThanOrEqual(SHADED);
    expect(shade[(60 - Math.floor(reach) + 2) * w + (60 - Math.floor(reach) + 2)]).toBeGreaterThanOrEqual(SHADED);
    expect(shade[(60 - Math.ceil(reach) - 3) * w + (60 - Math.ceil(reach) - 3)]).toBe(0);
    // Nothing on the sunny side.
    expect(shade[(60 + 5) * w + (60 + 5)]).toBe(0);
  });

  it('blurs the edge of a long shadow more than a short one, as the sun is a disc', () => {
    // 50 m cells, sun at 5° from the east. A 1000 m wall casts 11.4 km, a 50 m wall 570 m.
    const partial = (height: number) => {
      const g = wall(600, 3, height, 'col', 50);
      const shade = castShadows(g, { azimuth: 90, altitude: 5 });
      // Along the middle row, westwards from the wall.
      let n = 0;
      for (let c = 299; c >= 0; c--) if (shade[600 + c] > 0 && shade[600 + c] < 255) n++;
      return n;
    };
    // The far end blurs over hundreds of metres; the short shadow ends within a cell or two.
    expect(partial(1000)).toBeGreaterThan(6);
    expect(partial(50)).toBeLessThanOrEqual(2);
  });

  it('marks slopes turned away from the sun', () => {
    // A ramp rising 1 m per metre to the east, sun in the west: faces it. Sun in the east: away.
    const w = 20;
    const values = new Float32Array(w * w);
    for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) values[r * w + c] = c * CELL;
    const g = shadowTerrain(w, w, values, new Float64Array(w).fill(CELL));
    expect(castShadows(g, { azimuth: 270, altitude: 30 })[10 * w + 10]).toBe(0);
    expect(castShadows(g, { azimuth: 90, altitude: 30 })[10 * w + 10]).toBe(255);
  });

  it('lights the summits before the valleys: below the horizon, the round earth decides', () => {
    // The same west-facing ramp in a valley and 3000 m up, the sun 1° below the horizon in the west.
    const w = 20;
    const ramp = (base: number) => {
      const values = new Float32Array(w * w);
      for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) values[r * w + c] = base + c * CELL;
      return shadowTerrain(w, w, values, new Float64Array(w).fill(CELL));
    };
    // From 3000 m the sea-level horizon lies 1.6° down, from 100 m 0.3°.
    expect(horizonDip(3000)).toBeCloseTo(1.64, 1);
    expect(castShadows(ramp(3000), { azimuth: 270, altitude: -1 })[10 * w + 10]).toBe(0);
    expect(castShadows(ramp(0), { azimuth: 270, altitude: -1 })[10 * w + 10]).toBe(255);
    // Well below the horizon everything is in shade.
    expect(castShadows(ramp(3000), { azimuth: 270, altitude: -5 }).every((v) => v === 255)).toBe(true);
  });

  it('carries a shadow line in from beyond its edge', () => {
    // Flat ground; the line enters 100 m high at the sun's (eastern) edge: a shadow 100 / tan 10° long.
    const w = 200;
    const g = shadowTerrain(w, 3, new Float32Array(w * 3), new Float64Array(3).fill(CELL));
    const shade = castShadows(g, { azimuth: 90, altitude: 10 }, (col) => (col >= w ? { line: 100, reach: 0 } : null));
    const length = 100 / Math.tan((10 * Math.PI) / 180) / CELL;
    expect(Math.abs(shadowRun(shade, w + w - 1, -1) - length)).toBeLessThan(1.5);
    expect(castShadows(g, { azimuth: 90, altitude: 10 })[w + w - 1]).toBe(0);
  });

  it('interpolates the sun altitude across the grid', () => {
    // Flat ground with a wall; the sun is higher in the south, so the shadow is shorter there.
    const g = wall(200, 200, 100, 'col');
    const shade = castShadows(g, { azimuth: 90, altitude: { cols: 2, rows: 2, values: [5, 5, 20, 20] } });
    const north = shadowRun(shade, 10 * 200 + 98, -1);
    const south = shadowRun(shade, 190 * 200 + 98, -1);
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
      const shade = castShadows(terrain, { azimuth, altitude: alt });
      // Every 37th cell away from the edges, where the shadow can come from outside the grid.
      for (let i = 0; i < shade.length; i += 37) {
        const col = i % grid.width;
        const row = Math.floor(i / grid.width);
        if (col < 120 || row < 120 || col > grid.width - 120 || row > grid.height - 120) continue;
        if (turnedAway(values, grid.width, grid.height, cellSize, i, azimuth, alt)) continue;
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
        if (sky > alt === shade[i] >= SHADED) agree++;
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
    const shade = castShadows(terrain, { azimuth: 120, altitude });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(100);
    // A low morning sun leaves much of the region in shade, but not all of it.
    const shaded = shade.reduce((n, v) => n + (v >= SHADED ? 1 : 0), 0) / shade.length;
    expect(shaded).toBeGreaterThan(0.3);
    expect(shaded).toBeLessThan(0.9);
  });
});
