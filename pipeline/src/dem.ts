// Elevation on the model grid, averaged from Mapterhorn terrarium tiles. Terrain is static, so the
// grid is built once (`npm run dem`) and committed as pipeline/assets/dem-grid.bin
// (Int16 metres, row-major from the north-west corner).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cellCenter, type GridSpec, MODEL_GRID } from '../../shared/grid.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEM_FILE = path.join(ROOT, 'pipeline/assets/dem-grid.bin');
export const MAPTERHORN = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
/** z10 terrarium tiles have ~52 m pixels here; each 250 m cell averages about 5 × 5 of them. */
export const DEM_ZOOM = 10;
const TILE = 512;

export interface ElevationGrid {
  grid: GridSpec;
  /** Metres, row-major from the north-west corner. */
  values: Float32Array;
}

export async function loadDemGrid(file = DEM_FILE): Promise<ElevationGrid> {
  const buf = await readFile(file);
  const ints = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  if (ints.length !== MODEL_GRID.width * MODEL_GRID.height) {
    throw new Error(`${file}: expected ${MODEL_GRID.width}×${MODEL_GRID.height} cells, got ${ints.length}; rebuild with npm run dem`);
  }
  return { grid: MODEL_GRID, values: Float32Array.from(ints) };
}

/** Global pixel coordinates at `zoom` for 512 px tiles. */
export function lonLatToPixel(lon: number, lat: number, zoom: number): { px: number; py: number } {
  const n = TILE * 2 ** zoom;
  const r = (lat * Math.PI) / 180;
  return { px: ((lon + 180) / 360) * n, py: ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n };
}

/** Decodes terrarium RGB into metres. */
export const terrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;

/**
 * Builds the grid by averaging terrain pixels inside each cell.
 * `getTile` returns raw RGB(A) pixels of a terrain tile (channels per pixel given).
 */
export async function buildDemGrid(
  grid: GridSpec,
  getTile: (z: number, x: number, y: number) => Promise<{ data: Uint8Array; channels: number }>,
): Promise<Float32Array> {
  const out = new Float32Array(grid.width * grid.height);
  const tiles = new Map<string, { data: Uint8Array; channels: number }>();
  const pixel = async (px: number, py: number) => {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    const key = `${tx}/${ty}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = await getTile(DEM_ZOOM, tx, ty)));
    const i = ((Math.floor(py) - ty * TILE) * TILE + (Math.floor(px) - tx * TILE)) * t.channels;
    return terrarium(t.data[i], t.data[i + 1], t.data[i + 2]);
  };
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      // Cell corners from the neighbouring cell centres' midpoints.
      const nw = cellCenter(grid, col - 0.5, row - 0.5);
      const se = cellCenter(grid, col + 0.5, row + 0.5);
      const a = lonLatToPixel(nw.lon, nw.lat, DEM_ZOOM);
      const b = lonLatToPixel(se.lon, se.lat, DEM_ZOOM);
      let sum = 0;
      let n = 0;
      for (let py = Math.floor(a.py); py < Math.ceil(b.py); py++) {
        for (let px = Math.floor(a.px); px < Math.ceil(b.px); px++) {
          sum += await pixel(px + 0.5, py + 0.5);
          n++;
        }
      }
      out[row * grid.width + col] = sum / Math.max(1, n);
    }
  }
  return out;
}
