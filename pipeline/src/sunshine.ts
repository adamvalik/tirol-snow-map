// Did a station have the sun at its reading time? Radiation alone cannot tell fog from the shade of
// a mountain: in winter many valley stations lie in a ridge's shadow all morning. So the sun's
// position is checked against the station's skyline on the terrain grid first, and only a station
// the sun could reach is called "in the sun" or "sun hidden" (by cloud or fog). See
// docs/cloud-height-spike.md.

import { getPosition } from 'suncalc';
import { type GridSpec, sampleGrid } from '../../shared/grid.ts';
import { curvatureDrop } from '../../shared/horizon.ts';
import type { RawStation } from './raw.ts';

/** Below this the sun is too low for radiation to say much (and the skyline matters most). */
export const SUN_MIN_ALTITUDE_DEG = 8;
/**
 * The sun must clear the skyline by this much to count as reaching the station: the 250 m grid
 * smooths the ridges, and the radiation sensor reads a 10-minute mean.
 */
export const SKYLINE_MARGIN_DEG = 2;
/** Rays start this far out: the station's own cell and its neighbours are averaged over slopes and valley floor. */
const RAY_START_M = 750;
const RAY_STEP_M = 125;
const RAY_END_M = 40_000;
/** Radiation against the clear-sky value: at least this share is sun, at most `HIDDEN` is cloud or fog. */
const SUNNY_SHARE = 0.6;
const HIDDEN_SHARE = 0.3;

const DEG = 180 / Math.PI;
const EARTH_RADIUS = 6_371_000;

/** Clear-sky global radiation on flat ground (W/m²), Haurwitz's model. */
export function clearSkyRadiation(altitudeDeg: number): number {
  const c = Math.sin(altitudeDeg / DEG);
  return c <= 0 ? 0 : 1098 * c * Math.exp(-0.057 / c);
}

/**
 * Sun or not from the sensors, given the sun's altitude: the sunshine sensor wins when there is
 * one, else radiation against the clear-sky value. Null in between and without sensors.
 */
export function measuredSunshine(r: Pick<RawStation, 'radiationWm2' | 'sunshineShare'>, altitudeDeg: number): boolean | null {
  if (r.sunshineShare != null) return r.sunshineShare >= 0.5 ? true : r.sunshineShare <= 0.1 ? false : null;
  if (r.radiationWm2 != null) {
    const share = r.radiationWm2 / clearSkyRadiation(altitudeDeg);
    return share >= SUNNY_SHARE ? true : share <= HIDDEN_SHARE ? false : null;
  }
  return null;
}

export interface Terrain {
  grid: GridSpec;
  values: ArrayLike<number>;
  /** Highest value of the grid, to stop rays early. */
  zMax: number;
}

/** Skyline angle (degrees) seen from a point at `ground` metres towards `azimuth` (degrees from north). */
export function skylineAngle(t: Terrain, lon: number, lat: number, ground: number, azimuth: number): number {
  const z0 = ground + 2;
  const lat0 = lat / DEG;
  const north = Math.cos(azimuth / DEG);
  const east = Math.sin(azimuth / DEG);
  let best = -90;
  for (let d = RAY_START_M; d <= RAY_END_M; d += RAY_STEP_M) {
    const drop = curvatureDrop(d);
    if (Math.atan2(t.zMax - drop - z0, d) * DEG < best) break;
    const latR = lat0 + (d * north) / EARTH_RADIUS;
    const lonDeg = lon + ((d * east) / (EARTH_RADIUS * Math.cos((lat0 + latR) / 2))) * DEG;
    const z = sampleGrid(t.grid, t.values, lonDeg, latR * DEG);
    if (z === null) break;
    best = Math.max(best, Math.atan2(z - drop - z0, d) * DEG);
  }
  return best;
}

/** Whether the sun stood clear of the skyline at a station and time; null when the sun is too low or the station is off the grid. */
export function sunReaches(t: Terrain, r: Pick<RawStation, 'lon' | 'lat' | 'elevation'>, at: Date): { reaches: boolean; altitude: number } | null {
  const sun = getPosition(at, r.lat, r.lon);
  if (sun.altitude < SUN_MIN_ALTITUDE_DEG) return null;
  if (sampleGrid(t.grid, t.values, r.lon, r.lat) === null) return null;
  return { reaches: sun.altitude >= skylineAngle(t, r.lon, r.lat, r.elevation, sun.azimuth) + SKYLINE_MARGIN_DEG, altitude: sun.altitude };
}

/** Sets `sunshine` on every record: see Station.sunshine. */
export function markSunshine(records: RawStation[], t: Terrain): void {
  for (const r of records) {
    r.sunshine = null;
    if (!r.observedAt || (r.radiationWm2 == null && r.sunshineShare == null)) continue;
    const sun = sunReaches(t, r, new Date(r.observedAt));
    if (sun?.reaches) r.sunshine = measuredSunshine(r, sun.altitude);
  }
}

export function terrainOf(dem: { grid: GridSpec; values: Float32Array }): Terrain {
  let zMax = -Infinity;
  for (const v of dem.values) if (v > zMax) zMax = v;
  return { grid: dem.grid, values: dem.values, zMax };
}
