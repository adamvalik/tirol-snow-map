// A GPX track from the user's device: drawn on the terrain with a start and an end marker and a
// label with its name and length. One track at a time; the last one is kept in this browser
// (gpxStore.ts) and drawn again after a reload. Nothing is uploaded, and the track is not part of
// shared links. See docs/release-plan.md, section 4.
//
// This module draws the track and hands out data; the track's panel and the controls that load
// and remove it are built on top of it:
//
// - `loadGpxFile(file, onProgress)` / `removeGpx()` / `flyToGpx()`
// - `onGpxChange(track, why)`: a track was loaded, restored after a reload, or removed
// - `onGpxSelect(track)`: the line on the map was tapped
// - `gpxSnow()` / `onGpxSnow(snow)`: snow along the track for the day on the map, again when the day changes
import type * as maplibregl from 'maplibre-gl';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { lengthText } from '../format.ts';
import {
  densify,
  type ElevationSource,
  GpxError,
  type GpxTrack,
  hasElevation,
  MAX_GPX_BYTES,
  parseGpx,
  PROFILE_STEP_M,
  trackBounds,
  type TrackProfile,
  trackProfile,
  type TrackStats,
  trackStats,
  trackTitle,
  viewBearing,
} from '../gpx.ts';
import { indexedDbStore, type StoredTrack, type TrackStore } from '../gpxStore.ts';
import { inArea } from '../island.ts';
import { terrainAlong } from '../terrainSampler.ts';
import { onSnowShown, type SnowAlong, snowAlong } from './snow.ts';
import type { App, LayerModule } from './types.ts';

const SOURCE = 'gpx';
const HIT = 'gpx-hit';
const LABEL = 'gpx-label';
export const GPX_COLOR = '#7048e8';
export const GPX_START_COLOR = '#2f9e44';
export const GPX_END_COLOR = '#e03131';

/** A track ready for the map: parsed, with elevation filled in where the file has none. */
export interface ShownTrack {
  track: GpxTrack;
  /** The track's name, else the file name without ".gpx". */
  title: string;
  stats: TrackStats;
  /** For the elevation chart; its points are the ones `gpxSnow` gives a state for. */
  profile: TrackProfile;
  source: ElevationSource;
  fileName: string;
}

/**
 * Steps of a load, for a "Reading…" state: the file is being read (the name is not known yet), then
 * it has been read, with `terrain` true while its heights are being filled in from the terrain model.
 */
export type GpxProgress =
  | { stage: 'reading'; fileName: string }
  | { stage: 'parsed'; fileName: string; title: string; kind: GpxTrack['kind']; terrain: boolean };

/** Why the track changed: a file was loaded, the kept one drawn after a reload, or it was removed. */
export type GpxChange = 'loaded' | 'restored' | 'removed';

let app: App | null = null;
const store: TrackStore = indexedDbStore();
let restoring: Promise<StoredTrack | null> = Promise.resolve(null);
let current: ShownTrack | null = null;
/** The profile points as [lon, lat, ele] positions, for the snow check. */
let snowPositions: number[][] = [];
/** Bumped by every load and remove, so a slow one that finishes late does not win. */
let generation = 0;
const changeListeners: ((t: ShownTrack | null, why: GpxChange) => void)[] = [];
const selectListeners: ((t: ShownTrack) => void)[] = [];
const snowListeners: ((s: SnowAlong | null) => void)[] = [];

/** The track on the map, or null. */
export const gpxTrack = (): ShownTrack | null => current;

/** Called with the new track (null when removed) whenever it changes. */
export function onGpxChange(listener: (t: ShownTrack | null, why: GpxChange) => void) {
  changeListeners.push(listener);
}

/** Called when the track's line on the map is tapped (a tap on it opens no point panel). */
export function onGpxSelect(listener: (t: ShownTrack) => void) {
  selectListeners.push(listener);
}

/**
 * Snow seen from space along the track for the day on the map: shares, lowest snow, and a state per
 * profile point, or null without a track or while the snow is loading.
 */
export const gpxSnow = (): SnowAlong | null => (current ? snowAlong(snowPositions) : null);

/** Called with `gpxSnow()` whenever it changes: a new track, the snow loaded, another day on the slider. */
export function onGpxSnow(listener: (s: SnowAlong | null) => void) {
  snowListeners.push(listener);
}

