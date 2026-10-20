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
import { aggregateToModel, loadS2Composite, type S2Composite, s2Stats, snowWhitePng } from './s2cover.ts';
import { toModelStations } from './stations.ts';

const COVER_CACHE = 'snow-cover-grid.bin';
/** Older products are not shown as current snow cover. */
const MAX_COVER_AGE_DAYS = 7;
/** Days combined into the "last clear view" composite. */
const COMPOSITE_DAYS = 4;
/** Sentinel-2 passes come every 2–5 days, so its views mask the depth estimate for longer. */
const S2_MASK_DAYS = 6;

export interface SnowStepOptions {
  outDir: string;
  now: string;
  stations: Station[];
  /** Skip network access (fixture runs). */
  offline: boolean;
  log: (msg: string) => void;
}

interface Cover {
  sensor: 'Sentinel-2' | 'Copernicus';
  /** Newest observation day and the days combined, newest first. */
  date: string;
  composite: { date: string; sensor: 'Sentinel-2' | 'VIIRS' | 'MODIS'; product: string }[];
  /** Model-grid cover in the Copernicus convention. */
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
        return { ...copernicusMeta(products), values: buf.slice(0, cells), age: buf.slice(cells), fetchedAt: previous.cover.fetchedAt };
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
  return { ...copernicusMeta(products), values, age, fetchedAt: opts.now };
}

function copernicusMeta(products: SceProduct[]) {
  return {
    sensor: 'Copernicus' as const,
    date: products[0].date,
    composite: products.map((p) => ({ date: p.date, sensor: p.sensor, product: p.name })),
  };
}

/** Sentinel-2 snow map; null (with the reason logged) when it cannot be built. */
async function loadS2(opts: SnowStepOptions): Promise<{ cover: Cover; s2: S2Composite } | { reason: string }> {
  if (opts.offline) return { reason: 'Offline run (fixtures): no satellite data' };
  const s2 = await loadS2Composite({ cacheDir: path.join(opts.outDir, '.cache', 's2-snow'), now: opts.now, log: opts.log });
  if ('reason' in s2) return s2;
  const { values, age } = aggregateToModel(s2);
  return {
    s2,
    cover: {
      sensor: 'Sentinel-2',
      date: s2.date,
      composite: s2.days.map((d) => ({ date: d.date, sensor: 'Sentinel-2' as const, product: d.scenes.join(', ') })),
      values,
      age,
      fetchedAt: opts.now,
    },
  };
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

function shares(s: { snow: number; bare: number; olderView: number; cloud: number }) {
  const total = s.snow + s.bare + s.olderView + s.cloud || 1;
  return { newest: (s.snow + s.bare) / total, older: s.olderView / total, never: s.cloud / total };
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

  // Sentinel-2 first (about 60 m, sees the snow line); the Copernicus 500 m product only as a fallback.
  let cover: CoverResult;
  let s2: S2Composite | null = null;
  const reasons: string[] = [];
  try {
    const r = await loadS2(opts);
    if ('reason' in r) reasons.push(`Sentinel-2: ${r.reason}`);
    else ({ cover, s2 } = r);
  } catch (e) {
    reasons.push(`Sentinel-2 snow map failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!s2) {
    try {
      cover = await loadCover(opts, previous);
    } catch (e) {
      cover = { reason: `Snow cover fetch failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if ('reason' in cover) {
      reasons.push(`Copernicus 500 m: ${cover.reason}`);
      cover = { reason: [...new Set(reasons)].join('; ') };
    }
  }
  cover ??= { reason: 'unknown' };
  const coverOk = 'values' in cover ? cover : null;
  // Older views still show on the cover layer but do not mask the depth estimate.
  const masking = coverOk ? maskingCover(coverOk.values, coverOk.age, s2 ? S2_MASK_DAYS : 1) : null;
  if ('reason' in cover) opts.log(`snow cover: ${cover.reason}`);

  const stations = toModelStations(opts.stations);
  const files: SnowFile['files'] = { white: null, cover: null, depth: null, confidence: null, data: null };
  const write = async (name: keyof SnowFile['files'], rgba: Uint8Array) => {
    const file = `snow-${name}.png`;
    await writeFile(path.join(opts.outDir, file), await encodePng(grid, rgba));
    files[name] = file;
  };

  if (coverOk) await write('cover', coverRgba(grid, coverOk.values, coverOk.age));
  if (s2 && coverOk) {
    // Snow share of the clear cells per elevation band, to sanity-check the classification in logs.
    const bands = new Map<number, [number, number]>();
    coverOk.values.forEach((v, i) => {
      if (v > 100) return;
      const b = Math.floor(dem.values[i] / 500) * 500;
      const t = bands.get(b) ?? [0, 0];
      bands.set(b, [t[0] + 1, t[1] + v / 100]);
    });
    opts.log(
      `snow (Sentinel-2): newest pass ${s2.date}, days ${s2.days.map((d) => `${d.date} (${Math.round(d.clearShare * 100)}% clear)`).join(', ')}; ` +
        `snow share of clear ground by elevation: ${[...bands.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([b, [n, snow]]) => `${b}–${b + 500} m ${((100 * snow) / n).toFixed(1)}% (${n} cells)`)
          .join(', ')}`,
    );
    await writeFile(path.join(opts.outDir, 'snow-white.png'), await snowWhitePng(s2));
    files.white = 'snow-white.png';
  }

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
            date: coverOk.date,
            sensor: coverOk.composite[0].sensor,
            product: coverOk.composite[0].product,
            fetchedAt: coverOk.fetchedAt,
            resolutionM: s2 ? 60 : 500,
            stats: coverStats(coverOk),
            shares: shares(s2 ? s2Stats(s2) : coverStats(coverOk)),
            composite: coverOk.composite,
            snowLineM: snowLine(masking!, dem.values),
            ...(s2
              ? {
                  source: 'https://dataspace.copernicus.eu/explore-data/data-collections/sentinel-data/sentinel-2',
                  licence: 'Copernicus data policy (free, full and open access)',
                  attribution: 'Contains modified Copernicus Sentinel data, processed by Sentinel Hub (Copernicus Data Space Ecosystem); snow detection by this app',
                }
              : {
                  source: 'https://land.copernicus.eu/en/products/snow/snow-cover-extent-europe-v1-0-500m',
                  licence: 'Copernicus data policy (free, full and open access)',
                  attribution: 'Copernicus Land Monitoring Service, Snow Cover Extent Europe 500 m (European Union)',
                }),
          }
        : { available: false, reason: 'reason' in cover ? cover.reason : 'unknown' },
    depth,
    files,
  };
  await writeFile(jsonPath, JSON.stringify(file));
  return file;
}
