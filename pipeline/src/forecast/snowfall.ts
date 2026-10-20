// Forecast new snow on the model grid. Open-Meteo is asked for hourly precipitation and freezing
// level on a coarse grid of points (one multi-location request); both are interpolated to the
// 250 m cells and the terrain decides how much of the precipitation falls as snow:
//
//   snow(cell, hour) = precip(hour) · fraction(h, freezing level) · SNOW_CM_PER_MM
//
// The model's own snowfall is not used: it is computed for the model's smooth orography, which
// sits far below the peaks and above the valley floors, so it misses the snow line.

import { cellCenter, type GridSpec } from '../../../shared/grid.ts';
import { snowClassColor } from '../../../shared/snowColors.ts';

/** Coarse forecast grid over MODEL_GRID: 21 × 13 points, about 10 × 11 km apart. */
export const FORECAST_GRID = { west: 10.2, south: 46.1, lonStep: 0.125, latStep: 0.1, cols: 21, rows: 13 } as const;
/** Snowfall limit below the freezing level (m); rule of thumb for the Alps is 200–400 m. */
export const SNOW_LIMIT_BELOW_FL_M = 300;
/** Width of the rain-to-snow transition around the snowfall limit (m). */
export const MIX_BAND_M = 300;
/** Fresh snow from 1 mm of water (10:1). */
export const SNOW_CM_PER_MM = 1;

export interface ForecastPoint {
  lat: number;
  lon: number;
}

/** Points row by row from the south-west corner, west to east. */
export function forecastPoints(g = FORECAST_GRID): ForecastPoint[] {
  const pts: ForecastPoint[] = [];
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.cols; i++) pts.push({ lat: +(g.south + j * g.latStep).toFixed(3), lon: +(g.west + i * g.lonStep).toFixed(3) });
  }
  return pts;
}

