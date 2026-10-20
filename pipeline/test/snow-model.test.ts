import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellCenter, type GridSpec } from '../../shared/grid.ts';
import { STATION_BBOX } from '../src/config.ts';
import { mergeStations } from '../src/merge.ts';
import {
  COVER_CLOUD,
  COVER_NODATA,
  DEFAULT_PARAMS,
  estimateGrid,
  fit,
  fitTrend,
  leaveOneOut,
  type ModelStation,
  predict,
  residualAt,
} from '../src/snow/model.ts';
import { toModelStations } from '../src/snow/stations.ts';
import { parseLinea } from '../src/sources/linea.ts';
import { parseProvince } from '../src/sources/provinceBz.ts';

const station = (id: string, lon: number, lat: number, elevation: number, depthCm: number): ModelStation => ({
  id,
  lon,
  lat,
  elevation,
  depthCm,
});

/** A 6 × 5 grid of stations around Bolzano following depth = 0.1 cm/m · (h − 1000). */
function linearStations(): ModelStation[] {
  const out: ModelStation[] = [];
  let k = 0;
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 5; j++) {
      const h = 1200 + ((i * 5 + j) * 61) % 1600;
      out.push(station(`s${k++}`, 11 + i * 0.1, 46.3 + j * 0.1, h, 0.1 * (h - 1000)));
    }
  return out;
}

describe('fitTrend', () => {
  it('recovers a known elevation gradient', () => {
    const t = fitTrend(linearStations());
    expect(t.b).toBeCloseTo(0.1, 6);
    expect(t.a).toBeCloseTo(-100, 3);
  });

  it('falls back to the mean when elevations barely vary', () => {
    const t = fitTrend([station('a', 11, 46, 2000, 10), station('b', 11.1, 46, 2010, 30), station('c', 11.2, 46, 2020, 20)]);
    expect(t.b).toBe(0);
    expect(t.a).toBe(20);
  });
});

describe('residual interpolation', () => {
  const stations = [station('a', 11.0, 46.5, 2000, 0), station('b', 11.5, 46.5, 2000, 0)];
  const residuals = [40, 0];

  it('is strongest at the station and fades to zero far away', () => {
    const at = residualAt(stations[0], stations, residuals, DEFAULT_PARAMS);
    const near = residualAt({ lon: 11.05, lat: 46.5 }, stations, residuals, DEFAULT_PARAMS);
    const far = residualAt({ lon: 10.0, lat: 46.5 }, stations, residuals, DEFAULT_PARAMS);
    expect(at).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(0);
    expect(at).toBeLessThanOrEqual(40);
    expect(far).toBe(0); // beyond the search radius
  });

  it('never predicts negative depth', () => {
    const f = fit(linearStations(), 'trend+residuals');
    expect(predict(f, { lon: 11.3, lat: 46.5 }, 250)).toBe(0);
  });
});

describe('leave-one-out validation', () => {
  it('is near zero for perfectly linear data and keeps the simpler trend', () => {
    const v = leaveOneOut(linearStations());
    expect(v.maeCm.trend).toBeLessThan(1e-6);
    expect(v.chosen).toBe('trend');
    expect(v.byBand.reduce((n, b) => n + b.n, 0)).toBe(v.n);
  });

  it('chooses residual interpolation when a region is consistently above the trend', () => {
    // The eastern half got an extra 40 cm (a regional storm), which the elevation trend cannot explain.
    const s = linearStations().map((x) => (x.lon > 11.25 ? { ...x, depthCm: x.depthCm + 40 } : x));
    const v = leaveOneOut(s);
    expect(v.maeCm['trend+residuals']).toBeLessThan(v.maeCm.trend);
    expect(v.chosen).toBe('trend+residuals');
  });
});

describe('estimateGrid', () => {
  const grid: GridSpec = { west: 11.0, south: 46.3, east: 11.6, north: 46.8, width: 6, height: 5 };
  const elevation = new Float32Array(30).fill(2000);
  const f = fit(linearStations(), 'trend');

  it('sets depth to zero where the satellite sees bare ground, and trusts that', () => {
    const cover = new Uint8Array(30).fill(80);
    cover[0] = 5;
    const e = estimateGrid(grid, elevation, f, cover);
    expect(e.depthCm[0]).toBe(0);
    expect(e.confidence[0]).toBe(2);
    expect(e.depthCm[1]).toBeCloseTo(100, 3); // 0.1 · (2000 − 1000)
    expect(e.stats.maskedBySatellite).toBe(1);
  });

  it('keeps the estimate under clouds but lowers confidence', () => {
    const clear = estimateGrid(grid, elevation, f, new Uint8Array(30).fill(80));
    const cloudy = estimateGrid(grid, elevation, f, new Uint8Array(30).fill(COVER_CLOUD));
    expect(cloudy.depthCm[7]).toBe(clear.depthCm[7]);
    expect(cloudy.confidence[7]).toBe(Math.max(0, clear.confidence[7] - 1));
    expect(cloudy.stats.cloudy).toBe(30);
    expect(estimateGrid(grid, elevation, f, new Uint8Array(30).fill(COVER_NODATA)).stats.noCover).toBe(30);
  });

  it('marks cells far above the highest station as low confidence', () => {
    const high = new Float32Array(30).fill(4500);
    const e = estimateGrid(grid, high, f, new Uint8Array(30).fill(80));
    expect([...e.confidence].every((c) => c === 0)).toBe(true);
    expect(cellCenter(grid, 0, 0).lat).toBeLessThan(46.8);
  });
});

describe('on the real station fixtures (20 Oct 2026, early season)', () => {
  const fixture = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
  const opts = { now: '2026-10-20T12:30:00Z', maxAgeHours: 24, bbox: STATION_BBOX };
  const merged = mergeStations([
    parseProvince(fixture('province-bz/v1-stations.geojson'), fixture('province-bz/v1-sensors-all.json'), opts),
    parseLinea(fixture('euregio/linea-stations-bbox.geojson'), opts),
  ]);
  const stations = toModelStations(merged);

  it('uses every station with a snow reading', () => {
    expect(stations.length).toBe(merged.filter((s) => s.snowDepthCm !== null).length);
    expect(stations.length).toBeGreaterThan(200);
  });

  it('fits snow increasing with elevation and validates with a small error', () => {
    const t = fitTrend(stations);
    expect(t.b).toBeGreaterThan(0);
    const v = leaveOneOut(stations);
    // Only a few cm of early-season snow on the ground: errors must be of the same order.
    expect(v.maeCm[v.chosen]).toBeGreaterThan(0);
    expect(v.maeCm[v.chosen]).toBeLessThan(6);
  });
});
