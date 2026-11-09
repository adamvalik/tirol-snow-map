// A GPX track from the user's device: drawn on the terrain with a start and an end marker, with its
// distance, climb, highest point and snow along it in the point panel. One track at a time; the
// last one is kept in this browser (gpxStore.ts) and drawn again after a reload. Nothing is
// uploaded, and the track is not part of shared links. See docs/release-plan.md, section 4.
//
// It has no switch: the controls (a file input and a remove button in the layer card) call
// `loadGpxFile` and `removeGpx`, and `onGpxChange` tells them when a track comes or goes.
import * as maplibregl from 'maplibre-gl';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { resample } from '../../../shared/geo.ts';
import { $ } from '../app/dom.ts';
import {
  densify,
  type ElevationSource,
  GpxError,
  type GpxTrack,
  gpxHtml,
  hasElevation,
  MAX_GPX_BYTES,
  parseGpx,
  PROFILE_STEP_M,
  trackBounds,
  type TrackStats,
  trackStats,
  viewBearing,
} from '../gpx.ts';
import { indexedDbStore, type StoredTrack, type TrackStore } from '../gpxStore.ts';
import { inArea } from '../island.ts';
import { closePanel } from '../panel.ts';
import { terrainAlong } from '../terrainSampler.ts';
import { routeSnowSummary } from './snow.ts';
import type { App, LayerModule } from './types.ts';

const SOURCE = 'gpx';
const HIT = 'gpx-hit';
const LAYERS = ['gpx-casing', 'gpx-line', 'gpx-ends', HIT];
export const GPX_COLOR = '#7048e8';
const START_COLOR = '#2f9e44';
const END_COLOR = '#e03131';

/** A track ready for the map: parsed, with elevation filled in where the file has none. */
export interface ShownTrack {
  track: GpxTrack;
  stats: TrackStats;
  source: ElevationSource;
  fileName: string;
  /** Evenly spaced points for the snow along the track, so each share is a share of its length. */
  snowPoints: number[][];
}

let app: App | null = null;
const store: TrackStore = indexedDbStore();
let restoring: Promise<StoredTrack | null> = Promise.resolve(null);
let current: ShownTrack | null = null;
/** Bumped by every load and remove, so a slow one that finishes late does not win. */
let generation = 0;
const listeners: ((t: ShownTrack | null) => void)[] = [];

/** The track on the map, or null. */
export const gpxTrack = (): ShownTrack | null => current;

/** Called with the new track, or null, whenever a track is added or removed. */
export function onGpxChange(listener: (t: ShownTrack | null) => void) {
  listeners.push(listener);
}

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

function geoJson(t: GpxTrack): FeatureCollection {
  const first = t.lines[0][0];
  const lastLine = t.lines[t.lines.length - 1];
  const last = lastLine[lastLine.length - 1];
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { role: 'line' }, geometry: { type: 'MultiLineString', coordinates: t.lines } },
      { type: 'Feature', properties: { role: 'end' }, geometry: { type: 'Point', coordinates: last } },
      { type: 'Feature', properties: { role: 'start' }, geometry: { type: 'Point', coordinates: first } },
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
export async function prepareTrack(text: string, fileName: string): Promise<ShownTrack> {
  const parsed = parseGpx(text);
  if (!parsed.lines.some((l) => l.some(([lon, lat]) => inArea(lon, lat)))) {
    throw new GpxError('This track lies outside the area the map covers.');
  }
  const { track, source } = await withElevation(parsed);
  return {
    track,
    stats: trackStats(track.lines),
    source,
    fileName,
    snowPoints: track.lines.flatMap((l) => resample(l, 25)),
  };
}