export function forecastGridUrl(points: ForecastPoint[], hours: number): string {
  const p = new URLSearchParams({
    latitude: points.map((x) => x.lat).join(','),
    longitude: points.map((x) => x.lon).join(','),
    hourly: 'precipitation,freezing_level_height',
    forecast_hours: String(hours),
    timezone: 'GMT',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

export interface RawForecast {
  /** Hour ends, ISO 8601 UTC; precipitation at time T fell during the hour before T. */
  times: string[];
  /** [hour][point] mm. */
  precip: number[][];
  /** [hour][point] m above sea level. */
  freezingLevel: number[][];
}

interface OmLocation {
  hourly?: { time?: string[]; precipitation?: (number | null)[]; freezing_level_height?: (number | null)[] };
}

/** Open-Meteo answers a multi-location request with one object per location, in request order. */
export function parseForecastGrid(body: unknown, pointCount: number): RawForecast {
  const list = (Array.isArray(body) ? body : [body]) as OmLocation[];
  if (list.length !== pointCount) throw new Error(`Open-Meteo returned ${list.length} locations, expected ${pointCount}`);
  const times = list[0].hourly?.time;
  if (!times?.length) throw new Error('Open-Meteo response has no hourly times');
  const precip = times.map(() => new Array<number>(pointCount).fill(0));
  const freezingLevel = times.map(() => new Array<number>(pointCount).fill(0));
  list.forEach((loc, p) => {
    const h = loc.hourly;
    if (!h?.precipitation || !h.freezing_level_height || h.time?.length !== times.length) {
      throw new Error(`Open-Meteo location ${p} lacks hourly precipitation or freezing level`);
    }
    for (let t = 0; t < times.length; t++) {
      precip[t][p] = Math.max(0, h.precipitation[t] ?? 0);
      // A missing freezing level is treated as very high: no snow rather than invented snow.
      freezingLevel[t][p] = h.freezing_level_height[t] ?? 6000;
    }
  });
  // timezone=GMT gives "2026-10-20T12:00" without an offset.
  return { times: times.map((t) => new Date(t.endsWith('Z') ? t : `${t}Z`).toISOString()), precip, freezingLevel };
}

/** Share of precipitation falling as snow at elevation `h` for a given freezing level. */
export function snowFraction(h: number, freezingLevel: number): number {
  const limit = freezingLevel - SNOW_LIMIT_BELOW_FL_M;
  return Math.min(1, Math.max(0, (h - limit) / MIX_BAND_M + 0.5));
}

/** Bilinear weights of the four forecast points around each model cell. */
export function cellWeights(grid: GridSpec, g = FORECAST_GRID): { idx: Uint16Array; w: Float32Array } {
  const n = grid.width * grid.height;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const { lon, lat } = cellCenter(grid, col, row);
      const fx = Math.min(g.cols - 1.000001, Math.max(0, (lon - g.west) / g.lonStep));
      const fy = Math.min(g.rows - 1.000001, Math.max(0, (lat - g.south) / g.latStep));
      const i0 = Math.floor(fx);
      const j0 = Math.floor(fy);
      const tx = fx - i0;
      const ty = fy - j0;
      const k = (row * grid.width + col) * 4;
      const p = (j: number, i: number) => j * g.cols + i;
      idx.set([p(j0, i0), p(j0, i0 + 1), p(j0 + 1, i0), p(j0 + 1, i0 + 1)], k);
      w.set([(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty], k);
    }
  }
  return { idx, w };
}

export interface Frames {
  /** Start of the accumulation (ISO, whole hour). */
  start: string;
  /** Frame times and the new snow (cm) accumulated from `start` to each, per cell. */
  frames: { time: string; snowCm: Float32Array }[];
  freezingLevelM: [number, number];
}

/**
 * Accumulates snow from the first hour after `now` and snapshots it every `stepHours`, for at
 * most `maxHours`.
 */
export function accumulateFrames(
  grid: GridSpec,
  elevation: Float32Array,
  raw: RawForecast,
  opts: { now: string; stepHours: number; maxHours: number },
): Frames {
  const startMs = Math.ceil(Date.parse(opts.now) / 3_600_000) * 3_600_000;
  const { idx, w } = cellWeights(grid);
  const n = grid.width * grid.height;
  const acc = new Float32Array(n);
  const frames: Frames['frames'] = [];
  let flMin = Infinity;
  let flMax = -Infinity;
  for (let t = 0; t < raw.times.length; t++) {
    const tMs = Date.parse(raw.times[t]);
    const hoursIn = (tMs - startMs) / 3_600_000;
    if (hoursIn <= 0) continue;
    if (hoursIn > opts.maxHours) break;
    const P = raw.precip[t];
    const F = raw.freezingLevel[t];
    for (const v of F) {
      flMin = Math.min(flMin, v);
      flMax = Math.max(flMax, v);
    }
    for (let c = 0; c < n; c++) {
      const k = c * 4;
      const p = w[k] * P[idx[k]] + w[k + 1] * P[idx[k + 1]] + w[k + 2] * P[idx[k + 2]] + w[k + 3] * P[idx[k + 3]];
      if (p <= 0) continue;
      const f = w[k] * F[idx[k]] + w[k + 1] * F[idx[k + 1]] + w[k + 2] * F[idx[k + 2]] + w[k + 3] * F[idx[k + 3]];
      acc[c] += p * snowFraction(elevation[c], f) * SNOW_CM_PER_MM;
    }
    if (hoursIn % opts.stepHours === 0) frames.push({ time: new Date(tMs).toISOString(), snowCm: acc.slice() });
  }
  return {
    start: new Date(startMs).toISOString(),
    frames,
    freezingLevelM: Number.isFinite(flMin) ? [Math.round(flMin), Math.round(flMax)] : [0, 0],
  };
}

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

/** New snow in the shared snow colour classes; under 0.5 cm transparent. */
export function newSnowRgba(snowCm: Float32Array): Uint8Array {
  const out = new Uint8Array(snowCm.length * 4);
  for (let i = 0; i < snowCm.length; i++) {
    if (snowCm[i] < 0.5) continue;
    out.set([...hex(snowClassColor(snowCm[i])), 215], i * 4);
  }
  return out;
}
