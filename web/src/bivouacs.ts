// Bivouacs (bivacchi, Biwaks): unstaffed emergency huts, from a static OpenStreetMap list
// (web/src/data/bivouacs.json, refreshed with `npm run bivouacs`). Drawn as little cabins:
// the classic red/orange metal half-barrel, or a brown wooden hut where OSM says it is wood.
// Zoomed in, the flat icons give way to small 3D cabins standing on the terrain (cabins.ts).

import * as maplibregl from 'maplibre-gl';
import type { MapLayerMouseEvent } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import { cabinGeoJson } from './cabins.ts';
import bivouacsData from './data/bivouacs.json';
import { escapeHtml } from './format.ts';

export interface Bivouac {
  name: string;
  lat: number;
  lon: number;
  ele: number | null;
  capacity: number | null;
  kind: 'metal' | 'wood';
  osm: string;
}

export const BIVOUACS = bivouacsData.bivouacs as Bivouac[];
const LAYER = 'bivouacs';
const CABINS = 'bivouac-cabins';
/** Both layers answer hover and click. */
export const BIVOUAC_LAYER_IDS = [LAYER, CABINS];
/** Zoom over which the icons hand over to the 3D cabins. */
const CABIN_ZOOM = [13, 14.5] as const;

// 32 × 28 icons, drawn at twice that size for sharp edges; the white outline keeps them visible on snow.
const METAL_SHAPE = 'M3 25V15a13 12 0 0 1 26 0v10z';
const WOOD_SHAPE = 'M2 15 16 4l14 11h-3v10H5V15z';
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 28" width="64" height="56">${body}</svg>`;

export const BIVOUAC_ICONS: Record<Bivouac['kind'], string> = {
  metal: svg(
    `<path d="${METAL_SHAPE}" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>` +
      `<path d="${METAL_SHAPE}" fill="#e04a26" stroke="#7a1f12" stroke-width="1.2" stroke-linejoin="round"/>` +
      '<path d="M7 13.5a10 9 0 0 1 18 0" fill="none" stroke="#f6a37f" stroke-width="1.6" stroke-linecap="round"/>' +
      '<rect x="13" y="16.5" width="6" height="8.5" fill="#fbefe4" stroke="#7a1f12" stroke-width=".9"/>',
  ),
  wood: svg(
    `<path d="${WOOD_SHAPE}" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>` +
      '<path d="M5 14h22v11H5z" fill="#a8703c" stroke="#4e2c12" stroke-width="1.2"/>' +
      '<path d="M5 17.5h22M5 21h22" stroke="#7b4a22" stroke-width=".9"/>' +
      '<path d="M2 15 16 4l14 11z" fill="#6b3d1d" stroke="#4e2c12" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<rect x="13" y="17" width="6" height="8" fill="#4a2a12"/>',
  ),
};

export const bivouacIconUrl = (kind: Bivouac['kind']) => `data:image/svg+xml,${encodeURIComponent(BIVOUAC_ICONS[kind])}`;

function loadIcon(kind: Bivouac['kind']): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(64, 56);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`bivouac icon ${kind}`));
    img.src = bivouacIconUrl(kind);
  });
}

function toGeoJson(list: Bivouac[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: list.map((b, i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
      properties: { index: i, name: b.name, icon: `bivouac-${b.kind}`, ele: b.ele ?? 0 },
    })),
  };
}

const kindText = (b: Bivouac) => (b.kind === 'wood' ? 'Wooden bivouac' : 'Bivouac');

export function bivouacTooltipHtml(b: Bivouac): string {
  const facts = [b.ele === null ? null : `${b.ele.toLocaleString('en-GB')} m`, b.capacity === null ? null : `${b.capacity} places`];
  return `<strong>${escapeHtml(b.name)}</strong>${kindText(b)}${facts.filter(Boolean).map((f) => ` · ${f}`).join('')}`;
}

