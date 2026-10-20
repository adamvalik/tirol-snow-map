import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_GRID } from '../../shared/grid.ts';
import { type HistoryFile, SCHEMA_VERSION, type SnowFile, type StatusFile } from '../../shared/types.ts';
import { daysBefore, HISTORY_DAYS, romeDate, updateHistory } from '../src/history.ts';
import { compositeAsOf } from '../src/snow/s2cover.ts';
import { S2_BARE, S2_CLOUD, S2_SNOW } from '../src/sources/sentinel2Snow.ts';
import { AGE_NONE } from '../src/sources/snowCover.ts';
import { writeStatus } from '../src/status.ts';

const snow = (date: string): SnowFile => ({
  schemaVersion: SCHEMA_VERSION,
  generatedAt: `${date}T12:00:00Z`,
  grid: MODEL_GRID,
  cover: { available: false, reason: 'test' },
  depth: null,
  files: { white: null, cover: null, depth: 'snow-depth.png', confidence: null, data: null },
});

async function outDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'snow-history-'));
  await writeFile(path.join(dir, 'stations.json'), '{"stations":[]}');
  await writeFile(path.join(dir, 'snow-depth.png'), 'png');
  return dir;
}

describe('dates', () => {
  it('uses the local South Tyrol day', () => {
    expect(romeDate('2026-10-20T21:30:00Z')).toBe('2026-10-20');
    expect(romeDate('2026-10-20T22:30:00Z')).toBe('2026-10-21');
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28');
  });
});

describe('updateHistory', () => {
  it('snapshots the day with files moved into its folder', async () => {
    const dir = await outDir();
    const h = await updateHistory({ outDir: dir, now: '2026-10-20T12:00:00Z', snow: snow('2026-10-20'), backfill: [], log: () => {} });
    expect(h.days).toHaveLength(1);
    expect(h.days[0]).toMatchObject({ date: '2026-10-20', snow: 'history/2026-10-20/snow.json', stations: 'history/2026-10-20/stations.json', backfilled: false });
    const copy = JSON.parse(await readFile(path.join(dir, 'history/2026-10-20/snow.json'), 'utf8')) as SnowFile;
    expect(copy.files.depth).toBe('history/2026-10-20/snow-depth.png');
    expect(await readFile(path.join(dir, copy.files.depth!), 'utf8')).toBe('png');
  });

  it('keeps the day when the snow step failed, adds backfill without overwriting, prunes old days', async () => {
    const dir = await outDir();
    await updateHistory({ outDir: dir, now: '2026-10-01T12:00:00Z', snow: snow('2026-10-01'), backfill: [], log: () => {} });
    await updateHistory({ outDir: dir, now: '2026-10-10T12:00:00Z', snow: snow('2026-10-10'), backfill: [], log: () => {} });
    const backfill = ['2026-10-10', '2026-10-08'].map((date) => ({
      date,
      meta: { ...snow(date), files: { white: 'snow-white.png', cover: null, depth: null, confidence: null, data: null } },
      pngs: { 'snow-white.png': Buffer.from('w') },
    }));
    const h = await updateHistory({ outDir: dir, now: '2026-10-16T09:00:00Z', snow: null, backfill, log: () => {} });
    // 2026-10-01 is more than HISTORY_DAYS before the 16th; the 10th stays a real snapshot.
    expect(HISTORY_DAYS).toBe(14);
    expect(h.days.map((d) => [d.date, d.backfilled])).toEqual([
      ['2026-10-10', false],
      ['2026-10-08', true],
    ]);
    expect(h.days[1].stations).toBeNull();
    const saved = JSON.parse(await readFile(path.join(dir, 'history.json'), 'utf8')) as HistoryFile;
    expect(saved.days).toHaveLength(2);
    await expect(readFile(path.join(dir, 'history/2026-10-01/snow.json'))).rejects.toThrow();
  });
});

describe('compositeAsOf', () => {
  it('rebuilds the composite of an earlier day from the passes up to it', () => {
    const perDay = [
      { date: '2026-10-19', cls: Uint8Array.from([S2_BARE, S2_CLOUD]) },
      { date: '2026-10-16', cls: Uint8Array.from([S2_SNOW, S2_SNOW]) },
    ];
    expect(compositeAsOf(perDay, '2026-10-15')).toBeNull();
    const c = compositeAsOf(perDay, '2026-10-17')!;
    expect([...c.cls]).toEqual([S2_SNOW, S2_SNOW]);
    expect([...c.age]).toEqual([1, 1]);
    const latest = compositeAsOf(perDay, '2026-10-19')!;
    expect([...latest.cls]).toEqual([S2_BARE, S2_SNOW]);
    expect([...latest.age]).toEqual([0, 3]);
    expect(AGE_NONE).toBe(255);
  });
});

describe('writeStatus', () => {
  it('counts failing runs in a row and resets on success', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'snow-status-'));
    await mkdir(dir, { recursive: true });
    const ok = { stations: [], snow: [], satellite: [], forecast: [] };
    await writeStatus(dir, '2026-10-20T10:00:00Z', { ...ok, forecast: ['HTTP 429'] });
    const s = await writeStatus(dir, '2026-10-20T10:30:00Z', { ...ok, forecast: ['HTTP 429'] });
    expect(s.steps.forecast).toEqual({ ok: false, problems: ['HTTP 429'], consecutiveFailures: 2, failingSince: '2026-10-20T10:00:00Z' });
    const back = (await writeStatus(dir, '2026-10-20T11:00:00Z', ok)) as StatusFile;
    expect(back.steps.forecast.consecutiveFailures).toBe(0);
    expect(back.steps.stations.ok).toBe(true);
  });
});
