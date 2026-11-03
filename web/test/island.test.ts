import { describe, expect, it } from 'vitest';
import { AREA, areaPixels, cutToArea, FLOOR_M, inArea } from '../src/island.ts';

const lonToTileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToTileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const terrarium = (d: Uint8ClampedArray, k: number) => d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768;

describe('island', () => {
  it('knows Bolzano is inside and Innsbruck and Trento are outside', () => {
    expect(inArea(11.354, 46.47)).toBe(true);
    expect(inArea(11.394, 47.269)).toBe(false);
    expect(inArea(11.121, 46.067)).toBe(false);
  });

  it('keeps a tile inside the area whole and drops one far outside', () => {
    const z = 12;
    const inside = areaPixels(z, lonToTileX(11.354, z), latToTileY(46.47, z), 512);
    expect(inside).toEqual({ x0: 0, x1: 512, y0: 0, y1: 512 });
    const outside = areaPixels(z, lonToTileX(9.0, z), latToTileY(46.47, z), 512);
    expect(outside.x0).toBe(outside.x1);
  });

  it('cuts an edge tile exactly at the western border', () => {
    const z = 10;
    const x = lonToTileX(AREA.west, z);
    const r = areaPixels(z, x, latToTileY(46.6, z), 512);
    expect(r.x0).toBeGreaterThan(0);
    expect(r.x0).toBeLessThan(512);
    expect(r.x1).toBe(512);
    // The pixel column of the border, computed independently.
    const px = (((AREA.west + 180) / 360) * 2 ** z - x) * 512;
    expect(Math.abs(r.x0 - px)).toBeLessThanOrEqual(0.5);
  });

  it('sets pixels outside the area to the floor elevation and leaves the rest', () => {
    const size = 4;
    const data = new Uint8ClampedArray(size * size * 4).fill(200);
    cutToArea(data, size, { x0: 1, x1: 3, y0: 0, y1: 2 });
    expect(terrarium(data, 0)).toBe(FLOOR_M); // (0,0) outside
    expect(data[(0 * size + 1) * 4]).toBe(200); // (1,0) inside
    expect(terrarium(data, (3 * size + 2) * 4)).toBe(FLOOR_M); // (2,3) below the area
  });
});
