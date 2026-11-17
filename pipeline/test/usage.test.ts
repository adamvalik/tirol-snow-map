import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODEL_GRID } from '../../shared/grid.ts';
import { type ModelErrorFile, SCHEMA_VERSION, type SnowFile } from '../../shared/types.ts';
import { updateModelError } from '../src/history.ts';
import { postProcess } from '../src/sources/sentinel2.ts';
import { writeStatus } from '../src/status.ts';
import { addUsage, countOpenMeteo, countSentinelHub, PU_HEADER, runUsage, tightestLimit } from '../src/usage.ts';

const zero = () => ({ sentinelHubRequests: 0, sentinelHubProcessingUnits: 0, openMeteoCalls: 0 });
const reset = () => Object.assign(runUsage, zero());
const noProblems = { stations: [], snow: [], satellite: [], forecast: [] };

describe('upstream usage', () => {
  afterEach(() => {
    reset();
    vi.unstubAllGlobals();
  });

  it('counts Sentinel Hub answers and their processing units, but not rate-limit refusals', () => {
    reset();
    countSentinelHub(new Response(null, { status: 200, headers: { [PU_HEADER]: '12.5' } }));
    countSentinelHub(new Response(null, { status: 200 }));
    countSentinelHub(new Response(null, { status: 429, headers: { [PU_HEADER]: '3' } }));
    countOpenMeteo(273);
    expect(runUsage).toEqual({ sentinelHubRequests: 2, sentinelHubProcessingUnits: 12.5, openMeteoCalls: 273 });
  });

  it('counts the requests postProcess makes', async () => {
    reset();
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200, headers: { [PU_HEADER]: '4' } }));
    await postProcess('t', {}, '');
    expect(runUsage).toMatchObject({ sentinelHubRequests: 1, sentinelHubProcessingUnits: 4 });
  });

  it('adds up within a month and a day, and starts again in the next', () => {
    const run = { sentinelHubRequests: 10, sentinelHubProcessingUnits: 400, openMeteoCalls: 273 };
    const a = addUsage(undefined, run, '2026-11-13T03:47:00Z');
    const b = addUsage(a, run, '2026-11-13T11:47:00Z');
    expect(b.sentinelHub).toMatchObject({ requests: 20, processingUnits: 800 });
    expect(b.openMeteo).toMatchObject({ calls: 546, callsToday: 546, day: '2026-11-13' });
    const c = addUsage(b, run, '2026-11-14T03:47:00Z');
    expect(c.openMeteo).toMatchObject({ calls: 819, callsToday: 273 });
    const d = addUsage(c, run, '2026-12-01T03:47:00Z');
    expect(d).toMatchObject({ month: '2026-12', sentinelHub: { processingUnits: 400 }, openMeteo: { calls: 273 } });
    expect(tightestLimit(addUsage(undefined, { ...run, sentinelHubProcessingUnits: 8500 }, '2026-11-13T00:00:00Z'))).toEqual({
      name: 'Sentinel Hub processing units this month',
      share: 0.85,
    });
  });

  it('keeps the totals in status.json from run to run', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'snow-usage-'));
    const run = { sentinelHubRequests: 3, sentinelHubProcessingUnits: 100, openMeteoCalls: 273 };
    await writeStatus(dir, '2026-11-13T03:47:00Z', noProblems, run);
    expect((await writeStatus(dir, '2026-11-13T11:47:00Z', noProblems, run)).usage?.sentinelHub.processingUnits).toBe(200);
  });
});

describe('model error log', () => {
  const snow = (date: string, mae: number): SnowFile => ({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: `${date}T12:00:00Z`,
    grid: MODEL_GRID,
    cover: { available: false, reason: 'test' },
    depth: {
      method: 'trend',
      trend: { a: 0, b: 0.01 },
      stationCount: 120,
      stationsObservedAt: null,
      stationElevationRange: [1000, 3000],
      validation: { maeCm: { trend: mae, 'trend+residuals': mae + 1.23 }, byBand: [{ label: 'below 1500 m', n: 10, maeCm: 2.345 }] },
      stats: { cells: 0, maskedBySatellite: 0, cloudy: 0, noCover: 0, high: 0, medium: 0, low: 0 },
    },
    files: { white: null, cover: null, depth: null, confidence: null, data: null },
  });

  it('keeps one entry per day, the last run winning, newest first, beyond the 14 history days', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'snow-error-'));
    const log = () => {};
    await updateModelError({ outDir: dir, now: '2026-10-01T10:00:00Z', snow: snow('2026-10-01', 9), log });
    await updateModelError({ outDir: dir, now: '2026-11-13T03:00:00Z', snow: snow('2026-11-13', 5), log });
    await updateModelError({ outDir: dir, now: '2026-11-13T17:00:00Z', snow: snow('2026-11-13', 4.04), log });
    // A run without a depth estimate keeps what is there.
    await updateModelError({ outDir: dir, now: '2026-11-13T18:00:00Z', snow: null, log });
    const file = JSON.parse(await readFile(path.join(dir, 'model-error.json'), 'utf8')) as ModelErrorFile;
    expect(file.days.map((d) => [d.date, d.maeCm])).toEqual([
      ['2026-11-13', 4],
      ['2026-10-01', 9],
    ]);
    expect(file.days[0]).toMatchObject({ method: 'trend', maeByMethodCm: { trend: 4, 'trend+residuals': 5.3 }, stationCount: 120 });
    expect(file.days[0].byBand[0].maeCm).toBe(2.3);
  });
});
