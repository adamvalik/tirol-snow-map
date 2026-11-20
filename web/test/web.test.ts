import { describe, expect, it } from 'vitest';
import { CABIN_COLORS, cabinBearing, cabinBlocks, cabinGeoJson } from '../src/cabins.ts';
import { Favourites } from '../src/favourites.ts';
import { GRADE_CLASSES, gradeColor, gradeLabel, gradeText, highestPoint, letterGrade, UNGRADED_COLOR, websiteUrl } from '../src/ferratas.ts';
import { snowColor, SNOW_CLASSES, NO_SNOW_SENSOR_COLOR } from '../src/colors.ts';
import { forecastUrl } from '../src/forecast.ts';
import { compass, fmtChange, formatAge, formatTimeShort, weatherText } from '../src/format.ts';
import { routeSnow, routeSnowPoints } from '../src/snow.ts';
import { parseHash, toHash, type ViewState } from '../src/viewState.ts';
import { aerialLifts, fullProps, highestPoint as winterTop, inView, LIFT_COLOR, liftEnds, slopeColor, UNKNOWN_SLOPE_COLOR, winterColor, winterHtml, winterSub, winterTitle, type WinterFeature } from '../src/winter.ts';

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

  it('formats signed changes', () => {
    expect(fmtChange(12.4, 'cm')).toBe('+12 cm');
    expect(fmtChange(-3, 'cm')).toBe('−3 cm');
    expect(fmtChange(-0.2, 'cm')).toBe('0 cm');
    expect(fmtChange(null, 'cm')).toBe('–');
    expect(fmtChange(undefined, 'cm')).toBe('–');
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

describe('via ferratas', () => {
  const props = { grade: 4, scale: '4+' };

  it('converts the OSM scale to A–E letters, with in-between grades for plus and minus', () => {
    const cases: [string, string][] = [
      ['0', 'A'], ['0+', 'A'], ['1', 'A'], ['1+', 'A/B'], ['2-', 'A/B'], ['2', 'B'], ['2+', 'B/C'], ['3-', 'B/C'],
      ['3', 'C'], ['3+', 'C/D'], ['4', 'D'], ['4+', 'D/E'], ['5-', 'D/E'], ['5', 'E'], ['5+', 'E'], ['6', 'E'],
    ];
    for (const [scale, letter] of cases) expect([scale, letterGrade(scale)]).toEqual([scale, letter]);
  });

  it('labels grades with the French and Italian equivalents', () => {
    expect(gradeLabel(props)).toBe('D/E');
    expect(gradeLabel({ scale: null })).toBe('ungraded');
    expect(gradeText(props)).toBe('D/E, very difficult, TD in France and Italy');
    expect(gradeText({ grade: 2, scale: '2' })).toBe('B, moderately difficult, AD in France, PD in Italy');
    expect(gradeText({ grade: null, scale: null })).toBe('No grade in OpenStreetMap');
  });

  it('colours by grade class', () => {
    expect(gradeColor(null)).toBe(UNGRADED_COLOR);
    expect(gradeColor(0)).toBe(GRADE_CLASSES[0].color);
    expect(gradeColor(1)).toBe(GRADE_CLASSES[0].color);
    expect(gradeColor(3)).toBe(GRADE_CLASSES[2].color);
    expect(gradeColor(6)).toBe(GRADE_CLASSES[4].color);
  });

  it('links only http(s) websites and adds a missing scheme', () => {
    expect(websiteUrl('www.example.com/x')?.href).toBe('https://www.example.com/x');
    expect(websiteUrl('http://example.com')?.hostname).toBe('example.com');
    expect(websiteUrl('javascript:alert(1)')).toBeNull();
    expect(websiteUrl('mailto:a@b.c')).toBeNull();
  });

  it('finds the highest point of a multi-part route', () => {
    const f = {
      type: 'Feature' as const,
      properties: {} as never,
      geometry: { type: 'MultiLineString' as const, coordinates: [[[11, 46, 2000], [11, 46.001, 2100]], [[11.01, 46, 2300], [11.01, 46.001, 2200]]] },
    };
    expect(highestPoint(f)).toEqual([11.01, 46, 2300]);
  });

  it('measures the share of a route in snow-covered cells and the lowest snowy point', () => {
    // Bare below 2000 m, snow above, one point under cloud; outside the grid is skipped.
    const values = {
      at: (lon: number) =>
        lon > 12 ? null : lon === 11.5 ? { depthCm: 0, confidence: 'low', cover: 254, viewAge: 0 } : lon >= 11.2 ? { depthCm: 30, confidence: 'high', cover: 80, viewAge: 1 } : { depthCm: 0, confidence: 'high', cover: 0, viewAge: 0 },
    };
    const points = [[11.0, 46, 1900], [11.1, 46, 1950], [11.2, 46, 2050], [11.3, 46, 2150], [11.5, 46, 2200], [12.5, 46, 2300]];
    expect(routeSnow(values, points)).toEqual({ snow: 0.4, unseen: 0.2, lowestSnowM: 2050, maxDepthCm: 30 });
    expect(routeSnow(values, [[12.5, 46, 2000]])).toBeNull();
    // The same check point by point, for a chart along a GPX track.
    expect(routeSnowPoints(values, points)).toEqual({
      route: { snow: 0.4, unseen: 0.2, lowestSnowM: 2050, maxDepthCm: 30 },
      points: ['bare', 'bare', 'snow', 'snow', 'unseen', null],
    });
  });

  it('keeps ferratas in shared links', () => {
    expect(parseHash('#layers=snow,ferratas').layers).toEqual(['snow', 'ferratas']);
  });
});

describe('shortPlaceName', async () => {
  const { expression } = await import('@maplibre/maplibre-gl-style-spec');
  const { shortPlaceName, SHORT_NAME_MAX_ZOOM } = await import('../src/basemap.ts');
  const label = (props: Record<string, string>, zoom: number) => {
    const e = expression.createExpression(shortPlaceName(['get', 'name']), { type: 'formatted' } as never);
    if (e.result !== 'success') throw new Error(JSON.stringify(e.value));
    return String(e.value.evaluate({ zoom }, { properties: props } as never));
  };
  const ortisei = { name: 'Urtijëi - St. Ulrich - Ortisei', 'name:it': 'Ortisei', 'name:de': 'St. Ulrich in Gröden' };

  it('prefers the Italian, then the German name at low zoom', () => {
    expect(label(ortisei, 10)).toBe('Ortisei');
    expect(label({ name: 'Bruneck - Brunico', 'name:de': 'Bruneck' }, 10)).toBe('Bruneck');
    expect(label({ name: 'Lungiarü - Campill' }, 10)).toBe('Lungiarü');
  });

  it('keeps the full name when zoomed in and single-language names as they are', () => {
    expect(label(ortisei, SHORT_NAME_MAX_ZOOM)).toBe(ortisei.name);
    expect(label({ name: 'Innsbruck', 'name:it': 'Innsbruck' }, 8)).toBe('Innsbruck');
    expect(label({ name: 'Lienz', 'name:it': 'Lienz' }, 8)).toBe('Lienz');
  });
});

describe('shortPlaceName with a zoom step', async () => {
  const { shortPlaceName, SHORT_NAME_MAX_ZOOM: Z } = await import('../src/basemap.ts');
  const short = (shortPlaceName(['get', 'name']) as unknown[])[2];
  const wrap = (o: unknown) => JSON.stringify(shortPlaceName(o));
  it('merges into the existing step instead of nesting one', () => {
    const a = ['get', 'name'];
    const b = ['coalesce', ['get', 'name:en'], a];
    const c = ['coalesce', ['get', 'pgf:name'], a];
    const ref = ['get', 'ref'];
    expect(wrap(['step', ['zoom'], ref, 6, b])).toBe(JSON.stringify(['step', ['zoom'], ref, 6, swap(short, b), Z, b]));
    expect(wrap(['step', ['zoom'], a, 6, b, Z, c])).toBe(JSON.stringify(['step', ['zoom'], swap(short, a), 6, swap(short, b), Z, c]));
    expect(wrap(['step', ['zoom'], a, 14, c])).toBe(JSON.stringify(['step', ['zoom'], swap(short, a), Z, a, 14, c]));
  });
  function swap(e: unknown, out: unknown) {
    const c = structuredClone(e) as unknown[];
    c[3] = out;
    return c;
  }
});

describe('basemap labels', async () => {
  const { basemapLayers } = await import('../src/basemap.ts');
  it('shortens multilingual names of places and lakes, not countries', () => {
    const shortened = basemapLayers()
      .labels.filter((l) => JSON.stringify(l).includes('name:it'))
      .map((l) => l.id);
    expect(shortened).toEqual(expect.arrayContaining(['places_locality', 'places_region', 'water_label_lakes']));
    expect(shortened).not.toContain('places_country');
  });
});

describe('winter sports', () => {
  const lift = fullProps({ id: 'w4388461', kind: 'lift', lift: 'chair_lift', name: 'Ciampinoi', occupancy: 6, capacity: 2400, lengthM: 1346, minM: 1500, maxM: 2025, startM: 1502, endM: 2025 });
  const slope = fullProps({ id: 'r12', kind: 'downhill', difficulty: 'intermediate', ref: '3', name: 'Saslong', ways: 3, lengthM: 3400, minM: 1400, maxM: 2250 });

  it('fills in what the file leaves out', () => {
    expect(lift).toMatchObject({ osm: 'way/4388461', ways: 1, lit: false, grooming: null, areaHa: null, climbM: null });
    expect(slope.osm).toBe('relation/12');
  });

  it('names and describes lifts and pistes', () => {
    expect(winterSub(lift)).toBe('Chairlift, 6 seats');
    expect(winterSub(fullProps({ id: 'w1', kind: 'lift', lift: 'gondola', occupancy: 8, minM: 0, maxM: 0 }))).toBe('Gondola, 8 per cabin');
    expect(winterSub(slope)).toBe('Red slope, intermediate');
    expect(winterSub(fullProps({ id: 'w1', kind: 'nordic', grooming: 'classic+skating', minM: 0, maxM: 0 }))).toBe('Cross-country trail, classic and skating');
    expect(winterTitle(slope)).toBe('3 Saslong');
    expect(winterTitle({ kind: 'lift', lift: 't-bar', name: null, ref: '12' })).toBe('T-bar 12');
    expect(winterTitle({ kind: 'sled', lift: null, name: null, ref: null })).toBe('Toboggan run');
  });

  it('colours slopes by difficulty and the rest by kind', () => {
    expect(slopeColor('easy')).toBe('#1c7ed6');
    expect(slopeColor(null)).toBe(UNKNOWN_SLOPE_COLOR);
    expect(winterColor(lift)).toBe(LIFT_COLOR);
  });

  it('shows a lift its rise and top station, and escapes OSM text', () => {
    const html = winterHtml(lift);
    expect(html).toContain('523 m');
    expect(html).toContain('2,025 m');
    expect(html).toContain('2,400 people an hour');
    expect(winterHtml({ ...slope, website: 'javascript:alert(1)' })).not.toContain('javascript');
  });

  it('puts a dot at both ends of every lift', () => {
    const f = { type: 'Feature', properties: lift, geometry: { type: 'LineString', coordinates: [[11, 46], [11.01, 46.01]] } } as WinterFeature;
    expect(liftEnds([f]).map((e) => e.geometry.coordinates)).toEqual([[11, 46], [11.01, 46.01]]);
  });

  it('asks for the forecast at the top station or the highest drawn point', () => {
    const line = (p: WinterFeature['properties'], coordinates: number[][]) => ({ type: 'Feature', properties: p, geometry: { type: 'LineString', coordinates } }) as WinterFeature;
    expect(winterTop(line({ ...lift, top: 1 }, [[11, 46], [11.01, 46.01]]))).toEqual([11.01, 46.01, 2025]);
    // A slope drawn as two lines: the index runs on across them.
    const twoLines = { type: 'Feature', properties: { ...slope, top: 3 }, geometry: { type: 'MultiLineString', coordinates: [[[11, 46], [11.1, 46]], [[11.2, 46], [11.3, 46.2]]] } } as WinterFeature;
    expect(winterTop(twoLines)).toEqual([11.3, 46.2, 2250]);
    // An older file without `top`: the first point.
    expect(winterTop(line(slope, [[11, 46], [11.01, 46.01]]))).toEqual([11, 46, 2250]);
  });

  it('finds the aerial lifts in view by their box first', async () => {
    const { LngLatBounds } = await import('maplibre-gl');
    const line = (id: string, p: Partial<WinterFeature['properties']>, coordinates: number[][]) =>
      ({ type: 'Feature', properties: { ...lift, id, ...p }, geometry: { type: 'LineString', coordinates } }) as WinterFeature;
    const lifts = aerialLifts([
      line('w1', {}, [[11, 46], [11.02, 46.01]]),
      line('w2', { lift: 't-bar' }, [[11, 46], [11.02, 46.01]]),
      line('w3', { lift: 'gondola' }, [[11.5, 46.5], [11.6, 46.6]]),
      // A long lift seen up close, without a point in the view.
      line('w4', { lift: 'cable_car' }, [[10.9, 46.005], [11.1, 46.005]]),
    ]);
    expect(lifts.map((l) => l.f.properties.id)).toEqual(['w1', 'w3', 'w4']);
    expect(lifts[0].box).toEqual([11, 46, 11.02, 46.01]);
    const view = new LngLatBounds([10.99, 45.99], [11.03, 46.02]);
    expect(inView(lifts, view).map((l) => l.f.properties.id)).toEqual(['w1', 'w4']);
  });

  it('keeps the layer in shared links', () => {
    expect(parseHash('#layers=snow,winter').layers).toEqual(['snow', 'winter']);
  });
});

describe('lifts in 3D', async () => {
  const { carriersFor, LIFT_3D, LIFT_3D_COLORS, liftBlocks, preferOwnGround, supports } = await import('../src/lifts3d.ts');
  // About 1.1 km north, rising 400 m.
  const line = [[11, 46.5, 1500], [11, 46.51, 1900]];
  const slope = (_lon: number, lat: number) => 1500 + (lat - 46.5) * 40000;

  it('puts pylons where OSM maps them, or evenly where it maps none', () => {
    expect(supports(line, [[11, 46.503], [11, 46.506]]).map((s) => s.station)).toEqual([true, false, false, true]);
    // A pylon mapped on a station is left to the station.
    expect(supports(line, [[11, 46.50001]]).length).toBe(2);
    const even = supports(line, null);
    expect(even.length).toBe(2 + Math.ceil(1112 / LIFT_3D.span) - 1);
    const gaps = even.slice(1).map((s, i) => s.d - even[i].d);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
  });

  it('makes a small kink a pylon and a real bend an angle station', () => {
    // A kink of about 8 m sideways halfway up: about 1.6 degrees.
    const kinked = [[11, 46.5], [11.0001, 46.505], [11, 46.51]];
    const k = supports(kinked, null);
    expect(k.filter((s) => s.station).length).toBe(2);
    expect(k.some((s) => !s.station && Math.abs(s.d - k.find((t) => t.d > 500)!.d) < 1)).toBe(true);
    // A turn of about 45 degrees: a station, with pylons spaced on each stretch.
    const bent = [[11, 46.5], [11, 46.505], [11.007, 46.51]];
    const b = supports(bent, null);
    expect(b.filter((s) => s.station).length).toBe(3);
    const gaps = b.slice(1).map((s, i) => s.d - b[i].d);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(LIFT_3D.span + 1);
  });

  it('builds stations, pylons, cables and cabins that stay above the ground', () => {
    const blocks = liftBlocks('w1', line, [[11, 46.505]], slope)!;
    const colors = new Set(blocks.map((b) => b.properties.color));
    expect(colors.size).toBeGreaterThanOrEqual(5);
    expect(blocks.every((b) => b.properties.base >= 0 && b.properties.height > b.properties.base && b.properties.id === 'w1')).toBe(true);
    // Cables leave the stations at the station's height and hang at least the clearance above the ground.
    const cable = blocks.filter((b) => b.properties.color === '#212529');
    expect(cable.length).toBeGreaterThan(100);
    expect(Math.min(...cable.map((b) => b.properties.base))).toBeGreaterThanOrEqual(LIFT_3D.clearance);
  });

  it('hangs chairs on chairlifts, wider with more seats and with a hood where mapped', () => {
    const count = (blocks: { properties: { color: string } }[], color: string) => blocks.filter((b) => b.properties.color === color).length;
    const width = (b: { geometry: { coordinates: number[][][] } }) => {
      const [a, , c] = b.geometry.coordinates[0];
      return Math.abs(c[0] - a[0]) * 111_320 * Math.cos((46.5 * Math.PI) / 180);
    };
    expect(carriersFor('chair_lift', 6, true)).toEqual({ kind: 'chair', seats: 6, bubble: true });
    expect(carriersFor('gondola').kind).toBe('cabin');
    const gondola = liftBlocks('w1', line, null, slope, carriersFor('gondola'))!;
    const chairs4 = liftBlocks('w1', line, null, slope, carriersFor('chair_lift', 4))!;
    const chairs8 = liftBlocks('w1', line, null, slope, carriersFor('chair_lift', 8, true))!;
    expect(count(gondola, LIFT_3D_COLORS.chair)).toBe(0);
    expect(count(chairs4, LIFT_3D_COLORS.cabin)).toBe(0);
    // Seat and backrest per chair, closer together than cabins.
    expect(count(chairs4, LIFT_3D_COLORS.chair) / 2).toBeGreaterThan(count(gondola, LIFT_3D_COLORS.cabin) * 2);
    expect(count(chairs4, LIFT_3D_COLORS.hood)).toBe(0);
    expect(count(chairs8, LIFT_3D_COLORS.hood)).toBeGreaterThan(0);
    // The line runs north, so a chair's width lies east–west.
    const seat = (bs: typeof chairs4) => bs.find((b) => b.properties.color === LIFT_3D_COLORS.chair)!;
    expect(width(seat(chairs8)) / width(seat(chairs4))).toBeCloseTo(2, 1);
    const mixed = liftBlocks('w1', line, null, slope, carriersFor('mixed_lift'))!;
    expect(count(mixed, LIFT_3D_COLORS.chair) > 0 && count(mixed, LIFT_3D_COLORS.cabin) > 0).toBe(true);
  });

  it('builds less from afar: rougher cables, no chairs, half the cabins', () => {
    const count = (blocks: { properties: { color: string } }[], color: string) => blocks.filter((b) => b.properties.color === color).length;
    const fine = liftBlocks('w1', line, null, slope, carriersFor('chair_lift'), 'fine')!;
    const medium = liftBlocks('w1', line, null, slope, carriersFor('chair_lift'), 'medium')!;
    const coarse = liftBlocks('w1', line, null, slope, carriersFor('chair_lift'), 'coarse')!;
    expect(count(medium, LIFT_3D_COLORS.cable)).toBeLessThan(count(fine, LIFT_3D_COLORS.cable) / 1.5);
    expect(count(coarse, LIFT_3D_COLORS.cable)).toBeLessThan(count(medium, LIFT_3D_COLORS.cable));
    expect(count(medium, LIFT_3D_COLORS.chair)).toBe(count(fine, LIFT_3D_COLORS.chair));
    expect(count(coarse, LIFT_3D_COLORS.chair)).toBe(0);
    const cabins = (d: 'fine' | 'coarse') => count(liftBlocks('w1', line, null, slope, carriersFor('gondola'), d)!, LIFT_3D_COLORS.cabin);
    expect(cabins('coarse')).toBeLessThan(cabins('fine'));
    expect(cabins('coarse')).toBeGreaterThan(0);
  });

  it('waits while the ground is not loaded', () => {
    expect(liftBlocks('w1', line, null, () => null)).toBeNull();
  });

  it('notes a lift built on a coarser tile standing in for one still loading', () => {
    // The tile's own data covers the bottom half; above it the coarse ground is 30 m off.
    const own = (lon: number, lat: number) => (lat < 46.505 ? slope(lon, lat) : undefined);
    const coarse = (lon: number, lat: number) => slope(lon, lat) - 30;
    const half = preferOwnGround(own, coarse);
    expect(half.rough()).toBe(false);
    expect(half.ground(11, 46.501)).toBe(slope(11, 46.501));
    expect(half.rough()).toBe(false);
    expect(half.ground(11, 46.508)).toBe(slope(11, 46.508) - 30);
    expect(half.rough()).toBe(true);
    // Every tile loaded: the lift can be kept.
    const all = preferOwnGround(slope, coarse);
    expect(liftBlocks('w1', line, null, all.ground)).not.toBeNull();
    expect(all.rough()).toBe(false);
  });
});
