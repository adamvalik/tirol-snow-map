// OpenStreetMap basemap (roads, places, rivers, land cover, buildings) from a self-hosted
// Protomaps extract, merged with the terrain layers. Fonts and icons are served from
// basemap-assets/, so the browser still only talks to this site, Mapterhorn and Open-Meteo.

import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import type { ExpressionSpecification, LayerSpecification, SourceSpecification } from 'maplibre-gl';
import summitsData from './data/summits.json';
import valleysData from './data/valleys.json';
import { inArea } from './island.ts';

export const BASEMAP_SOURCE = 'protomaps';
export const SUMMITS_SOURCE = 'summits';
export const VALLEYS_SOURCE = 'valleys';

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
            properties: { name: s.name, ele: s.ele, eleLabel: `${s.ele.toLocaleString('en-GB')} m` },
          })),
      },
    },
    [VALLEYS_SOURCE]: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          ...valleysData.valleys.map((v) => ({ ...v, kind: 'valley' })),
          ...valleysData.ranges.map((r) => ({ ...r, kind: 'range' })),
        ].map((v) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
          properties: { kind: v.kind, name: v.name, nameIt: v.nameIt },
        })),
      },
    },
  };
}

/**
 * Layers that are not wanted on a 3D terrain map: opaque land would hide relief and hillshade, and
 * the park fill tints whole national parks one flat green. Land cover is drawn by LAND_COVER instead.
 */
const DROP = new Set(['background', 'earth', 'water_label_ocean', 'earth_label_islands', 'landuse_park']);

/** Colours of the land cover, close to a Swiss topographic map: darker forest, light meadows, grey rock. */
const LAND_COLORS: [kinds: string[], color: string][] = [
  [['forest', 'wood'], '#76a366'],
  [['scrub'], '#a3bd80'],
  [['grassland', 'grass', 'meadow', 'heath'], '#d2dc9c'],
  [['farmland', 'orchard', 'vineyard', 'allotments'], '#dfe2a6'],
  [['park', 'golf_course', 'cemetery', 'recreation_ground'], '#b6d29a'],
  [['bare_rock', 'scree', 'sand'], '#cbc2b4'],
  [['glacier'], '#f3f8fc'],
  [['wetland'], '#b4d2c6'],
  [['residential'], '#e6d7c6'],
];

const LAND_COVER: LayerSpecification = {
  id: 'land-cover',
  type: 'fill',
  source: BASEMAP_SOURCE,
  'source-layer': 'landuse',
  filter: ['in', ['get', 'kind'], ['literal', LAND_COLORS.flatMap(([kinds]) => kinds)]],
  paint: {
    'fill-color': ['match', ['get', 'kind'], ...LAND_COLORS.flatMap(([kinds, color]) => [kinds, color]), '#e2dfda'] as never,
    // Translucent, so the elevation tint and the hillshade above still model the relief; glaciers a little stronger.
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'kind'], 'glacier', 0.6, 0.35], 11, ['match', ['get', 'kind'], 'glacier', 0.8, 0.55]],
    'fill-antialias': false,
  },
};

/** Rock faces from OSM (natural=cliff): fine dark lines that add detail to the mountains up close. */
const CLIFFS: LayerSpecification = {
  id: 'cliffs',
  type: 'line',
  source: BASEMAP_SOURCE,
  'source-layer': 'earth',
  filter: ['==', ['get', 'kind'], 'cliff'],
  minzoom: 12,
  paint: {
    'line-color': '#5e4f42',
    'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.45],
    'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 15, 1.4],
  },
};

const WATER = '#8cc3e3';
const WATER_INK = '#2f6ea6';
const HALO = 'rgba(255, 255, 255, 0.9)';

/** Small dark summit triangle with a white rim, drawn at runtime (the basemap's sprite has only a park-style peak icon). */
export const SUMMIT_ICON = 'summit-triangle';

