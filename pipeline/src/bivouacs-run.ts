// One-off: refreshes web/src/data/bivouacs.json from OpenStreetMap (`npm run bivouacs`).
// OVERPASS_URL picks one Overpass instance (see overpass.ts).

import { writeFile } from 'node:fs/promises';
import { OVERPASS_QUERY, parseBivouacs } from './bivouacs.ts';
import { fetchOverpass } from './overpass.ts';

const OUT = 'web/src/data/bivouacs.json';

const bivouacs = parseBivouacs((await fetchOverpass(OVERPASS_QUERY, 'bivouacs')) as Parameters<typeof parseBivouacs>[0]);
const file = {
  source: `OpenStreetMap huts and shelters named bivacco/Biwak via Overpass API, ${new Date().toISOString().slice(0, 10)}`,
  licence: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors',
  bivouacs,
};
// Never replace the committed list with an empty or nearly empty one.
if (bivouacs.length < 100) throw new Error(`Only ${bivouacs.length} bivouacs found; ${OUT} left unchanged.`);
await writeFile(OUT, `${JSON.stringify(file, null, 1)}\n`);
const wood = bivouacs.filter((b) => b.kind === 'wood').length;
console.log(`[bivouacs] ${bivouacs.length} (${wood} wooden) -> ${OUT}`);
