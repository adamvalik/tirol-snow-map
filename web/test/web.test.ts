import { describe, expect, it } from 'vitest';
import { snowColor, SNOW_CLASSES, NO_SNOW_SENSOR_COLOR } from '../src/colors.ts';
import { forecastUrl } from '../src/forecast.ts';
import { compass, formatAge, formatTimeShort, weatherText } from '../src/format.ts';
import { frameLabel } from '../src/forecastAnim.ts';
import { parseHash, toHash, type ViewState } from '../src/viewState.ts';
import type { ForecastFile } from '../../shared/types.ts';

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
    expect(formatTimeShort('2026-10-20T07:21:00Z', now)).toBe('09:21');
    expect(formatTimeShort('2026-10-18T07:21:00Z', now)).toBe('18 Oct, 09:21');
    expect(compass(350)).toBe('N');
    expect(compass(135)).toBe('SE');
    expect(weatherText(73)).toBe('Snow');
  });
});


describe('view link', () => {
  const view: ViewState = {
    center: [11.354, 46.47],
    zoom: 10.4,
    pitch: 60,
    bearing: -20,
    exaggeration: 1.5,
    layers: ['stations', 'snow', 'forecast'],
    day: '2026-10-18',
    frame: 5,
  };

  it('round-trips camera, layers, day and frame', () => {
    const hash = toHash(view);
    expect(hash).toBe('#map=10.40/46.4700/11.3540/340/60&x=1.5&layers=snow,stations,forecast&day=2026-10-18&f=5');
    expect(parseHash(hash)).toEqual({ ...view, bearing: 340, layers: ['snow', 'stations', 'forecast'] });
  });

  it('drops invalid or out-of-range parts and keeps the rest', () => {
    const p = parseHash('#map=25/99/11/abc/90&x=9&layers=snow,bogus&day=yesterday&f=-1');
    expect(p).toEqual({ layers: ['snow'] });
    expect(parseHash('')).toEqual({});
    // An empty layer list is a valid choice: everything off.
    expect(parseHash('#layers=').layers).toEqual([]);
  });
});

describe('forecast frame label', () => {
  it('shows local time, hours ahead and the largest amount', () => {
    const file: ForecastFile = {
      schemaVersion: 1,
      generatedAt: '2026-10-20T12:30:00Z',
      available: true,
      start: '2026-10-20T13:00:00.000Z',
      stepHours: 3,
      frames: [{ time: '2026-10-21T13:00:00.000Z', file: 'forecast/f00.png', maxCm: 31 }],
      source: '',
      attribution: '',
    };
    expect(frameLabel(file, 0)).toBe('Wed 21 Oct, 15:00 · +24 h · new snow up to 31 cm');
    expect(frameLabel(file, 3)).toBe('');
  });
});
