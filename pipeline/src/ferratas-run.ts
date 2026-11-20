// One-off: refreshes web/src/data/ferratas.json from OpenStreetMap (`npm run ferratas`), with
// length, elevation range and climb read from Mapterhorn terrain tiles.
// OVERPASS_URL picks one Overpass instance (see overpass.ts). `npm run ferratas -- saved.json`
// uses a saved Overpass response of OVERPASS_QUERY instead, for when every instance is busy.

import { readFile, writeFile } from 'node:fs/promises';
import { OVERPASS_QUERY, parseFerratas, toFeatureCollection } from './ferratas.ts';
import { fetchOverpass } from './overpass.ts';
import { terrainSampler } from './terrain-sampler.ts';

const OUT = 'web/src/data/ferratas.json';
/** z13 terrarium tiles have about 6.6 m pixels here: fine enough for a route up a rock face. */
const ZOOM = 13;

const saved = process.argv[2];
const osm = saved ? JSON.parse(await readFile(saved, 'utf8')) : await fetchOverpass(OVERPASS_QUERY, 'ferratas');
const routes = parseFerratas(osm as Parameters<typeof parseFerratas>[0]);
// Never replace the committed layer with an empty or nearly empty one.
if (routes.length < 300) throw new Error(`Only ${routes.length} via ferratas found; ${OUT} left unchanged.`);

const elevationAt = await terrainSampler(routes.flatMap((r) => r.lines), ZOOM, 'ferratas');

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
