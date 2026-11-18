// Fog top and temperature inversion from the stations around a point (docs/cloud-height-spike.md).
//
// Fog needs daylight. Each station is "in cloud", "clear" or unknown: a station in the sun is clear,
// one the sun could reach but did not (sunshine false) is in cloud when its air is humid, and dry
// air is clear. Humidity alone cannot decide: sensors read 100 % on clear nights and for a while in
// the morning sun (dew on the sensor). The stations are then split by height, and the split with
// cloud below and clear air above that fits best is the fog top. Without fog, or by night, the
// temperatures can still show an inversion: air higher up warmer than in the valley.

import { distanceM } from './geo.ts';

export interface ProfileStation {
  lon: number;
  lat: number;
  elevation: number;
  observedAt: string | null;
  airTempC: number | null;
  humidityPct?: number | null;
  sunshine?: boolean | null;
}

/** Stations this close to the point are used. */
export const RADIUS_M = 20_000;
/** Readings older than this before the newest one nearby are left out: fog moves fast. */
const SAME_TIME_MS = 60 * 60_000;
/** Fewer stations than this with a sun reading: night, or the sun too low to decide. */
const MIN_SUN_READINGS = 3;
/** Humidity (%) of a station in cloud, with the sun hidden. */
const CLOUD_RH = 90;
/** Humidity (%) at or below which a station is clear of cloud. */
const CLEAR_RH = 85;
/** Only stations this far above a split are compared with it: peaks often have their own cap cloud. */
const ABOVE_WINDOW_M = 1200;
/**
 * The first clear station above the split must be at least this far above the lowest station:
 * cloud at some valley stations and none at others of the same height is patchy fog, not a layer.
 */
const MIN_DEPTH_M = 150;
/** Fog or inversion tops above this are not reported (that is general cloud, not a sea of fog). */
export const MAX_TOP_M = 3000;
/** Shares that make a split believable: cloud below, clear above. */
const MIN_CLOUD_SHARE_BELOW = 0.75;
const MIN_CLEAR_SHARE_ABOVE = 0.8;
/** Valley stations: those within this of the lowest one. */
const VALLEY_BAND_M = 250;
/** Height window for the inversion (at least two stations in it), and the warming that counts as one. */
const WINDOW_M = 300;
const MIN_INVERSION_C = 1.5;
/** Warming above the fog top worth mentioning. */
const MIN_WARMER_C = 1;

export type Sky = 'cloud' | 'clear' | null;

export function skyAt(s: ProfileStation): Sky {
  if (s.sunshine === true) return 'clear';
  const rh = s.humidityPct ?? null;
  if (rh !== null && rh <= CLEAR_RH) return 'clear';
  // Humid in a mountain's shadow may just be cold, damp air, so only a hidden sun says cloud.
  if (s.sunshine === false) return rh === null || rh >= CLOUD_RH ? 'cloud' : null;
  return null;
}

export interface FogLayer {
  kind: 'fog';
  /** Highest station in cloud below the split, and the lowest clear one above it (m). */
  cloudTopM: number;
  clearFromM: number;
  /** Stations in cloud of all classified below the split; clear of all classified above (within the window). */
  cloudBelow: number;
  below: number;
  clearAbove: number;
  above: number;
  /** How many of the clear stations above had the sun. */
  sunAbove: number;
  /** Median temperature of the clear stations above minus the stations in cloud, when 1 °C or more. */
  warmerC: number | null;
  stations: number;
  observedAt: string;
}

