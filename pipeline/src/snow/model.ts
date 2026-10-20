// Snow depth estimate on the model grid (see plan.md, "Estimating snow depth at every point"):
//
//   S(x,y) = max(0, a + b·h(x,y) + Σ wᵢ(x,y)·rᵢ),   rᵢ = Sᵢ − (a + b·hᵢ)
//
// 1. Fit the elevation trend a + b·h to station depths (least squares).
// 2. Spread station residuals with inverse distance weighting. A "nugget" keeps weights finite at a
//    station, and a zero-residual pseudo-station at SHRINK_KM makes the correction fade back to the
//    trend away from stations, so one odd station does not colour a whole valley.
// 3. Evaluate on the elevation grid, mask with satellite snow cover, attach a confidence class.
// Leave-one-out validation compares trend-only against trend + residuals; the better one is used.

import { cellCenter, type GridSpec } from '../../../shared/grid.ts';

export interface ModelStation {
  id: string;
  lon: number;
  lat: number;
  elevation: number;
  depthCm: number;
}

export interface ModelParams {
  /** Stations beyond this distance are ignored when spreading residuals. */
  radiusKm: number;
  /** IDW exponent. */
  power: number;
  /** Softening distance: weight = 1 / (d² + nugget²)^(power/2). */
  nuggetKm: number;
  /** Distance at which a zero residual weighs as much as a station, pulling the estimate back to the trend. */
  shrinkKm: number;
}

export const DEFAULT_PARAMS: ModelParams = { radiusKm: 40, power: 2, nuggetKm: 2, shrinkKm: 12 };

/** Snow cover below this fraction counts as snow-free (plan: about 15 percent). */
export const SNOW_FREE_BELOW_PCT = 15;

export type Method = 'trend' | 'trend+residuals';

export interface Trend {
  /** Depth at sea level (cm); usually negative. */
  a: number;
  /** cm per metre of elevation. */
  b: number;
}

const KM_PER_DEG_LAT = 111.32;

export function distanceKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const kx = KM_PER_DEG_LAT * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * KM_PER_DEG_LAT);
}

