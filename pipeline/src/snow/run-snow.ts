// Snow step of the pipeline: satellite snow cover (if credentials are set) plus the station-based
// depth estimate on the model grid. Writes snow.json and the layer PNGs next to stations.json.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_GRID } from '../../../shared/grid.ts';
import { SCHEMA_VERSION, type SnowFile, type Station } from '../../../shared/types.ts';
import { loadDemGrid } from '../dem.ts';
import {
  type CoverGrid,
  decodeToGrid,
  downloadProduct,
  extractTiff,
  getToken,
  type SceProduct,
  searchProducts,
} from '../sources/snowCover.ts';
import { estimateGrid, fit, leaveOneOut } from './model.ts';
import { confidenceRgba, coverRgba, dataRgba, depthRgba, encodePng, snowLine } from './render.ts';
import { toModelStations } from './stations.ts';

const COVER_CACHE = 'snow-cover-grid.bin';
/** Older products are not shown as current snow cover. */
const MAX_COVER_AGE_DAYS = 7;

export interface SnowStepOptions {
  outDir: string;
  now: string;
  stations: Station[];
  /** Skip network access (fixture runs). */
  offline: boolean;
  log: (msg: string) => void;
}

type CoverResult = { product: SceProduct; grid: CoverGrid; fetchedAt: string } | { reason: string };

async function loadCover(opts: SnowStepOptions, previous: SnowFile | null): Promise<CoverResult> {
  if (opts.offline) return { reason: 'Offline run (fixtures): no satellite data' };
  const user = process.env.CDSE_USERNAME;
  const pass = process.env.CDSE_PASSWORD;
  if (!user || !pass) return { reason: 'No Copernicus credentials configured (CDSE_USERNAME, CDSE_PASSWORD)' };

  const products = await searchProducts();
  const newest = products[0];
  if (!newest) return { reason: 'No snow cover product found in the catalogue' };
  const ageDays = (Date.parse(opts.now) - Date.parse(`${newest.date}T12:00:00Z`)) / 86_400_000;
  if (ageDays > MAX_COVER_AGE_DAYS) return { reason: `Newest snow cover product is from ${newest.date}, too old to show` };

  // The product changes once a day; reuse the decoded grid when it is the same one.
  const cachePath = path.join(opts.outDir, COVER_CACHE);
  if (previous?.cover.available && previous.cover.product === newest.name) {
    try {
      const buf = await readFile(cachePath);
      if (buf.length === MODEL_GRID.width * MODEL_GRID.height) {
        const values = new Uint8Array(buf);
        opts.log(`snow cover: reusing ${newest.name}`);
        return { product: newest, fetchedAt: previous.cover.fetchedAt, grid: { values, stats: previous.cover.stats, rawCodes: {}, bands: 1 } };
      }
    } catch {
      // cache missing: download again
    }
  }

  const token = await getToken(user, pass);
  const download = await downloadProduct(newest.id, token);
  const { tiff, note } = extractTiff(download);
  opts.log(`snow cover: downloaded ${(download.byteLength / 1e6).toFixed(1)} MB, ${note}`);
  const grid = await decodeToGrid(tiff, MODEL_GRID);
  await writeFile(cachePath, grid.values);
  const codes = Object.entries(grid.rawCodes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([c, n]) => `${c}:${n}`)
    .join(' ');
  opts.log(
    `snow cover: ${newest.name} (${(tiff.byteLength / 1e6).toFixed(1)} MB, ${grid.bands} band(s)); ` +
      `cells snow ${grid.stats.snow}, bare ${grid.stats.bare}, cloud ${grid.stats.cloud}, no data ${grid.stats.nodata}; raw codes ${codes}`,
  );
  return { product: newest, grid, fetchedAt: opts.now };
}

async function readPrevious(file: string): Promise<SnowFile | null> {
  try {
    const prev = JSON.parse(await readFile(file, 'utf8')) as SnowFile;
    return prev.schemaVersion === SCHEMA_VERSION ? prev : null;
  } catch {
    return null;
  }
}

export async function runSnowStep(opts: SnowStepOptions): Promise<SnowFile> {
  const jsonPath = path.join(opts.outDir, 'snow.json');
  const previous = await readPrevious(jsonPath);
  const dem = await loadDemGrid();
  const grid = MODEL_GRID;

  let cover: CoverResult;
  try {
    cover = await loadCover(opts, previous);
  } catch (e) {
    cover = { reason: `Snow cover fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const coverValues = 'grid' in cover ? cover.grid.values : null;
  if ('reason' in cover) opts.log(`snow cover: ${cover.reason}`);

  const stations = toModelStations(opts.stations);
  const files: SnowFile['files'] = { cover: null, depth: null, confidence: null, data: null };
  const write = async (name: keyof SnowFile['files'], rgba: Uint8Array) => {
    const file = `snow-${name}.png`;
    await writeFile(path.join(opts.outDir, file), await encodePng(grid, rgba));
    files[name] = file;
  };

  if (coverValues) await write('cover', coverRgba(grid, coverValues));

  let depth: SnowFile['depth'] = null;
  if (stations.length >= 10) {
    const validation = leaveOneOut(stations);
    const fitted = fit(stations, validation.chosen);
    const estimate = estimateGrid(grid, dem.values, fitted, coverValues);
    await write('depth', depthRgba(grid, estimate.depthCm));
    await write('confidence', confidenceRgba(grid, estimate.confidence));
    await write('data', dataRgba(grid, estimate.depthCm, estimate.confidence, coverValues));
    const elevations = stations.map((s) => s.elevation);
    depth = {
      method: validation.chosen,
      trend: fitted.trend,
      stationCount: stations.length,
      stationsObservedAt:
        opts.stations
          .map((s) => s.observedAt)
          .filter((t): t is string => t !== null)
          .sort()
          .at(-1) ?? null,
      stationElevationRange: [Math.min(...elevations), Math.max(...elevations)],
      validation: { maeCm: validation.maeCm, byBand: validation.byBand },
      stats: estimate.stats,
    };
    opts.log(
      `snow depth: ${stations.length} stations, method ${validation.chosen}, ` +
        `LOO MAE trend ${validation.maeCm.trend.toFixed(1)} cm / with residuals ${validation.maeCm['trend+residuals'].toFixed(1)} cm`,
    );
  } else {
    opts.log(`snow depth: only ${stations.length} stations with snow readings, estimate skipped`);
  }

  const file: SnowFile = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: opts.now,
    grid,
    cover:
      'grid' in cover
        ? {
            available: true,
            date: cover.product.date,
            sensor: cover.product.sensor,
            product: cover.product.name,
            fetchedAt: cover.fetchedAt,
            stats: cover.grid.stats,
            snowLineM: snowLine(cover.grid.values, dem.values),
            source: 'https://land.copernicus.eu/en/products/snow/snow-cover-extent-europe-v1-0-500m',
            licence: 'Copernicus data policy (free, full and open access)',
            attribution: 'Copernicus Land Monitoring Service, Snow Cover Extent Europe 500 m (European Union)',
          }
        : { available: false, reason: cover.reason },
    depth,
    files,
  };
  await writeFile(jsonPath, JSON.stringify(file));
  return file;
}
