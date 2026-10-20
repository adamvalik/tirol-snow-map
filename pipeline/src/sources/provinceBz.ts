// South Tyrol province meteo API v1 (CC0).
// stations: GeoJSON with SCODE, NAME_*, ALT, LAT, LONG.
// sensors:  [{SCODE, TYPE, UNIT, DATE: "2026-10-20T13:30:00CEST", VALUE}], one row per station and sensor.

import { cleanSnowDepth, hoursBetween, inBbox, msToKmh, num, round, type RawStation } from '../raw.ts';

interface ProvinceStationProps {
  SCODE: string;
  NAME_D?: string;
  NAME_I?: string;
  NAME_E?: string;
  ALT?: number;
  LAT?: number;
  LONG?: number;
}

interface ProvinceSensorRow {
  SCODE: string;
  TYPE: string;
  UNIT?: string;
  DATE?: string;
  VALUE?: number;
}

const ZONES: Record<string, string> = { CEST: '+02:00', CET: '+01:00', UTC: 'Z' };

/** Parses the API's `2026-10-20T13:30:00CEST` format to ISO 8601 UTC, or null if unrecognised. */
export function parseProvinceDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([A-Z]+)$/.exec(s);
  if (!m) return null;
  const offset = ZONES[m[2]];
  if (!offset) return null;
  const t = Date.parse(m[1] + offset);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function stationName(p: ProvinceStationProps): string {
  const de = p.NAME_D?.trim();
  const it = p.NAME_I?.trim();
  if (de && it && de !== it) return `${de} - ${it}`;
  return de || it || p.NAME_E?.trim() || p.SCODE;
}

/** Sensors the app uses; a station without any of them (e.g. a river gauge) is skipped. */
const METEO_TYPES = new Set(['HS', 'LT', 'WG', 'WG.BOE', 'WR']);

export function parseProvince(
  stationsGeojson: { features: { properties: ProvinceStationProps }[] },
  sensors: ProvinceSensorRow[],
  opts: { now: string; maxAgeHours: number; bbox: Parameters<typeof inBbox>[2] },
): RawStation[] {
  const bySation = new Map<string, Map<string, { value: number; date: string }>>();
  for (const row of sensors) {
    const value = num(row.VALUE);
    const date = parseProvinceDate(row.DATE);
    if (value === null || date === null || !METEO_TYPES.has(row.TYPE)) continue;
    if (hoursBetween(date, opts.now) > opts.maxAgeHours) continue;
    let m = bySation.get(row.SCODE);
    if (!m) bySation.set(row.SCODE, (m = new Map()));
    m.set(row.TYPE, { value, date });
  }

  const out: RawStation[] = [];
  for (const { properties: p } of stationsGeojson.features) {
    const s = bySation.get(p.SCODE);
    const lon = num(p.LONG);
    const lat = num(p.LAT);
    const elevation = num(p.ALT);
    if (!s || lon === null || lat === null || elevation === null || elevation <= 0) continue;
    if (!inBbox(lon, lat, opts.bbox)) continue;
    const v = (t: string) => s.get(t)?.value ?? null;
    const dates = [...s.values()].map((x) => x.date).sort();
    const temp = v('LT');
    out.push({
      source: 'province-bz',
      provider: 'province-bz',
      code: p.SCODE,
      name: stationName(p),
      lon,
      lat,
      elevation: round(elevation, 0),
      operator: 'Autonomous Province of Bolzano - South Tyrol',
      observedAt: dates.at(-1) ?? null,
      snowDepthCm: cleanSnowDepth(v('HS')),
      airTempC: temp === null ? null : round(temp),
      windSpeedKmh: msToKmh(v('WG')),
      windGustKmh: msToKmh(v('WG.BOE')),
      windDirDeg: v('WR') === null ? null : round(v('WR')!, 0),
      // The API's N sensor is a 5-minute value; the 24 h sum comes from the Euregio feed instead.
      precip24hMm: null,
    });
  }
  return out;
}
