import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATION_BBOX } from '../src/config.ts';
import { mergeStations } from '../src/merge.ts';
import { cleanSnowDepth, romeOffsetMinutes, type RawStation } from '../src/raw.ts';
import { parseLinea, parseLineaDate } from '../src/sources/linea.ts';
import { parseProvince, parseProvinceDate } from '../src/sources/provinceBz.ts';

const fixture = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const NOW = '2026-10-20T12:30:00Z';
const opts = { now: NOW, maxAgeHours: 24, bbox: STATION_BBOX };

const province = parseProvince(fixture('province-bz/v1-stations.geojson'), fixture('province-bz/v1-sensors-all.json'), opts);
const linea = parseLinea(fixture('euregio/linea-stations-bbox.geojson'), opts);

describe('province API v1', () => {
  it('parses the CEST/CET date format to UTC', () => {
    expect(parseProvinceDate('2026-10-20T13:30:00CEST')).toBe('2026-10-20T11:30:00.000Z');
    expect(parseProvinceDate('2026-12-01T08:00:00CET')).toBe('2026-12-01T07:00:00.000Z');
    expect(parseProvinceDate('garbage')).toBeNull();
    expect(parseProvinceDate(undefined)).toBeNull();
  });

  it('keeps meteo stations and skips river gauges', () => {
    expect(province.length).toBeGreaterThan(80);
    expect(province.some((s) => s.code.endsWith('PG'))).toBe(false);
  });

  it('reads Seiser Alm Zallinger as in the raw sensor fixture', () => {
    const s = province.find((x) => x.code === '74200MS')!;
    expect(s.elevation).toBe(2055);
    expect(s.snowDepthCm).toBe(7);
    expect(s.airTempC).toBe(6.5);
    // 1.2 m/s wind in the fixture -> km/h
    expect(s.windSpeedKmh).toBeCloseTo(1.2 * 3.6, 1);
  });

  it('finds all 26 snow depth sensors', () => {
    expect(province.filter((s) => s.snowDepthCm !== null)).toHaveLength(26);
  });
});

describe('Euregio linea feed', () => {
  it('converts SI units (m, K, m/s) to cm, °C, km/h', () => {
    const s = linea.find((x) => x.code === 'ALBINA/GPFI2')!; // Pfinnalm, avalanche service copy
    expect(s.snowDepthCm).toBe(5.7); // HS 0.057 m
    expect(s.airTempC).toBe(6.3); // TA 279.45 K
    expect(s.windSpeedKmh).toBe(3.2); // VW 0.89 m/s
    expect(s.elevation).toBe(2152);
  });

  it('reinterprets future "Z" timestamps as Europe/Rome local time', () => {
    expect(parseLineaDate('2026-10-20T13:05:00.000Z', NOW)).toBe('2026-10-20T11:05:00.000Z');
    expect(parseLineaDate('2026-10-20T11:40:00.000Z', NOW)).toBe('2026-10-20T11:40:00.000Z');
    expect(parseLineaDate('2026-10-21T13:05:00.000Z', NOW)).toBeNull();
    for (const s of linea) expect(Date.parse(s.observedAt!)).toBeLessThanOrEqual(Date.parse(NOW) + 15 * 60_000);
  });

  it('knows the Rome UTC offset in summer and winter', () => {
    expect(romeOffsetMinutes(new Date('2026-07-01T12:00:00Z'))).toBe(120);
    expect(romeOffsetMinutes(new Date('2026-12-01T12:00:00Z'))).toBe(60);
  });

  it('drops stations without a usable elevation', () => {
    expect(linea.every((s) => s.elevation > 0)).toBe(true);
  });
});

describe('snow depth cleaning', () => {
  it('clamps small negatives, drops implausible values', () => {
    expect(cleanSnowDepth(-2.4)).toBe(0);
    expect(cleanSnowDepth(-6)).toBeNull();
    expect(cleanSnowDepth(501)).toBeNull();
    expect(cleanSnowDepth(12.34)).toBe(12.3);
    expect(cleanSnowDepth(null)).toBeNull();
  });
});

describe('mergeStations', () => {
  const base: RawStation = {
    source: 'province-bz',
    provider: 'province-bz',
    code: 'A',
    name: 'Alpha',
    lon: 11.5,
    lat: 46.5,
    elevation: 2000,
    operator: 'Province',
    observedAt: '2026-10-20T11:30:00.000Z',
    snowDepthCm: 10,
    airTempC: null,
    windSpeedKmh: null,
    windGustKmh: null,
    windDirDeg: null,
    precip24hMm: null,
  };

  it('merges the same station from two providers and fills missing fields', () => {
    const other: RawStation = {
      ...base,
      source: 'euregio-linea',
      provider: 'ALBINA',
      code: 'X1',
      lon: 11.501, // ~75 m away
      snowDepthCm: 11,
      airTempC: -1,
    };
    const [s, ...rest] = mergeStations([[base], [other]]);
    expect(rest).toHaveLength(0);
    expect(s.id).toBe('province-bz:A');
    expect(s.snowDepthCm).toBe(10); // higher-priority source wins
    expect(s.airTempC).toBe(-1); // filled from the other record
    expect(s.sources).toEqual(['province-bz', 'euregio-linea']);
  });

  it('prefers a fresh duplicate over a stale higher-priority one', () => {
    const stale = { ...base, observedAt: '2026-10-20T05:00:00.000Z' };
    const fresh: RawStation = { ...base, source: 'euregio-linea', provider: 'ALBINA', code: 'X1', snowDepthCm: 20 };
    expect(mergeStations([[stale], [fresh]])[0].snowDepthCm).toBe(20);
  });

  it('keeps nearby stations apart when elevations differ or the provider is the same', () => {
    const summit = { ...base, code: 'B', elevation: 2100 };
    expect(mergeStations([[base, summit]])).toHaveLength(2);
    const sameProvider = { ...base, code: 'C', lon: 11.5005 };
    expect(mergeStations([[base, sameProvider]])).toHaveLength(2);
  });

  it('collapses the three copies of a provincial station in the real fixtures', () => {
    const merged = mergeStations([province, linea]);
    const pfinn = merged.filter((s) => Math.abs(s.lat - 46.8417) < 0.003 && Math.abs(s.lon - 12.2096) < 0.003);
    expect(pfinn).toHaveLength(1);
    expect(pfinn[0].sources).toEqual(['province-bz', 'euregio-linea']);
    expect(merged.length).toBeLessThan(province.length + linea.length);
    expect(new Set(merged.map((s) => s.id)).size).toBe(merged.length);
  });
});
