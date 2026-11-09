// Elevation for the horizon around a clicked point. The first few kilometres come from
// Mapterhorn tiles with ~26 m pixels, because ridges close by decide when the sun reaches a
// valley; beyond that the pipeline's 250 m grid (pipeline/assets/dem-grid.bin) reaches 100 km.
// Both are fetched on the first click and kept for later ones.

import demUrl from '../../pipeline/assets/dem-grid.bin?url';
import { MODEL_GRID, sampleGrid } from '../../shared/grid.ts';
import type { ElevationSampler } from '../../shared/horizon.ts';
import { lonLatToPixel, TERRARIUM_TILE, terrarium } from '../../shared/terrarium.ts';
import { MAPTERHORN_TILES } from './map.ts';

/** z11: about 26 m pixels at this latitude, 13 km per tile. */
const NEAR_ZOOM = 11;
/** Radius around the point drawn from the fine tiles. */
export const NEAR_RADIUS = 5000;
/** Decoded tiles kept in memory (1 MB each). */
const MAX_TILES = 12;

export interface Grid {
  /** Metres on MODEL_GRID, row-major from the north-west corner. */
  values: Int16Array;
  zMax: number;
}

let gridPromise: Promise<Grid> | null = null;

/** The 250 m terrain grid, downloaded once. */
export function loadGrid(): Promise<Grid> {
  gridPromise ??= (async () => {
    const res = await fetch(demUrl);
    if (!res.ok) throw new Error(`terrain grid: HTTP ${res.status}`);
    const values = new Int16Array(await res.arrayBuffer());
    if (values.length !== MODEL_GRID.width * MODEL_GRID.height) throw new Error('terrain grid has the wrong size');
    let zMax = -Infinity;
    for (const v of values) zMax = Math.max(zMax, v);
    return { values, zMax };
  })().catch((e: unknown) => {
    // A failed download is retried on the next click.
    gridPromise = null;
    throw e;
  });
  return gridPromise;
}

interface Tile {
  /** Metres, row-major, TERRARIUM_TILE² values. */
  values: Float32Array;
  zMax: number;
}

const tiles = new Map<string, Promise<Tile | null>>();

