import { describe, expect, it } from 'vitest';
import type { LonLat, OsmRelation, OsmWay } from '../src/ferratas.ts';
import { readOsmXml } from '../src/osm-xml.ts';
import {
  difficulty,
  durationMinutes,
  grooming,
  mergeResponses,
  multipolygon,
  overpassQuery,
  parseWinter,
  pisteKind,
  queryBoxes,
  startsInArea,
  toWinterCollection,
  winterStats,
} from '../src/winter.ts';

/** A way along a line of [lon, lat] points with the given node ids. */
const way = (id: number, nodes: number[], coords: LonLat[], tags: Record<string, string>): OsmWay => ({
  type: 'way',
  id,
  nodes,
  geometry: coords.map(([lon, lat]) => ({ lon, lat })),
  tags,
});
const relation = (id: number, ways: number[], tags: Record<string, string>, role = ''): OsmRelation => ({
  type: 'relation',
  id,
  members: ways.map((ref) => ({ type: 'way', ref, role })),
  tags,
});

describe('tag readers', () => {
  it('reads piste types, difficulties and grooming', () => {
    expect(pisteKind({ 'piste:type': 'downhill' })).toBe('downhill');
    expect(pisteKind({ 'piste:type': 'hike;nordic' })).toBe('nordic');
    expect(pisteKind({ 'piste:type': 'hike' })).toBeNull();
    expect(difficulty('Intermediate')).toBe('intermediate');
    expect(difficulty('extreme')).toBe('expert');
    expect(difficulty('blue')).toBeNull();
    expect(grooming('classic;skating')).toBe('classic+skating');
    expect(grooming('skating+classic')).toBe('classic+skating');
    expect(grooming('classic')).toBe('classic');
    expect(grooming('backcountry')).toBe('backcountry');
    expect(grooming('mogul')).toBeNull();
  });

  it('reads ride times in minutes or mm:ss', () => {
    expect(durationMinutes('6')).toBe(6);
    expect(durationMinutes('6.5')).toBe(6.5);
    expect(durationMinutes('07:30')).toBe(7.5);
    expect(durationMinutes('0:12:00')).toBe(12);
    expect(durationMinutes('fast')).toBeNull();
    expect(durationMinutes(undefined)).toBeNull();
  });
});

