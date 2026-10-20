import { readFileSync } from 'node:fs';
import { writeArrayBuffer } from 'geotiff';
import { describe, expect, it } from 'vitest';
import { cellCenter, type GridSpec } from '../../shared/grid.ts';
import { COVER_CLOUD, COVER_NODATA } from '../src/snow/model.ts';
import { zipSync } from 'fflate';
import {
  AGE_NONE,
  compositeCover,
  decodeCode,
  decodeToGrid,
  extractTiff,
  maskingCover,
  parseProductName,
  pickProducts,
} from '../src/sources/snowCover.ts';

const catalogue = JSON.parse(
  readFileSync(new URL('../../fixtures/copernicus/cdse-odata-search-sce-europe-500m.json', import.meta.url), 'utf8'),
);

describe('Copernicus SCE catalogue', () => {
  it('parses product names', () => {
    expect(parseProductName('c_gls_SCE500_202610190000_CEURO_VIIRS_V1.0.1_cog')).toEqual({
      date: '2026-10-19',
      sensor: 'VIIRS',
      format: 'cog',
    });
    expect(parseProductName('something else')).toBeNull();
  });

  it('picks the newest COG per day and prefers VIIRS over MODIS (real search fixture)', () => {
    const products = pickProducts(catalogue);
    expect(products[0]).toMatchObject({ date: '2026-10-19', sensor: 'VIIRS', id: '92a1e58b-92fc-4d62-823a-9dc809202ffe' });
    expect(products.every((p) => p.name.endsWith('_cog'))).toBe(true);
    expect(new Set(products.map((p) => p.date)).size).toBe(products.length);
  });
});

describe('pixel codes (product user manual table 4.2)', () => {
  it('maps codes to snow percent, cloud and no-data', () => {
    expect(decodeCode(100)).toBe(0);
    expect(decodeCode(165)).toBe(65);
    expect(decodeCode(200)).toBe(100);
    expect(decodeCode(30)).toBe(COVER_CLOUD);
    // In the COG files clouds come as 255 (no data): treated as "no clear view".
    expect(decodeCode(255)).toBe(COVER_CLOUD);
    for (const c of [0, 20, 21, 22, 251, 254]) expect(decodeCode(c)).toBe(COVER_NODATA);
  });
});

describe('decodeToGrid', () => {
  it('samples a 0.005° EPSG:4326 GeoTIFF onto the model grid', async () => {
    // A synthetic product over 10–13°E, 46–48°N: west half 80 % snow, east half cloud, a lake row.
    const res = 0.005;
    const width = 600;
    const height = 400;
    const values = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) values[y * width + x] = y === 200 ? 21 : x < 300 ? 180 : 30;
    const tiff = writeArrayBuffer(values, {
      width,
      height,
      BitsPerSample: [8],
      SampleFormat: [1],
      ModelPixelScale: [res, res, 0],
      ModelTiepoint: [0, 0, 0, 10, 48, 0],
      GeographicTypeGeoKey: 4326,
      GTModelTypeGeoKey: 2,
      GTRasterTypeGeoKey: 1,
    } as Parameters<typeof writeArrayBuffer>[1]);

    const grid: GridSpec = { west: 11.0, south: 46.5, east: 12.0, north: 47.5, width: 20, height: 20 };
    const out = await decodeToGrid(tiff, grid);
    expect(out.bands).toBe(1);
    const at = (lon: number, lat: number) => {
      for (let row = 0; row < grid.height; row++)
        for (let col = 0; col < grid.width; col++) {
          const c = cellCenter(grid, col, row);
          if (Math.abs(c.lon - lon) < 0.026 && Math.abs(c.lat - lat) < 0.03) return out.values[row * grid.width + col];
        }
      throw new Error('no cell');
    };
    expect(at(11.2, 47.3)).toBe(80); // west of 11.5°E: code 180
    expect(at(11.8, 47.3)).toBe(COVER_CLOUD); // east: code 30
    expect(out.stats.snow + out.stats.cloud + out.stats.nodata + out.stats.bare).toBe(400);
    expect(out.rawCodes[180]).toBeGreaterThan(0);
  });
});

describe('extractTiff', () => {
  const tiff = writeArrayBuffer(new Uint8Array(4).fill(150), { width: 2, height: 2 } as Parameters<typeof writeArrayBuffer>[1]);

  it('passes a plain GeoTIFF through', () => {
    expect(extractTiff(tiff).tiff.byteLength).toBe(tiff.byteLength);
  });

  it('takes the snow cover layer out of a ZIP and skips side layers', () => {
    const zip = zipSync({
      'c_gls_SCE500_x/c_gls_SCE500_x_QFLAG.tif': new Uint8Array(tiff).slice(),
      'c_gls_SCE500_x/c_gls_SCE500_x_SCE.tif': new Uint8Array(tiff),
      'c_gls_SCE500_x/readme.txt': new TextEncoder().encode('hi'),
    });
    const out = extractTiff(zip.buffer as ArrayBuffer);
    expect(out.note).toContain('_SCE.tif');
    expect(out.tiff.byteLength).toBe(tiff.byteLength);
  });

  it('explains what arrived when it is neither', () => {
    expect(() => extractTiff(new TextEncoder().encode('<html>login</html>').buffer as ArrayBuffer)).toThrow(/neither GeoTIFF nor ZIP.*login/);
  });
});

describe('compositeCover', () => {
  const C = COVER_CLOUD;
  it('takes the newest clear view per cell and records its age', () => {
    const today = Uint8Array.from([80, C, C, C]);
    const yesterday = Uint8Array.from([10, 60, C, C]);
    const threeDaysAgo = Uint8Array.from([0, 0, 5, C]);
    const c = compositeCover([
      { values: today, ageDays: 0 },
      { values: yesterday, ageDays: 1 },
      { values: threeDaysAgo, ageDays: 3 },
    ]);
    expect([...c.values]).toEqual([80, 60, 5, C]);
    expect([...c.age]).toEqual([0, 1, 3, AGE_NONE]);
  });

  it('masks the estimate only with recent views', () => {
    const m = maskingCover(Uint8Array.from([80, 60, 5, C]), Uint8Array.from([0, 1, 3, AGE_NONE]));
    expect([...m]).toEqual([80, 60, C, C]);
  });
});
