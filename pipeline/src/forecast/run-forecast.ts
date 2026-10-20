// Forecast step of the pipeline: fetches the Open-Meteo grid at most every REFRESH_HOURS (each
// point counts as one call against the free limits, which runner IPs share), keeps the raw answer
// in the state folder, and re-renders the frames on every run so the animation starts "now".

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MODEL_GRID } from '../../../shared/grid.ts';
import { type ForecastFile, SCHEMA_VERSION } from '../../../shared/types.ts';
import type { ElevationGrid } from '../dem.ts';
import { accumulateFrames, forecastGridUrl, forecastPoints, newSnowRgba, parseForecastGrid, type RawForecast } from './snowfall.ts';

export const FORECAST_FIXTURE = 'fixtures/open-meteo/forecast-grid-72h.json';
const REFRESH_HOURS = 6;
const FETCH_HOURS = 78;
const STEP_HOURS = 3;
const MAX_HOURS = 72;
/** A cached forecast is still worth animating while it reaches this far ahead. */
const MIN_AHEAD_HOURS = 12;
const SOURCE = 'https://open-meteo.com/';
const ATTRIBUTION = 'Weather data by Open-Meteo.com (CC BY 4.0), best-match model blend; snow share from the terrain by this app';

export interface ForecastStepOptions {
  outDir: string;
  stateDir: string;
  now: string;
  /** Path of the fixture response to use instead of the network, if any. */
  fixture: string | null;
  dem: ElevationGrid;
  log: (msg: string) => void;
}

interface Cached extends RawForecast {
  fetchedAt: string;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function fetchGrid(): Promise<unknown> {
  const points = forecastPoints();
  const res = await fetch(forecastGridUrl(points, FETCH_HOURS), {
    signal: AbortSignal.timeout(60_000),
    headers: { 'user-agent': 'tirol-snow-map pipeline (+https://github.com/adamvalik/tirol-snow-map)' },
  });
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      reason += `: ${((await res.json()) as { reason?: string }).reason ?? ''}`;
    } catch {
      // keep the status
    }
    throw new Error(`Open-Meteo forecast grid: ${reason}`);
  }
  return res.json();
}

export async function runForecastStep(opts: ForecastStepOptions): Promise<{ file: ForecastFile; problems: string[] }> {
  const jsonPath = path.join(opts.outDir, 'forecast.json');
  const framesDir = path.join(opts.outDir, 'forecast');
  const cachePath = path.join(opts.stateDir, 'forecast-grid.json');
  const problems: string[] = [];
  const points = forecastPoints();

  let raw = await readJson<Cached>(cachePath);
  let fetchError: string | null = null;
  if (opts.fixture) {
    raw = { ...parseForecastGrid(await readJson(opts.fixture), points.length), fetchedAt: opts.now };
  } else if (!raw || Date.parse(opts.now) - Date.parse(raw.fetchedAt) >= REFRESH_HOURS * 3_600_000) {
    try {
      raw = { ...parseForecastGrid(await fetchGrid(), points.length), fetchedAt: opts.now };
      await mkdir(opts.stateDir, { recursive: true });
      await writeFile(cachePath, JSON.stringify(raw));
      opts.log(`forecast: fetched ${points.length} points, ${raw.times.length} hours`);
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
      problems.push(fetchError);
      opts.log(`forecast: ${fetchError}${raw ? `; using the forecast fetched ${raw.fetchedAt}` : ''}`);
    }
  } else {
    opts.log(`forecast: reusing the grid fetched ${raw.fetchedAt}`);
  }

  const unavailable = async (reason: string) => {
    const file: ForecastFile = { schemaVersion: SCHEMA_VERSION, generatedAt: opts.now, available: false, reason, source: SOURCE, attribution: ATTRIBUTION };
    await writeFile(jsonPath, JSON.stringify(file));
    return { file, problems };
  };
  if (!raw) return unavailable(fetchError ?? 'No forecast fetched yet');
  const lastMs = Date.parse(raw.times.at(-1)!);
  if (lastMs - Date.parse(opts.now) < MIN_AHEAD_HOURS * 3_600_000) {
    return unavailable(`The last forecast (fetched ${raw.fetchedAt}) has run out${fetchError ? `; ${fetchError}` : ''}`);
  }

  const { start, frames, freezingLevelM } = accumulateFrames(MODEL_GRID, opts.dem.values, raw, {
    now: opts.now,
    stepHours: STEP_HOURS,
    maxHours: MAX_HOURS,
  });
  await mkdir(framesDir, { recursive: true });
  const written = new Set<string>();
  const list: NonNullable<ForecastFile['frames']> = [];
  for (const [k, f] of frames.entries()) {
    const name = `f${String(k).padStart(2, '0')}.png`;
    const png = await sharp(newSnowRgba(f.snowCm), { raw: { width: MODEL_GRID.width, height: MODEL_GRID.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(path.join(framesDir, name), png);
    written.add(name);
    let max = 0;
    for (const v of f.snowCm) if (v > max) max = v;
    list.push({ time: f.time, file: `forecast/${name}`, maxCm: Math.round(max) });
  }
  for (const f of await readdir(framesDir)) if (!written.has(f)) await rm(path.join(framesDir, f));

  const file: ForecastFile = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: opts.now,
    available: list.length > 0,
    ...(list.length ? {} : { reason: 'The forecast has no hours after now' }),
    fetchedAt: raw.fetchedAt,
    stale: fetchError !== null,
    ...(fetchError ? { error: fetchError } : {}),
    start,
    stepHours: STEP_HOURS,
    frames: list,
    points: points.length,
    freezingLevelM,
    source: SOURCE,
    attribution: ATTRIBUTION,
  };
  await writeFile(jsonPath, JSON.stringify(file));
  opts.log(
    `forecast: ${list.length} frames from ${start}, new snow up to ${list.at(-1)?.maxCm ?? 0} cm, freezing level ${freezingLevelM[0]}–${freezingLevelM[1]} m`,
  );
  return { file, problems };
}
