// A GPX track or route from the user's device, read in the browser: nothing is uploaded anywhere.
// GPX is plain XML, so the browser's DOMParser is enough. Tracks (<trk>, recorded) win over routes
// (<rte>, planned) when a file has both, since many apps export a planned route next to the track.
// The numbers (distance, climb, highest point) use the same code as the via ferratas.

import { ascentDescent, distanceM, lineLengthM, resample } from '../../shared/geo.ts';
import { escapeHtml, lengthText, metres } from './format.ts';

/** A file the app cannot use; the message is meant for the user. */
export class GpxError extends Error {}

/** Larger than this and the file is refused before it is read (a long multi-day track is ~10 MB). */
export const MAX_GPX_BYTES = 25 * 1024 * 1024;

export interface GpxTrack {
  /** The track's, route's or file's name; null when the file has none. */
  name: string | null;
  kind: 'track' | 'route';
  /**
   * One line per track segment or route, as [lon, lat] or [lon, lat, ele m] positions. A line has
   * elevation on all of its points or on none.
   */
  lines: number[][][];
}

/** Elevation on every point of every line. */
export const hasElevation = (t: Pick<GpxTrack, 'lines'>): boolean => t.lines.every((l) => l.every((p) => p.length > 2));

/** Parses XML text into a document; throws, or returns one with a <parsererror>, when it is broken. */
export type XmlParser = (text: string) => Document;

const browserParser: XmlParser = (text) => new DOMParser().parseFromString(text, 'application/xml');

/** Child elements with the given local name, whatever namespace (GPX 1.0, 1.1 or none) the file uses. */
const children = (el: Element, name: string): Element[] =>
  Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === name);

const childText = (el: Element, name: string): string | null => {
  const t = children(el, name)[0]?.textContent?.trim();
  return t ? t : null;
};

/** A <trkpt> or <rtept> as [lon, lat] or [lon, lat, ele]; null when its position is missing or invalid. */
function point(el: Element): number[] | null {
  const lat = Number(el.getAttribute('lat') ?? NaN);
  const lon = Number(el.getAttribute('lon') ?? NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const raw = childText(el, 'ele');
  const ele = raw === null ? NaN : Number(raw);
  return Number.isFinite(ele) ? [lon, lat, ele] : [lon, lat];
}

/** The valid points of a segment; elevation is dropped from all of them unless every one has it. */
function line(points: Element[]): number[][] {
  const out = points.map(point).filter((p): p is number[] => p !== null);
  return out.every((p) => p.length > 2) ? out : out.map((p) => p.slice(0, 2));
}

/** Reads a GPX file's text. Throws a GpxError when it is not GPX or has nothing to draw. */
export function parseGpx(text: string, parse: XmlParser = browserParser): GpxTrack {
  let doc: Document;
  try {
    doc = parse(text);
  } catch {
    throw new GpxError('This file could not be read as GPX (the XML is broken).');
  }
  // Browsers report broken XML as a <parsererror> element instead of throwing.
  if (doc.getElementsByTagName('parsererror').length) throw new GpxError('This file could not be read as GPX (the XML is broken).');
  const root = doc.documentElement;
  if (!root || root.localName !== 'gpx') throw new GpxError('This is not a GPX file.');

  const keep = (lines: number[][][]) => lines.filter((l) => l.length >= 2);
  const trks = children(root, 'trk');
  const rtes = children(root, 'rte');
  const trackLines = keep(trks.flatMap((t) => children(t, 'trkseg').map((s) => line(children(s, 'trkpt')))));
  const routeLines = keep(rtes.map((r) => line(children(r, 'rtept'))));
  const kind = trackLines.length ? 'track' : 'route';
  const lines = trackLines.length ? trackLines : routeLines;
  if (!lines.length) throw new GpxError('This GPX file has no track or route to draw (waypoints alone are not shown).');

  const metadata = children(root, 'metadata')[0];
  const named = (kind === 'track' ? trks : rtes).map((e) => childText(e, 'name')).find((n) => n !== null);
  // GPX 1.0 puts the file's name directly under <gpx>.
  const name = named ?? (metadata ? childText(metadata, 'name') : null) ?? childText(root, 'name');
  return { name: name ?? null, kind, lines };
}

/** Distances in metres, elevations in metres above sea level; elevation numbers are null without elevation. */
export interface TrackStats {
  distanceM: number;
  ascentM: number | null;
  descentM: number | null;
  /** [lon, lat, ele] of the highest point. */
  highest: [number, number, number] | null;
  lowestM: number | null;
}

/** Elevation profile spacing for the climb, as for the via ferratas. */
export const PROFILE_STEP_M = 10;

/**
 * The line with extra points wherever two are more than `stepM` apart, keeping every original
 * point (unlike `resample`, which would cut the corners).
 */
export function densify(line: readonly (readonly number[])[], stepM: number): number[][] {
  const out: number[][] = line.length ? [[...line[0]]] : [];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const n = Math.ceil(distanceM(a, b) / stepM);
    for (let k = 1; k < n; k++) out.push(a.map((v, j) => v + ((b[j] - v) * k) / n));
    out.push([...b]);
  }
  return out;
}

