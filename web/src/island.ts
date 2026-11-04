// The area the snow data covers (MODEL_GRID), and how the map shows the world outside it: either
// cut, so it reads as an island (the terrain stops in a cliff over a flat, plain floor), or faded
// under a pale veil (see EdgeStyle). The cut is done in the browser by rewriting the elevation
// tiles on their way in, so nothing changes in the pipeline. Outside either way, labels, stations,
// bivouacs and via ferratas are not drawn and clicks do nothing.
//
// Tiles fully inside the area pass through untouched, tiles fully outside are never downloaded,
// and only the tiles on the edge are decoded and cut.

import * as maplibregl from 'maplibre-gl';
import type { FilterSpecification, LayerSpecification, SourceSpecification } from 'maplibre-gl';
import { convertFilter, expression } from '@maplibre/maplibre-gl-style-spec';
import { MODEL_GRID } from '../../shared/grid.ts';

/** The covered area: snow from space, depth estimate, satellite picture and shadows share this grid. */
export const AREA = { west: MODEL_GRID.west, south: MODEL_GRID.south, east: MODEL_GRID.east, north: MODEL_GRID.north };

export const inArea = (lon: number, lat: number): boolean =>
  lon >= AREA.west && lon <= AREA.east && lat >= AREA.south && lat <= AREA.north;

/** Elevation of the floor around the island; below every valley in the area (lowest ~190 m). */
export const FLOOR_M = -100;
/** Colour of the floor; the background layer and the mask use the same. */
export const FLOOR_COLOR = '#e8ebee';

export const ISLAND_PROTOCOL = 'island';

/** Terrarium encoding of FLOOR_M: elevation = R * 256 + G + B / 256 - 32768. */
const floorRgb = (): [number, number, number] => {
  const v = FLOOR_M + 32768;
  return [Math.floor(v / 256), Math.floor(v) % 256, Math.round((v % 1) * 256)];
};

/** Pixel rectangle of the area inside tile z/x/y of `size` pixels: [x0, x1) × [y0, y1), clamped to the tile. */
export function areaPixels(z: number, x: number, y: number, size: number): { x0: number; x1: number; y0: number; y1: number } {
  const n = 2 ** z;
  const px = (lon: number) => (((lon + 180) / 360) * n - x) * size;
  const py = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return (((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n - y) * size;
  };
  const clamp = (v: number) => Math.max(0, Math.min(size, Math.round(v)));
  return { x0: clamp(px(AREA.west)), x1: clamp(px(AREA.east)), y0: clamp(py(AREA.north)), y1: clamp(py(AREA.south)) };
}

/** Sets every pixel outside the rectangle to the floor elevation, in place. */
export function cutToArea(data: Uint8ClampedArray, size: number, r: { x0: number; x1: number; y0: number; y1: number }): void {
  const [R, G, B] = floorRgb();
  for (let j = 0; j < size; j++) {
    const rowInside = j >= r.y0 && j < r.y1;
    for (let i = 0; i < size; i++) {
      if (rowInside && i >= r.x0 && i < r.x1) continue;
      const k = (j * size + i) * 4;
      data[k] = R;
      data[k + 1] = G;
      data[k + 2] = B;
      data[k + 3] = 255;
    }
  }
}

const TILE_SIZE = 512;
const bitmapOptions: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };

let floorTile: ImageData | null = null;
function flatTile(): Promise<ImageBitmap> {
  if (!floorTile) {
    floorTile = new ImageData(TILE_SIZE, TILE_SIZE);
    cutToArea(floorTile.data, TILE_SIZE, { x0: 0, x1: 0, y0: 0, y1: 0 });
  }
  return createImageBitmap(floorTile, bitmapOptions);
}

/**
 * `island://host/z/x/y.ext` loads `https://host/z/x/y.ext` and cuts it to the area.
 * Used for both elevation sources (3D mesh and hillshade/relief).
 */