function draw(t: ShownTrack | null) {
  current = t;
  (app?.map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(t ? geoJson(t.track) : empty);
  for (const l of listeners) l(t);
}

/** Opens the point panel for the track, at its highest point (where the forecast is taken). */
export function showGpxPanel() {
  if (!app || !current) return;
  const { track, stats, source, fileName, snowPoints } = current;
  const at = stats.highest ?? track.lines[0][0];
  void app.point.show(new maplibregl.LngLat(at[0], at[1]), {
    title: track.name ?? (track.kind === 'route' ? 'GPX route' : 'GPX track'),
    html: gpxHtml(track, stats, source, fileName),
    elevation: stats.highest?.[2] ?? null,
    elevationLabel: stats.highest ? 'Highest point' : undefined,
    snowHtml: routeSnowSummary(snowPoints),
  });
}

/** Moves the camera to show the whole track, tilted and looking along it. */
function flyTo(t: GpxTrack) {
  if (!app) return;
  const [w, s, e, n] = trackBounds(t.lines);
  app.map.fitBounds(
    [
      [w, s],
      [e, n],
    ],
    { padding: 60, pitch: 55, bearing: viewBearing(t.lines), maxZoom: 14.5, duration: 2500 },
  );
}

/**
 * Puts a GPX file's text on the map in place of the current track, flies to it, opens its panel
 * and keeps it for the next visit. Throws a GpxError the user can read. When another file is
 * loaded (or the track removed) before this one is ready, this one is dropped.
 */
export async function loadGpxText(text: string, fileName: string): Promise<ShownTrack> {
  const gen = ++generation;
  const shown = await prepareTrack(text, fileName);
  // Another file was picked, or the track removed, while this one was being read.
  if (gen !== generation) return shown;
  draw(shown);
  flyTo(shown.track);
  showGpxPanel();
  void store.save({ fileName, text, savedAt: new Date().toISOString() });
  return shown;
}

/** As loadGpxText, from a picked or dropped file. */
export async function loadGpxFile(file: File): Promise<ShownTrack> {
  if (file.size > MAX_GPX_BYTES) throw new GpxError(`This file is too large (over ${MAX_GPX_BYTES / 1024 / 1024} MB).`);
  return loadGpxText(await file.text(), file.name);
}

/** Takes the track off the map and out of storage. */
export function removeGpx() {
  generation++;
  if (!current) return void store.clear();
  // The panel shows the track's numbers; close it with the track.
  if (!$('details').hidden && $('details-body').querySelector('.gpx-remove')) closePanel();
  draw(null);
  void store.clear();
}

/** Draws the track kept from the last visit, without moving the camera (the address sets the view). */
async function restore() {
  const gen = generation;
  const saved = await restoring;
  if (!saved || gen !== generation) return;
  try {
    const shown = await prepareTrack(saved.text, saved.fileName);
    if (gen === generation) draw(shown);
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
    $('details-body').addEventListener('click', (e) => {
      if ((e.target as Element).closest('.gpx-remove')) removeGpx();
    });
  },

  /** Above the via ferratas, below the place labels, bivouacs and station dots. */
  init(a) {
    const { map, basemap } = a;
    const beforeId = basemap.labels[0]?.id;
    const add = (layer: maplibregl.LayerSpecification) => map.addLayer(layer, beforeId);
    const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
    const lineOnly = ['==', ['get', 'role'], 'line'] as maplibregl.FilterSpecification;
    map.addSource(SOURCE, { type: 'geojson', data: current ? geoJson(current.track) : empty });
    const width = (z9: number, z15: number) => ['interpolate', ['linear'], ['zoom'], 9, z9, 15, z15] as maplibregl.ExpressionSpecification;
    add({ id: LAYERS[0], type: 'line', source: SOURCE, filter: lineOnly, layout: round, paint: { 'line-color': '#ffffff', 'line-width': width(4.5, 9), 'line-opacity': 0.9 } });
    add({ id: LAYERS[1], type: 'line', source: SOURCE, filter: lineOnly, layout: round, paint: { 'line-color': GPX_COLOR, 'line-width': width(2.5, 5) } });
    add({
      id: LAYERS[2],
      type: 'circle',
      source: SOURCE,
      filter: ['!=', ['get', 'role'], 'line'],
      paint: {
        'circle-radius': width(4.5, 7),
        'circle-color': ['match', ['get', 'role'], 'start', START_COLOR, END_COLOR],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
    // Thin lines are hard to hit, so a wide transparent copy takes hover and click.
    add({ id: HIT, type: 'line', source: SOURCE, filter: lineOnly, layout: round, paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 18 } });
    map.on('mouseenter', HIT, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', HIT, () => (map.getCanvas().style.cursor = ''));
    map.on('click', HIT, (e: maplibregl.MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      if (e.features?.length) showGpxPanel();
    });
    // Not awaited: reading the kept track may fetch terrain, and the other layers should not wait.
    void restore();
  },
};
