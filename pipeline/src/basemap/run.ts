// Builds the self-hosted OpenStreetMap basemap: a PMTiles extract of the Protomaps daily planet
// build, limited to South Tyrol. Run rarely (monthly is plenty): `npm run basemap`.
//
//   --build YYYYMMDD   use a specific Protomaps build (default: newest of the last 10 days)
//   --out <file>       default web/public/basemap/south-tyrol.pmtiles

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FetchSource } from 'pmtiles';
import { BANDS } from './config.ts';
import { extract } from './pmtiles.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BUILDS = 'https://build.protomaps.com';


function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function findBuild(): Promise<string> {
  const requested = arg('--build');
  if (requested) return requested;
  for (let back = 0; back < 10; back++) {
    const d = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
    const res = await fetch(`${BUILDS}/${d}.pmtiles`, { method: 'HEAD' });
    if (res.ok) return d;
  }
  throw new Error('No Protomaps build found in the last 10 days');
}

const build = await findBuild();
const url = `${BUILDS}/${build}.pmtiles`;
const outFile = path.resolve(ROOT, arg('--out') ?? 'web/public/basemap/south-tyrol.pmtiles');
console.log(`[basemap] extracting from ${url}`);

let lastLog = 0;
const result = await extract(new FetchSource(url), BANDS, {
  onProgress: (done, total) => {
    if (Date.now() - lastLog > 5000 || done === total) {
      lastLog = Date.now();
      console.log(`[basemap] ${done}/${total} range requests`);
    }
  },
});

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, result.archive);
await writeFile(
  path.join(path.dirname(outFile), 'basemap.json'),
  JSON.stringify({ build, source: url, createdAt: new Date().toISOString(), tiles: result.tiles, bytes: result.archive.length }, null, 2),
);
const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
console.log(`[basemap] wrote ${path.relative(ROOT, outFile)}: ${result.tiles} tiles, ${mb(result.archive.length)} MB`);
console.log(
  '  per zoom (MB): ' +
    Object.entries(result.bytesPerZoom)
      .map(([z, b]) => `z${z} ${mb(b)}`)
      .join(', '),
);
