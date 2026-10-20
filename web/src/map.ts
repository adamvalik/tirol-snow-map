import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 locates its worker relative to its own module URL, which a bundler cannot follow;
// let Vite bundle the worker and hand MapLibre the resulting URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);

export const MAPTERHORN_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
/** Mapterhorn serves tiles up to z15; z16 returns 404. */
const DEM_MAX_ZOOM = 15;

export const DEFAULT_EXAGGERATION = 1.5;
/** Opening view: Bolzano, tilted, looking north-north-east up the Eisack valley towards the Dolomites. */
export const DEFAULT_VIEW = { center: [11.354, 46.47] as [number, number], zoom: 10.4, pitch: 60, bearing: 20 };

/** Phones and tablets: coarser terrain mesh and capped pixel ratio keep tilting smooth. */
export const isLowPowerDevice = (): boolean =>
  matchMedia('(max-width: 700px), (pointer: coarse)').matches;

function createStyle(lowPower: boolean): StyleSpecification {
  const dem = (maxzoom: number) =>
    ({
      type: 'raster-dem',
      tiles: [MAPTERHORN_TILES] as string[],
      tileSize: 512,
      encoding: 'terrarium',
      maxzoom,
      attribution: '<a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a>',
    }) as const;
  return {
    version: 8,
    // Separate sources for the 3D mesh and the drawn layers, as MapLibre recommends; the tiles are shared via HTTP cache.
    sources: {
      terrain: dem(lowPower ? 13 : 14),
      dem: dem(DEM_MAX_ZOOM),
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#dcd8cf' } },
      {
        id: 'relief',
        type: 'color-relief',
        source: 'dem',
        paint: {
          'color-relief-opacity': 0.9,
          'color-relief-color': [
            'interpolate',
            ['linear'],
            ['elevation'],
            0, '#b9c9a3',
            400, '#cfd8b0',
            1000, '#e1ddb4',
            1600, '#dacaa3',
            2100, '#cbb595',
            2600, '#bfb2a6',
            3100, '#d9d6d2',
            3600, '#f4f4f4',
          ],
        },
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-method': 'standard',
          'hillshade-exaggeration': 0.3,
          'hillshade-shadow-color': '#5b4f40',
          'hillshade-highlight-color': '#ffffff',
        },
      },
    ],
    terrain: { source: 'terrain', exaggeration: DEFAULT_EXAGGERATION },
    sky: {
      'sky-color': '#9ec9f0',
      'horizon-color': '#e8f1f8',
      'fog-color': '#e8edf0',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.4,
    },
  };
}

export function createMap(container: string, view = DEFAULT_VIEW): maplibregl.Map {
  const lowPower = isLowPowerDevice();
  return new maplibregl.Map({
    container,
    style: createStyle(lowPower),
    ...view,
    maxPitch: 75,
    minZoom: 7.5,
    maxZoom: 16,
    // South Tyrol with a margin; keeps tile requests to the region.
    maxBounds: [
      [9.4, 45.6],
      [13.4, 47.75],
    ],
    pixelRatio: Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2),
    attributionControl: false,
    maxTileCacheSize: lowPower ? 100 : null,
    cancelPendingTileRequestsWhileZooming: true,
  });
}