/** Intro for the point panel; the elevation and forecast follow it. */
export function bivouacHtml(b: Bivouac): string {
  return `
    <dl class="kv">
      <dt>Type</dt><dd><img class="bivouac-icon" src="${bivouacIconUrl(b.kind)}" alt=""> ${kindText(b)}, unstaffed</dd>
      <dt>Places</dt><dd>${b.capacity === null ? 'not recorded' : b.capacity}</dd>
    </dl>
    <p class="muted">From <a href="https://www.openstreetmap.org/${escapeHtml(b.osm)}" target="_blank" rel="noopener">OpenStreetMap</a>
    (ODbL). Whether it is open, equipped or still standing is not checked here.</p>`;
}

export async function addBivouacLayer(
  map: maplibregl.Map,
  onSelect: (b: Bivouac) => void,
  visible = true,
  beforeId?: string,
): Promise<{ setVisible: (v: boolean) => void }> {
  const [metal, wood] = await Promise.all([loadIcon('metal'), loadIcon('wood')]);
  map.addImage('bivouac-metal', metal, { pixelRatio: 2 });
  map.addImage('bivouac-wood', wood, { pixelRatio: 2 });
  map.addSource(LAYER, { type: 'geojson', data: toGeoJson(BIVOUACS) });
  map.addSource(CABINS, { type: 'geojson', data: cabinGeoJson(BIVOUACS) });
  map.addLayer(
    {
      id: CABINS,
      type: 'fill-extrusion',
      source: CABINS,
      minzoom: CABIN_ZOOM[0],
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], CABIN_ZOOM[0], 0, CABIN_ZOOM[0] + 0.7, 1],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: LAYER,
      type: 'symbol',
      source: LAYER,
      layout: {
        visibility: visible ? 'visible' : 'none',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 0.85, 14, 1],
        // Fully faded icons still take space, so they stop drawing once the cabins are in.
        'icon-image': ['step', ['zoom'], ['get', 'icon'], CABIN_ZOOM[1], ''],
        'icon-anchor': 'bottom',
        // Highest first, so the glacier bivouacs win when they crowd.
        'symbol-sort-key': ['-', ['get', 'ele']],
        'text-field': ['step', ['zoom'], '', 12, ['get', 'name']],
        'text-font': ['Noto Sans Medium'],
        'text-size': 11,
        'text-anchor': 'top',
        // Zoomed in, the label moves clear of the cabin's front.
        'text-offset': ['interpolate', ['linear'], ['zoom'], CABIN_ZOOM[0], ['literal', [0, 0.2]], 16, ['literal', [0, 1.6]]],
        'text-optional': true,
      },
      paint: {
        'icon-opacity': ['interpolate', ['linear'], ['zoom'], CABIN_ZOOM[0] + 0.5, 1, CABIN_ZOOM[1], 0],
        'text-color': '#7a1f12',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    },
    beforeId,
  );

  // The icon stands on its point, so a tooltip above it clears the roof.
  const above: [number, number] = [0, -26];
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'tooltip',
    offset: {
      center: [0, -12],
      bottom: above,
      'bottom-left': above,
      'bottom-right': above,
      top: [0, 4],
      'top-left': [0, 4],
      'top-right': [0, 4],
      left: [16, -12],
      right: [-16, -12],
    },
  });
  const bivouacAt = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    return f ? BIVOUACS[f.properties.index as number] : undefined;
  };
  for (const id of BIVOUAC_LAYER_IDS) {
    if (matchMedia('(hover: hover)').matches) {
      map.on('mousemove', id, (e: MapLayerMouseEvent) => {
        const b = bivouacAt(e);
        if (!b) return;
        map.getCanvas().style.cursor = 'pointer';
        popup.setLngLat([b.lon, b.lat]).setHTML(bivouacTooltipHtml(b)).addTo(map);
      });
      map.on('mouseleave', id, () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });
    }
    map.on('click', id, (e: MapLayerMouseEvent) => {
      const b = bivouacAt(e);
      if (b) onSelect(b);
    });
  }

  return {
    setVisible: (v) => {
      for (const id of BIVOUAC_LAYER_IDS) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
      if (!v) popup.remove();
    },
  };
}
