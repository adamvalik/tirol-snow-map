// One-off: refreshes web/src/data/winter.json, the winter sports layer (lifts, slopes,
// cross-country trails, toboggan runs, ski touring routes), from OpenStreetMap (`npm run winter`),
// with lengths and elevations read from Mapterhorn terrain tiles.
// The area is asked for in boxes (queryBoxes), since one request for all of it times out on the
// public instances; when every instance is busy, OpenSnowMap's daily piste extract is read instead
// (`--opensnowmap` goes there straight away). OVERPASS_URL picks one Overpass instance (see
// overpass.ts). `npm run winter -- saved.json` reads saved Overpass responses (one, or a JSON array
// of one per box); `npm run winter -- pistes.osm.gz` reads a saved OSM XML file.

import { readFile, writeFile } from 'node:fs/promises';
import { MODEL_GRID } from '../../shared/grid.ts';
import { osmXmlLines, readOsmXml } from './osm-xml.ts';
import { fetchOverpass } from './overpass.ts';
import { terrainSampler } from './terrain-sampler.ts';
import { itemLines, mergeResponses, overpassQuery, parseWinter, queryBoxes, startsInArea, toWinterCollection, type WinterKind } from './winter.ts';

const OUT = 'web/src/data/winter.json';
/** z12 terrarium tiles have about 13 m pixels here: plenty for a slope or a lift, at a quarter of the tiles of z13. */
const ZOOM = 12;
/** OpenSnowMap's daily extract of every piste and lift in OpenStreetMap (about 200 MB). */
const OPENSNOWMAP = 'https://www.opensnowmap.org/download/planet_pistes.osm.gz';
/** Nodes this far around the drawn area are kept from the extract, so lines leaving it stay whole. */
const MARGIN_DEG = 0.15;

type Response = { elements?: { type: string; id: number }[]; osm3s?: { timestamp_osm_base?: string } };

async function fromOverpass(): Promise<Response[]> {
  // One box after the other: the public instances limit how many requests run at once.
  const responses: Response[] = [];
  const boxes = queryBoxes();
  for (const [i, box] of boxes.entries()) {
    responses.push((await fetchOverpass(overpassQuery(box), `winter ${i + 1}/${boxes.length}`)) as Response);
  }
  return responses;
}

async function fromXml(source: string): Promise<Response[]> {
  console.log(`[winter] reading ${source}`);
  const box = { west: MODEL_GRID.west - MARGIN_DEG, south: MODEL_GRID.south - MARGIN_DEG, east: MODEL_GRID.east + MARGIN_DEG, north: MODEL_GRID.north + MARGIN_DEG };
  return [await readOsmXml(await osmXmlLines(source), box)];
}

const args = process.argv.slice(2);
const saved = args.find((a) => !a.startsWith('--'));
let responses: Response[];
let via = 'Overpass API';
if (saved && /\.json$/.test(saved)) {
  const json = JSON.parse(await readFile(saved, 'utf8')) as Response | Response[];
  responses = Array.isArray(json) ? json : [json];
} else if (saved || args.includes('--opensnowmap')) {
  responses = await fromXml(saved ?? OPENSNOWMAP);
  via = 'the OpenSnowMap extract';
} else {
  try {
    responses = await fromOverpass();
  } catch (e) {
    console.warn(`[winter] ${e instanceof Error ? e.message : String(e)}\n[winter] falling back to ${OPENSNOWMAP}`);
    responses = await fromXml(OPENSNOWMAP);
    via = 'the OpenSnowMap extract';
  }
}
const osm = mergeResponses(responses);
// Only what starts inside the area the app draws, to keep the file small.
const items = parseWinter(osm).filter(startsInArea);
const count = (k: WinterKind) => items.filter((i) => i.kind === k).length;
// Never replace the committed layer with an empty or nearly empty one.
if (count('lift') < 300 || count('downhill') < 500) {
  throw new Error(`Only ${count('lift')} lifts and ${count('downhill')} slopes found; ${OUT} left unchanged.`);
}

const elevationAt = await terrainSampler(items.flatMap(itemLines), ZOOM, 'winter');

const head = {
  source: `OpenStreetMap lifts and pistes via ${via}, ${responses[0]?.osm3s?.timestamp_osm_base?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}; elevations from Mapterhorn terrain`,
  licence: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors',
  type: 'FeatureCollection',
};
// One feature per line keeps refreshes readable as a git diff.
const features = toWinterCollection(items, elevationAt).features.map((f) => JSON.stringify(f));
await writeFile(OUT, `${JSON.stringify(head).slice(0, -1)},"features":[\n${features.join(',\n')}\n]}\n`);
const kinds: WinterKind[] = ['lift', 'downhill', 'nordic', 'sled', 'skitour'];
console.log(`[winter] ${kinds.map((k) => `${count(k)} ${k}`).join(', ')} -> ${OUT}`);
