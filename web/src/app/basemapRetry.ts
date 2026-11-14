// Keeps the OSM basemap (roads, places) on the map when a request for it fails.
//
// The basemap is one PMTiles file read with range requests. If its first request fails (a network
// blip, or a deploy: GitHub Pages gives the file a new ETag every time, three times a day, and the
// CDN can serve old and new copies for a few minutes), the PMTiles reader keeps that failure and
// every tile after it fails too, so roads stayed off until the page was reloaded. Here a failure
// retries with a fresh reader a few times, and a warning is shown only when that does not help,
// saying the file is missing only when the server says so (a local build without `npm run basemap`).
import type * as maplibregl from 'maplibre-gl';
import { BASEMAP_SOURCE, basemapFileUrl, basemapUrl } from '../basemap.ts';
import { setWarning } from './warnings.ts';

/** Waits before each retry; after the last one the warning is shown. */
const RETRY_DELAYS_MS = [1000, 4000, 15000];
/** A session without basemap errors for this long gets its retries back. */
const CALM_MS = 5 * 60_000;

async function fileMissing(): Promise<boolean> {
  try {
    const res = await fetch(basemapFileUrl(), { method: 'HEAD', cache: 'no-store' });
    return res.status === 404;
  } catch {
    return false;
  }
}

export function setupBasemapRetry(map: maplibregl.Map) {
  let attempt = 0;
  let pending = false;
  let lastError = 0;

  // The source's TileJSON loaded (first load or a retry): clear a warning from an earlier failure.
  map.on('sourcedata', (e: maplibregl.MapSourceDataEvent) => {
    if (e.sourceId === BASEMAP_SOURCE && e.sourceDataType === 'metadata') setWarning('basemap', null);
  });

  /** Handles a map error if it is the basemap's; returns false for other errors. */
  return function onBasemapError(e: maplibregl.ErrorEvent & { sourceId?: string }): boolean {
    if (e.sourceId !== BASEMAP_SOURCE) return false;
    const now = Date.now();
    if (now - lastError > CALM_MS) attempt = 0;
    lastError = now;
    // One failure often comes with many failed tiles; retry once for all of them. After the last
    // retry, wait for a calm spell before trying again.
    if (pending || attempt > RETRY_DELAYS_MS.length) return true;
    console.warn('Basemap error:', e.error?.message ?? e);
    if (attempt < RETRY_DELAYS_MS.length) {
      pending = true;
      const delay = RETRY_DELAYS_MS[attempt++];
      setTimeout(() => {
        pending = false;
        const source = map.getSource(BASEMAP_SOURCE) as maplibregl.VectorTileSource | undefined;
        // A new URL is a new PMTiles reader (and a new browser cache key); MapLibre keeps the tiles
        // it already shows until the new ones arrive.
        source?.setUrl(basemapUrl(attempt));
      }, delay);
      return true;
    }
    attempt++;
    pending = true;
    void fileMissing().then((missing) => {
      pending = false;
      setWarning(
        'basemap',
        missing
          ? 'Roads and places are unavailable (basemap file missing; run "npm run basemap").'
          : 'Roads and places could not be loaded. Reload the page to try again.',
      );
    });
    return true;
  };
}