/**
 * Distance, climb and highest point. Gaps between segments (a paused recording) are not counted.
 * Climb uses the via ferrata hysteresis, so GPS and terrain-model noise does not add up.
 */
export function trackStats(lines: readonly (readonly number[])[][]): TrackStats {
  const distance = lines.reduce((s, l) => s + lineLengthM(l), 0);
  const withEle = lines.filter((l) => l.length && l.every((p) => p.length > 2));
  if (!withEle.length) return { distanceM: distance, ascentM: null, descentM: null, highest: null, lowestM: null };
  let ascent = 0;
  let descent = 0;
  let highest = withEle[0][0];
  let lowest = Infinity;
  for (const l of withEle) {
    const climb = ascentDescent(resample(l, PROFILE_STEP_M).map((p) => p[2]));
    ascent += climb.ascent;
    descent += climb.descent;
    for (const p of l) {
      if (p[2] > highest[2]) highest = p;
      lowest = Math.min(lowest, p[2]);
    }
  }
  return {
    distanceM: distance,
    ascentM: ascent,
    descentM: descent,
    highest: [highest[0], highest[1], highest[2]],
    lowestM: lowest,
  };
}

/** Initial compass bearing in degrees (0 north, 90 east) from a to b. */
export function bearingDeg(a: readonly number[], b: readonly number[]): number {
  const rad = Math.PI / 180;
  const [lat1, lat2] = [a[1] * rad, b[1] * rad];
  const dLon = (b[0] - a[0]) * rad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) / rad) % 360 + 360) % 360;
}

/**
 * The direction the camera looks along the track: from the start towards the end, or for a loop
 * (the end comes back near the start) towards the point farthest from the start.
 */
export function viewBearing(lines: readonly (readonly number[])[][]): number {
  const all = lines.flat();
  const start = all[0];
  const end = all[all.length - 1];
  let far = end;
  let farM = 0;
  for (const p of all) {
    const d = distanceM(start, p);
    if (d > farM) [far, farM] = [p, d];
  }
  const target = distanceM(start, end) < farM / 3 ? far : end;
  return bearingDeg(start, target);
}

/** [west, south, east, north] around every line. */
export function trackBounds(lines: readonly (readonly number[])[][]): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of lines) {
    for (const [lon, lat] of l) {
      [w, e] = [Math.min(w, lon), Math.max(e, lon)];
      [s, n] = [Math.min(s, lat), Math.max(n, lat)];
    }
  }
  return [w, s, e, n];
}

/** Where the track's elevation came from. */
export type ElevationSource = 'file' | 'terrain' | null;

/** The track's part of the point panel; the snow along it and the forecast at its highest point follow. */
export function gpxHtml(t: GpxTrack, s: TrackStats, source: ElevationSource, fileName: string | null): string {
  const rows = [
    `<dt>Distance</dt><dd class="big">${lengthText(s.distanceM)}${t.lines.length > 1 ? ` <span class="muted">(${t.lines.length} ${t.kind === 'track' ? 'segments' : 'routes'})</span>` : ''}</dd>`,
    s.ascentM === null || s.descentM === null ? '' : `<dt>Climb</dt><dd>↑ ${metres(s.ascentM)} · ↓ ${metres(s.descentM)}</dd>`,
    s.lowestM === null || !s.highest ? '' : `<dt>Elevation</dt><dd>${metres(s.lowestM)} – ${metres(s.highest[2])}</dd>`,
  ];
  const from =
    source === 'file'
      ? 'Elevation and climb from the file.'
      : source === 'terrain'
        ? 'The file has no elevation, so it is read from the terrain model.'
        : 'No elevation in the file or the terrain model, so climb is not shown.';
  return `
    <dl class="kv">${rows.join('')}</dl>
    <p class="muted">${fileName ? `${escapeHtml(fileName)}. ` : ''}${from}
    The track stays in this browser: it is not uploaded and not part of shared links.</p>
    <p><button type="button" class="link-btn gpx-remove">Remove track</button></p>`;
}
