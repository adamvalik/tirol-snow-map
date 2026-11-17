// OpenStreetMap basemap (roads, places, rivers, land cover, buildings) from a self-hosted
// Protomaps extract, merged with the terrain layers. Fonts and icons are served from
// basemap-assets/, so the browser still only talks to this site, Mapterhorn and Open-Meteo.

import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import type { LayerSpecification, SourceSpecification } from 'maplibre-gl';
import summitsData from './data/summits.json';
import { inArea } from './island.ts';

export const BASEMAP_SOURCE = 'protomaps';
export const SUMMITS_SOURCE = 'summits';

/** Absolute base URL of the app, for style URLs that MapLibre requires to be absolute. */
export const siteBase = (): string => new URL(import.meta.env.BASE_URL, window.location.href).href;

export const glyphsUrl = () => `${siteBase()}basemap-assets/fonts/{fontstack}/{range}.pbf`;
export const spriteUrl = () => `${siteBase()}basemap-assets/sprites/light`;

export function basemapSources(): Record<string, SourceSpecification> {
  return {
    [BASEMAP_SOURCE]: {
      type: 'vector',
      url: `pmtiles://${siteBase()}basemap/south-tyrol.pmtiles`,
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

/** Below this zoom, multilingual place names ("Urtijëi - St. Ulrich - Ortisei") show one name only. */
export const SHORT_NAME_MAX_ZOOM = 12;

const NAME = ['get', 'name'];
const isMultilingual = ['any', ['in', ' - ', NAME], ['in', ' / ', NAME]];

/**
 * One name for a place whose OSM name lists several languages: Italian, then German, then the
 * first part of the combined name. Single-language names are left to the original expression.
 */
export function shortPlaceName(original: unknown): unknown {
  const firstPart = ['case', ['in', ' - ', NAME], ['slice', NAME, 0, ['index-of', ' - ', NAME]], NAME];
  const short = ['format', ['coalesce', ['get', 'name:it'], ['get', 'name:de'], firstPart], {}];
  // Outputs that do not show the name (region abbreviations at the lowest zooms) stay as they are.
  const shorten = (out: unknown) =>
    JSON.stringify(out).includes('"name"') ? ['case', ['all', ['has', 'name'], isMultilingual], short, out] : out;

  // MapLibre allows only one zoom step per expression, so merge into one the original already has.
  const isZoomStep = (e: unknown): e is unknown[] =>
    Array.isArray(e) && e[0] === 'step' && Array.isArray(e[1]) && e[1][0] === 'zoom';
  if (!isZoomStep(original)) return ['step', ['zoom'], shorten(original), SHORT_NAME_MAX_ZOOM, original];

  const outputs = [original[2], ...original.slice(4).filter((_, i) => i % 2 === 0)];
  const stops = original.slice(3).filter((_, i) => i % 2 === 0) as number[];
  const merged: unknown[] = ['step', ['zoom'], shorten(outputs[0])];
  let split = false;
  stops.forEach((stop, i) => {
    if (!split && stop > SHORT_NAME_MAX_ZOOM) merged.push(SHORT_NAME_MAX_ZOOM, outputs[i]);
    if (stop >= SHORT_NAME_MAX_ZOOM) split = true;
    merged.push(stop, split ? outputs[i + 1] : shorten(outputs[i + 1]));
  });
  if (!split) merged.push(SHORT_NAME_MAX_ZOOM, outputs.at(-1));
  return merged;
}

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
    } else if (l.type === 'symbol') {
      if (l.id.startsWith('places_') && l.id !== 'places_country' && l.layout?.['text-field']) {
        l.layout = { ...l.layout, 'text-field': shortPlaceName(l.layout['text-field']) as never };
      }
      labels.push(l);
    }
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