const tellSnow = () => {
  const s = gpxSnow();
  for (const l of snowListeners) l(s);
};

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Where the label sits: the profile point halfway along the track. */
function labelPoint(p: TrackProfile): number[] {
  const half = p.distanceM / 2;
  const q = p.points.reduce((a, b) => (Math.abs(b.distM - half) < Math.abs(a.distM - half) ? b : a), p.points[0]);
  return [q.lon, q.lat];
}

function geoJson(t: ShownTrack): FeatureCollection {
  const { lines } = t.track;
  const first = lines[0][0];
  const lastLine = lines[lines.length - 1];
  const last = lastLine[lastLine.length - 1];
  const point = (role: string, coordinates: number[], extra = {}): Feature => ({
    type: 'Feature',
    properties: { role, ...extra },
    geometry: { type: 'Point', coordinates },
  });
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { role: 'line' }, geometry: { type: 'MultiLineString', coordinates: lines } },
      point('end', last),
      point('start', first),
      point('label', labelPoint(t.profile), { name: t.title, distance: lengthText(t.stats.distanceM) }),
    ],
  };
}

/**
 * Fills in elevation from the terrain model when the file has none; lines it cannot fill stay flat.
 * The lines are first given a point every 10 m, so a planned route with a few far-apart points
 * still follows the ground between them.
 */
async function withElevation(t: GpxTrack): Promise<{ track: GpxTrack; source: ElevationSource }> {
  if (hasElevation(t)) return { track: t, source: 'file' };
  const dense = t.lines.map((l) => densify(l.map((p) => p.slice(0, 2)), PROFILE_STEP_M));
  let ele: (number | null)[];
  try {
    ele = await terrainAlong(dense.flat());
  } catch (e) {
    console.warn('GPX terrain elevation:', e);
    return { track: t, source: null };
  }
  let i = 0;
  const lines = dense.map((l) => {
    const z = l.map(() => ele[i++]);
    return z.every((v) => v !== null) ? l.map(([lon, lat], k) => [lon, lat, Math.round(z[k]! * 10) / 10]) : l;
  });
  const track = { ...t, lines };
  return { track, source: lines.some((l) => l[0].length > 2) ? 'terrain' : null };
}

/** Parses and measures a file's text. Throws a GpxError the user can read. */
export async function prepareTrack(text: string, fileName: string, onProgress?: (p: GpxProgress) => void): Promise<ShownTrack> {
  const parsed = parseGpx(text);
  if (!parsed.lines.some((l) => l.some(([lon, lat]) => inArea(lon, lat)))) {
    throw new GpxError('This track lies outside the area the map covers.');
  }
  const title = trackTitle(parsed, fileName);
  onProgress?.({ stage: 'parsed', fileName, title, kind: parsed.kind, terrain: !hasElevation(parsed) });
  const { track, source } = await withElevation(parsed);
  return { track, title, stats: trackStats(track.lines), profile: trackProfile(track.lines), source, fileName };
}

