// One-off: refreshes web/src/data/ferratas.json from OpenStreetMap (`npm run ferratas`), with
// length, elevation range and climb read from Mapterhorn terrain tiles.
// OVERPASS_URL picks one Overpass instance (see overpass.ts). `npm run ferratas -- saved.json`
// uses a saved Overpass response of OVERPASS_QUERY instead, for when every instance is busy.

import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { MAPTERHORN } from './dem.ts';
import { resample } from '../../shared/geo.ts';
import { lonLatToPixel, terrarium } from '../../shared/terrarium.ts';
import { OVERPASS_QUERY, parseFerratas, toFeatureCollection } from './ferratas.ts';
import { fetchOverpass } from './overpass.ts';

const OUT = 'web/src/data/ferratas.json';
/** z13 terrarium tiles have about 6.6 m pixels here: fine enough for a route up a rock face. */
const ZOOM = 13;
const TILE = 512;

const saved = process.argv[2];
const osm = saved ? JSON.parse(await readFile(saved, 'utf8')) : await fetchOverpass(OVERPASS_QUERY, 'ferratas');
const routes = parseFerratas(osm as Parameters<typeof parseFerratas>[0]);
// Never replace the committed layer with an empty or nearly empty one.
if (routes.length < 300) throw new Error(`Only ${routes.length} via ferratas found; ${OUT} left unchanged.`);

// Every tile a sampled point falls in, fetched once up front, so the sampler can stay synchronous.
const tiles = new Map<string, Uint8Array>();
const key = (lon: number, lat: number) => {
  const { px, py } = lonLatToPixel(lon, lat, ZOOM);
  return `${Math.floor(px / TILE)}/${Math.floor(py / TILE)}`;
};
const wanted = new Set<string>();
for (const r of routes) for (const l of r.lines) for (const [lon, lat] of resample(l, 10)) wanted.add(key(lon, lat));
const queue = [...wanted];
console.log(`[ferratas] ${routes.length} routes, ${queue.length} terrain tiles`);
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let k = queue.pop(); k; k = queue.pop()) {
      const [x, y] = k.split('/');
      const url = MAPTERHORN.replace('{z}', String(ZOOM)).replace('{x}', x).replace('{y}', y);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const { data } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      tiles.set(k, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
  }),
);

/** Bilinear between pixel centres; at the edge of the fetched tiles the nearest edge pixel is used. */
function elevationAt(lon: number, lat: number): number {
  const { px, py } = lonLatToPixel(lon, lat, ZOOM);
  const [ox, oy] = [Math.floor(px / TILE) * TILE, Math.floor(py / TILE) * TILE];
  const pixel = (gx: number, gy: number) => {
    let t = tiles.get(`${Math.floor(gx / TILE)}/${Math.floor(gy / TILE)}`);
    if (!t) {
      t = tiles.get(`${ox / TILE}/${oy / TILE}`)!;
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
}

const head = {
  source: `OpenStreetMap via ferratas via Overpass API, ${(osm as { osm3s?: { timestamp_osm_base?: string } }).osm3s?.timestamp_osm_base?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}; elevations from Mapterhorn terrain`,
  licence: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors',
  type: 'FeatureCollection',
};
// One route per line keeps refreshes readable as a git diff.
const features = toFeatureCollection(routes, elevationAt).features.map((f) => JSON.stringify(f));
await writeFile(OUT, `${JSON.stringify(head).slice(0, -1)},"features":[\n${features.join(',\n')}\n]}\n`);
const graded = routes.filter((r) => r.grade !== null).length;
console.log(`[ferratas] ${routes.length} (${graded} graded, ${routes.filter((r) => r.closed).length} closed) -> ${OUT}`);