export function registerIslandProtocol(): void {
  maplibregl.addProtocol(ISLAND_PROTOCOL, async (params, abort) => {
    const url = params.url.replace(`${ISLAND_PROTOCOL}://`, 'https://');
    const m = /\/(\d+)\/(\d+)\/(\d+)\.\w+$/.exec(url);
    if (!m) throw new Error(`island: unexpected tile URL ${url}`);
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];

    const r = areaPixels(z, x, y, TILE_SIZE);
    if (r.x0 >= r.x1 || r.y0 >= r.y1) return { data: await flatTile() };

    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${url}`), { status: res.status });
    const meta = { cacheControl: res.headers.get('Cache-Control'), expires: res.headers.get('Expires') };
    const whole = r.x0 === 0 && r.y0 === 0 && r.x1 === TILE_SIZE && r.y1 === TILE_SIZE;
    if (whole) return { data: await res.arrayBuffer(), ...meta };

    const bitmap = await createImageBitmap(await res.blob(), bitmapOptions);
    const size = bitmap.width;
    const edge = size === TILE_SIZE ? r : areaPixels(z, x, y, size);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const img = ctx.getImageData(0, 0, size, size);
    cutToArea(img.data, size, edge);
    return { data: await createImageBitmap(img, bitmapOptions), ...meta };
  });
}

/** The area as a polygon, and the world outside it with the area as a hole. */
const ring = (w: number, s: number, e: number, n: number) => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];
export const AREA_POLYGON = { type: 'Polygon' as const, coordinates: [ring(AREA.west, AREA.south, AREA.east, AREA.north)] };

export const OUTSIDE_SOURCE = 'outside-area';

/** The world outside the area, with the area as a hole. */
export function outsideSource(): SourceSpecification {
  return {
    type: 'geojson',
    data: { type: 'Polygon', coordinates: [ring(-180, -85, 180, 85), ring(AREA.west, AREA.south, AREA.east, AREA.north).reverse()] },
  };
}

/**
 * Two looks for the world outside the area, switchable at any time:
 * - `island`: the terrain is cut at the edge and stands on a plain floor; outside tiles are never loaded.
 * - `faded`: the real terrain continues under a pale veil, so neighbouring ranges give context.
 */
export type EdgeStyle = 'island' | 'faded';

const MASK_PAINT: Record<EdgeStyle, { color: string; opacity: number }> = {
  island: { color: FLOOR_COLOR, opacity: 1 },
  faded: { color: '#f2f3f5', opacity: 0.62 },
};

/** Elevation tile URL for an edge style: through the cutting protocol, or straight from the host. */
export const elevationTiles = (url: string, style: EdgeStyle): string =>
  style === 'island' ? url.replace('https://', `${ISLAND_PROTOCOL}://`) : url;

/** Covers (island) or veils (faded) roads, rivers, land cover and terrain beyond the edge. */
export const outsideMaskLayer = (style: EdgeStyle): LayerSpecification => ({
  id: OUTSIDE_SOURCE,
  type: 'fill',
  source: OUTSIDE_SOURCE,
  paint: { 'fill-color': MASK_PAINT[style].color, 'fill-opacity': MASK_PAINT[style].opacity, 'fill-antialias': false },
});

/** Switches a running map to the other look. Terrain sources reload from the matching URL. */
export function setEdgeStyle(map: maplibregl.Map, style: EdgeStyle, demSources: string[], tileUrl: string): void {
  for (const id of demSources) (map.getSource(id) as maplibregl.RasterDEMTileSource | undefined)?.setTiles([elevationTiles(tileUrl, style)]);
  map.setPaintProperty(OUTSIDE_SOURCE, 'fill-color', MASK_PAINT[style].color);
  map.setPaintProperty(OUTSIDE_SOURCE, 'fill-opacity', MASK_PAINT[style].opacity);
}

/**
 * Keeps a label layer to the area. `within` handles points and lines; labels placed from polygons
 * (rare in this basemap) are left alone so none inside the area disappear.
 */
export function withinArea(filter: FilterSpecification | undefined): FilterSpecification {
  const inside: FilterSpecification = [
    'case',
    ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    true,
    ['within', AREA_POLYGON],
  ];
  if (!filter) return inside;
  // Some basemap layers use the old filter syntax, which cannot be combined with expressions.
  const asExpression = expression.isExpressionFilter(filter) ? filter : convertFilter(filter);
  return ['all', asExpression, inside] as FilterSpecification;
}
