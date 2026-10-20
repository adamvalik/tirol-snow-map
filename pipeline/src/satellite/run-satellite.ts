// Satellite step of the pipeline: renders the newest clear Sentinel-2 day as map tiles, but only
// when that day changes (rendering costs Copernicus processing units).

import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_GRID } from '../../../shared/grid.ts';
import { SCHEMA_VERSION, type SatelliteFile } from '../../../shared/types.ts';
import { chooseDay, getClientToken, renderChunk, searchScenes } from '../sources/sentinel2.ts';
import { buildPyramid } from './tiles.ts';

const BBOX = { west: MODEL_GRID.west, south: MODEL_GRID.south, east: MODEL_GRID.east, north: MODEL_GRID.north };
export const SAT_MIN_ZOOM = 8;
/** z12 ≈ 25 m pixels here; z13 would show the full 10 m detail at four times the processing cost. */
export const SAT_MAX_ZOOM = 12;
const CHUNK = 8;
const SEARCH_DAYS = 20;
const ATTRIBUTION = 'Contains modified Copernicus Sentinel data, processed by Sentinel Hub (Copernicus Data Space Ecosystem)';

export interface SatelliteStepOptions {
  outDir: string;
  now: string;
  offline: boolean;
  log: (msg: string) => void;
}

async function readPrevious(file: string): Promise<SatelliteFile | null> {
  try {
    const prev = JSON.parse(await readFile(file, 'utf8')) as SatelliteFile;
    return prev.schemaVersion === SCHEMA_VERSION ? prev : null;
  } catch {
    return null;
  }
}

const exists = (p: string) => stat(p).then(() => true, () => false);

export async function runSatelliteStep(opts: SatelliteStepOptions): Promise<SatelliteFile> {
  const jsonPath = path.join(opts.outDir, 'satellite.json');
  const tilesDir = path.join(opts.outDir, 'satellite');
  const previous = await readPrevious(jsonPath);
  const unavailable = async (reason: string): Promise<SatelliteFile> => {
    // Keep showing the last picture if there is one; it carries its own date.
    if (previous?.available && (await exists(tilesDir))) {
      opts.log(`satellite: ${reason}; keeping picture of ${previous.date}`);
      return previous;
    }
    const file: SatelliteFile = { schemaVersion: SCHEMA_VERSION, generatedAt: opts.now, available: false, reason, attribution: ATTRIBUTION };
    await writeFile(jsonPath, JSON.stringify(file));
    opts.log(`satellite: ${reason}`);
    return file;
  };

  if (opts.offline) return unavailable('Offline run (fixtures): no satellite picture');
  const id = process.env.CDSE_CLIENT_ID;
  const secret = process.env.CDSE_CLIENT_SECRET;
  if (!id || !secret) return unavailable('No Sentinel Hub OAuth client configured (CDSE_CLIENT_ID, CDSE_CLIENT_SECRET)');

  const token = await getClientToken(id, secret);
  const scenes = await searchScenes(token, BBOX, SEARCH_DAYS, opts.now);
  const { choice, days } = chooseDay(scenes, BBOX);
  opts.log(
    `satellite: ${scenes.length} scene parts in ${SEARCH_DAYS} days; ` +
      days.slice(0, 8).map((d) => `${d.date} cover ${Math.round(d.coverage * 100)}% clear ${Math.round(d.clearShare * 100)}%`).join(', '),
  );
  if (!choice) return unavailable(`No clear Sentinel-2 day in the last ${SEARCH_DAYS} days`);

  if (previous?.available && previous.date === choice.date && (await exists(tilesDir))) {
    opts.log(`satellite: ${choice.date} already rendered`);
    return previous;
  }

  // Render into a staging folder and swap, so a failed run never leaves half a pyramid.
  const staging = `${tilesDir}.new`;
  await rm(staging, { recursive: true, force: true });
  const t0 = Date.now();
  const counts = await buildPyramid(staging, {
    bbox: BBOX,
    minZoom: SAT_MIN_ZOOM,
    maxZoom: SAT_MAX_ZOOM,
    chunk: CHUNK,
    render: (box, px) => renderChunk(token, choice.date, box, px),
    onChunk: (done, total) => {
      if (done === total || done % 5 === 0) opts.log(`satellite: rendered ${done}/${total} chunks`);
    },
  });
  await rm(tilesDir, { recursive: true, force: true });
  await rename(staging, tilesDir);

  const file: SatelliteFile = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: opts.now,
    available: true,
    date: choice.date,
    coverage: choice.coverage,
    clearShare: choice.clearShare,
    scenes: choice.scenes,
    bounds: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    minZoom: SAT_MIN_ZOOM,
    maxZoom: SAT_MAX_ZOOM,
    version: `${choice.date}-${Date.parse(opts.now)}`,
    attribution: ATTRIBUTION,
  };
  await writeFile(jsonPath, JSON.stringify(file));
  opts.log(
    `satellite: ${choice.date} rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s, tiles ${Object.entries(counts)
      .map(([z, n]) => `z${z}:${n}`)
      .join(' ')}`,
  );
  return file;
}
