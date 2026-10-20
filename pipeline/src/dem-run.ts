// One-off: builds pipeline/assets/dem-grid.bin from Mapterhorn tiles (`npm run dem`).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MODEL_GRID } from '../../shared/grid.ts';
import { buildDemGrid, DEM_FILE, MAPTERHORN } from './dem.ts';

let fetched = 0;
const values = await buildDemGrid(MODEL_GRID, async (z, x, y) => {
  const url = MAPTERHORN.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
  fetched++;
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), channels: info.channels };
});

const ints = Int16Array.from(values, (v) => Math.round(v));
await mkdir(path.dirname(DEM_FILE), { recursive: true });
await writeFile(DEM_FILE, new Uint8Array(ints.buffer));
let min = Infinity;
let max = -Infinity;
for (const v of ints) {
  min = Math.min(min, v);
  max = Math.max(max, v);
}
console.log(`[dem] ${fetched} tiles -> ${DEM_FILE} (${MODEL_GRID.width}×${MODEL_GRID.height}, ${min}–${max} m)`);
