// Starts the app: the map, the layers (layers/registry.ts) and the parts around them in app/.
import * as maplibregl from 'maplibre-gl';
import './style.css';
import { hydrateIcons } from './app/icons.ts';
import { track, trackVisit } from './app/analytics.ts';
import { setupLayout, syncQuick } from './app/layout.ts';
import { setupLocate } from './app/locate.ts';
import { setupNewDeployReload } from './app/newDeploy.ts';
import { PointPanel } from './app/point.ts';
import { setupShare } from './app/share.ts';
import { setupSources } from './app/sources.ts';
import { applyLinkSwitches } from './app/switches.ts';
import { dayView, loadHistory, setupTimeline } from './app/timeline.ts';
import { setupTrack } from './app/track.ts';
import { setupBasemapRetry } from './app/basemapRetry.ts';
import { showStartError, supportsWebgl2, watchContext } from './app/startError.ts';
import { setupWarnings } from './app/warnings.ts';
import { setupWhatsNew } from './app/whatsNew.ts';
import { basemapLayers, SUMMIT_ICON, summitIcon } from './basemap.ts';
import { flyToGpx, gpxSnow, gpxTrack, loadGpxFile, loadGpxText, removeGpx } from './layers/gpx.ts';
import { initLayers, layersView, onMapClick, setupLayers } from './layers/registry.ts';
import { pointSnow } from './layers/snow.ts';
import { edgeStyle, terrainExaggeration } from './layers/terrain.ts';
import type { App } from './layers/types.ts';
import { createMap, DEFAULT_VIEW } from './map.ts';
import { parseHash } from './viewState.ts';

// Tells the inline script in index.html that the app's code runs (it shows the start screen otherwise).
Object.assign(window, { __snowmapRan: true });

// A tab opened before a deploy reloads once when it needs a file the deploy replaced.
setupNewDeployReload();

// The icons of index.html first, so everything below finds its buttons complete.
hydrateIcons();

// The address can carry a shared view (see viewState.ts).
const initial = parseHash(window.location.hash);
applyLinkSwitches(initial);

// MapLibre needs WebGL 2; without it the map cannot start, so say so instead of an empty page.
if (!supportsWebgl2()) showStartError('webgl');
else {
  try {
    start();
  } catch (e) {
    showStartError('start');
    throw e;
  }
}

/** Creates the map and everything around it. */
function start() {
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
  // Opened from a link with a view (a shared link, or a reload). Only that it has one, never the view.
  if (window.location.hash.length > 1) track('arrive/link');
  loadHistory();
  setupWhatsNew();

  watchContext(map);

  map.on('load', async () => {
    try {
      await initLayers(app);
      // Some switches were changed by the layers (nothing to show), without a change event.
      syncQuick();
      await setupTimeline(app);
      map.on('click', (e: maplibregl.MapMouseEvent) => onMapClick(app, e));
    } catch (e) {
      // Without the layers, the timeline or the clicks, the map only looks like it works.
      showStartError('start');
      throw e;
    }
  });

  // The summit triangle is drawn here, not in the sprite. The Protomaps style also names a few POI
  // icons its sprite does not contain; draw those labels without an icon. A resolver, not the
  // `styleimagemissing` event: MapLibre asks it before it counts an image as missing, so a normal
  // load logs no warning.
  map.setMissingStyleImageResolver((id) => {
    if (map.hasImage(id)) return;
    if (id === SUMMIT_ICON) map.addImage(id, summitIcon(2), { pixelRatio: 2 });
    else map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
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
}
