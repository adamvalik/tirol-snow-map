import { describe, expect, it } from 'vitest';
import {
  clockTime,
  dayGradient,
  dayMinutes,
  hillshadePaint,
  localDate,
  localMidnight,
  nightOpacity,
  skyFor,
  sunDay,
  sunLabel,
  sunParam,
  sunPosition,
} from '../src/sun.ts';

describe('sun position', () => {
  it('uses SunCalc 2.x units: degrees, azimuth clockwise from north', () => {
    // Bolzano at noon on the winter solstice: due south, 90 − 46.5 − 23.44 ≈ 20° high.
    const noon = sunPosition(Date.parse('2026-12-21T11:15:00Z'), 46.5, 11.35);
    expect(noon.azimuth).toBeGreaterThan(175);
    expect(noon.azimuth).toBeLessThan(185);
    expect(noon.altitude).toBeCloseTo(20, 0);
    // Morning sun is in the south-east, evening sun in the south-west.
    expect(sunPosition(Date.parse('2026-12-21T08:00:00Z'), 46.5, 11.35).azimuth).toBeLessThan(150);
    expect(sunPosition(Date.parse('2026-12-21T14:30:00Z'), 46.5, 11.35).azimuth).toBeGreaterThan(210);
  });

  it('rises about 8 minutes earlier in the east of the region than in the west', () => {
    const west = sunDay('2026-12-21', 46.6, 10.4).sunrise!;
    const east = sunDay('2026-12-21', 46.6, 12.5).sunrise!;
    expect(new Date(west).toISOString().slice(11, 16)).toBe('06:59');
    expect(new Date(east).toISOString().slice(11, 16)).toBe('06:51');
  });

  it('gives sunrise and sunset in local time across a clock change', () => {
    const winter = sunDay('2026-12-21', 46.5, 11.35);
    expect(clockTime(winter.sunrise!)).toBe('07:55');
    expect(clockTime(winter.sunset!)).toBe('16:29');
    const summer = sunDay('2026-06-21', 46.5, 11.35);
    expect(clockTime(summer.sunrise!)).toBe('05:21');
    expect(clockTime(summer.sunset!)).toBe('21:11');
  });
});

describe('local days', () => {
  it('finds local midnight in Europe/Rome, summer and winter time', () => {
    expect(new Date(localMidnight('2026-07-01')).toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(new Date(localMidnight('2026-10-26')).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(localDate(Date.parse('2026-10-20T22:30:00Z'))).toBe('2026-10-21');
  });

  it('has 25 hours on 25 October 2026 and 23 on 29 March 2026', () => {
    expect(dayMinutes('2026-10-21')).toBe(1440);
    expect(dayMinutes('2026-10-25')).toBe(1500);
    expect(dayMinutes('2026-03-29')).toBe(1380);
  });

  it('labels the time and where the sun stands', () => {
    const morning = Date.parse('2026-10-21T06:30:00Z');
    expect(sunLabel(morning, sunPosition(morning, 46.5, 11.35))).toBe('08:30 · sun 7° high in the SE');
    const night = Date.parse('2026-10-21T20:30:00Z');
    expect(sunLabel(night, sunPosition(night, 46.5, 11.35))).toBe('22:30 · night');
    expect(sunParam(morning + 42_000)).toBe('2026-10-21T06:30Z');
  });
});

describe('sun light on the map', () => {
  it('keeps the usual north-west light when off', () => {
    expect(hillshadePaint(null, false)).toMatchObject({
      'hillshade-method': 'standard',
      'hillshade-exaggeration': 0.3,
      'hillshade-illumination-direction': 335,
      'hillshade-illumination-anchor': 'viewport',
    });
    expect(hillshadePaint(null, true)['hillshade-exaggeration']).toBe(0.12);
  });

  it('lights from the sun, fixed to the map, never from below the horizon', () => {
    const paint = hillshadePaint({ azimuth: -90, altitude: -3 }, false);
    expect(paint).toMatchObject({
      // 'standard' would ignore the altitude.
      'hillshade-method': 'basic',
      'hillshade-illumination-direction': 270,
      'hillshade-illumination-altitude': 0,
      'hillshade-illumination-anchor': 'map',
    });
    expect(hillshadePaint({ azimuth: 180, altitude: 30 }, false)['hillshade-illumination-altitude']).toBe(30);
    // Warm light near the horizon, near white high up, none once the sun is well down.
    const light = (altitude: number) => hillshadePaint({ azimuth: 180, altitude }, false)['hillshade-highlight-color'];
    expect(light(2)).toBe('rgba(255, 210, 160, 0.55)');
    expect(light(40)).toBe('rgba(255, 252, 240, 0.65)');
    expect(paint['hillshade-highlight-color']).toBe('rgba(255, 210, 160, 0)');
  });

  it('darkens the map and sky only once the sun has set', () => {
    expect(nightOpacity(10)).toBe(0);
    expect(nightOpacity(0)).toBe(0);
    expect(nightOpacity(-6)).toBe(0.3);
    expect(nightOpacity(-30)).toBe(0.6);
    expect(skyFor(30)['sky-color']).toBe('#9ec9f0');
    expect(skyFor(-20)['sky-color']).toBe('#101a33');
  });

  it('draws night and day along the time slider', () => {
    const date = '2026-12-21';
    const start = localMidnight(date);
    const g = dayGradient(sunDay(date, 46.5, 11.35), start, dayMinutes(date));
    // Sunrise 07:55 ± 30 min is 07:25 to 08:25 (445 and 505 of 1440 minutes), sunset 16:29 ± 30 min likewise.
    expect(g).toBe('linear-gradient(to right, #3a4560 30.9%, #f2c45a 35.1%, #f2c45a 66.7%, #3a4560 70.8%)');
    expect(dayGradient({ sunrise: null, sunset: null }, start, 1440)).toBe('#3a4560');
  });
});
