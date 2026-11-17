// One-off: refreshes web/src/data/regions.json, the avalanche warning regions (`npm run regions`).
// The regions change rarely (a few times a decade); run it before a winter.

import { writeFile } from 'node:fs/promises';
import { MODEL_GRID } from '../../shared/grid.ts';
import { buildRegions, REGION_FILES, REGIONS_URL } from './regions.ts';

const OUT = 'web/src/data/regions.json';

async function get<T>(file: string): Promise<T> {
  const res = await fetch(`${REGIONS_URL}/${file}`, { headers: { 'user-agent': 'tirol-snow-map (github.com/adamvalik/tirol-snow-map)' } });
  if (!res.ok) throw new Error(`${REGIONS_URL}/${file}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

type Args = Parameters<typeof buildRegions>[0];
const [collections, services, en, de, it] = await Promise.all([
  Promise.all(REGION_FILES.map((r) => get<Args['collections'][number]>(`micro-regions/${r}_micro-regions.geojson.json`))),
  get<Args['services']>('outline_properties/index.json'),
  get<Record<string, string>>('micro-regions_names/en.json'),
  get<Record<string, string>>('micro-regions_names/de.json'),
  get<Record<string, string>>('micro-regions_names/it.json'),
]);
const file = buildRegions({
  collections,
  services,
  names: { en, de, it },
  area: [MODEL_GRID.west, MODEL_GRID.south, MODEL_GRID.east, MODEL_GRID.north],
  date: new Date().toISOString().slice(0, 10),
});
// Never replace the committed file with a nearly empty one.
if (file.regions.length < 60) throw new Error(`Only ${file.regions.length} regions found; ${OUT} left unchanged.`);
await writeFile(OUT, `${JSON.stringify(file)}\n`);
const points = file.regions.reduce((n, r) => n + r.polygons.flat().reduce((m, ring) => m + ring.length, 0), 0);
console.log(`[regions] ${file.regions.length} regions, ${points} points, ${Object.keys(file.services).length} services -> ${OUT}`);
