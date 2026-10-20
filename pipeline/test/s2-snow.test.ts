import { describe, expect, it } from 'vitest';
import { mercY } from '../../shared/grid.ts';
import { aggregateToModel, compositeDays, snowWhiteRgba } from '../src/snow/s2cover.ts';
import { COVER_CLOUD, COVER_NODATA } from '../src/snow/model.ts';
import { S2_BARE, S2_CLOUD, S2_NODATA, S2_SNOW, snowChunks, snowRequest } from '../src/sources/sentinel2Snow.ts';
import { AGE_NONE } from '../src/sources/snowCover.ts';

describe('Sentinel-2 snow composite', () => {
  it('takes the newest clear view per pixel and remembers clouds', () => {
    const newest = Uint8Array.from([S2_CLOUD, S2_BARE, S2_NODATA, S2_CLOUD]);
    const older = Uint8Array.from([S2_SNOW, S2_SNOW, S2_NODATA, S2_CLOUD]);
    const { cls, age } = compositeDays([
      { cls: newest, ageDays: 0 },
      { cls: older, ageDays: 3 },
    ]);
    expect([...cls]).toEqual([S2_SNOW, S2_BARE, S2_NODATA, S2_CLOUD]);
    expect([...age]).toEqual([3, 0, AGE_NONE, AGE_NONE]);
  });

  it('sums fine pixels into model cells as snow percent, cloud or no data', () => {
    const grid = { west: 11, south: 46, east: 12, north: 47, width: 3, height: 1 };
    // Fine grid 6 × 2 (factor 2): cell 0 half snow, cell 1 all cloud, cell 2 no data.
    const cls = Uint8Array.from([S2_SNOW, S2_BARE, S2_CLOUD, S2_CLOUD, 0, 0, S2_SNOW, S2_BARE, S2_CLOUD, S2_CLOUD, 0, 0]);
    const age = Uint8Array.from([1, 0, 255, 255, 255, 255, 2, 0, 255, 255, 255, 255]);
    const { values, age: cellAge } = aggregateToModel({ cls, age }, grid, 2);
    expect([...values]).toEqual([50, COVER_CLOUD, COVER_NODATA]);
    expect(cellAge[0]).toBe(2);
  });

  it('paints only snow white, fainter for older views', () => {
    const rgba = snowWhiteRgba({ cls: Uint8Array.from([S2_SNOW, S2_BARE, S2_SNOW]), age: Uint8Array.from([0, 0, 8]) });
    expect(rgba[3]).toBeGreaterThan(rgba[11]);
    expect(rgba[7]).toBe(0);
    expect(rgba[11]).toBeGreaterThan(100);
  });

  it('requests the fine grid in Web Mercator chunks within the Process API size limit', () => {
    const grid = { west: 10.2, south: 46.1, east: 12.7, north: 47.25, width: 3056, height: 2048 };
    const chunks = snowChunks(grid);
    expect(chunks).toHaveLength(2);
    expect(chunks.reduce((n, c) => n + c.width, 0)).toBe(3056);
    expect(chunks[0].box[3]).toBeCloseTo(mercY(47.25), 3);
    const req = snowRequest('2026-10-19', chunks[0].box, chunks[0].width, grid.height);
    expect(req.output.width).toBeLessThanOrEqual(2500);
    expect(req.input.data[0].dataFilter.timeRange.from).toBe('2026-10-19T00:00:00Z');
    expect(req.evalscript).toContain('B11');
  });
});