/** Least-squares line through (elevation, depth). Falls back to a flat mean if elevations barely vary. */
export function fitTrend(stations: ModelStation[]): Trend {
  const n = stations.length;
  if (n === 0) return { a: 0, b: 0 };
  const mx = stations.reduce((s, x) => s + x.elevation, 0) / n;
  const my = stations.reduce((s, x) => s + x.depthCm, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const s of stations) {
    sxx += (s.elevation - mx) ** 2;
    sxy += (s.elevation - mx) * (s.depthCm - my);
  }
  if (n < 3 || sxx / n < 100 ** 2) return { a: my, b: 0 };
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

export const trendAt = (t: Trend, h: number): number => t.a + t.b * h;

/** Weighted residual correction at a point. */
export function residualAt(
  p: { lon: number; lat: number },
  stations: ModelStation[],
  residuals: number[],
  params: ModelParams,
): number {
  const half = params.power / 2;
  let num = 0;
  // The zero-residual pseudo-station: contributes weight but nothing to the numerator.
  let den = 1 / (params.shrinkKm ** 2 + params.nuggetKm ** 2) ** half;
  for (let i = 0; i < stations.length; i++) {
    const d = distanceKm(p, stations[i]);
    if (d > params.radiusKm) continue;
    const w = 1 / (d * d + params.nuggetKm ** 2) ** half;
    num += w * residuals[i];
    den += w;
  }
  return num / den;
}

export interface Fitted {
  method: Method;
  trend: Trend;
  stations: ModelStation[];
  residuals: number[];
  params: ModelParams;
}

export function fit(stations: ModelStation[], method: Method, params = DEFAULT_PARAMS): Fitted {
  const trend = fitTrend(stations);
  return { method, trend, stations, residuals: stations.map((s) => s.depthCm - trendAt(trend, s.elevation)), params };
}

export function predict(f: Fitted, p: { lon: number; lat: number }, elevation: number): number {
  let v = trendAt(f.trend, elevation);
  if (f.method === 'trend+residuals') v += residualAt(p, f.stations, f.residuals, f.params);
  return Math.max(0, v);
}

export interface BandError {
  label: string;
  n: number;
  maeCm: number;
}

export interface Validation {
  n: number;
  /** Mean absolute error of each method when every station is predicted from all the others. */
  maeCm: Record<Method, number>;
  /** Per elevation band, for the chosen method. */
  byBand: BandError[];
  chosen: Method;
}

const BANDS: [string, number, number][] = [
  ['below 1500 m', -Infinity, 1500],
  ['1500–2000 m', 1500, 2000],
  ['2000–2500 m', 2000, 2500],
  ['above 2500 m', 2500, Infinity],
];

/** Leave-one-out cross-validation: hide each station, predict it from the rest, compare. */
export function leaveOneOut(stations: ModelStation[], params = DEFAULT_PARAMS): Validation {
  const errors: Record<Method, number[]> = { trend: [], 'trend+residuals': [] };
  for (let i = 0; i < stations.length; i++) {
    const rest = stations.filter((_, j) => j !== i);
    for (const method of ['trend', 'trend+residuals'] as Method[]) {
      const f = fit(rest, method, params);
      errors[method].push(Math.abs(predict(f, stations[i], stations[i].elevation) - stations[i].depthCm));
    }
  }
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  const maeCm = { trend: mean(errors.trend), 'trend+residuals': mean(errors['trend+residuals']) };
  // Prefer the simpler trend unless the residual correction clearly helps (by 3 % and at least 0.1 cm).
  const gain = maeCm.trend - maeCm['trend+residuals'];
  const chosen: Method = gain > 0.1 && gain > maeCm.trend * 0.03 ? 'trend+residuals' : 'trend';
  const byBand = BANDS.map(([label, lo, hi]) => {
    const idx = stations.map((s, i) => (s.elevation >= lo && s.elevation < hi ? i : -1)).filter((i) => i >= 0);
    return { label, n: idx.length, maeCm: mean(idx.map((i) => errors[chosen][i])) };
  });
  return { n: stations.length, maeCm, byBand, chosen };
}

/** Per-cell confidence: 0 low, 1 medium, 2 high. */
export type Confidence = 0 | 1 | 2;

/** Snow cover per cell: 0–100 percent, or one of these flags. */
export const COVER_CLOUD = 254;
export const COVER_NODATA = 255;

export interface GridEstimate {
  /** Estimated depth in cm per cell. */
  depthCm: Float32Array;
  confidence: Uint8Array;
  /** Why a cell is what it is, for the info panel and click readout. */
  stats: { cells: number; maskedBySatellite: number; cloudy: number; noCover: number; high: number; medium: number; low: number };
}

export interface ConfidenceRules {
  /** Within this distance of a snow station and inside the stations' elevation range: high. */
  highKm: number;
  /** Within this distance and within `elevationMarginM` of the range: medium. */
  mediumKm: number;
  elevationMarginM: number;
}

export const DEFAULT_CONFIDENCE: ConfidenceRules = { highKm: 10, mediumKm: 25, elevationMarginM: 300 };

export function estimateGrid(
  grid: GridSpec,
  elevation: Float32Array,
  f: Fitted,
  cover: Uint8Array | null,
  rules = DEFAULT_CONFIDENCE,
): GridEstimate {
  const n = grid.width * grid.height;
  const depthCm = new Float32Array(n);
  const confidence = new Uint8Array(n);
  const stats = { cells: n, maskedBySatellite: 0, cloudy: 0, noCover: 0, high: 0, medium: 0, low: 0 };
  const hMin = Math.min(...f.stations.map((s) => s.elevation));
  const hMax = Math.max(...f.stations.map((s) => s.elevation));

  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const i = row * grid.width + col;
      const p = cellCenter(grid, col, row);
      const h = elevation[i];
      const c = cover ? cover[i] : COVER_NODATA;

      let conf: Confidence;
      let nearest = Infinity;
      for (const s of f.stations) nearest = Math.min(nearest, distanceKm(p, s));
      const inRange = h >= hMin && h <= hMax;
      const nearRange = h >= hMin - rules.elevationMarginM && h <= hMax + rules.elevationMarginM;
      conf = nearest <= rules.highKm && inRange ? 2 : nearest <= rules.mediumKm && nearRange ? 1 : 0;

      if (c <= 100 && c < SNOW_FREE_BELOW_PCT) {
        // The satellite saw (almost) bare ground: no snow, and that is a direct observation.
        depthCm[i] = 0;
        conf = 2;
        stats.maskedBySatellite++;
      } else {
        depthCm[i] = predict(f, p, h);
        if (c === COVER_CLOUD || c === COVER_NODATA) {
          // No satellite check here: one level less confident.
          conf = Math.max(0, conf - 1) as Confidence;
          if (c === COVER_CLOUD) stats.cloudy++;
          else stats.noCover++;
        }
      }
      confidence[i] = conf;
      if (conf === 2) stats.high++;
      else if (conf === 1) stats.medium++;
      else stats.low++;
    }
  }
  return { depthCm, confidence, stats };
}
