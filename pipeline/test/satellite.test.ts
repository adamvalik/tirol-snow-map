import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { buildPyramid, mercatorBox, tileRange } from '../src/satellite/tiles.ts';
import { chooseDay, processRequest, type Scene, scenesFromStac } from '../src/sources/sentinel2.ts';

const REGION = { west: 10.2, south: 46.1, east: 12.7, north: 47.25 };
const box = (w: number, s: number, e: number, n: number): [number, number][] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];

describe('chooseDay', () => {
  const scene = (id: string, datetime: string, cloud: number, ring: [number, number][]): Scene => ({ id, datetime, cloud, ring });

  it('picks the newest day that shows most of the region without clouds', () => {
    const scenes = [
      scene('a', '2026-10-20T10:10:00Z', 95, box(9, 45, 14, 48)), // newest, but cloudy
      scene('b', '2026-10-19T10:20:00Z', 5, box(9, 45, 11.5, 48)), // clear, but only the west half
      scene('c', '2026-10-17T10:10:00Z', 10, box(9, 45, 14, 48)), // clear, everything
    ];
    const { choice, days } = chooseDay(scenes, REGION);
    expect(days.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-19', '2026-10-17']);
    expect(days[0].coverage).toBe(1);
    expect(days[0].clearShare).toBeCloseTo(0.05, 2);
    expect(days[1].coverage).toBeCloseTo(0.52, 1);
    expect(choice?.date).toBe('2026-10-19'); // 52 % covered × 95 % clear ≈ 0.49 ≥ 0.45
  });

  it('uses the least cloudy of overlapping scenes and returns null when nothing is clear', () => {
    const scenes = [scene('x', '2026-10-20T10:00:00Z', 90, box(9, 45, 14, 48)), scene('y', '2026-10-20T10:00:05Z', 80, box(9, 45, 14, 48))];
    const { choice, days } = chooseDay(scenes, REGION);
    expect(days[0].clearShare).toBeCloseTo(0.2, 5);
    expect(choice).toBeNull();
  });

  it('reads STAC features including multipolygons', () => {
    const s = scenesFromStac([
      {
        id: 'S2B_X',
        properties: { datetime: '2026-10-19T10:20:00Z', 'eo:cloud_cover': 12 },
        geometry: { type: 'MultiPolygon', coordinates: [[box(9, 45, 10, 46)], [box(11, 46, 12, 47)]] },
      },
    ]);
    expect(s).toHaveLength(2);
    expect(s[0].cloud).toBe(12);
  });
});

describe('processRequest', () => {
  it('asks for one day in Web Mercator with cloud masking', () => {
    const r = processRequest('2026-10-19', [1, 2, 3, 4], 2048);
    expect(r.input.data[0].dataFilter.timeRange).toEqual({ from: '2026-10-19T00:00:00Z', to: '2026-10-19T23:59:59Z' });
    expect(r.input.bounds.properties.crs).toContain('3857');
    expect(r.output.width).toBe(2048);
    expect(r.evalscript).toContain('SCL');
  });
});

describe('tile pyramid', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it('cuts chunks into tiles that line up with the XYZ grid and builds lower zooms', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pyramid-'));
    dirs.push(dir);
    const small = { west: 11.3, south: 46.45, east: 11.42, north: 46.52 };
    const z = 12;
    const r = tileRange(small, z);
    const chunks: [number, number, number, number][] = [];
    // Each chunk is painted with a colour derived from its Mercator box, so tiles can be traced back.
    const counts = await buildPyramid(dir, {
      bbox: small,
      minZoom: 10,
      maxZoom: z,
      chunk: 2,
      render: async (mercBox, px) => {
        chunks.push(mercBox);
        const red = chunks.length * 40;
        return (await sharp({ create: { width: px, height: px, channels: 4, background: { r: red, g: 100, b: 50, alpha: 1 } } })
          .png()
          .toBuffer()).buffer as ArrayBuffer;
      },
    });
    const expectedTop = (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
    expect(counts[z]).toBe(expectedTop);
    expect(counts[11]).toBeGreaterThan(0);
    expect(counts[10]).toBeGreaterThan(0);
    // The first chunk starts exactly at the top-left tile of the range.
    expect(chunks[0]).toEqual(mercatorBox(z, r.minX, r.minY, r.minX + 1, r.minY + 1));
    const { data } = await sharp(path.join(dir, String(z), String(r.minX), `${r.minY}.webp`)).raw().toBuffer({ resolveWithObject: true });
    expect(Math.abs(data[0] - 40)).toBeLessThan(6); // painted by chunk 1 (lossy WebP)
    expect((await readdir(path.join(dir, '10'))).length).toBeGreaterThan(0);
  });
});
