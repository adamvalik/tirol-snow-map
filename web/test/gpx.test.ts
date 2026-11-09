import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { distanceM, lineLengthM } from '../../shared/geo.ts';
import { bearingDeg, densify, GpxError, gpxHtml, hasElevation, parseGpx, trackBounds, trackStats, viewBearing, type XmlParser } from '../src/gpx.ts';

// Node has no DOMParser; xmldom stands in for the browser's. Broken XML throws, as the app expects
// either a throw or a <parsererror>.
const xml: XmlParser = (text) =>
  new DOMParser({
    onError: (level, msg) => {
      if (level !== 'warning') throw new Error(msg);
    },
  }).parseFromString(text, 'application/xml') as unknown as Document;

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/gpx/${name}`, import.meta.url), 'utf8');
const parse = (text: string) => parseGpx(text, xml);

describe('parseGpx', () => {
  it('reads a recorded track with elevation, ignoring times and extensions', () => {
    const t = parse(fixture('track-ele.gpx'));
    expect(t.kind).toBe('track');
    // The track's name wins over the file's, and entities are decoded.
    expect(t.name).toBe('Seiser Alm & Schlern');
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toHaveLength(60);
    expect(t.lines[0][0]).toEqual([11.6065, 46.5385, 1849.5]);
    expect(hasElevation(t)).toBe(true);
  });

  it('reads a planned route without elevation and skips waypoints', () => {
    const t = parse(fixture('route-no-ele.gpx'));
    expect(t.kind).toBe('route');
    expect(t.name).toBe('Puez loop');
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toHaveLength(12);
    expect(t.lines[0].every((p) => p.length === 2)).toBe(true);
    expect(hasElevation(t)).toBe(false);
  });

  it('reads GPX 1.0 with several segments, dropping bad points and one-point segments', () => {
    const t = parse(fixture('segments-1.0.gpx'));
    expect(t.name).toBe('Two days in the Ortler');
    // The third segment has a single point and cannot be drawn.
    expect(t.lines).toHaveLength(2);
    // The point with lat="abc" is dropped.
    expect(t.lines[0]).toHaveLength(5);
    expect(t.lines[0].every((p) => p.length === 3)).toBe(true);
    // One point of the second segment has no <ele>, so the segment carries none.
    expect(t.lines[1]).toHaveLength(5);
    expect(t.lines[1].every((p) => p.length === 2)).toBe(true);
    expect(hasElevation(t)).toBe(false);
  });

  it('prefers the track when a file has a route as well', () => {
    const t = parse(`<gpx xmlns="http://www.topografix.com/GPX/1/1">
      <rte><name>Plan</name><rtept lat="46.5" lon="11.5"/><rtept lat="46.6" lon="11.6"/></rte>
      <trk><name>Done</name><trkseg><trkpt lat="46.5" lon="11.5"/><trkpt lat="46.55" lon="11.52"/></trkseg></trk>
    </gpx>`);
    expect(t).toMatchObject({ kind: 'track', name: 'Done' });
    expect(t.lines).toEqual([
      [
        [11.5, 46.5],
        [11.52, 46.55],
      ],
    ]);
  });

  it('reads a file without a namespace or a name', () => {
    const t = parse('<gpx><trk><trkseg><trkpt lat="46.5" lon="11.5"/><trkpt lat="46.51" lon="11.5"/></trkseg></trk></gpx>');
    expect(t.name).toBeNull();
    expect(t.lines[0]).toHaveLength(2);
  });

  it('refuses broken XML, other XML and files with nothing to draw', () => {
    expect(() => parse(fixture('broken.gpx'))).toThrow(GpxError);
    expect(() => parse(fixture('broken.gpx'))).toThrow(/broken/);
    expect(() => parse('<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>')).toThrow(/not a GPX/);
    expect(() => parse('<gpx><wpt lat="46.5" lon="11.5"/></gpx>')).toThrow(/no track or route/);
    expect(() => parse('<gpx><trk><trkseg><trkpt lat="99" lon="11.5"/><trkpt lat="46.5" lon="11.5"/></trkseg></trk></gpx>')).toThrow(
      /no track or route/,
    );
  });

  it('reports a browser-style <parsererror> as broken', () => {
    const doc = new DOMParser().parseFromString('<gpx><parsererror>bad</parsererror></gpx>', 'application/xml') as unknown as Document;
    expect(() => parseGpx('', () => doc)).toThrow(/broken/);
  });
});

describe('trackStats', () => {
  it('measures distance, climb with hysteresis and the highest point', () => {
    const t = parse(fixture('track-ele.gpx'));
    const s = trackStats(t.lines);
    expect(s.distanceM).toBeCloseTo(lineLengthM(t.lines[0]), 6);
    expect(s.distanceM).toBeGreaterThan(5000);
    expect(s.distanceM).toBeLessThan(7000);
    // About 650 m up and 60 m down; the ±1.5 m noise in the file must not add up.
    expect(s.ascentM!).toBeGreaterThan(640);
    expect(s.ascentM!).toBeLessThan(665);
    expect(s.descentM!).toBeGreaterThan(50);
    expect(s.descentM!).toBeLessThan(75);
    expect(s.highest![2]).toBeGreaterThan(2495);
    expect(s.lowestM!).toBeLessThan(1852);
  });

  it('adds up segments without the gap between them', () => {
    const lines = [
      [
        [11.5, 46.5, 1000],
        [11.5, 46.51, 1100],
      ],
      [
        [11.6, 46.5, 1100],
        [11.6, 46.51, 1000],
      ],
    ];
    const s = trackStats(lines);
    expect(s.distanceM).toBeCloseTo(2 * lineLengthM(lines[0]), 6);
    expect(s.ascentM).toBeCloseTo(100, 6);
    expect(s.descentM).toBeCloseTo(100, 6);
    expect(s.highest).toEqual([11.5, 46.51, 1100]);
    expect(s.lowestM).toBe(1000);
  });

  it('gives only the distance without elevation', () => {
    const s = trackStats(parse(fixture('route-no-ele.gpx')).lines);
    expect(s.distanceM).toBeGreaterThan(1000);
    expect(s).toMatchObject({ ascentM: null, descentM: null, highest: null, lowestM: null });
  });
});

describe('densify', () => {
  it('adds points between far-apart ones and keeps every original point', () => {
    const line = [
      [11.5, 46.5],
      [11.5, 46.501],
      [11.5005, 46.501],
    ];
    const d = densify(line, 10);
    for (const p of line) expect(d).toContainEqual(p);
    for (let i = 1; i < d.length; i++) expect(distanceM(d[i - 1], d[i])).toBeLessThanOrEqual(10.0001);
    expect(lineLengthM(d)).toBeCloseTo(lineLengthM(line), 6);
    // 111 m and 38 m: 12 and 4 steps.
    expect(d).toHaveLength(17);
    expect(densify([], 10)).toEqual([]);
    expect(densify([[11, 46]], 10)).toEqual([[11, 46]]);
  });
});

describe('camera helpers', () => {
  it('computes compass bearings', () => {
    expect(bearingDeg([11, 46], [11, 47])).toBeCloseTo(0, 6);
    expect(bearingDeg([11, 46], [12, 46])).toBeCloseTo(89.64, 1);
    expect(bearingDeg([11, 46], [11, 45])).toBeCloseTo(180, 6);
    expect(bearingDeg([11, 46], [10, 46])).toBeCloseTo(270.36, 1);
  });

  it('looks from start to end, or for a loop towards its far point', () => {
    const southWest = parse(fixture('track-ele.gpx')).lines;
    expect(viewBearing(southWest)).toBeGreaterThan(200);
    expect(viewBearing(southWest)).toBeLessThan(250);
    // The Puez loop starts and ends in the same place and reaches farthest to the east.
    const loop = parse(fixture('route-no-ele.gpx')).lines;
    expect(viewBearing(loop)).toBeGreaterThan(45);
    expect(viewBearing(loop)).toBeLessThan(135);
  });

  it('bounds every segment', () => {
    expect(trackBounds(parse(fixture('segments-1.0.gpx')).lines)).toEqual([10.6, 46.5, 10.628, 46.528]);
  });
});

describe('gpxHtml', () => {
  it('shows the numbers, where the elevation came from and escapes the file name', () => {
    const t = parse(fixture('track-ele.gpx'));
    const html = gpxHtml(t, trackStats(t.lines), 'file', '<b>hike</b>.gpx');
    expect(html).toContain('km');
    expect(html).toContain('↑');
    expect(html).toContain('from the file');
    expect(html).toContain('&#60;b&#62;hike');
    expect(html).not.toContain('<b>hike');
    expect(html).toContain('gpx-remove');
  });

  it('leaves out climb without elevation and says so', () => {
    const t = parse(fixture('route-no-ele.gpx'));
    const html = gpxHtml(t, trackStats(t.lines), null, null);
    expect(html).not.toContain('Climb');
    expect(html).toContain('climb is not shown');
  });
});
