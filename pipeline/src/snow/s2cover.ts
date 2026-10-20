// Sentinel-2 snow map: classifies each clear pass day of the last WINDOW_DAYS on a fine grid
// (MODEL_GRID × FINE, about 60 m), keeps the classified days on disk so each day costs processing
// units only once, and combines them per pixel into a "last clear view" composite. The composite
// is drawn as white snow in the app and, summed into the 250 m model cells, masks the depth estimate.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { type GridSpec, MODEL_GRID } from '../../../shared/grid.ts';
import { chooseDay, getClientToken, searchScenes } from '../sources/sentinel2.ts';
import { classifyDay, S2_BARE, S2_CLOUD, S2_NODATA, S2_SNOW } from '../sources/sentinel2Snow.ts';
import { AGE_NONE } from '../sources/snowCover.ts';
import { COVER_CLOUD, COVER_NODATA } from './model.ts';

/** Fine pixels per model cell along each axis: 250 m / 4 ≈ 62 m. */
export const FINE = 4;
export const FINE_GRID: GridSpec = { ...MODEL_GRID, width: MODEL_GRID.width * FINE, height: MODEL_GRID.height * FINE };
/** Pass days combined; older views are too stale to say much about snow. */
export const WINDOW_DAYS = 10;
/** Days whose passes are expected to show less than this share of the region clear are skipped. */
const MIN_CLEAR_SHARE = 0.05;
/** A model cell needs this many clear fine pixels (of FINE²) to get a cover value. */
const MIN_CLEAR_PIXELS = 4;

export interface S2Day {
  date: string;
  scenes: string[];
  clearShare: number;
}

export interface S2Composite {
  /** Newest pass day used, YYYY-MM-DD. */
  date: string;
  days: S2Day[];
  /** Fine grid: S2_* class of the newest clear view per pixel. */
  cls: Uint8Array;
  /** Fine grid: days between that view and `date`; AGE_NONE without a clear view. */
  age: Uint8Array;
  /** Classes of each day used, newest first (for history snapshots of earlier days). */
  perDay: { date: string; cls: Uint8Array }[];
  /** Set when the catalogue could not be reached and only cached days were used. */
  error?: string;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

/** Per pixel, the newest day with a clear (bare or snow) view. `days` newest first. */
export function compositeDays(days: { cls: Uint8Array; ageDays: number }[]): { cls: Uint8Array; age: Uint8Array } {
  const n = days[0].cls.length;
  const cls = new Uint8Array(n);
  const age = new Uint8Array(n).fill(AGE_NONE);
  for (let i = 0; i < n; i++) {
    for (const d of days) {
      const c = d.cls[i];
      if (c === S2_BARE || c === S2_SNOW) {
        cls[i] = c;
        age[i] = d.ageDays;
        break;
      }
      if (c === S2_CLOUD) cls[i] = S2_CLOUD;
    }
  }
  return { cls, age };
}

/**
 * Model-grid cover in the Copernicus convention (0–100 % snow, COVER_CLOUD, COVER_NODATA), the
 * share of snow among the clear fine pixels of each cell, with the oldest view used as the cell age.
 */
export function aggregateToModel(c: { cls: Uint8Array; age: Uint8Array }, grid: GridSpec = MODEL_GRID, f = FINE) {
  const values = new Uint8Array(grid.width * grid.height);
  const age = new Uint8Array(grid.width * grid.height).fill(AGE_NONE);
  const fw = grid.width * f;
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      let clear = 0;
      let snow = 0;
      let cloud = 0;
      let oldest = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const j = (row * f + dy) * fw + col * f + dx;
          const k = c.cls[j];
          if (k === S2_BARE || k === S2_SNOW) {
            clear++;
            if (k === S2_SNOW) snow++;
            oldest = Math.max(oldest, c.age[j]);
          } else if (k === S2_CLOUD) cloud++;
        }
      }
      const i = row * grid.width + col;
      if (clear >= MIN_CLEAR_PIXELS) {
        values[i] = Math.round((100 * snow) / clear);
        age[i] = oldest;
      } else values[i] = cloud > 0 ? COVER_CLOUD : COVER_NODATA;
    }
  }
  return { values, age };
}

/** White where the newest clear view saw snow, fading slightly with the age of the view. */
export function snowWhiteRgba(c: { cls: Uint8Array; age: Uint8Array }): Uint8Array {
  const out = new Uint8Array(c.cls.length * 4);
  for (let i = 0; i < c.cls.length; i++) {
    if (c.cls[i] !== S2_SNOW) continue;
    const alpha = 245 - Math.min(c.age[i], WINDOW_DAYS) * 9;
    out.set([255, 255, 255, alpha], i * 4);
  }
  return out;
}

