// Downloads the fonts (glyph ranges) and icon sprites the Protomaps style needs, so the app
// serves them itself. Run once when the basemap style or extract changes: `npm run basemap:assets`.
// The output is committed (web/public/basemap-assets/).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'web/public/basemap-assets');
const BASE = 'https://protomaps.github.io/basemaps-assets';

const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
/**
 * Unicode blocks (start of each 256-code-point range) that occur in names in the South Tyrol
 * extract, found by scanning every label. Latin covers almost everything; the rest appear in a
 * handful of country and place names. A range missing here makes MapLibre log a 404.
 */
const RANGES = [
  0, 256, 512, 768, 1024, 1280, 1536, 2304, 3328, 3584, 4096, 4608, 4864, 7680, 8192, 11520, 19968, 22016, 24064,
  25088, 25856, 26368, 36864,
];
const SPRITES = ['light.json', 'light.png', 'light@2x.json', 'light@2x.png'];

async function download(url: string, file: string) {
  const res = await fetch(url);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, new Uint8Array(await res.arrayBuffer()));
  return true;
}

let count = 0;
for (const font of FONTS) {
  for (const start of RANGES) {
    const name = `${start}-${start + 255}.pbf`;
    if (await download(`${BASE}/fonts/${encodeURIComponent(font)}/${name}`, path.join(OUT, 'fonts', font, name))) count++;
  }
}
for (const s of SPRITES) {
  if (await download(`${BASE}/sprites/v4/${s}`, path.join(OUT, 'sprites', s))) count++;
}
console.log(`[basemap-assets] downloaded ${count} files to ${path.relative(ROOT, OUT)}`);