export interface Inversion {
  kind: 'inversion';
  /** Median height of the valley stations and of the warmest band (m). */
  valleyM: number;
  topM: number;
  warmerC: number;
  stations: number;
  observedAt: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The stations near a point that were read at about the same time as the newest of them. */
export function nearbyStations<T extends ProfileStation>(all: readonly T[], lon: number, lat: number, radiusM = RADIUS_M): T[] {
  const near = all.filter((s) => s.observedAt && distanceM([s.lon, s.lat], [lon, lat]) <= radiusM);
  const newest = Math.max(...near.map((s) => Date.parse(s.observedAt!)));
  return near.filter((s) => newest - Date.parse(s.observedAt!) <= SAME_TIME_MS);
}

export function fogLayer(stations: readonly ProfileStation[]): FogLayer | null {
  if (stations.filter((s) => s.sunshine != null).length < MIN_SUN_READINGS) return null;
  const pts = stations
    .map((s) => ({ s, sky: skyAt(s) }))
    .filter((p): p is { s: ProfileStation; sky: 'cloud' | 'clear' } => p.sky !== null)
    .sort((a, b) => a.s.elevation - b.s.elevation);
  let best: (FogLayer & { misfits: number; fits: number }) | null = null;
  for (let i = 1; i < pts.length; i++) {
    const splitM = pts[i].s.elevation;
    if (splitM === pts[i - 1].s.elevation) continue;
    const below = pts.slice(0, i);
    const above = pts.slice(i).filter((p) => p.s.elevation < splitM + ABOVE_WINDOW_M);
    const cloud = below.filter((p) => p.sky === 'cloud');
    const clear = above.filter((p) => p.sky === 'clear');
    if (cloud.length < 2 || clear.length < 2) continue;
    if (cloud.length / below.length < MIN_CLOUD_SHARE_BELOW || clear.length / above.length < MIN_CLEAR_SHARE_ABOVE) continue;
    const cloudTopM = Math.max(...cloud.map((p) => p.s.elevation));
    const clearFromM = Math.min(...clear.map((p) => p.s.elevation));
    if (cloudTopM > MAX_TOP_M || clearFromM - pts[0].s.elevation < MIN_DEPTH_M) continue;
    // Fewest stations on the wrong side wins, then most on the right side. A clear night shows why:
    // saturated valley floors (ground fog) with dry, warmer slopes in between must not become one
    // deep layer up to the highest damp side valley. On a full tie the higher split wins: telling
    // people to climb a little more is the safe side.
    const misfits = below.length - cloud.length + (above.length - clear.length);
    const fits = cloud.length + clear.length;
    if (best && (misfits > best.misfits || (misfits === best.misfits && fits < best.fits))) continue;
    const temps = (ps: typeof pts) => ps.map((p) => p.s.airTempC).filter((t): t is number => t !== null);
    const [tCloud, tClear] = [temps(cloud), temps(clear)];
    const warmer = tCloud.length && tClear.length ? median(tClear) - median(tCloud) : null;
    best = {
      kind: 'fog',
      cloudTopM,
      clearFromM,
      cloudBelow: cloud.length,
      below: below.length,
      clearAbove: clear.length,
      above: above.length,
      sunAbove: clear.filter((p) => p.s.sunshine === true).length,
      warmerC: warmer !== null && warmer >= MIN_WARMER_C ? Math.round(warmer) : null,
      stations: stations.length,
      observedAt: newestTime(stations),
      misfits,
      fits,
    };
  }
  if (!best) return null;
  const { misfits: _m, fits: _f, ...layer } = best;
  return layer;
}

export function inversion(stations: readonly ProfileStation[]): Inversion | null {
  const pts = stations.filter((s) => s.airTempC !== null).sort((a, b) => a.elevation - b.elevation);
  if (pts.length < 4) return null;
  const lowest = pts[0].elevation;
  const valley = pts.filter((s) => s.elevation <= lowest + VALLEY_BAND_M);
  const valleyT = median(valley.map((s) => s.airTempC!));
  // Each station above the valley with its neighbours within half a window, two stations at least.
  const upper = pts.filter((s) => s.elevation > lowest + VALLEY_BAND_M && s.elevation <= MAX_TOP_M);
  let best: { t: number; m: number } | null = null;
  for (const c of upper) {
    const band = upper.filter((s) => Math.abs(s.elevation - c.elevation) <= WINDOW_M / 2);
    if (band.length < 2) continue;
    const t = median(band.map((s) => s.airTempC!));
    if (!best || t > best.t) best = { t, m: median(band.map((s) => s.elevation)) };
  }
  if (!best || best.t - valleyT < MIN_INVERSION_C) return null;
  return {
    kind: 'inversion',
    valleyM: median(valley.map((s) => s.elevation)),
    topM: best.m,
    warmerC: Math.round(best.t - valleyT),
    stations: stations.length,
    observedAt: newestTime(stations),
  };
}

const newestTime = (stations: readonly ProfileStation[]): string =>
  stations.reduce((a, s) => (s.observedAt && s.observedAt > a ? s.observedAt : a), '');

/** Fog first (it answers "how high to go"), else an inversion, else nothing. */
export function airLayers(all: readonly ProfileStation[], lon: number, lat: number): FogLayer | Inversion | null {
  const near = nearbyStations(all, lon, lat);
  return fogLayer(near) ?? inversion(near);
}
