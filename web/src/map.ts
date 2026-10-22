import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { basemapLayers, basemapSources, glyphsUrl, spriteUrl } from './basemap.ts';
import { DEFAULT_SKY, hillshadePaint } from './sun.ts';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 locates its worker relative to its own module URL, which a bundler cannot follow;
// let Vite bundle the worker and hand MapLibre the resulting URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);
// The OSM basemap is a single PMTiles file read with HTTP range requests.
maplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile);

export const MAPTERHORN_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
/** Mapterhorn serves tiles up to z15; z16 returns 404. */
const DEM_MAX_ZOOM = 15;

export const DEFAULT_EXAGGERATION = 1.5;
/** Opening view: Bolzano, tilted, looking north-north-east up the Eisack valley towards the Dolomites. */
export const DEFAULT_VIEW = { center: [11.354, 46.47] as [number, number], zoom: 10.4, pitch: 60, bearing: 20 };
/** South Tyrol with a margin; keeps tile requests to the region. */
export const MAX_BOUNDS: [[number, number], [number, number]] = [
  [9.4, 45.6],
  [13.4, 47.75],
];

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
  const basemap = basemapLayers();
  return {
    version: 8,
    glyphs: glyphsUrl(),
    sprite: spriteUrl(),
    // Separate sources for the 3D mesh and the drawn layers, as MapLibre recommends; the tiles are shared via HTTP cache.
    sources: {
      terrain: dem(lowPower ? 13 : 14),
      dem: dem(DEM_MAX_ZOOM),
      ...basemapSources(),
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#dcd8cf' } },
      {
        id: 'relief',
        type: 'color-relief',
        source: 'dem',
        paint: {
          'color-relief-opacity': 0.75,
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
      ...basemap.fills,
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        // The light is swapped for the sun's when the time-of-day light is on (sun.ts).
        paint: hillshadePaint(null, false),
      },
      ...basemap.lines,
      basemap.buildings,
      ...basemap.labels,
    ],
    terrain: { source: 'terrain', exaggeration: DEFAULT_EXAGGERATION },
    sky: DEFAULT_SKY,
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
    maxBounds: MAX_BOUNDS,
    pixelRatio: Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2),
    attributionControl: false,
    maxTileCacheSize: lowPower ? 100 : null,
    cancelPendingTileRequestsWhileZooming: true,
  });
}