export function summitIcon(pixelRatio = 2): { width: number; height: number; data: Uint8Array } {
  const w = Math.round(12 * pixelRatio);
  const h = Math.round(11 * pixelRatio);
  const data = new Uint8Array(w * h * 4);
  // Point-in-triangle by supersampling; the outer triangle is the rim, the inner one the fill.
  const inside = (x: number, y: number, inset: number) => {
    const top = inset * 2;
    const bottom = h - inset;
    if (y < top || y > bottom) return false;
    const half = ((y - top) / (bottom - top)) * (w / 2 - inset * 1.7);
    return Math.abs(x - w / 2) <= half;
  };
  const rim = 1.4 * pixelRatio;
  const N = 4;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let outer = 0;
      let inner = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = i + (sx + 0.5) / N;
          const y = j + (sy + 0.5) / N;
          if (inside(x, y, 0)) outer++;
          if (inside(x, y, rim)) inner++;
        }
      }
      const a = outer / (N * N);
      const f = inner / (N * N);
      // Mix fill (#5a4634) over rim (white), premultiplied by nothing: MapLibre takes straight alpha.
      const k = (j * w + i) * 4;
      const t = a > 0 ? f / a : 0;
      data[k] = Math.round(255 + (0x5a - 255) * t);
      data[k + 1] = Math.round(255 + (0x46 - 255) * t);
      data[k + 2] = Math.round(255 + (0x34 - 255) * t);
      data[k + 3] = Math.round(a * 255);
    }
  }
  return { width: w, height: h, data };
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
      if (l.id === 'water') l.paint = { ...l.paint, 'fill-color': WATER };
      else l.paint = { ...l.paint, 'fill-opacity': 0.45 };
      fills.push(l);
      // The alpine land cover goes right after the coarse low-zoom one, under water and towns.
      if (l.id === 'landcover') fills.push(LAND_COVER);
    } else if (l.type === 'symbol') labels.push(restyleLabel(l));
    else lines.push(restyleLine(l));
  }
  if (!fills.includes(LAND_COVER)) fills.unshift(LAND_COVER);
  lines.unshift(CLIFFS);

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

  // Labels later in the list are placed first and win collisions: mountain groups, then valleys,
  // then the curated major summits.
  labels.push(
    {
      // Mountain groups for the overview: wide-spaced capitals that fade out as the summits appear.
      id: 'mountain-ranges',
      type: 'symbol',
      source: VALLEYS_SOURCE,
      filter: ['==', ['get', 'kind'], 'range'],
      maxzoom: 11,
      layout: {
        'text-field': ['upcase', ['get', 'name']],
        'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7.5, 10, 10, 12],
        'text-letter-spacing': 0.25,
        'text-max-width': 12,
        'text-padding': 8,
      },
      paint: {
        'text-color': '#7d6e60',
        'text-halo-color': 'rgba(255, 255, 255, 0.75)',
        'text-halo-width': 1.2,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 10, 1, 11, 0],
      },
    },
    {
      // Valley names, the main way to find one's way at the opening view: italic, German and Italian.
      id: 'valleys',
      type: 'symbol',
      source: VALLEYS_SOURCE,
      filter: ['==', ['get', 'kind'], 'valley'],
      minzoom: 8,
      maxzoom: 13,
      layout: {
        'text-field': [
          'case',
          ['==', ['get', 'nameIt'], ''],
          ['get', 'name'],
          ['format', ['get', 'name'], {}, '\n', {}, ['get', 'nameIt'], { 'font-scale': 0.82 }],
        ],
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 10, 14, 12, 15],
        'text-letter-spacing': 0.06,
        'text-padding': 4,
      },
      paint: {
        'text-color': '#3f5262',
        'text-halo-color': HALO,
        'text-halo-width': 1.6,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 8.5, 1, 12, 1, 13, 0],
      },
    },
    {
      id: 'summits',
      type: 'symbol',
      source: SUMMITS_SOURCE,
      layout: {
        'icon-image': SUMMIT_ICON,
        'icon-size': 0.9,
        'text-field': ['format', ['get', 'name'], {}, '\n', {}, ['get', 'eleLabel'], { 'font-scale': 0.85, 'text-font': ['literal', ['Noto Sans Regular']], 'text-color': '#7a6550' }],
        'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 13, 12.5],
        'text-offset': [0, 0.55],
        'text-anchor': 'top',
        'text-max-width': 9,
        'symbol-sort-key': ['-', ['get', 'ele']],
      },
      paint: {
        'text-color': '#3d2f22',
        'text-halo-color': HALO,
        'text-halo-width': 1.5,
      },
    },
  );
  return { fills, lines, buildings, labels };
}

/** Place names: a clear size order from Bolzano down to hamlets, dark text on a white halo. */
const PLACE_SIZE = (small: number, step: number): ExpressionSpecification => [
  'step',
  ['get', 'population_rank'],
  small,
  5, small + step,
  6, small + 2 * step,
  7, small + 3 * step,
  8, small + 5 * step,
];

function restyleLabel(l: LayerSpecification): LayerSpecification {
  if (l.type !== 'symbol') return l;
  switch (l.id) {
    case 'places_locality':
      return {
        ...l,
        layout: {
          ...l.layout,
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, PLACE_SIZE(10, 1), 10, PLACE_SIZE(11.5, 1.2), 13, PLACE_SIZE(13, 1.2)],
          'text-font': ['step', ['get', 'population_rank'], ['literal', ['Noto Sans Regular']], 6, ['literal', ['Noto Sans Medium']]],
        },
        paint: { ...l.paint, 'text-color': ['step', ['get', 'population_rank'], '#3b4148', 6, '#1f252b'], 'text-halo-color': HALO, 'text-halo-width': 1.6 },
      };
    case 'water_waterway_label':
      // Rivers named from zoom 11, streams from 13, in blue on white instead of blue on cyan.
      return {
        ...l,
        minzoom: 11,
        filter: ['any', ['==', ['get', 'kind'], 'river'], ['all', ['==', ['get', 'kind'], 'stream'], ['>=', ['zoom'], 13]]],
        paint: { ...l.paint, 'text-color': WATER_INK, 'text-halo-color': HALO, 'text-halo-width': 1.4 },
      };
    case 'water_label_lakes':
      return { ...l, paint: { ...l.paint, 'text-color': WATER_INK, 'text-halo-color': HALO, 'text-halo-width': 1.4 } };
    default:
      return l;
  }
}

/** Rivers a touch wider and in the map's water blue, so the main valleys read from afar. */
function restyleLine(l: LayerSpecification): LayerSpecification {
  if (l.type !== 'line') return l;
  if (l.id === 'water_river') {
    return { ...l, minzoom: 8, paint: { ...l.paint, 'line-color': WATER, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 8, 0.6, 11, 1.8, 14, 4, 18, 12] } };
  }
  if (l.id === 'water_stream') return { ...l, minzoom: 12, paint: { ...l.paint, 'line-color': WATER, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 15, 1.2] } };
  return l;
}
