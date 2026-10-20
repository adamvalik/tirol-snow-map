// Cuts rendered satellite chunks into a 256 px XYZ tile pyramid (WebP with alpha). The top zoom is
// rendered by Sentinel Hub in chunks of CHUNK × CHUNK tiles; lower zooms are built here by merging
// four children, so they cost no processing units.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import type { Bbox } from '../sources/sentinel2.ts';

export const TILE = 256;
const R = 6378137;
const WORLD = 2 * Math.PI * R;

export function tileRange(b: Bbox, z: number) {
  const n = 2 ** z;
  const x = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const y = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n);
  };
  return { minX: x(b.west), maxX: x(b.east), minY: y(b.north), maxY: y(b.south) };
}

/** Web Mercator box [minX, minY, maxX, maxY] of a block of tiles (x0..x1, y0..y1 inclusive). */
export function mercatorBox(z: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  const size = WORLD / 2 ** z;
  const minX = -WORLD / 2 + x0 * size;
  const maxX = -WORLD / 2 + (x1 + 1) * size;
  const maxY = WORLD / 2 - y0 * size;
  const minY = WORLD / 2 - (y1 + 1) * size;
  return [minX, minY, maxX, maxY];
}

const tilePath = (dir: string, z: number, x: number, y: number) => path.join(dir, String(z), String(x), `${y}.webp`);

async function writeTile(dir: string, z: number, x: number, y: number, rgba: Buffer) {
  const file = tilePath(dir, z, x, y);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await sharp(rgba, { raw: { width: TILE, height: TILE, channels: 4 } }).webp({ quality: 78, alphaQuality: 60 }).toBuffer());
}

export interface PyramidOptions {
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  /** Tiles per chunk side at maxZoom (chunk = CHUNK·256 px, at most 2500 px for the Process API). */
  chunk: number;
  /** Returns a PNG of the given Mercator box at `px` × `px`. */
  render: (mercBox: [number, number, number, number], px: number) => Promise<ArrayBuffer>;
  onChunk?: (done: number, total: number) => void;
}

/** Builds the pyramid in `dir`; returns the number of tiles written per zoom. */
export async function buildPyramid(dir: string, o: PyramidOptions): Promise<Record<number, number>> {
  const counts: Record<number, number> = {};
  const top = tileRange(o.bbox, o.maxZoom);
  const chunks: [number, number][] = [];
  for (let cx = top.minX; cx <= top.maxX; cx += o.chunk) for (let cy = top.minY; cy <= top.maxY; cy += o.chunk) chunks.push([cx, cy]);

  let done = 0;
  for (const [cx, cy] of chunks) {
    const px = o.chunk * TILE;
    const png = await o.render(mercatorBox(o.maxZoom, cx, cy, cx + o.chunk - 1, cy + o.chunk - 1), px);
    const raw = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer();
    for (let tx = 0; tx < o.chunk; tx++) {
      for (let ty = 0; ty < o.chunk; ty++) {
        const x = cx + tx;
        const y = cy + ty;
        if (x > top.maxX || y > top.maxY) continue;
        const tile = Buffer.alloc(TILE * TILE * 4);
        for (let row = 0; row < TILE; row++) {
          const src = ((ty * TILE + row) * px + tx * TILE) * 4;
          raw.copy(tile, row * TILE * 4, src, src + TILE * 4);
        }
        await writeTile(dir, o.maxZoom, x, y, tile);
        counts[o.maxZoom] = (counts[o.maxZoom] ?? 0) + 1;
      }
    }
    o.onChunk?.(++done, chunks.length);
  }

  for (let z = o.maxZoom - 1; z >= o.minZoom; z--) {
    const r = tileRange(o.bbox, z);
    for (let x = r.minX; x <= r.maxX; x++) {
      for (let y = r.minY; y <= r.maxY; y++) {
        const parts: OverlayOptions[] = [];
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          try {
            const child = await readFile(tilePath(dir, z + 1, 2 * x + dx, 2 * y + dy));
            parts.push({ input: child, left: dx * TILE, top: dy * TILE });
          } catch {
            // child outside the region: stays transparent
          }
        }
        const merged = await sharp({ create: { width: 2 * TILE, height: 2 * TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite(parts)
          .png()
          .toBuffer();
        const down = await sharp(merged).resize(TILE, TILE, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
        await writeTile(dir, z, x, y, down);
        counts[z] = (counts[z] ?? 0) + 1;
      }
    }
  }
  return counts;
}
