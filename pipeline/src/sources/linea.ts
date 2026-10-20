// Euregio station feed behind avalanche.report ("linea" format, SMET-style SI units):
// HS in m, TA in K, VW / VW_MAX in m/s, DW in degrees, PSUM_24 in mm, date ISO 8601 UTC.

import {
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
  opts: { now: string; maxAgeHours: number; bbox: Parameters<typeof inBbox>[2] },
): RawStation[] {
  const out: RawStation[] = [];
  for (const f of geojson.features) {
    const p = f.properties;
    const [lon, lat, z] = f.geometry.coordinates;
    if (num(lon) === null || num(lat) === null || !inBbox(lon, lat, opts.bbox)) continue;
    // Elevation is in the geometry; a few stations carry 0 there and the real value in `altitude`.
    const elevation = num(z) || num(p.altitude);
    if (!elevation || elevation <= 0) continue;

    const observedAt = parseLineaDate(str(p.date), opts.now);
    if (observedAt === null || hoursBetween(observedAt, opts.now) > opts.maxAgeHours) continue;

    const hsM = num(p.HS);
    const taK = num(p.TA);
    const dw = num(p.DW);
    const psum = num(p.PSUM_24);
    const provider = str(p.dataProviderID) || 'unknown';
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
      snowDepthCm: cleanSnowDepth(hsM === null ? null : hsM * 100),
      airTempC: taK === null ? null : round(taK - 273.15),
      windSpeedKmh: msToKmh(num(p.VW)),
      windGustKmh: msToKmh(num(p.VW_MAX)),
      windDirDeg: dw === null ? null : round(dw, 0),
      precip24hMm: psum === null || psum < 0 ? null : round(psum),
    };
    const hasData =
      record.snowDepthCm !== null || record.airTempC !== null || record.windSpeedKmh !== null;
    if (hasData) out.push(record);
  }
  return out;
}
