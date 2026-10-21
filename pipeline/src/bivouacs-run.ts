// One-off: refreshes web/src/data/bivouacs.json from OpenStreetMap (`npm run bivouacs`).
// OVERPASS_URL picks one Overpass instance; by default the main one and a mirror are tried in turn.

import { writeFile } from 'node:fs/promises';
import { OVERPASS_QUERY, parseBivouacs } from './bivouacs.ts';

const OUT = 'web/src/data/bivouacs.json';
const URLS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
/** overpass-api.de answers 406 to requests without an identifying User-Agent. */
const HEADERS = { 'User-Agent': 'tirol-snow-map (github.com/adamvalik/tirol-snow-map)', Accept: 'application/json' };

async function fetchOsm(): Promise<unknown> {
  const errors: string[] = [];
  // Busy instances answer 429 or 504; a few rounds with a pause usually get through.
  for (let round = 0; round < 3; round++) {
    for (const url of URLS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: HEADERS, body: new URLSearchParams({ data: OVERPASS_QUERY }) });
        if (res.ok) return await res.json();
        errors.push(`${url}: HTTP ${res.status}`);
      } catch (e) {
        errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
      console.warn(`[bivouacs] ${errors.at(-1)}, trying again`);
    }
    await new Promise((r) => setTimeout(r, 15_000 * (round + 1)));
  }
  throw new Error(`Overpass unavailable:\n${errors.join('\n')}`);
}

const bivouacs = parseBivouacs((await fetchOsm()) as Parameters<typeof parseBivouacs>[0]);
const file = {
  source: `OpenStreetMap huts and shelters named bivacco/Biwak via Overpass API, ${new Date().toISOString().slice(0, 10)}`,
  licence: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors',
  bivouacs,
};
await writeFile(OUT, `${JSON.stringify(file, null, 1)}\n`);
const wood = bivouacs.filter((b) => b.kind === 'wood').length;
console.log(`[bivouacs] ${bivouacs.length} (${wood} wooden) -> ${OUT}`);
