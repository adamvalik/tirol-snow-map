// Snow step of the pipeline: satellite snow cover (if credentials are set) plus the station-based
// depth estimate on the model grid. Writes snow.json and the layer PNGs next to stations.json.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_GRID } from '../../../shared/grid.ts';
import { SCHEMA_VERSION, type SnowFile, type Station } from '../../../shared/types.ts';
import { loadDemGrid } from '../dem.ts';
import {
  compositeCover,
  decodeToGrid,
  downloadProduct,
  extractTiff,
  getToken,
  maskingCover,
  type SceProduct,
  searchAllProducts,
} from '../sources/snowCover.ts';
import { COVER_NODATA, estimateGrid, fit, leaveOneOut } from './model.ts';
import { confidenceRgba, coverRgba, dataRgba, depthRgba, encodePng, snowLine } from './render.ts';
import { toModelStations } from './stations.ts';

const COVER_CACHE = 'snow-cover-grid.bin';
/** Older products are not shown as current snow cover. */
const MAX_COVER_AGE_DAYS = 7;
/** Days combined into the "last clear view" composite. */
const COMPOSITE_DAYS = 4;

export interface SnowStepOptions {
  outDir: string;
  now: string;
  stations: Station[];
  /** Skip network access (fixture runs). */
  offline: boolean;
  log: (msg: string) => void;
}

interface Cover {
  products: SceProduct[];
  values: Uint8Array;
  /** Days between each cell's view and the newest product; AGE_NONE without any clear view. */
  age: Uint8Array;
  fetchedAt: string;
}
type CoverResult = Cover | { reason: string };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

async function loadCover(opts: SnowStepOptions, previous: SnowFile | null): Promise<CoverResult> {
  if (opts.offline) return { reason: 'Offline run (fixtures): no satellite data' };
  const user = process.env.CDSE_USERNAME;
  const pass = process.env.CDSE_PASSWORD;
  if (!user || !pass) return { reason: 'No Copernicus credentials configured (CDSE_USERNAME, CDSE_PASSWORD)' };

  const all = await searchAllProducts();
  const newest = all[0];
  if (!newest) return { reason: 'No snow cover product found in the catalogue' };
  const ageDays = (Date.parse(opts.now) - Date.parse(`${newest.date}T12:00:00Z`)) / 86_400_000;
  if (ageDays > MAX_COVER_AGE_DAYS) return { reason: `Newest snow cover product is from ${newest.date}, too old to show` };
  const products = all.filter((p) => daysBetween(newest.date, p.date) < COMPOSITE_DAYS);

  // Products change about twice a day; reuse the decoded composite while the set is the same.
  const cells = MODEL_GRID.width * MODEL_GRID.height;
  const cachePath = path.join(opts.outDir, COVER_CACHE);
  const sameSet =
    previous?.cover.available &&
    previous.cover.composite.map((c) => c.product).join() === products.map((p) => p.name).join();
  if (sameSet && previous.cover.available) {
    try {
      const buf = new Uint8Array(await readFile(cachePath));
      if (buf.length === cells * 2) {
        opts.log(`snow cover: reusing composite of ${products.length} products`);
        return { products, values: buf.slice(0, cells), age: buf.slice(cells), fetchedAt: previous.cover.fetchedAt };
      }
    } catch {
      // cache missing: download again
    }
  }

  const token = await getToken(user, pass);
  const days: { values: Uint8Array; ageDays: number }[] = [];
  for (const p of products) {
    const download = await downloadProduct(p.id, token);
    const { tiff } = extractTiff(download);
    const g = await decodeToGrid(tiff, MODEL_GRID);
    days.push({ values: g.values, ageDays: daysBetween(newest.date, p.date) });
    opts.log(
      `snow cover: ${p.name} (${(download.byteLength / 1e6).toFixed(1)} MB): ` +
        `snow ${g.stats.snow}, bare ${g.stats.bare}, no clear view ${g.stats.cloud}, no data ${g.stats.nodata}`,
    );
  }
  const { values, age } = compositeCover(days);
  const merged = new Uint8Array(cells * 2);
  merged.set(values);
  merged.set(age, cells);
  await writeFile(cachePath, merged);
  return { products, values, age, fetchedAt: opts.now };
}

function coverStats(c: Cover): Extract<SnowFile['cover'], { available: true }>['stats'] {
  const s = { snow: 0, bare: 0, olderView: 0, cloud: 0, nodata: 0 };
  for (let i = 0; i < c.values.length; i++) {
    const v = c.values[i];
    if (v === COVER_NODATA) s.nodata++;
    else if (v > 100) s.cloud++;
    else if (c.age[i] > 0) s.olderView++;
    else if (v >= 15) s.snow++;
    else s.bare++;
  }
  return s;
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
  const coverOk = 'values' in cover ? cover : null;
  // Views older than a day still show on the cover layer but do not mask the depth estimate.
  const masking = coverOk ? maskingCover(coverOk.values, coverOk.age) : null;
  if ('reason' in cover) opts.log(`snow cover: ${cover.reason}`);

  const stations = toModelStations(opts.stations);
  const files: SnowFile['files'] = { cover: null, depth: null, confidence: null, data: null };
  const write = async (name: keyof SnowFile['files'], rgba: Uint8Array) => {
    const file = `snow-${name}.png`;
    await writeFile(path.join(opts.outDir, file), await encodePng(grid, rgba));
    files[name] = file;
  };

  if (coverOk) await write('cover', coverRgba(grid, coverOk.values, coverOk.age));

  let depth: SnowFile['depth'] = null;
  if (stations.length >= 10) {
    const validation = leaveOneOut(stations);
    const fitted = fit(stations, validation.chosen);
    const estimate = estimateGrid(grid, dem.values, fitted, masking);
    await write('depth', depthRgba(grid, estimate.depthCm));
    await write('confidence', confidenceRgba(grid, estimate.confidence));
    await write('data', dataRgba(grid, estimate.depthCm, estimate.confidence, coverOk?.values ?? null, coverOk?.age ?? null));
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
      coverOk
        ? {
            available: true,
            date: coverOk.products[0].date,
            sensor: coverOk.products[0].sensor,
            product: coverOk.products[0].name,
            fetchedAt: coverOk.fetchedAt,
            stats: coverStats(coverOk),
            composite: coverOk.products.map((p) => ({ date: p.date, sensor: p.sensor, product: p.name })),
            snowLineM: snowLine(masking!, dem.values),
            source: 'https://land.copernicus.eu/en/products/snow/snow-cover-extent-europe-v1-0-500m',
            licence: 'Copernicus data policy (free, full and open access)',
            attribution: 'Copernicus Land Monitoring Service, Snow Cover Extent Europe 500 m (European Union)',
          }
        : { available: false, reason: 'reason' in cover ? cover.reason : 'unknown' },
    depth,
    files,
  };
  await writeFile(jsonPath, JSON.stringify(file));
  return file;
}