function draw(t: ShownTrack | null, why: GpxChange) {
  current = t;
  snowPositions = t ? t.profile.points.map((p) => (p.ele === null ? [p.lon, p.lat] : [p.lon, p.lat, p.ele])) : [];
  (app?.map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(t ? geoJson(t) : empty);
  for (const l of changeListeners) l(t, why);
  tellSnow();
}

/** Moves the camera to show the whole track, tilted and looking along it. */
export function flyToGpx() {
  if (!app || !current) return;
  const { lines } = current.track;
  const [w, s, e, n] = trackBounds(lines);
  app.map.fitBounds(
    [
      [w, s],
      [e, n],
    ],
    { padding: 60, pitch: 55, bearing: viewBearing(lines), maxZoom: 14.5, duration: 2500 },
  );
}

/**
 * Puts a GPX file's text on the map in place of the current track, flies to it and keeps it for
 * the next visit. Throws a GpxError the user can read. When another file is loaded (or the track
 * removed) before this one is ready, this one is dropped and nothing changes.
 */
export async function loadGpxText(text: string, fileName: string, onProgress?: (p: GpxProgress) => void): Promise<ShownTrack> {
  const gen = ++generation;
  const shown = await prepareTrack(text, fileName, (p) => gen === generation && onProgress?.(p));
  // Another file was picked, or the track removed, while this one was being read.
  if (gen !== generation) return shown;
  draw(shown, 'loaded');
  flyToGpx();
  void store.save({ fileName, text, savedAt: new Date().toISOString() });
  return shown;
}

/** As loadGpxText, from a picked or dropped file. */
export async function loadGpxFile(file: File, onProgress?: (p: GpxProgress) => void): Promise<ShownTrack> {
  if (file.size > MAX_GPX_BYTES) throw new GpxError(`This file is too large (over ${MAX_GPX_BYTES / 1024 / 1024} MB).`);
  onProgress?.({ stage: 'reading', fileName: file.name });
  return loadGpxText(await file.text(), file.name, onProgress);
}

/** Takes the track off the map and out of storage. */
export function removeGpx() {
  generation++;
  void store.clear();
  if (current) draw(null, 'removed');
}

/** Draws the track kept from the last visit, without moving the camera (the address sets the view). */
async function restore() {
  const gen = generation;
  const saved = await restoring;
  if (!saved || gen !== generation) return;
  try {
    const shown = await prepareTrack(saved.text, saved.fileName);
    if (gen === generation) draw(shown, 'restored');
  } catch (e) {
    // A kept file this version cannot read any more: forget it.
    console.warn('GPX from the last visit:', e);
    if (gen === generation) void store.clear();
  }
}

export const gpx: LayerModule = {
  keys: [],
  clickLayers: [HIT],

  setup(a) {
    app = a;
    // Start reading storage now; the track is drawn once the map is ready.
    restoring = store.load();
    onSnowShown(() => {
      if (current) tellSnow();
    });
  },

  /** The line above the via ferratas and below the place labels, bivouacs and station dots; its label above the place labels. */
  init(a) {
    const { map, basemap } = a;
    const beforeId = basemap.labels[0]?.id;
    const add = (layer: maplibregl.LayerSpecification) => map.addLayer(layer, beforeId);
    const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
    const role = (...roles: string[]) => ['match', ['get', 'role'], roles, true, false] as maplibregl.FilterSpecification;
    map.addSource(SOURCE, { type: 'geojson', data: current ? geoJson(current) : empty });
    const width = (z9: number, z15: number) => ['interpolate', ['linear'], ['zoom'], 9, z9, 15, z15] as maplibregl.ExpressionSpecification;
    add({ id: 'gpx-casing', type: 'line', source: SOURCE, filter: role('line'), layout: round, paint: { 'line-color': '#ffffff', 'line-width': width(4.5, 9), 'line-opacity': 0.9 } });
    add({ id: 'gpx-line', type: 'line', source: SOURCE, filter: role('line'), layout: round, paint: { 'line-color': GPX_COLOR, 'line-width': width(2.5, 5) } });
    add({
      id: 'gpx-ends',
      type: 'circle',
      source: SOURCE,
      filter: role('start', 'end'),
      paint: {
        'circle-radius': width(4.5, 7),
        'circle-color': ['match', ['get', 'role'], 'start', GPX_START_COLOR, GPX_END_COLOR],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
    // Thin lines are hard to hit, so a wide transparent copy takes hover and click.
    add({ id: HIT, type: 'line', source: SOURCE, filter: role('line'), layout: round, paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 18 } });
    // "Seiser Alm & Schlern  5.2 km" halfway along. Above the place labels (only bivouacs and station
    // dots, added later, go over it), so place names give way to the user's own track rather than the other way round.
    map.addLayer({
      id: LABEL,
      type: 'symbol',
      source: SOURCE,
      filter: role('label'),
      layout: {
        'text-field': ['format', ['get', 'name'], {}, '  ', {}, ['get', 'distance'], { 'font-scale': 0.85 }],
        'text-font': ['Noto Sans Medium'],
        'text-size': 13,
        'text-anchor': 'bottom',
        'text-offset': [0, -0.9],
        'text-max-width': 14,
      },
      paint: { 'text-color': GPX_COLOR, 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 },
    });
    map.on('mouseenter', HIT, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', HIT, () => (map.getCanvas().style.cursor = ''));
    map.on('click', HIT, (e: maplibregl.MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      if (e.features?.length && current) for (const l of selectListeners) l(current);
    });
    // Not awaited: reading the kept track may fetch terrain, and the other layers should not wait.
    void restore();
  },
};
