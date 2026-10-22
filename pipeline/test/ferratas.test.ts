import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { distanceM, lineLengthM, resample } from '../../shared/geo.ts';
import {
  ascentDescent,
  isClosed,
  joinLines,
  type LonLat,
  type OsmWay,
  parseFerratas,
  parseScale,
  routeStats,
  simplify,
  toFeatureCollection,
} from '../src/ferratas.ts';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/osm/overpass-ferratas-sample.json', import.meta.url), 'utf8'));

/** A way along a line of [lon, lat] points with the given node ids. */
const way = (id: number, nodes: number[], coords: LonLat[], tags: Record<string, string>): OsmWay => ({
  type: 'way',
  id,
  nodes,
  geometry: coords.map(([lon, lat]) => ({ lon, lat })),
  tags,
});

describe('parseScale', () => {
  it('reads every spelling seen in the region and the documented ones', () => {
    const cases: [string | undefined, number | null, string | null][] = [
      ['0', 0, '0'], ['3', 3, '3'], ['6', 6, '6'], ['2+', 2, '2+'], ['3-', 3, '3-'], ['1.5', 1, '1+'], ['C', 3, '3'],
      ['K4', 4, '4'], ['k2+', 2, '2+'], ['2;3', 3, '3'], ['2-3', 3, '3'], ['B/C', 3, '3'], [' 5 ', 5, '5'],
      ['', null, null], [undefined, null, null], ['yes', null, null], ['7', null, null], ['hard', null, null],
    ];
    for (const [raw, grade, label] of cases) {
      const got = parseScale(raw);
      expect({ raw, grade: got?.grade ?? null, label: got?.label ?? null }).toEqual({ raw, grade, label });
    }
    expect(parseScale('2-3')!.min).toBe(2);
  });
});

describe('isClosed', () => {
  it('lets foot=yes override access=no', () => {
    expect(isClosed({ access: 'no' })).toBe(true);
    expect(isClosed({ access: 'no', foot: 'yes' })).toBe(false);
    expect(isClosed({ foot: 'no' })).toBe(true);
    expect(isClosed({ 'disused:highway': 'via_ferrata' })).toBe(true);
    expect(isClosed({ highway: 'via_ferrata' })).toBe(false);
  });
});

describe('parseFerratas on real OSM data', () => {
  const routes = parseFerratas(fixture);
  const byName = (n: string) => routes.filter((r) => r.name === n);

  it('joins the 18 sections of a route into one line graded by its hardest section', () => {
    const [taja] = byName('Tajakante Klettersteig');
    expect(byName('Tajakante Klettersteig')).toHaveLength(1);
    expect(taja).toMatchObject({ id: 'w41687103', ways: 18, grade: 4, gradeMin: 0, scale: '4+', closed: false, osm: 'way/41687103' });
    expect(taja.lines).toHaveLength(1);
  });

  it("uses the relation's name, grade and website", () => {
    expect(byName('Zimmereben Klettersteig')[0]).toMatchObject({ id: 'r5330393', grade: 5, gradeMin: 4, scale: '5', ways: 3 });
    expect(byName('Hans Kammerlander')[0].website).toBe('https://alpskyvudce.cz/ferrata/Hans_Kammerlander');
  });

  it('draws a relation made only of plain paths from those paths, ungraded', () => {
    expect(byName('Via ferrata Salt de Val Gelada')[0]).toMatchObject({ id: 'r19557729', grade: null, scale: null, ways: 2 });
  });

  it('marks closed sections and keeps the note, but not access=no with foot=yes', () => {
    expect(byName('Klettersteig Pursteinwand')[0]).toMatchObject({ closed: true, closedNote: expect.stringContaining('Felsbruchgefahr') });
    expect(byName('Ferrata Piero Rossi (ex Marmol)')[0]).toMatchObject({ closed: false, closedNote: null });
  });

  it('keeps unnamed routes and sorts by id', () => {
    expect(routes.find((r) => r.id === 'w679699492')).toMatchObject({ name: null, grade: 1, scale: '1+' });
    const ids = routes.map((r) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })));
    expect(JSON.stringify(parseFerratas(fixture))).toBe(JSON.stringify(routes));
  });
});

