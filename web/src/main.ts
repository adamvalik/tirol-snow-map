// Starts the app: the map, the layers (layers/registry.ts) and the parts around them in app/.
import * as maplibregl from 'maplibre-gl';
import './style.css';
import { trackVisit } from './app/analytics.ts';
import { dayView, loadHistory, setupDaySlider } from './app/daySlider.ts';
import { setupLayout } from './app/layout.ts';
import { PointPanel } from './app/point.ts';
import { setupShare } from './app/share.ts';
import { setupSources } from './app/sources.ts';
import { applyLinkSwitches } from './app/switches.ts';
import { setWarning } from './app/warnings.ts';
import { BASEMAP_SOURCE, basemapLayers } from './basemap.ts';
import { flyToGpx, gpxSnow, gpxTrack, loadGpxFile, loadGpxText, removeGpx } from './layers/gpx.ts';
import { initLayers, layersView, onMapClick, setupLayers } from './layers/registry.ts';
import { pointSnow } from './layers/snow.ts';
import { edgeStyle, terrainExaggeration } from './layers/terrain.ts';
import type { App } from './layers/types.ts';
import { createMap, DEFAULT_VIEW } from './map.ts';
import { parseHash } from './viewState.ts';

// The address can carry a shared view (see viewState.ts).
const initial = parseHash(window.location.hash);
applyLinkSwitches(initial);

const map = createMap(
  'map',
  {
    center: initial.center ?? DEFAULT_VIEW.center,
    zoom: initial.zoom ?? DEFAULT_VIEW.zoom,
    pitch: initial.pitch ?? DEFAULT_VIEW.pitch,
    bearing: initial.bearing ?? DEFAULT_VIEW.bearing,
  },
  edgeStyle(),
);
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

setupLayout();
const app: App = {
  map,
  basemap: basemapLayers(),
  initial,
  syncHash: setupShare(map, () => [...layersView(), dayView()]),
  point: new PointPanel(map, terrainExaggeration, pointSnow),
};
setupLayers(app);
setupSources();
trackVisit();
loadHistory();

map.on('load', async () => {
  await initLayers(app);
  await setupDaySlider(app);
  map.on('click', (e: maplibregl.MapMouseEvent) => onMapClick(app, e));
});

// The Protomaps style names a few POI icons its sprite does not contain; draw those labels without an icon.
map.on('styleimagemissing', (e: { id: string }) => {
  if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
});

// Hooks for the smoke test (scripts/smoke.mjs) and for debugging from the console.
map.once('idle', () => {
  document.body.dataset.mapReadyMs = String(Math.round(performance.now()));
});
Object.assign(window, { __snowmap: { map, gpx: { load: loadGpxText, loadFile: loadGpxFile, remove: removeGpx, fly: flyToGpx, track: gpxTrack, snow: gpxSnow } } });

map.on('error', (e: maplibregl.ErrorEvent & { sourceId?: string }) => {
  if (e.sourceId === BASEMAP_SOURCE) {
    // The extract is built locally with `npm run basemap` and is not in git; say so instead of failing silently.
    setWarning('basemap', 'Roads and places are unavailable (basemap file missing; run "npm run basemap").');
    return;
  }
  // Missing ocean/edge tiles are expected; anything else is worth surfacing in the console.
  const status = (e.error as { status?: number } | undefined)?.status;
  if (status === 404) return;
  console.warn('Map error:', e.error?.message ?? e);
});