describe('parseWinter', () => {
  it('keeps skier lifts with their facts and drops zip lines and disused ones', () => {
    const items = parseWinter({
      elements: [
        way(1, [1, 2], [[11.7, 46.5], [11.71, 46.51]], {
          aerialway: 'chair_lift',
          name: 'Ciampinoi',
          'aerialway:occupancy': '6',
          'aerialway:capacity': '2400',
          'aerialway:duration': '5:30',
          'aerialway:bubble': 'yes',
        }),
        way(2, [3, 4], [[11.7, 46.5], [11.71, 46.5]], { aerialway: 'zip_line' }),
        way(3, [5, 6], [[11.7, 46.5], [11.71, 46.5]], { aerialway: 't-bar', disused: 'yes' }),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'w1', kind: 'lift', lift: 'chair_lift', name: 'Ciampinoi', occupancy: 6, capacity: 2400, durationMin: 5.5, bubble: true, heating: false });
  });

  it('keeps the pylons mapped on a lift, bottom to top, without the stations', () => {
    const [lift] = parseWinter({
      elements: [
        way(1, [1, 2, 3, 4], [[11, 46.5], [11, 46.501], [11, 46.502], [11, 46.503]], { aerialway: 'gondola' }),
        { type: 'node', id: 2, lat: 46.501, lon: 11, tags: { aerialway: 'pylon' } },
        { type: 'node', id: 4, lat: 46.503, lon: 11, tags: { aerialway: 'pylon' } },
      ],
    });
    expect(lift.pylons).toEqual([[11, 46.501]]);
    const [bare] = parseWinter({ elements: [way(1, [1, 2], [[11, 46.5], [11, 46.6]], { aerialway: 'gondola' })] });
    expect(bare.pylons).toBeNull();
  });

  it('joins named sections that meet and share a difficulty, but not unnamed ones', () => {
    const red = { 'piste:type': 'downhill', 'piste:difficulty': 'intermediate' };
    const items = parseWinter({
      elements: [
        way(10, [1, 2], [[11, 46.5], [11, 46.49]], { ...red, 'piste:name': 'Saslong' }),
        way(11, [2, 3], [[11, 46.49], [11, 46.48]], { ...red, name: 'Saslong' }),
        way(12, [3, 4], [[11, 46.48], [11, 46.47]], { ...red, name: 'Saslong', 'piste:difficulty': 'advanced' }),
        way(13, [4, 5], [[11, 46.47], [11, 46.46]], red),
        way(14, [5, 6], [[11, 46.46], [11, 46.45]], red),
      ],
    });
    expect(items.map((i) => [i.id, i.ways, i.difficulty])).toEqual([
      ['w10', 2, 'intermediate'],
      ['w12', 1, 'advanced'],
      // Unnamed sections that only continue each other are one run.
      ['w13', 2, 'intermediate'],
    ]);
    expect(items[0].geometry).toEqual({ type: 'lines', lines: [[[11, 46.5], [11, 46.49], [11, 46.48]]] });
  });

  it('keeps unnamed sections apart at a junction of three', () => {
    const blue = { 'piste:type': 'downhill', 'piste:difficulty': 'easy' };
    const items = parseWinter({
      elements: [
        way(1, [1, 2], [[11, 46.5], [11, 46.49]], blue),
        way(2, [2, 3], [[11, 46.49], [11, 46.48]], blue),
        way(3, [2, 4], [[11, 46.49], [11.01, 46.49]], blue),
        way(4, [3, 5], [[11, 46.48], [11, 46.47]], { ...blue, 'piste:difficulty': 'intermediate' }),
      ],
    });
    expect(items.map((i) => [i.id, i.ways])).toEqual([['w1', 1], ['w2', 1], ['w3', 1], ['w4', 1]]);
  });

  it('draws a route relation once, with its own tags, and its member ways not again', () => {
    const items = parseWinter({
      elements: [
        way(20, [1, 2], [[11, 46.5], [11.01, 46.5]], { 'piste:type': 'nordic', 'piste:grooming': 'classic' }),
        way(21, [2, 3], [[11.01, 46.5], [11.02, 46.5]], { highway: 'track' }),
        way(22, [9, 8], [[11.1, 46.5], [11.11, 46.5]], { 'piste:type': 'downhill' }),
        relation(30, [20, 21, 22], { type: 'route', route: 'piste', 'piste:type': 'nordic', name: 'Loipe Toblach', 'piste:grooming': 'classic;skating', lit: 'yes' }),
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['w22', 'r30']);
    expect(items[1]).toMatchObject({ kind: 'nordic', name: 'Loipe Toblach', grooming: 'classic+skating', lit: true, ways: 2, osm: 'relation/30' });
    expect(items[1].geometry).toEqual({ type: 'lines', lines: [[[11, 46.5], [11.01, 46.5], [11.02, 46.5]]] });
  });

  it('reads closed downhill ways and multipolygons as areas, closed trails as loops', () => {
    const ring: LonLat[] = [[11, 46.5], [11.01, 46.5], [11.01, 46.51], [11, 46.5]];
    const items = parseWinter({
      elements: [
        way(40, [1, 2, 3, 1], ring, { 'piste:type': 'downhill', 'piste:difficulty': 'easy' }),
        way(41, [4, 5, 6, 4], ring, { 'piste:type': 'nordic' }),
        way(42, [7, 8, 9, 7], ring, { 'piste:type': 'downhill', area: 'no' }),
        way(43, [10, 11, 12], ring.slice(0, 3), {}),
        way(44, [12, 10], [ring[2], ring[0]], {}),
        relation(50, [43, 44], { type: 'multipolygon', 'piste:type': 'downhill', 'piste:difficulty': 'freeride' }, 'outer'),
      ],
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i.geometry.type]));
    expect(byId).toEqual({ w40: 'polygons', w41: 'lines', w42: 'lines', r50: 'polygons' });
    expect(items.find((i) => i.id === 'r50')).toMatchObject({ difficulty: 'freeride', ways: 2 });
  });

  it('puts an inner ring into the outer ring it lies in', () => {
    const outer = way(1, [1, 2, 3, 4, 1], [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], {});
    const inner = way(2, [5, 6, 7, 5], [[0.2, 0.2], [0.4, 0.2], [0.3, 0.4], [0.2, 0.2]], {});
    const polygons = multipolygon([{ way: outer, role: 'outer' }, { way: inner, role: 'inner' }]);
    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(2);
  });

  it('skips abandoned pistes', () => {
    expect(parseWinter({ elements: [way(1, [1, 2], [[11, 46.5], [11, 46.49]], { 'piste:type': 'downhill', 'piste:abandoned': 'yes' })] })).toEqual([]);
  });
});

describe('statistics and the layer file', () => {
  // Elevation rises 1 m per 0.0001° of latitude: 1000 m over the test lines.
  const elevationAt = (_lon: number, lat: number) => 1000 + (lat - 46.5) * 10000;

  it('gives a lift its ends and a trail its climb', () => {
    const [lift, trail] = parseWinter({
      elements: [
        way(1, [1, 2], [[11, 46.5], [11, 46.6]], { aerialway: 'gondola' }),
        way(2, [3, 4, 5], [[11, 46.5], [11, 46.55], [11, 46.5]], { 'piste:type': 'nordic' }),
      ],
    });
    expect(winterStats(lift, elevationAt)).toMatchObject({ startM: 1000, endM: 2000, minM: 1000, maxM: 2000, climbM: null, areaHa: null });
    expect(winterStats(lift, elevationAt).lengthM).toBeCloseTo(11119, -1);
    expect(winterStats(trail, elevationAt)).toMatchObject({ climbM: 500, startM: null });
  });

  it('measures an area slope in hectares', () => {
    // About 111 m × 77 m.
    const [slope] = parseWinter({
      elements: [way(1, [1, 2, 3, 4, 1], [[11, 46.5], [11.001, 46.5], [11.001, 46.501], [11, 46.501], [11, 46.5]], { 'piste:type': 'downhill' })],
    });
    expect(winterStats(slope, elevationAt).areaHa).toBeCloseTo(0.9, 1);
    const fc = toWinterCollection([slope], elevationAt);
    expect(fc.features[0].geometry.type).toBe('Polygon');
    expect(fc.features[0].properties).toMatchObject({ kind: 'downhill', minM: 1000, maxM: 1010 });
    // Empty properties are left out of the file; the app fills them back in.
    expect(fc.features[0].properties).not.toHaveProperty('lengthM');
    expect(fc.features[0].properties).not.toHaveProperty('name');
    expect(fc.features[0].properties).not.toHaveProperty('osm');
    // Positions without elevations; the highest drawn point is the third corner (46.501).
    expect((fc.features[0].geometry.coordinates as number[][][])[0].every((p) => p.length === 2)).toBe(true);
    expect(fc.features[0].properties).toMatchObject({ top: 2 });
  });

  it('leaves out the top when it is the first point', () => {
    const [lift] = parseWinter({ elements: [way(1, [1, 2], [[11, 46.6], [11, 46.5]], { aerialway: 'gondola' })] });
    const f = toWinterCollection([lift], elevationAt).features[0];
    expect(f.geometry.coordinates).toEqual([[11, 46.6], [11, 46.5]]);
    expect(f.properties).not.toHaveProperty('top');
  });

  it('keeps only items starting in the covered area', () => {
    const inside = parseWinter({ elements: [way(1, [1, 2], [[11.5, 46.5], [11.5, 46.6]], { aerialway: 'gondola' })] })[0];
    const outside = parseWinter({ elements: [way(1, [1, 2], [[13, 46.5], [11.5, 46.6]], { aerialway: 'gondola' })] })[0];
    expect(startsInArea(inside)).toBe(true);
    expect(startsInArea(outside)).toBe(false);
  });
});

describe('Overpass requests', () => {
  it('covers the area in boxes without gaps', () => {
    const boxes = queryBoxes({ west: 10.2, south: 46.1, east: 12.7, north: 47.25 });
    expect(boxes).toHaveLength(15);
    expect(Math.min(...boxes.map((b) => b.west))).toBe(10.2);
    expect(Math.max(...boxes.map((b) => b.east))).toBe(12.7);
    expect(Math.max(...boxes.map((b) => b.north))).toBe(47.25);
    expect(overpassQuery(boxes[0])).toContain('(46.1,10.2,46.5,10.7)');
  });

  it('merges responses, each element once', () => {
    const a = { elements: [{ type: 'way', id: 1 }, { type: 'relation', id: 1 }] };
    const b = { elements: [{ type: 'way', id: 1 }, { type: 'way', id: 2 }] };
    expect(mergeResponses([a, b]).elements.map((e) => `${e.type}/${e.id}`)).toEqual(['way/1', 'relation/1', 'way/2']);
  });
});

describe('OSM XML', () => {
  it('reads ways, relations and pylons inside the box, with escaped tags', async () => {
    const xml = `<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6" generator="osmium/1.15.0">
  <node id="1" version="1" lat="46.5" lon="11.0"/>
  <node id="2" version="1" lat="46.6" lon="11.0">
    <tag k="aerialway" v="pylon"/>
  </node>
  <node id="3" version="1" lat="46.7" lon="11.0"/>
  <node id="9" version="1" lat="10.0" lon="10.0">
    <tag k="aerialway" v="pylon"/>
  </node>
  <way id="10" version="1">
    <nd ref="1"/>
    <nd ref="2"/>
    <nd ref="3"/>
    <tag k="aerialway" v="gondola"/>
    <tag k="name" v="Ski &amp; Sun &quot;Express&quot;"/>
  </way>
  <way id="11" version="1">
    <nd ref="9"/>
    <tag k="piste:type" v="downhill"/>
  </way>
  <relation id="20" version="1">
    <member type="way" ref="10" role=""/>
    <tag k="piste:type" v="nordic"/>
  </relation>
  <relation id="21" version="1">
    <member type="way" ref="11" role=""/>
    <tag k="piste:type" v="nordic"/>
  </relation>
</osm>`;
    async function* lines() {
      yield* xml.split('\n');
    }
    const { elements } = await readOsmXml(lines(), { west: 10.5, south: 46, east: 11.5, north: 47 });
    expect(elements.map((e) => `${e.type}/${e.id}`)).toEqual(['node/2', 'way/10', 'relation/20']);
    const items = parseWinter({ elements });
    expect(items.find((i) => i.kind === 'lift')).toMatchObject({ name: 'Ski & Sun "Express"', pylons: [[11, 46.6]] });
  });
});
