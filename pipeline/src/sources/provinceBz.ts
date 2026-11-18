// South Tyrol province meteo API v1 (CC0).
// stations: GeoJSON with SCODE, NAME_*, ALT, LAT, LONG.
// sensors:  [{SCODE, TYPE, UNIT, DATE: "2026-10-20T13:30:00CEST", VALUE}], one row per station and sensor.

import { cleanHumidity, cleanSnowDepth, hoursBetween, inBbox, msToKmh, num, round, type RawStation } from '../raw.ts';

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
/** Sensors for the fog and inversion note: humidity, global radiation, sunshine in the last 10 minutes (s). */
const AIR_TYPES = new Set(['LF', 'GS', 'SD']);
/** Radiation and sunshine describe one moment, so they must be read with the station's other sensors. */
const SAME_READING_HOURS = 1;

export function parseProvince(
  stationsGeojson: { features: { properties: ProvinceStationProps }[] },
  sensors: ProvinceSensorRow[],
  opts: { now: string; maxAgeHours: number; bbox: Parameters<typeof inBbox>[2] },
): RawStation[] {
  const bySation = new Map<string, Map<string, { value: number; date: string }>>();
  for (const row of sensors) {
    const value = num(row.VALUE);
    const date = parseProvinceDate(row.DATE);
    if (value === null || date === null || !(METEO_TYPES.has(row.TYPE) || AIR_TYPES.has(row.TYPE))) continue;
    if (hoursBetween(date, opts.now) > opts.maxAgeHours) continue;
    let m = bySation.get(row.SCODE);
    if (!m) bySation.set(row.SCODE, (m = new Map()));
    // A sensor can be listed twice (an old row of a sensor that stopped); keep the newer reading.
    const had = m.get(row.TYPE);
    if (!had || date > had.date) m.set(row.TYPE, { value, date });
  }

  const out: RawStation[] = [];
  for (const { properties: p } of stationsGeojson.features) {
    const s = bySation.get(p.SCODE);
    const lon = num(p.LONG);
    const lat = num(p.LAT);
    const elevation = num(p.ALT);
    if (!s || ![...s.keys()].some((t) => METEO_TYPES.has(t)) || lon === null || lat === null || elevation === null || elevation <= 0) continue;
    if (!inBbox(lon, lat, opts.bbox)) continue;
    const v = (t: string) => s.get(t)?.value ?? null;
    const dates = [...s.values()].map((x) => x.date).sort();
    const newest = dates.at(-1) ?? null;
    /** A value only if read together with the newest sensor. */
    const now = (t: string) => {
      const x = s.get(t);
      return x && newest && hoursBetween(x.date, newest) <= SAME_READING_HOURS ? x.value : null;
    };
    const temp = v('LT');
    const gs = now('GS');
    const sd = now('SD');
    out.push({
      source: 'province-bz',
      provider: 'province-bz',
      code: p.SCODE,
      name: stationName(p),
      lon,
      lat,
      elevation: round(elevation, 0),
      operator: 'Autonomous Province of Bolzano - South Tyrol',
      observedAt: newest,
      snowDepthCm: cleanSnowDepth(v('HS')),
      airTempC: temp === null ? null : round(temp),
      windSpeedKmh: msToKmh(v('WG')),
      windGustKmh: msToKmh(v('WG.BOE')),
      windDirDeg: v('WR') === null ? null : round(v('WR')!, 0),
      // The API's N sensor is a 5-minute value; the 24 h sum comes from the Euregio feed instead.
      precip24hMm: null,
      // The API gives only the current depth; the change comes from the Euregio feed's copy of the
      // same station when the two are merged.
      snowChange24hCm: null,
      snowChange48hCm: null,
      snowChange72hCm: null,
      humidityPct: cleanHumidity(now('LF')),
      radiationWm2: gs === null || gs < 0 ? null : round(gs, 0),
      sunshineShare: sd === null || sd < 0 || sd > 600 ? null : round(sd / 600, 2),
      sunshine: null,
    });
  }
  return out;
}
