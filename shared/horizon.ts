// Horizon and visible sun for one viewpoint (tier 2 of docs/sun-shade-spike.md): how high the
// terrain rises above the eye in every compass direction, and when the sun clears it on a day.
// It reads elevation through samplers, so the app (fine tiles near the point, the 250 m grid
// further out) and the pipeline (the grid alone) can share it.
//
// Conventions as in SunCalc 2.x and the map: azimuth in degrees clockwise from north, angles in
// degrees above the horizontal, times as UTC milliseconds.

/** Elevation in metres at a point, or null where the sampler has no data. */
export type ElevationSampler = (lon: number, lat: number) => number | null;

/** One stretch of every ray: sampled every `step` metres out to `until` metres. */
export interface RayBand {
  sampler: ElevationSampler;
  until: number;
  step: number;
}

export interface HorizonOptions {
  /** Nearest band first. Where a band's sampler has no data, the next bands' samplers are tried. */
  bands: RayBand[];
  /** Highest terrain any sampler can return; rays stop once even that peak could not rise above the horizon found. */
  zMax: number;
  /** Eye height above the ground, metres. */
  observerHeight?: number;
  /** Compass step, degrees. */
  stepDeg?: number;
  /** Subtract the earth's curvature (with refraction) from distant terrain. */
  curvature?: boolean;
}

export interface Horizon {
  stepDeg: number;
  /** Elevation angle of the skyline for azimuth i × stepDeg, degrees. */
  angles: Float32Array;
  /** Distance to the terrain that forms the skyline, metres (NaN where nothing rises above the eye's flat horizon). */
  distances: Float32Array;
}

const EARTH_RADIUS = 6_371_000;
/** Standard refraction coefficient: light bends with the earth, so far terrain sinks a little less. */
const REFRACTION_K = 0.13;
const DEG = 180 / Math.PI;

/** Height a point at distance d sinks below the eye's horizontal through curvature and refraction. */
export const curvatureDrop = (d: number): number => (d * d * (1 - REFRACTION_K)) / (2 * EARTH_RADIUS);

export function horizonProfile(lon: number, lat: number, ground: number, opts: HorizonOptions): Horizon {
  const stepDeg = opts.stepDeg ?? 1;
  const n = Math.round(360 / stepDeg);
  const angles = new Float32Array(n);
  const distances = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const { angle, distance } = horizonAngle(lon, lat, ground, i * stepDeg, opts);
    angles[i] = angle;
    distances[i] = distance;
  }
  return { stepDeg, angles, distances };
}

/** Skyline angle towards one azimuth, and the distance to the terrain forming it (NaN below the flat horizon). */
export function horizonAngle(
  lon: number,
  lat: number,
  ground: number,
  azimuth: number,
  opts: HorizonOptions,
): { angle: number; distance: number } {
  const { bands, zMax, observerHeight = 2, curvature = true } = opts;
  const z0 = ground + observerHeight;
  const lat0 = lat / DEG;
  const sample = (b: number, x: number, y: number): number | null => {
    for (let k = b; k < bands.length; k++) {
      const z = bands[k].sampler(x, y);
      if (z !== null) return z;
    }
    return null;
  };
  const az = azimuth / DEG;
  const north = Math.cos(az);
  const east = Math.sin(az);
  let best = -90;
  let bestD = NaN;
  let d = 0;
  ray: for (let b = 0; b < bands.length; b++) {
    const { until, step } = bands[b];
    for (d += step; d <= until; d += step) {
      const drop = curvature ? curvatureDrop(d) : 0;
      if (Math.atan2(zMax - drop - z0, d) * DEG < best) break ray;
      // Local east/north offsets on a sphere; plenty for 100 km rays.
      const latR = lat0 + (d * north) / EARTH_RADIUS;
      const lonDeg = lon + ((d * east) / (EARTH_RADIUS * Math.cos((lat0 + latR) / 2))) * DEG;
      const z = sample(b, lonDeg, latR * DEG);
      if (z === null) break ray;
      const angle = Math.atan2(z - drop - z0, d) * DEG;
      if (angle > best) {
        best = angle;
        bestD = d;
      }
    }
    d -= step;
  }
  return { angle: best, distance: best > 0 ? bestD : NaN };
}

/** Skyline angle towards an azimuth, interpolated between the profile's steps. */
export function horizonAt(h: Horizon, azimuth: number): number {
  const n = h.angles.length;
  const idx = ((((azimuth % 360) + 360) % 360) / h.stepDeg) % n;
  const i0 = Math.floor(idx);
  const f = idx - i0;
  return h.angles[i0] * (1 - f) + h.angles[(i0 + 1) % n] * f;
}

/** Apparent radius of the sun; it counts as visible while its top edge is above the skyline. */
export const SUN_RADIUS = 0.27;

export interface SunWindow {
  start: number;
  end: number;
}

/**
 * Periods between `from` and `to` when the sun's top edge is above the skyline. The day is
 * scanned every `stepMs` and each crossing refined by bisection to about a second.
 * `sunAt` returns the sun's azimuth and refraction-corrected altitude at a time.
 */
export function sunWindows(
  h: Horizon,
  sunAt: (t: number) => { azimuth: number; altitude: number },
  from: number,
  to: number,
  stepMs = 2 * 60_000,
): SunWindow[] {
  const clearance = (t: number) => {
    const s = sunAt(t);
    return s.altitude + SUN_RADIUS - horizonAt(h, s.azimuth);
  };
  const refine = (a: number, b: number, va: number) => {
    while (b - a > 1000) {
      const mid = (a + b) / 2;
      const vm = clearance(mid);
      if (vm > 0 === va > 0) {
        a = mid;
        va = vm;
      } else b = mid;
    }
    return Math.round((a + b) / 2);
  };
  const windows: SunWindow[] = [];
  let prevT = from;
  let prevV = clearance(from);
  let start: number | null = prevV > 0 ? from : null;
  for (let t = Math.min(from + stepMs, to); prevT < to; t = Math.min(t + stepMs, to)) {
    const v = clearance(t);
    if (v > 0 !== prevV > 0) {
      const cross = refine(prevT, t, prevV);
      if (v > 0) start = cross;
      else if (start !== null) {
        windows.push({ start, end: cross });
        start = null;
      }
    }
    prevT = t;
    prevV = v;
  }
  if (start !== null) windows.push({ start, end: to });
  return windows;
}
