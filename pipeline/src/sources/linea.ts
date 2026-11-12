// Euregio station feed behind avalanche.report ("linea" format, SMET-style SI units):
// HS in m, TA in K, VW / VW_MAX in m/s, DW in degrees, PSUM_24 in mm, date ISO 8601 with offset.
// Some providers leave SMET's no-data value (-777, sometimes -999) in the numbers.

import {
  cleanSnowChange,
  cleanSnowDepth,
  hoursBetween,
  inBbox,
  msToKmh,
  num,
  romeOffsetMinutes,
  round,
  type RawStation,
} from '../raw.ts';

interface LineaFeature {
  id?: string;
  geometry: { coordinates: number[] };
  properties: Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A number, with SMET's no-data markers treated as missing. */
const val = (v: unknown): number | null => {
  const n = num(v);
  return n === null || n === -777 || n === -999 ? null : n;
};

/** Newest reading time in a feed (ISO UTC), whatever its location, or null if it has none. */
export function newestLineaDate(geojson: { features: LineaFeature[] }): string | null {
  let newest = -Infinity;
  for (const f of geojson.features) {
    const t = Date.parse(str(f.properties.date));
    if (t > newest) newest = t;
  }
  return Number.isFinite(newest) ? new Date(newest).toISOString() : null;
}

/** Allowance for clock skew before a timestamp counts as "in the future". */
const FUTURE_TOLERANCE_MS = 15 * 60_000;

/**
 * Parses a feed timestamp to ISO UTC. Some providers (seen with IT-32-BZ) publish local
 * Europe/Rome time with a `Z` suffix, which puts readings up to two hours in the future;
 * such timestamps are reinterpreted as local time.
 */
export function parseLineaDate(s: string, now: string): string | null {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  if (t > Date.parse(now) + FUTURE_TOLERANCE_MS) {
    const corrected = t - romeOffsetMinutes(new Date(t)) * 60_000;
    return corrected > Date.parse(now) + FUTURE_TOLERANCE_MS ? null : new Date(corrected).toISOString();
  }
  return new Date(t).toISOString();
}

export function parseLinea(
  geojson: { features: LineaFeature[] },
  opts: {
    now: string;
    maxAgeHours: number;
    bbox: Parameters<typeof inBbox>[2];
    /** Provider of the whole feed; a per-station dataProviderID (old combined feed) wins. */
    provider?: string;
  },
): RawStation[] {
  const out: RawStation[] = [];
  for (const f of geojson.features) {
    const p = f.properties;
    const [lon, lat, z] = f.geometry.coordinates;
    if (num(lon) === null || num(lat) === null || !inBbox(lon, lat, opts.bbox)) continue;
    // Elevation is in the geometry; a few stations carry 0 there and the real value in `altitude`.
    const elevation = val(z) || val(p.altitude);
    if (!elevation || elevation <= 0) continue;

    const observedAt = parseLineaDate(str(p.date), opts.now);
    if (observedAt === null || hoursBetween(observedAt, opts.now) > opts.maxAgeHours) continue;

    const hsM = val(p.HS);
    const taK = val(p.TA);
    const dw = val(p.DW);
    const psum = val(p.PSUM_24);
    const snowDepthCm = cleanSnowDepth(hsM === null ? null : hsM * 100);
    const change = (key: string) => {
      const m = val(p[key]);
      return cleanSnowChange(m === null ? null : m * 100, snowDepthCm);
    };
    const provider = str(p.dataProviderID) || opts.provider || 'unknown';
    const record: RawStation = {
      source: 'euregio-linea',
      provider,
      // Short codes are only unique per provider (GeoSphere and ALBINA both use e.g. MITT1).
      code: `${provider}/${str(p.shortName) || str(f.id) || `${lon},${lat}`}`,
      name: str(p.name),
      lon,
      lat,
      elevation: round(elevation, 0),
      operator: str(p.operator),
      observedAt,
      snowDepthCm,
      airTempC: taK === null ? null : round(taK - 273.15),
      windSpeedKmh: msToKmh(val(p.VW)),
      windGustKmh: msToKmh(val(p.VW_MAX)),
      windDirDeg: dw === null ? null : round(dw, 0),
      precip24hMm: psum === null || psum < 0 ? null : round(psum),
      snowChange24hCm: change('HSD_24'),
      snowChange48hCm: change('HSD_48'),
      snowChange72hCm: change('HSD_72'),
    };
    const hasData =
      record.snowDepthCm !== null || record.airTempC !== null || record.windSpeedKmh !== null;
    if (hasData) out.push(record);
  }
  return out;
}