describe('route grouping', () => {
  const f = (scale: string, name?: string) => ({ highway: 'via_ferrata', via_ferrata_scale: scale, ...(name ? { name } : {}) });

  it('joins sections sharing a node whatever their names and lists the other names', () => {
    const [r] = parseFerratas({
      elements: [
        way(1, [1, 2], [[11, 46], [11, 46.002]], f('2', 'Main route')),
        way(2, [2, 3], [[11, 46.002], [11, 46.003]], f('4', 'Rope bridge')),
        way(3, [3, 4], [[11, 46.003], [11, 46.004]], f('3')),
      ],
    });
    expect(r).toMatchObject({ id: 'w1', name: 'Main route', otherNames: ['Rope bridge'], grade: 4, gradeMin: 2, ways: 3 });
    expect(r.lines).toHaveLength(1);
  });

  it('joins same-named sections across a small gap only', () => {
    const near = parseFerratas({
      elements: [way(1, [1, 2], [[11, 46], [11, 46.001]], f('2', 'X')), way(2, [3, 4], [[11, 46.0015], [11, 46.003]], f('2', 'X'))],
    });
    expect(near).toHaveLength(1);
    expect(near[0].lines).toHaveLength(2);
    const far = parseFerratas({
      elements: [way(1, [1, 2], [[11, 46], [11, 46.001]], f('2', 'X')), way(2, [3, 4], [[11, 46.01], [11, 46.011]], f('2', 'X'))],
    });
    expect(far).toHaveLength(2);
  });

  it('lets a relation grade win and skips its approach paths', () => {
    const routes = parseFerratas({
      elements: [
        way(1, [1, 2], [[11, 46], [11, 46.001]], f('2')),
        way(2, [5, 1], [[10.99, 46], [11, 46]], { highway: 'path' }),
        { type: 'relation', id: 9, tags: { route: 'via_ferrata', name: 'R', via_ferrata_scale: '3' }, members: [{ type: 'way', ref: 2, role: '' }, { type: 'way', ref: 1, role: '' }] },
      ],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ id: 'r9', name: 'R', grade: 3, gradeMin: 2, ways: 1, osm: 'relation/9' });
  });

  it('skips ways that are not ferratas or have under two points', () => {
    expect(
      parseFerratas({
        elements: [way(1, [1, 2], [[11, 46], [11, 46.001]], { highway: 'path', sac_scale: 'alpine_hiking' }), way(2, [3], [[11, 46]], f('2'))],
      }),
    ).toEqual([]);
  });
});

describe('line helpers', () => {
  it('joins lines at shared ends, reversing where needed', () => {
    const lines = joinLines([
      { nodes: [1, 2], coords: [[0, 0], [0, 1]] },
      { nodes: [3, 2], coords: [[0, 2], [0, 1]] },
      { nodes: [9, 8], coords: [[5, 5], [5, 6]] },
    ]);
    expect(lines).toEqual([[[0, 0], [0, 1], [0, 2]], [[5, 5], [5, 6]]]);
  });

  it('simplifies nearly straight runs but keeps corners and ends', () => {
    const line: LonLat[] = [[11, 46], [11, 46.0005], [11.000001, 46.001], [11.001, 46.001]];
    expect(simplify(line, 2)).toEqual([[11, 46], [11.000001, 46.001], [11.001, 46.001]]);
  });

  it('measures distance and resamples every step, interpolating elevation', () => {
    expect(distanceM([11, 46], [11, 46.01])).toBeCloseTo(1112, -1);
    const pts = resample([[11, 46, 1000], [11, 46.01, 2000]], 25);
    expect(pts[0]).toEqual([11, 46, 1000]);
    expect(pts.at(-1)).toEqual([11, 46.01, 2000]);
    expect(pts[1][2]).toBeCloseTo(1000 + (25 / 1112) * 1000, 0);
    const gaps = pts.slice(1, -1).map((p, i) => distanceM(pts[i], p));
    expect(gaps.every((g) => Math.abs(g - 25) < 0.5)).toBe(true);
    expect(lineLengthM(pts)).toBeCloseTo(lineLengthM([[11, 46], [11, 46.01]]), 3);
  });
});

describe('terrain statistics', () => {
  // Deterministic noise in [-1, 1].
  let seed = 7;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

  it('ignores terrain-model noise on gentle ground', () => {
    const gentle = Array.from({ length: 401 }, (_, i) => 1500 + i + noise() * 2);
    expect(Math.abs(ascentDescent(gentle).ascent - 400)).toBeLessThan(20);
    const ridge = [...Array.from({ length: 41 }, (_, i) => 2000 + i * 10), ...Array.from({ length: 40 }, (_, i) => 2400 - (i + 1) * 5)];
    expect(ascentDescent(ridge)).toEqual({ ascent: 400, descent: 200 });
  });

  // A plane rising 0.5 m per metre north.
  const plane = (_lon: number, lat: number) => 1000 + ((lat - 46) * 111195) / 2;

  it('gives length, range and climb along one line, either way round', () => {
    const s = routeStats([[[11, 46], [11, 46.01]]], plane);
    expect(s.lengthM).toBeCloseTo(1112, -1);
    expect([s.minM, s.maxM]).toEqual([1000, 1556]);
    expect(Math.abs(s.climbM! - 556)).toBeLessThan(3);
    expect(routeStats([[[11, 46.01], [11, 46]]], plane).climbM).toBe(s.climbM);
  });

  it('leaves the climb out when the sections are not one line', () => {
    expect(routeStats([[[11, 46], [11, 46.001]], [[11, 46.005], [11, 46.006]]], plane).climbM).toBeNull();
  });

  it('writes one feature per route with elevations in the positions', () => {
    const fc = toFeatureCollection(parseFerratas(fixture), plane);
    const taja = fc.features.find((x) => x.properties.name === 'Tajakante Klettersteig')!;
    expect(taja.geometry.type).toBe('LineString');
    const first = taja.geometry.coordinates[0] as number[];
    expect(first).toHaveLength(3);
    expect(first[2]).toBe(Math.round(plane(first[0], first[1])));
    expect(taja.properties).toMatchObject({ grade: 4, scale: '4+', closed: false });
    expect(taja.properties.lengthM).toBeGreaterThan(500);
    expect(fc.features.find((x) => x.properties.id === 'r19557729')!.geometry.type).toBe('MultiLineString');
  });
});
