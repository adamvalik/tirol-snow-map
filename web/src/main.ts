// Starts the app: the map, the layers (layers/registry.ts) and the parts around them in app/.
import * as maplibregl from 'maplibre-gl';
import './style.css';
import { hydrateIcons } from './app/icons.ts';
import { trackVisit } from './app/analytics.ts';
import { setupLayout, syncQuick } from './app/layout.ts';
import { setupLocate } from './app/locate.ts';
import { PointPanel } from './app/point.ts';
import { setupShare } from './app/share.ts';
import { setupSources } from './app/sources.ts';
import { applyLinkSwitches } from './app/switches.ts';
import { dayView, loadHistory, setupTimeline } from './app/timeline.ts';
import { setupTrack } from './app/track.ts';
import { setupBasemapRetry } from './app/basemapRetry.ts';
import { setupWarnings } from './app/warnings.ts';
import { basemapLayers } from './basemap.ts';
import { flyToGpx, gpxSnow, gpxTrack, loadGpxFile, loadGpxText, removeGpx } from './layers/gpx.ts';
import { initLayers, layersView, onMapClick, setupLayers } from './layers/registry.ts';
import { pointSnow } from './layers/snow.ts';
import { edgeStyle, terrainExaggeration } from './layers/terrain.ts';
import type { App } from './layers/types.ts';
import { createMap, DEFAULT_VIEW } from './map.ts';
import { parseHash } from './viewState.ts';

// The icons of index.html first, so everything below finds its buttons complete.
hydrateIcons();

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
// Zoom and north are buttons of the page (app/layout.ts); the scale sits above the timeline.
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

setupLayout(map);
setupLocate(map);
setupWarnings();
const app: App = {
  map,
  basemap: basemapLayers(),
  initial,
  syncHash: setupShare(map, () => [...layersView(), dayView()]),
  point: new PointPanel(map, terrainExaggeration, pointSnow),
};
setupLayers(app);
setupSources();
setupTrack();
trackVisit();
loadHistory();

map.on('load', async () => {
  await initLayers(app);
  // Some switches were changed by the layers (nothing to show), without a change event.
  syncQuick();
  await setupTimeline(app);
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

const onBasemapError = setupBasemapRetry(map);
map.on('error', (e: maplibregl.ErrorEvent & { sourceId?: string }) => {
  // Retried, and a warning if that does not help (app/basemapRetry.ts).
  if (onBasemapError(e)) return;
  // Missing ocean/edge tiles are expected; anything else is worth surfacing in the console.
  const status = (e.error as { status?: number } | undefined)?.status;
  if (status === 404) return;
  console.warn('Map error:', e.error?.message ?? e);
});
