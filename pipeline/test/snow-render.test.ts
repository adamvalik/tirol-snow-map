import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../../shared/grid.ts';
import { COVER_CLOUD } from '../src/snow/model.ts';
import { coverRgba, dataRgba, decodeData, snowLine } from '../src/snow/render.ts';

const grid: GridSpec = { west: 11, south: 46, east: 12, north: 47, width: 4, height: 1 };

describe('data PNG encoding', () => {
  it('round-trips depth, confidence, cover and view age', () => {
    const rgba = dataRgba(
      grid,
      Float32Array.from([0, 37.4, 512, 2000]),
      Uint8Array.from([2, 1, 0, 0]),
      Uint8Array.from([5, 80, COVER_CLOUD, 100]),
      Uint8Array.from([0, 1, 255, 2]),
    );
    const at = (i: number) => decodeData(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    expect(at(0)).toEqual({ depthCm: 0, confidence: 2, cover: 5, viewAge: 0 });
    expect(at(1)).toEqual({ depthCm: 37, confidence: 1, cover: 80, viewAge: 1 });
    expect(at(2)).toEqual({ depthCm: 512, confidence: 0, cover: COVER_CLOUD, viewAge: 15 });
    expect(at(3).depthCm).toBe(1023); // clamped
    for (let i = 0; i < 4; i++) expect(rgba[i * 4 + 3]).toBe(255);
  });
});

describe('cover rendering', () => {
  it('draws older views fainter and leaves bare ground transparent', () => {
    const rgba = coverRgba(grid, Uint8Array.from([100, 100, 5, COVER_CLOUD]), Uint8Array.from([0, 2, 0, 255]));
    expect(rgba[3]).toBeGreaterThan(rgba[7]);
    expect(rgba[11]).toBe(0);
    expect(rgba[15]).toBeGreaterThan(0); // hatch or faint cloud tint
  });
});

describe('snowLine', () => {
  it('finds the band where most clear ground turns white', () => {
    const n = 4000;
    const elevation = Float32Array.from({ length: n }, (_, i) => 500 + (i % 2500));
    const cover = Uint8Array.from(elevation, (h) => (h >= 1800 ? 90 : 0));
    expect(snowLine(cover, elevation, { bandM: 100, minCells: 10 })).toBe(1800);
  });

  it('returns null when everything is cloud', () => {
    expect(snowLine(new Uint8Array(100).fill(COVER_CLOUD), new Float32Array(100).fill(2000))).toBeNull();
  });
});
