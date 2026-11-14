// OpenStreetMap basemap (roads, places, rivers, land cover, buildings) from a self-hosted
// Protomaps extract, merged with the terrain layers. Fonts and icons are served from
// basemap-assets/, so the browser still only talks to this site, Mapterhorn and Open-Meteo.

import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import type { LayerSpecification, SourceSpecification } from 'maplibre-gl';
import summitsData from './data/summits.json';
import { inArea } from './island.ts';
import { BUILD_ID } from './version.ts';

export const BASEMAP_SOURCE = 'protomaps';
export const SUMMITS_SOURCE = 'summits';

/** Absolute base URL of the app, for style URLs that MapLibre requires to be absolute. */
export const siteBase = (): string => new URL(import.meta.env.BASE_URL, window.location.href).href;

export const glyphsUrl = () => `${siteBase()}basemap-assets/fonts/{fontstack}/{range}.pbf`;
export const spriteUrl = () => `${siteBase()}basemap-assets/sprites/light`;

/** The basemap file, as served next to the app. */
export const basemapFileUrl = (): string => `${siteBase()}basemap/south-tyrol.pmtiles`;

/**
 * The PMTiles URL of the basemap source. The build id keeps the browser from mixing byte ranges
 * cached from an earlier deploy with the current one; `attempt` (app/basemapRetry.ts) gives a retry
 * a fresh PMTiles reader, since a reader whose first request failed keeps failing.
 */
export const basemapUrl = (attempt = 0): string => `pmtiles://${basemapFileUrl()}?v=${BUILD_ID}${attempt ? `-${attempt}` : ''}`;

export function basemapSources(): Record<string, SourceSpecification> {
  return {
    [BASEMAP_SOURCE]: {
      type: 'vector',
      url: basemapUrl(),
      attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>',
    },
    [SUMMITS_SOURCE]: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: summitsData.summits
          .filter((s) => inArea(s.lon, s.lat))
          .map((s) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: { name: s.name, ele: s.ele, label: `${s.name}\n${s.ele.toLocaleString('en-GB')} m` },
          })),
      },
    },
  };
}

/** Layers that are not wanted on a 3D terrain map (opaque land would hide relief and hillshade). */
const DROP = new Set(['background', 'earth', 'water_label_ocean', 'earth_label_islands']);

export interface BasemapLayers {
  /** Land cover, land use and water fills; drawn translucently between the relief tint and the hillshade. */
  fills: LayerSpecification[];
  /** Roads, railways, boundaries, waterways. */
  lines: LayerSpecification[];
  buildings: LayerSpecification;
  labels: LayerSpecification[];
}

export function basemapLayers(): BasemapLayers {
  const all = protomapsLayers(BASEMAP_SOURCE, namedFlavor('light'), { lang: 'en' }).filter((l) => !DROP.has(l.id));
  const fills: LayerSpecification[] = [];
  const lines: LayerSpecification[] = [];
  const labels: LayerSpecification[] = [];
  for (const l of all) {
    if (l.id === 'buildings') continue;
    if (l.type === 'fill') {
      // Water stays solid; land cover only tints so the terrain shading shows through.
      if (l.id !== 'water') l.paint = { ...l.paint, 'fill-opacity': 0.45 };
      fills.push(l);
    } else if (l.type === 'symbol') labels.push(l);
    else lines.push(l);
  }

  // Extruded buildings make towns read as a miniature when zoomed in.
  const buildings: LayerSpecification = {
    id: 'buildings-3d',
    type: 'fill-extrusion',
    source: BASEMAP_SOURCE,
    'source-layer': 'buildings',
    minzoom: 13.5,
    paint: {
      'fill-extrusion-color': '#e3dcd2',
      'fill-extrusion-height': ['coalesce', ['get', 'height'], 9],
      'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, 0.9],
    },
  };

  // Curated major summits, placed before the generic OSM labels so they win collisions.
  labels.push({
    id: 'summits',
    type: 'symbol',
    source: SUMMITS_SOURCE,
    layout: {
      'icon-image': 'peak',
      'icon-size': 0.8,
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Medium'],
      'text-size': 11,
      'text-offset': [0, 0.6],
      'text-anchor': 'top',
      'symbol-sort-key': ['-', ['get', 'ele']],
    },
    paint: {
      'text-color': '#4a3c2c',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
    },
  });
  return { fills, lines, buildings, labels };
}
