// Scheduled pipeline entry point: fetch upstream data, normalise, write static files for the web app.
//
//   npm run pipeline             live fetch
//   npm run pipeline:fixtures    build from fixtures/ (offline, deterministic)
//   --out <dir>                  output directory, published with the app (default web/public/data)
//   --state <dir>                caches that are kept between runs but not published (default data/state)
//   --now <iso>                  reference time for staleness checks
//
// Exit code 2 means some upstream failed; the files then carry the last good data, flagged stale.

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION, type SourceStatus, type StationsFile, type StepId } from '../../shared/types.ts';
import { FIXTURES, STATION_BBOX, URLS } from './config.ts';
import { loadDemGrid } from './dem.ts';
import { FORECAST_FIXTURE, runForecastStep } from './forecast/run-forecast.ts';
import { readHistory, romeDate, updateHistory } from './history.ts';
import { mergeStations } from './merge.ts';
import type { RawStation } from './raw.ts';
import { parseLinea } from './sources/linea.ts';
import { runSatelliteStep } from './satellite/run-satellite.ts';
import { runSnowStep } from './snow/run-snow.ts';
import { parseProvince } from './sources/provinceBz.ts';
import { writeStatus } from './status.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Readings older than this are left out rather than shown as current. */
const MAX_AGE_HOURS = 24;
/** Reference time for fixture runs: shortly after the fixtures were captured. */
const FIXTURE_NOW = '2026-10-20T12:30:00Z';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const useFixtures = process.argv.includes('--fixtures');
const outDir = path.resolve(ROOT, arg('--out') ?? 'web/public/data');
const stateDir = path.resolve(ROOT, arg('--state') ?? 'data/state');
const now = arg('--now') ?? (useFixtures ? FIXTURE_NOW : new Date().toISOString());

