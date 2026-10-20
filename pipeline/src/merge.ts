import type { SourceId, Station } from '../../shared/types.ts';
import { hoursBetween, type RawStation } from './raw.ts';

/** Two records closer than this, horizontally and vertically, are treated as the same station. */
export const SAME_STATION_M = 300;
export const SAME_STATION_DZ_M = 60;
/** A duplicate this much older than the freshest one only fills fields the fresher records lack. */
const STALE_DUPLICATE_HOURS = 3;

const FIELDS = [
  'snowDepthCm',
  'airTempC',
  'windSpeedKmh',
  'windGustKmh',
  'windDirDeg',
  'precip24hMm',
] as const;

export function distanceM(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const isSameStation = (a: RawStation, b: RawStation) =>
  a.provider !== b.provider &&
  Math.abs(a.elevation - b.elevation) <= SAME_STATION_DZ_M && distanceM(a, b) <= SAME_STATION_M;

/**
 * Merges records from several sources into one list of stations.
 * `bySource` is in priority order: on equal freshness, earlier sources win.
 * The same physical station often appears several times (the province API, the Euregio
 * feed's provincial copy and its avalanche-service copy), so near-identical positions are clustered.
 */
export function mergeStations(bySource: RawStation[][]): Station[] {
  const clusters: RawStation[][] = [];
  for (const records of bySource) {
    for (const r of records) {
      const c = clusters.find(
        (members) =>
          members.some((m) => isSameStation(m, r)) && !members.some((m) => m.provider === r.provider),
      );
      if (c) c.push(r);
      else clusters.push([r]);
    }
  }
  return clusters.map(mergeCluster).sort((a, b) => a.id.localeCompare(b.id));
}

function mergeCluster(members: RawStation[]): Station {
  const newest = members
    .map((m) => m.observedAt)
    .filter((t): t is string => t !== null)
    .sort()
    .at(-1);
  const fresh = (m: RawStation) =>
    newest === undefined || (m.observedAt !== null && hoursBetween(m.observedAt, newest) <= STALE_DUPLICATE_HOURS);
  // Stable sort keeps source priority within the fresh and the stale group.
  const ordered = [...members].sort((a, b) => Number(fresh(b)) - Number(fresh(a)));
  const primary = ordered[0];

  const station: Station = {
    id: `${primary.source}:${primary.code}`,
    name: primary.name || ordered.find((m) => m.name)?.name || primary.code,
    lon: primary.lon,
    lat: primary.lat,
    elevation: primary.elevation,
    sources: [...new Set(ordered.map((m) => m.source))] as SourceId[],
    operator: primary.operator,
    observedAt: newest ?? null,
    snowDepthCm: null,
    airTempC: null,
    windSpeedKmh: null,
    windGustKmh: null,
    windDirDeg: null,
    precip24hMm: null,
  };
  for (const f of FIELDS) {
    station[f] = ordered.find((m) => m[f] !== null)?.[f] ?? null;
  }
  return station;
}
