// Daily snapshots for the app's time slider: each run copies the snow layers and station readings
// into data/history/<local day>/ (the day's last run wins) and keeps HISTORY_DAYS days.

import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type HistoryDay, type HistoryFile, type ModelErrorDay, type ModelErrorFile, SCHEMA_VERSION, type SnowFile } from '../../shared/types.ts';
import type { BackfillDay } from './snow/run-snow.ts';

export const HISTORY_DAYS = 14;
/** The model error log is small, so it keeps more than a winter. */
export const MODEL_ERROR_DAYS = 400;

/** Local calendar day in South Tyrol, YYYY-MM-DD. */
export const romeDate = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(iso));

/** YYYY-MM-DD `n` days before `day`. */
export function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function readHistory(outDir: string): Promise<HistoryFile | null> {
  try {
    const h = JSON.parse(await readFile(path.join(outDir, 'history.json'), 'utf8')) as HistoryFile;
    return h.schemaVersion === SCHEMA_VERSION ? h : null;
  } catch {
    return null;
  }
}

/** snow.json with its files pointing into `dir` (paths relative to data/). */
function relocate(snow: SnowFile, dir: string): SnowFile {
  const files = Object.fromEntries(Object.entries(snow.files).map(([k, v]) => [k, v ? `${dir}/${v}` : null])) as SnowFile['files'];
  return { ...snow, files };
}

function entry(date: string, dir: string, snow: SnowFile, stations: boolean, backfilled: boolean): HistoryDay {
  return {
    date,
    snow: `${dir}/snow.json`,
    stations: stations ? `${dir}/stations.json` : null,
    backfilled,
    coverDate: snow.cover.available ? snow.cover.date : null,
    snowLineM: snow.cover.available ? snow.cover.snowLineM : null,
  };
}

export async function updateHistory(opts: {
  outDir: string;
  now: string;
  /** This run's snow.json, or null when the snow step failed (today's earlier snapshot stays). */
  snow: SnowFile | null;
  backfill: BackfillDay[];
  log: (msg: string) => void;
}): Promise<HistoryFile> {
  const today = romeDate(opts.now);
  const days = new Map((await readHistory(opts.outDir))?.days.map((d) => [d.date, d]) ?? []);

  if (opts.snow) {
    const dir = `history/${today}`;
    const abs = path.join(opts.outDir, dir);
    await rm(abs, { recursive: true, force: true });
    await mkdir(abs, { recursive: true });
    for (const name of Object.values(opts.snow.files)) if (name) await copyFile(path.join(opts.outDir, name), path.join(abs, name));
    await copyFile(path.join(opts.outDir, 'stations.json'), path.join(abs, 'stations.json'));
    await writeFile(path.join(abs, 'snow.json'), JSON.stringify(relocate(opts.snow, dir)));
    days.set(today, entry(today, dir, opts.snow, true, false));
  }
  for (const b of opts.backfill) {
    if (days.has(b.date)) continue;
    const dir = `history/${b.date}`;
    const abs = path.join(opts.outDir, dir);
    await mkdir(abs, { recursive: true });
    for (const [name, png] of Object.entries(b.pngs)) await writeFile(path.join(abs, name), png);
    await writeFile(path.join(abs, 'snow.json'), JSON.stringify(relocate(b.meta, dir)));
    days.set(b.date, entry(b.date, dir, b.meta, false, true));
  }

  const oldest = daysBefore(today, HISTORY_DAYS - 1);
  for (const date of days.keys()) if (date < oldest || date > today) days.delete(date);
  try {
    for (const name of await readdir(path.join(opts.outDir, 'history'))) {
      if (!days.has(name)) await rm(path.join(opts.outDir, 'history', name), { recursive: true, force: true });
    }
  } catch {
    // no history folder yet
  }

  const file: HistoryFile = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: opts.now,
    days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };
  await writeFile(path.join(opts.outDir, 'history.json'), JSON.stringify(file));
  opts.log(`history: ${file.days.length} days (${file.days.at(-1)?.date ?? '–'} to ${file.days[0]?.date ?? '–'})`);
  return file;
}

/**
 * Adds the day's leave-one-out error of the depth estimate to model-error.json (the day's last run
 * wins), so a season shows whether the estimate holds. Runs without a depth estimate add nothing.
 */
export async function updateModelError(opts: { outDir: string; now: string; snow: SnowFile | null; log: (msg: string) => void }): Promise<ModelErrorFile> {
  const file = path.join(opts.outDir, 'model-error.json');
  let days: ModelErrorDay[] = [];
  try {
    const prev = JSON.parse(await readFile(file, 'utf8')) as ModelErrorFile;
    if (prev.schemaVersion === SCHEMA_VERSION) days = prev.days;
  } catch {
    // first run
  }
  const today = romeDate(opts.now);
  const depth = opts.snow?.depth;
  if (depth) {
    const day: ModelErrorDay = {
      date: today,
      method: depth.method,
      maeCm: Math.round(depth.validation.maeCm[depth.method] * 10) / 10,
      maeByMethodCm: {
        trend: Math.round(depth.validation.maeCm.trend * 10) / 10,
        'trend+residuals': Math.round(depth.validation.maeCm['trend+residuals'] * 10) / 10,
      },
      stationCount: depth.stationCount,
      byBand: depth.validation.byBand.map((b) => ({ ...b, maeCm: Math.round(b.maeCm * 10) / 10 })),
    };
    days = [day, ...days.filter((d) => d.date !== today)];
  }
  const oldest = daysBefore(today, MODEL_ERROR_DAYS - 1);
  days = days.filter((d) => d.date >= oldest && d.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const out: ModelErrorFile = { schemaVersion: SCHEMA_VERSION, generatedAt: opts.now, days };
  await writeFile(file, JSON.stringify(out));
  if (depth) opts.log(`model error: ${days[0].maeCm} cm (${depth.method}) on ${today}, ${days.length} days logged`);
  return out;
}