async function getJson<T>(key: keyof typeof URLS): Promise<T> {
  if (useFixtures) return JSON.parse(await readFile(path.join(ROOT, FIXTURES[key]), 'utf8')) as T;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    try {
      const res = await fetch(URLS[key], {
        signal: AbortSignal.timeout(30_000),
        headers: { 'user-agent': 'tirol-snow-map pipeline (+https://github.com/adamvalik/tirol-snow-map)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`${URLS[key]}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

interface SourceDef {
  status: Omit<SourceStatus, 'fetchedAt' | 'ok' | 'error' | 'stationCount'>;
  load: () => Promise<RawStation[]>;
}

const SOURCES: SourceDef[] = [
  {
    status: {
      id: 'province-bz',
      name: 'Weather service of the Autonomous Province of Bolzano - South Tyrol',
      url: 'https://data.civis.bz.it/dataset/misure-meteo-e-idrografiche',
      licence: 'CC0 1.0',
      attribution: 'Autonomous Province of Bolzano - South Tyrol, weather service',
    },
    load: async () => {
      const opts = { now, maxAgeHours: MAX_AGE_HOURS, bbox: STATION_BBOX };
      const [stations, sensors] = await Promise.all([
        getJson<Parameters<typeof parseProvince>[0]>('provinceStations'),
        getJson<Parameters<typeof parseProvince>[1]>('provinceSensors'),
      ]);
      return parseProvince(stations, sensors, opts);
    },
  },
  {
    status: {
      id: 'euregio-linea',
      name: 'Euregio avalanche warning services station network (avalanche.report)',
      url: 'https://avalanche.report/weather/stations',
      licence: 'Per operator; LWD Tirol, GeoSphere Austria, ARPAV and SLF data are CC BY 4.0',
      attribution:
        'Avalanche warning services Tirol, South Tyrol, Trentino and partner station operators, via avalanche.report',
    },
    load: async () =>
      parseLinea(await getJson<Parameters<typeof parseLinea>[0]>('linea'), {
        now,
        maxAgeHours: MAX_AGE_HOURS,
        bbox: STATION_BBOX,
      }),
  },
];

async function readPrevious(file: string): Promise<StationsFile | null> {
  try {
    const prev = JSON.parse(await readFile(file, 'utf8')) as StationsFile;
    return prev.schemaVersion === SCHEMA_VERSION ? prev : null;
  } catch {
    return null;
  }
}

/** Caches used to live inside the published folder; move them so a local run does not pay again. */
async function migrateState() {
  const moves: [string, string][] = [
    [path.join(outDir, '.cache', 's2-snow'), path.join(stateDir, 's2-snow')],
    [path.join(outDir, 'snow-cover-grid.bin'), path.join(stateDir, 'snow-cover-grid.bin')],
  ];
  for (const [from, to] of moves) {
    try {
      await stat(from);
      await mkdir(stateDir, { recursive: true });
      await rename(from, to);
      console.log(`[pipeline] moved ${path.relative(ROOT, from)} to ${path.relative(ROOT, to)}`);
    } catch {
      // nothing to move, or already moved
    }
  }
  await rm(path.join(outDir, '.cache'), { recursive: true, force: true });
}

async function main() {
  await migrateState();
  const outFile = path.join(outDir, 'stations.json');
  const previous = await readPrevious(outFile);

  const results = await Promise.all(
    SOURCES.map(async (s): Promise<{ status: SourceStatus; records: RawStation[] }> => {
      const prevStatus = previous?.sources.find((p) => p.id === s.status.id);
      try {
        const records = await s.load();
        return {
          status: { ...s.status, fetchedAt: now, ok: true, stationCount: records.length },
          records,
        };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[pipeline] ${s.status.id} failed: ${error}`);
        return {
          status: { ...s.status, fetchedAt: prevStatus?.fetchedAt ?? null, ok: false, error, stationCount: 0 },
          records: [],
        };
      }
    }),
  );

  const anyOk = results.some((r) => r.status.ok);
  let file: StationsFile;
  if (anyOk) {
    file = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: now,
      stale: false,
      sources: results.map((r) => r.status),
      stations: mergeStations(results.map((r) => r.records)),
    };
  } else if (previous) {
    // Every upstream failed: keep serving the last good stations, flagged as stale.
    file = { ...previous, stale: true, sources: results.map((r) => r.status) };
  } else {
    throw new Error('All station sources failed and there is no previous output to fall back on');
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(file));
  const withSnow = file.stations.filter((s) => s.snowDepthCm !== null).length;
  console.log(
    `[pipeline] wrote ${path.relative(ROOT, outFile)}: ${file.stations.length} stations (${withSnow} with snow depth)` +
      (file.stale ? ', STALE' : ''),
  );
  for (const r of results) console.log(`  ${r.status.id}: ${r.status.ok ? `${r.status.stationCount} records` : `FAILED ${r.status.error}`}`);

  const problems: Record<StepId, string[]> = { stations: [], snow: [], satellite: [], forecast: [] };
  for (const r of results) if (!r.status.ok) problems.stations.push(`${r.status.name}: ${r.status.error}`);
  const step = async (id: StepId, name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[pipeline] ${name} step failed: ${e instanceof Error ? e.stack : String(e)}`);
      problems[id].push(`${name} step failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const log = (msg: string) => console.log(`  ${msg}`);
  const dem = await loadDemGrid();

  // Snow cover and depth estimate, then the day's time slider snapshot. A failure here must not
  // take the station data down with it; the previous snow files stay in place.
  const today = romeDate(now);
  const historyDates = new Set([today, ...((await readHistory(outDir))?.days.map((d) => d.date) ?? [])]);
  let snowResult: Awaited<ReturnType<typeof runSnowStep>> | null = null;
  await step('snow', 'snow', async () => {
    const t0 = Date.now();
    snowResult = await runSnowStep({ outDir, stateDir, now, stations: file.stations, offline: useFixtures, historyDates, log });
    problems.snow.push(...snowResult.problems);
    const cover = snowResult.file.cover;
    console.log(`[pipeline] wrote snow.json in ${((Date.now() - t0) / 1000).toFixed(1)} s (cover ${cover.available ? cover.date : 'unavailable'})`);
  });
  await step('snow', 'history', async () => {
    const r = snowResult as Awaited<ReturnType<typeof runSnowStep>> | null;
    await updateHistory({ outDir, now, snow: r?.file ?? null, backfill: r?.backfill ?? [], log });
  });

  // Sentinel-2 picture: re-rendered only when a newer clear day appears.
  await step('satellite', 'satellite', async () => {
    const sat = await runSatelliteStep({ outDir, now, offline: useFixtures, log });
    console.log(`[pipeline] satellite.json: ${sat.available ? `picture of ${sat.date}` : `no picture (${sat.reason})`}`);
  });

  // Forecast snowfall frames for the animation.
  await step('forecast', 'forecast', async () => {
    const r = await runForecastStep({ outDir, stateDir, now, fixture: useFixtures ? path.join(ROOT, FORECAST_FIXTURE) : null, dem, log });
    problems.forecast.push(...r.problems);
    console.log(`[pipeline] forecast.json: ${r.file.available ? `${r.file.frames!.length} frames${r.file.stale ? ', STALE' : ''}` : `unavailable (${r.file.reason})`}`);
  });

  const status = await writeStatus(outDir, now, problems);
  const failing = Object.entries(status.steps).filter(([, s]) => !s.ok);
  console.log(`[pipeline] status: ${failing.length ? failing.map(([id, s]) => `${id} failing (${s.consecutiveFailures} runs)`).join(', ') : 'all steps OK'}`);
  if (failing.length) process.exitCode = 2;
}

await main();
