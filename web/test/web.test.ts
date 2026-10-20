import { describe, expect, it } from 'vitest';
import { snowColor, SNOW_CLASSES, NO_SNOW_SENSOR_COLOR } from '../src/colors.ts';
import { forecastUrl } from '../src/forecast.ts';
import { compass, formatAge, weatherText } from '../src/format.ts';
import { estimateSnowLine, snowShareByElevation } from '../src/snowline.ts';
import type { Station } from '../../shared/types.ts';

describe('forecastUrl', () => {
  it('passes the clicked elevation so Open-Meteo downscales to it', () => {
    const u = new URL(forecastUrl(46.51234, 11.6888, 2054.6));
    expect(u.host).toBe('api.open-meteo.com');
    expect(u.searchParams.get('elevation')).toBe('2055');
    expect(u.searchParams.get('forecast_days')).toBe('7');
    expect(u.searchParams.get('daily')).toContain('snowfall_sum');
  });

  it('omits elevation when the terrain is not loaded', () => {
    expect(new URL(forecastUrl(46.5, 11.3, null)).searchParams.has('elevation')).toBe(false);
  });
});

describe('snowColor', () => {
  it('maps depths to the legend classes', () => {
    expect(snowColor(null)).toBe(NO_SNOW_SENSOR_COLOR);
    expect(snowColor(0)).toBe(SNOW_CLASSES[0].color);
    expect(snowColor(3)).toBe(SNOW_CLASSES[1].color);
    expect(snowColor(75)).toBe(SNOW_CLASSES[4].color);
    expect(snowColor(350)).toBe(SNOW_CLASSES.at(-1)!.color);
  });
});

describe('format helpers', () => {
  it('formats age, compass and weather codes', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(formatAge('2026-10-20T11:45:00Z', now)).toBe('15 min ago');
    expect(formatAge('2026-10-20T07:00:00Z', now)).toBe('5 h ago');
    expect(compass(350)).toBe('N');
    expect(compass(135)).toBe('SE');
    expect(weatherText(73)).toBe('Snow');
  });
});

describe('estimateSnowLine', () => {
  const station = (elevation: number, snowDepthCm: number | null) =>
    ({ id: `s${elevation}`, name: '', lon: 11, lat: 46.5, elevation, snowDepthCm }) as Station;

  it('puts the line where half the stations report snow, ignoring an odd station', () => {
    const stations = [
      ...[600, 900, 1200, 1400, 1600, 1800].map((h) => station(h, 0)),
      station(1300, 15), // a single snowy valley station does not drag the line down
      ...[2000, 2200, 2400, 2600, 2800].map((h) => station(h, 20)),
      station(2100, 0),
    ];
    const line = estimateSnowLine(stations)!;
    expect(line.source).toBe('stations');
    expect(line.lineM).toBeGreaterThan(1800);
    expect(line.lineM).toBeLessThan(2200);
    expect(line.startM).toBeLessThan(line.lineM);
    expect(line.fullM).toBeGreaterThan(line.lineM);
  });

  it('returns null when no station reports snow, and follows the satellite line when given', () => {
    const bare = [...Array(12)].map((_, i) => station(800 + i * 200, i % 3 === 0 ? 1 : 0));
    expect(estimateSnowLine(bare)).toBeNull();
    const sat = estimateSnowLine(bare, 2600)!;
    expect(sat.source).toBe('satellite');
    expect(sat.lineM).toBe(2600);
  });

  it('isotonic share never decreases with elevation', () => {
    const share = snowShareByElevation([1, 0, 1, 1, 0, 1].map((s, i) => ({ elevation: 1000 + i * 100, snowy: s === 1 })));
    for (let i = 1; i < share.length; i++) expect(share[i][1]).toBeGreaterThanOrEqual(share[i - 1][1]);
  });
});