export function snowWhitePng(c: { cls: Uint8Array; age: Uint8Array }, grid: GridSpec = FINE_GRID): Promise<Buffer> {
  return sharp(snowWhiteRgba(c), { raw: { width: grid.width, height: grid.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export function s2Stats(c: { cls: Uint8Array; age: Uint8Array }) {
  const s = { snow: 0, bare: 0, olderView: 0, cloud: 0, nodata: 0 };
  for (let i = 0; i < c.cls.length; i++) {
    const k = c.cls[i];
    if (k === S2_NODATA) s.nodata++;
    else if (k === S2_CLOUD) s.cloud++;
    else if (c.age[i] > 0) s.olderView++;
    else if (k === S2_SNOW) s.snow++;
    else s.bare++;
  }
  return s;
}

interface CacheIndex {
  /** Older caches stored only the scene list. */
  [date: string]: { scenes: string[]; clearShare: number } | string[];
}

const indexScenes = (e: CacheIndex[string] | undefined) => (Array.isArray(e) ? e : e?.scenes);

/**
 * Classifies new pass days (cached in `cacheDir`) and returns the composite, or a reason. Needs
 * CDSE_CLIENT_ID / CDSE_CLIENT_SECRET.
 */
export async function loadS2Composite(opts: { cacheDir: string; now: string; log: (m: string) => void }): Promise<S2Composite | { reason: string }> {
  const id = process.env.CDSE_CLIENT_ID;
  const secret = process.env.CDSE_CLIENT_SECRET;
  if (!id || !secret) return { reason: 'No Sentinel Hub OAuth client configured (CDSE_CLIENT_ID, CDSE_CLIENT_SECRET)' };
  const bbox = { west: FINE_GRID.west, south: FINE_GRID.south, east: FINE_GRID.east, north: FINE_GRID.north };
  await mkdir(opts.cacheDir, { recursive: true });
  const indexPath = path.join(opts.cacheDir, 'index.json');
  let index: CacheIndex = {};
  try {
    index = JSON.parse(await readFile(indexPath, 'utf8')) as CacheIndex;
  } catch {
    // no cache yet
  }

  let token: string | null = null;
  let days: S2Day[];
  let error: string | undefined;
  try {
    token = await getClientToken(id, secret);
    const { days: scored } = chooseDay(await searchScenes(token, bbox, WINDOW_DAYS, opts.now), bbox);
    days = scored
      .filter((d) => d.clearShare >= MIN_CLEAR_SHARE)
      .map((d) => ({ date: d.date, scenes: [...d.scenes].sort(), clearShare: d.clearShare }));
  } catch (e) {
    // Catalogue or login unreachable: the days classified earlier still give a (staler) snow map.
    error = e instanceof Error ? e.message : String(e);
    const cutoff = new Date(Date.parse(opts.now) - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    days = Object.entries(index)
      .filter(([date]) => date >= cutoff)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, e]) => ({ date, scenes: indexScenes(e) ?? [], clearShare: Array.isArray(e) ? 0 : e.clearShare }));
    if (!days.length) throw e;
    opts.log(`snow (Sentinel-2): ${error}; using ${days.length} cached pass days`);
  }
  if (!days.length) return { reason: `No Sentinel-2 pass with clear sky in the last ${WINDOW_DAYS} days` };

  const file = (date: string) => path.join(opts.cacheDir, `${date}.png`);
  const loaded: { date: string; cls: Uint8Array }[] = [];
  for (const d of days) {
    let cls: Uint8Array | null = null;
    // A day is re-classified when more of its scenes have been published since.
    if (indexScenes(index[d.date])?.join() === d.scenes.join()) {
      try {
        const { data, info } = await sharp(await readFile(file(d.date))).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
        if (info.width === FINE_GRID.width && info.height === FINE_GRID.height) cls = new Uint8Array(data);
      } catch {
        // cache file missing or broken
      }
    }
    if (!cls && !token) continue;
    if (!cls) {
      const t0 = Date.now();
      cls = await classifyDay(token!, d.date, FINE_GRID);
      await writeFile(
        file(d.date),
        await sharp(Buffer.from(cls), { raw: { width: FINE_GRID.width, height: FINE_GRID.height, channels: 1 } }).png({ compressionLevel: 9 }).toBuffer(),
      );
      index[d.date] = { scenes: d.scenes, clearShare: d.clearShare };
      const counts = [0, 0, 0, 0];
      for (const k of cls) counts[k]++;
      opts.log(
        `snow (Sentinel-2): classified ${d.date} in ${((Date.now() - t0) / 1000).toFixed(0)} s: ` +
          `snow ${counts[S2_SNOW]}, bare ${counts[S2_BARE]}, cloud ${counts[S2_CLOUD]}, no data ${counts[S2_NODATA]}`,
      );
    }
    loaded.push({ date: d.date, cls });
  }
  if (!loaded.length) throw new Error(error ?? 'No Sentinel-2 day could be loaded');

  // Forget days that left the window (only after a successful search; offline, keep everything).
  const keep = new Set(error ? Object.keys(index) : days.map((d) => d.date));
  for (const date of Object.keys(index)) if (!keep.has(date)) delete index[date];
  for (const f of await readdir(opts.cacheDir)) {
    if (f.endsWith('.png') && !keep.has(f.slice(0, -4))) await rm(path.join(opts.cacheDir, f));
  }
  await writeFile(indexPath, JSON.stringify(index));

  const used = days.filter((d) => loaded.some((l) => l.date === d.date));
  const { cls, age } = compositeDays(loaded.map((l) => ({ cls: l.cls, ageDays: daysBetween(loaded[0].date, l.date) })));
  return { date: loaded[0].date, days: used, cls, age, perDay: loaded.map((l) => ({ date: l.date, cls: l.cls })), ...(error ? { error } : {}) };
}

/**
 * The composite as it stood on `date`: the pass days up to then, aged relative to it. Used to
 * rebuild time slider days from the cache.
 */
export function compositeAsOf(perDay: S2Composite['perDay'], date: string): { cls: Uint8Array; age: Uint8Array } | null {
  const days = perDay.filter((d) => d.date <= date && daysBetween(date, d.date) < WINDOW_DAYS);
  if (!days.length) return null;
  return compositeDays(days.map((d) => ({ cls: d.cls, ageDays: daysBetween(date, d.date) })));
}
