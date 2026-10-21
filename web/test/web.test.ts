import { describe, expect, it } from 'vitest';
import { CABIN_COLORS, cabinBearing, cabinBlocks, cabinGeoJson } from '../src/cabins.ts';
import { Favourites } from '../src/favourites.ts';
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
    sun: '2026-10-21T06:30Z',
  };

  it('round-trips camera, layers, day, frame and sun time', () => {
    const hash = toHash(view);
    expect(hash).toBe('#map=10.40/46.4700/11.3540/340/60&x=1.5&layers=snow,stations,forecast&day=2026-10-18&f=5&sun=2026-10-21T06:30Z');
    expect(parseHash(hash)).toEqual({ ...view, bearing: 340, layers: ['snow', 'stations', 'forecast'] });
  });

  it('drops invalid or out-of-range parts and keeps the rest', () => {
    const p = parseHash('#map=25/99/11/abc/90&x=9&layers=snow,bogus&day=yesterday&f=-1&sun=2026-10-21T25:00Z');
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

describe('3D bivouac cabins', () => {
  it('builds a barrel that is highest in the middle, with a door in front', () => {
    const blocks = cabinBlocks('metal');
    const body = blocks.filter((b) => b.color === CABIN_COLORS.metal).map((b) => b.height);
    expect(Math.max(...body)).toBe(body[Math.floor(body.length / 2)]);
    expect(body[0]).toBeLessThan(body[Math.floor(body.length / 2)]);
    const door = blocks.find((b) => b.color === CABIN_COLORS.metalDoor)!;
    expect(door.y0).toBeLessThan(Math.min(...blocks.filter((b) => b !== door).map((b) => b.y0)));
  });

  it('puts the wooden roof on top of the walls', () => {
    const blocks = cabinBlocks('wood');
    const walls = blocks.find((b) => b.color === CABIN_COLORS.wood)!;
    const roof = blocks.filter((b) => b.color === CABIN_COLORS.roof);
    for (const r of roof) expect(r.height).toBeGreaterThan(walls.height);
  });

  it('places closed polygons a few metres around the site, the same way each time', () => {
    const site = { lat: 46.5, lon: 11.3, kind: 'metal' as const, osm: 'node/1' };
    const fc = cabinGeoJson([site, { ...site, osm: 'node/2' }]);
    expect(fc.features.length).toBe(2 * cabinBlocks('metal').length);
    for (const f of fc.features) {
      const ring = f.geometry.coordinates[0];
      expect(ring[0]).toEqual(ring[4]);
      for (const [lon, lat] of ring) {
        expect(Math.abs(lon - site.lon)).toBeLessThan(0.0003);
        expect(Math.abs(lat - site.lat)).toBeLessThan(0.0002);
      }
    }
    expect(cabinBearing('node/1')).toBe(cabinBearing('node/1'));
    expect(cabinBearing('node/1')).not.toBe(cabinBearing('node/2'));
  });
});

describe('favourite bivouacs', () => {
  const memory = (initial?: string) => {
    const data = new Map<string, string>(initial === undefined ? [] : [['bivouac-favourites', initial]]);
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  };

  it('toggles, tells listeners and keeps the list across page loads', () => {
    const storage = memory();
    const favs = new Favourites(storage);
    let changes = 0;
    favs.onChange(() => changes++);
    expect(favs.toggle('node/1')).toBe(true);
    expect(favs.toggle('way/2')).toBe(true);
    expect(favs.toggle('node/1')).toBe(false);
    expect(changes).toBe(3);
    const reloaded = new Favourites(storage);
    expect(reloaded.has('way/2')).toBe(true);
    expect(reloaded.has('node/1')).toBe(false);
    expect(reloaded.size).toBe(1);
  });

  it('starts empty on broken or blocked storage and still works for the visit', () => {
    expect(new Favourites(memory('not json')).size).toBe(0);
    expect(new Favourites(memory('{"a":1}')).size).toBe(0);
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const favs = new Favourites(blocked);
    expect(favs.toggle('node/1')).toBe(true);
    expect(favs.has('node/1')).toBe(true);
    expect(new Favourites(null).size).toBe(0);
  });
});
