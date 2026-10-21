// One-off: refreshes web/src/data/bivouacs.json from OpenStreetMap (`npm run bivouacs`).
// OVERPASS_URL picks another Overpass instance when the main one is busy.

import { writeFile } from 'node:fs/promises';
import { OVERPASS_QUERY, parseBivouacs } from './bivouacs.ts';

const OUT = 'web/src/data/bivouacs.json';
const url = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: OVERPASS_QUERY }) });
if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
const bivouacs = parseBivouacs(await res.json());
const file = {
  source: `OpenStreetMap huts and shelters named bivacco/Biwak via Overpass API, ${new Date().toISOString().slice(0, 10)}`,
  licence: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors',
  bivouacs,
};
await writeFile(OUT, `${JSON.stringify(file, null, 1)}\n`);
const wood = bivouacs.filter((b) => b.kind === 'wood').length;
console.log(`[bivouacs] ${bivouacs.length} (${wood} wooden) -> ${OUT}`);