async function fetchTile(x: number, y: number): Promise<Tile | null> {
  const url = MAPTERHORN_TILES.replace('{z}', String(NEAR_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`terrain tile: HTTP ${res.status}`);
  // The colours are the elevation, so they must reach the canvas unchanged.
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(TERRARIUM_TILE, TERRARIUM_TILE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, TERRARIUM_TILE, TERRARIUM_TILE).data;
  const values = new Float32Array(TERRARIUM_TILE * TERRARIUM_TILE);
  let zMax = -Infinity;
  for (let i = 0; i < values.length; i++) {
    values[i] = terrarium(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    zMax = Math.max(zMax, values[i]);
  }
  return { values, zMax };
}

function getTile(x: number, y: number): Promise<Tile | null> {
  const key = `${x}/${y}`;
  let t = tiles.get(key);
  if (t) {
    // Most recently used last, so the oldest is dropped first.
    tiles.delete(key);
  } else {
    t = fetchTile(x, y).catch((e: unknown) => {
      tiles.delete(key);
      throw e;
    });
  }
  tiles.set(key, t);
  while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value!);
  return t;
}

export interface PointTerrain {
  near: ElevationSampler;
  far: ElevationSampler;
  /** Highest elevation either sampler can return. */
  zMax: number;
  /** Ground at the point itself. */
  ground: number;
}

/** The z11 tiles covering a lon/lat box, loaded; missing tiles (sea, outside the data) are left out. */
async function loadTiles(west: number, south: number, east: number, north: number): Promise<Map<string, Tile>> {
  const a = lonLatToPixel(west, north, NEAR_ZOOM);
  const b = lonLatToPixel(east, south, NEAR_ZOOM);
  const keys: [number, number][] = [];
  for (let x = Math.floor(a.px / TERRARIUM_TILE); x <= Math.floor(b.px / TERRARIUM_TILE); x++) {
    for (let y = Math.floor(a.py / TERRARIUM_TILE); y <= Math.floor(b.py / TERRARIUM_TILE); y++) keys.push([x, y]);
  }
  const loaded = await Promise.all(keys.map(([x, y]) => getTile(x, y)));
  const byKey = new Map<string, Tile>();
  keys.forEach(([x, y], i) => {
    const t = loaded[i];
    if (t) byKey.set(`${x}/${y}`, t);
  });
  return byKey;
}

/** Bilinear between pixel centres of the given tiles; null outside them. */
function tileSampler(byKey: ReadonlyMap<string, Tile>): ElevationSampler {
  const pixel = (px: number, py: number): number | null => {
    const tx = Math.floor(px / TERRARIUM_TILE);
    const ty = Math.floor(py / TERRARIUM_TILE);
    const t = byKey.get(`${tx}/${ty}`);
    return t ? t.values[(py - ty * TERRARIUM_TILE) * TERRARIUM_TILE + (px - tx * TERRARIUM_TILE)] : null;
  };
  return (x, y) => {
    const p = lonLatToPixel(x, y, NEAR_ZOOM);
    const fx = p.px - 0.5;
    const fy = p.py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const z00 = pixel(x0, y0);
    const z10 = pixel(x0 + 1, y0);
    const z01 = pixel(x0, y0 + 1);
    const z11 = pixel(x0 + 1, y0 + 1);
    if (z00 === null || z10 === null || z01 === null || z11 === null) return null;
    const u = fx - x0;
    const v = fy - y0;
    return (z00 * (1 - u) + z10 * u) * (1 - v) + (z01 * (1 - u) + z11 * u) * v;
  };
}

/** Samplers for the horizon around a point, or an error when the terrain cannot be loaded. */
export async function pointTerrain(lon: number, lat: number): Promise<PointTerrain> {
  const dLat = (NEAR_RADIUS / 6_371_000) * (180 / Math.PI);
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  const [grid, byKey] = await Promise.all([loadGrid(), loadTiles(lon - dLon, lat - dLat, lon + dLon, lat + dLat)]);
  const zMax = Math.max(grid.zMax, ...[...byKey.values()].map((t) => t.zMax));
  // Null outside the loaded tiles, so the ray falls back to the grid.
  const near = tileSampler(byKey);
  const far: ElevationSampler = (x, y) => sampleGrid(MODEL_GRID, grid.values, x, y);
  const ground = near(lon, lat) ?? far(lon, lat);
  if (ground === null) throw new Error('No terrain data for this point');
  return { near, far, zMax, ground };
}

/** More fine tiles than this for one line (~50 MB decoded) and it is read from the 250 m grid alone. */
const MAX_LINE_TILES = 48;

/**
 * Ground elevation in metres at each [lon, lat] position (a GPX track without elevation): from the
 * ~26 m tiles, or the 250 m grid where they are missing or the line spans too many of them; null
 * where neither has data.
 */
export async function terrainAlong(points: readonly (readonly number[])[]): Promise<(number | null)[]> {
  if (!points.length) return [];
  // A loop, not Math.min(...), which runs out of stack on a long track.
  let [west, east, south, north] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [lon, lat] of points) {
    [west, east] = [Math.min(west, lon), Math.max(east, lon)];
    [south, north] = [Math.min(south, lat), Math.max(north, lat)];
  }
  const a = lonLatToPixel(west, north, NEAR_ZOOM);
  const b = lonLatToPixel(east, south, NEAR_ZOOM);
  const count = (Math.floor(b.px / TERRARIUM_TILE) - Math.floor(a.px / TERRARIUM_TILE) + 1) * (Math.floor(b.py / TERRARIUM_TILE) - Math.floor(a.py / TERRARIUM_TILE) + 1);
  const grid = await loadGrid();
  // A failed tile download falls back to the grid rather than failing the track.
  const byKey = count <= MAX_LINE_TILES ? await loadTiles(west, south, east, north).catch(() => new Map<string, Tile>()) : new Map<string, Tile>();
  const near = tileSampler(byKey);
  return points.map(([lon, lat]) => near(lon, lat) ?? sampleGrid(MODEL_GRID, grid.values, lon, lat));
}
