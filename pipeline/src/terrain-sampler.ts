// Elevation along lines from Mapterhorn terrarium tiles, for the static OSM layers (via ferratas,
// winter sports). Every tile a point falls in is fetched once up front, so the sampler that comes
// back is synchronous.

import sharp from 'sharp';
import { MAPTERHORN } from './dem.ts';
import { resample } from '../../shared/geo.ts';
import { lonLatToPixel, TERRARIUM_TILE as TILE, terrarium } from '../../shared/terrarium.ts';

export type ElevationAt = (lon: number, lat: number) => number;

/**
 * Fetches the tiles at `zoom` under `lines`, sampled every `stepM` metres, and returns a bilinear
 * sampler in metres. `tag` prefixes the progress message. Points outside the fetched tiles take the
 * nearest edge pixel of the tile they would be in, or of the first tile when that is missing too.
 */
export async function terrainSampler(lines: Iterable<readonly (readonly number[])[]>, zoom: number, tag: string, stepM = 10): Promise<ElevationAt> {
  const tiles = new Map<string, Uint8Array>();
  const key = (lon: number, lat: number) => {
    const { px, py } = lonLatToPixel(lon, lat, zoom);
    return `${Math.floor(px / TILE)}/${Math.floor(py / TILE)}`;
  };
  const wanted = new Set<string>();
  for (const l of lines) for (const [lon, lat] of resample(l, stepM)) wanted.add(key(lon, lat));
  const queue = [...wanted];
  console.log(`[${tag}] ${queue.length} terrain tiles at z${zoom}`);
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let k = queue.pop(); k; k = queue.pop()) {
        const [x, y] = k.split('/');
        const url = MAPTERHORN.replace('{z}', String(zoom)).replace('{x}', x).replace('{y}', y);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        const { data } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        tiles.set(k, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      }
    }),
  );
  const fallback = tiles.values().next().value;

  /** Bilinear between pixel centres. */
  return (lon, lat) => {
    const { px, py } = lonLatToPixel(lon, lat, zoom);
    const [ox, oy] = [Math.floor(px / TILE) * TILE, Math.floor(py / TILE) * TILE];
    const pixel = (gx: number, gy: number) => {
      let t = tiles.get(`${Math.floor(gx / TILE)}/${Math.floor(gy / TILE)}`);
      if (!t) {
        t = tiles.get(`${ox / TILE}/${oy / TILE}`) ?? fallback!;
        [gx, gy] = [Math.min(Math.max(gx, ox), ox + TILE - 1), Math.min(Math.max(gy, oy), oy + TILE - 1)];
      }
      const i = ((gy % TILE) * TILE + (gx % TILE)) * 3;
      return terrarium(t[i], t[i + 1], t[i + 2]);
    };
    const [x0, y0] = [Math.floor(px - 0.5), Math.floor(py - 0.5)];
    const [fx, fy] = [px - 0.5 - x0, py - 0.5 - y0];
    const top = pixel(x0, y0) * (1 - fx) + pixel(x0 + 1, y0) * fx;
    const bottom = pixel(x0, y0 + 1) * (1 - fx) + pixel(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}
