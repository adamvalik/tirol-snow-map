// Satellite step of the pipeline: renders the newest clear Sentinel-2 day as map tiles, but only
// when that day changes (rendering costs Copernicus processing units).

import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
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
  const { choice, fallback, days } = chooseDay(scenes, BBOX);
  opts.log(
    `satellite: ${scenes.length} scene parts in ${SEARCH_DAYS} days; ` +
      days.slice(0, 8).map((d) => `${d.date} cover ${Math.round(d.coverage * 100)}% clear ${Math.round(d.clearShare * 100)}%`).join(', '),
  );
  if (!choice) return unavailable(`No clear Sentinel-2 day in the last ${SEARCH_DAYS} days`);

  if (previous?.available && previous.date === choice.date && previous.fallbackDate === fallback?.date && (await exists(tilesDir))) {
    opts.log(`satellite: ${choice.date} already rendered`);
    return previous;
  }
  opts.log(`satellite: rendering ${choice.date}${fallback ? `, gaps filled from ${fallback.date}` : ''}`);

  // Pixels hidden by clouds on the main day are filled from the fallback day. Chunks with no real
  // gaps skip the second request, which saves processing units.
  const counts = { main: 0, fallback: 0, empty: 0 };
  const render = async (box: [number, number, number, number], px: number): Promise<ArrayBuffer> => {
    const main = await renderChunk(token, choice.date, box, px);
    const a = await sharp(Buffer.from(main)).ensureAlpha().raw().toBuffer();
    let holes = 0;
    for (let i = 3; i < a.length; i += 4) if (a[i] < 128) holes++;
    counts.main += px * px - holes;
    if (!fallback || holes / (px * px) < 0.02) {
      counts.empty += holes;
      return main;
    }
    const b = await sharp(Buffer.from(await renderChunk(token, fallback.date, box, px))).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] >= 128) continue;
      if (b[i + 3] >= 128) {
        a[i] = b[i];
        a[i + 1] = b[i + 1];
        a[i + 2] = b[i + 2];
        a[i + 3] = b[i + 3];
        counts.fallback++;
      } else counts.empty++;
    }
    const png = await sharp(a, { raw: { width: px, height: px, channels: 4 } }).png().toBuffer();
    return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  };

  // Render into a staging folder and swap, so a failed run never leaves half a pyramid.
  const staging = `${tilesDir}.new`;
  await rm(staging, { recursive: true, force: true });
  const t0 = Date.now();
  const tileCounts = await buildPyramid(staging, {
    bbox: BBOX,
    minZoom: SAT_MIN_ZOOM,
    maxZoom: SAT_MAX_ZOOM,
    chunk: CHUNK,
    render,
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
    fallbackDate: fallback?.date,
    shares: (() => {
      const total = counts.main + counts.fallback + counts.empty || 1;
      return { main: counts.main / total, fallback: counts.fallback / total, empty: counts.empty / total };
    })(),
    bounds: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    minZoom: SAT_MIN_ZOOM,
    maxZoom: SAT_MAX_ZOOM,
    version: `${choice.date}-${fallback?.date ?? 'none'}-${Date.parse(opts.now)}`,
    attribution: ATTRIBUTION,
  };
  await writeFile(jsonPath, JSON.stringify(file));
  opts.log(
    `satellite: ${choice.date} rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s ` +
      `(pixels: main ${counts.main}, fill-in ${counts.fallback}, empty ${counts.empty}), tiles ${Object.entries(tileCounts)
      .map(([z, n]) => `z${z}:${n}`)
      .join(' ')}`,
  );
  return file;
}
