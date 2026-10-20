import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MODEL_GRID } from '../../shared/grid.ts';
import {
  accumulateFrames,
  cellWeights,
  FORECAST_GRID,
  forecastGridUrl,
  forecastPoints,
  newSnowRgba,
  parseForecastGrid,
  snowFraction,
} from '../src/forecast/snowfall.ts';
import { FORECAST_FIXTURE } from '../src/forecast/run-forecast.ts';

describe('forecast grid', () => {
  it('covers the model grid with one multi-location request', () => {
    const pts = forecastPoints();
    expect(pts).toHaveLength(FORECAST_GRID.cols * FORECAST_GRID.rows);
    expect(pts[0]).toEqual({ lat: 46.1, lon: 10.2 });
    expect(pts.at(-1)!.lon).toBeGreaterThanOrEqual(MODEL_GRID.east);
    expect(pts.at(-1)!.lat).toBeGreaterThanOrEqual(MODEL_GRID.north);
    const u = new URL(forecastGridUrl(pts, 72));
    expect(u.searchParams.get('latitude')!.split(',')).toHaveLength(pts.length);
    expect(u.searchParams.get('hourly')).toBe('precipitation,freezing_level_height');
  });

  it('parses the saved response in point order with UTC times', async () => {
    const body = JSON.parse(await readFile(FORECAST_FIXTURE, 'utf8'));
    const raw = parseForecastGrid(body, forecastPoints().length);
    expect(raw.times[0]).toBe('2026-10-20T12:00:00.000Z');
    expect(raw.times).toHaveLength(72);
    expect(raw.precip[0]).toHaveLength(273);
    expect(Math.min(...raw.freezingLevel.flat())).toBe(1460);
    expect(() => parseForecastGrid(body.slice(1), 273)).toThrow(/272 locations/);
  });
});

describe('snow share', () => {
  it('is snow well above the snowfall limit and rain well below', () => {
    // Freezing level 2000 m: limit 1700 m, transition 1550–1850 m.
    expect(snowFraction(2500, 2000)).toBe(1);
    expect(snowFraction(1700, 2000)).toBeCloseTo(0.5);
    expect(snowFraction(1000, 2000)).toBe(0);
  });

  it('weights the four surrounding points bilinearly', () => {
    const { w } = cellWeights(MODEL_GRID);
    for (let c = 0; c < 50; c++) expect(w[c * 4] + w[c * 4 + 1] + w[c * 4 + 2] + w[c * 4 + 3]).toBeCloseTo(1, 5);
  });
});

describe('accumulateFrames', () => {
  const grid = { west: 11, south: 46.5, east: 11.2, north: 46.6, width: 2, height: 1 };
  const elevation = Float32Array.from([3000, 500]);
  const n = FORECAST_GRID.cols * FORECAST_GRID.rows;
  const raw = {
    times: ['2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z', '2026-10-20T14:00:00.000Z', '2026-10-20T15:00:00.000Z'],
    precip: [0, 2, 2, 2].map((p) => new Array(n).fill(p)),
    freezingLevel: [1500, 1500, 1500, 1500].map((f) => new Array(n).fill(f)),
  };

  it('accumulates from the next whole hour, snow only above the snowfall limit', () => {
    const f = accumulateFrames(grid, elevation, raw, { now: '2026-10-20T12:30:00Z', stepHours: 1, maxHours: 72 });
    expect(f.start).toBe('2026-10-20T13:00:00.000Z');
    // The 13:00 value fell before the start; 14:00 and 15:00 count.
    expect(f.frames.map((x) => x.time)).toEqual(['2026-10-20T14:00:00.000Z', '2026-10-20T15:00:00.000Z']);
    expect([...f.frames[1].snowCm]).toEqual([4, 0]);
    expect(f.freezingLevelM).toEqual([1500, 1500]);
  });

  it('stops at maxHours and draws under 0.5 cm transparent', () => {
    const f = accumulateFrames(grid, elevation, raw, { now: '2026-10-20T12:30:00Z', stepHours: 1, maxHours: 1 });
    expect(f.frames).toHaveLength(1);
    const rgba = newSnowRgba(f.frames[0].snowCm);
    expect(rgba[3]).toBe(215);
    expect(rgba[7]).toBe(0);
  });
});
