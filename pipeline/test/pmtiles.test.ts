import { gzipSync } from 'node:zlib';
import { Compression, type Entry, type Header, PMTiles, type Source, TileType, zxyToTileId } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import { extract, tileRange, writeArchive, type ZoomBand } from '../src/basemap/pmtiles.ts';

const memorySource = (bytes: Uint8Array): Source => ({
  getKey: () => 'memory',
  getBytes: async (offset: number, length: number) => ({
    data: bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length) as ArrayBuffer,
  }),
});

const BASE: Header = {
  specVersion: 3,
  rootDirectoryOffset: 0,
  rootDirectoryLength: 0,
  jsonMetadataOffset: 0,
  jsonMetadataLength: 0,
  leafDirectoryOffset: 0,
  tileDataOffset: 0,
  numAddressedTiles: 0,
  numTileEntries: 0,
  numTileContents: 0,
  clustered: true,
  internalCompression: Compression.Gzip,
  tileCompression: Compression.None,
  tileType: TileType.Mvt,
  minZoom: 0,
  maxZoom: 0,
  minLon: -180,
  minLat: -85,
  maxLon: 180,
  maxLat: 85,
  centerZoom: 0,
  centerLon: 0,
  centerLat: 0,
  etag: undefined,
};

/**
 * Every tile from z0 to z7 (21 845 tiles). Tile bytes spell "z/x/y|" plus padding of varying length,
 * so the directory does not compress below the root size limit and leaf directories are exercised.
 */
function syntheticPlanet(): Uint8Array {
  const tiles: { id: number; data: Uint8Array }[] = [];
  let seed = 42;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let z = 0; z <= 7; z++)
    for (let x = 0; x < 2 ** z; x++)
      for (let y = 0; y < 2 ** z; y++) {
        const id = zxyToTileId(z, x, y);
        tiles.push({ id, data: new TextEncoder().encode(`${z}/${x}/${y}|${'.'.repeat(Math.floor(random() * 3000))}`) });
      }
  tiles.sort((a, b) => a.id - b.id);
  const entries: Entry[] = [];
  let offset = 0;
  for (const t of tiles) {
    entries.push({ tileId: t.id, offset, length: t.data.length, runLength: 1 });
    offset += t.data.length;
  }
  return writeArchive({
    base: BASE,
    entries,
    tileData: tiles.map((t) => t.data),
    compressedMetadata: gzipSync(JSON.stringify({ name: 'synthetic' })),
    numAddressedTiles: tiles.length,
    minZoom: 0,
    maxZoom: 7,
    bbox: { west: -180, south: -85, east: 180, north: 85 },
  });
}

const text = (b: ArrayBuffer) => new TextDecoder().decode(b).split('|')[0];

describe('PMTiles writer and extractor', () => {
  const planet = syntheticPlanet();

  it('writes an archive the official reader can read, including leaf directories', async () => {
    const p = new PMTiles(memorySource(planet));
    const h = await p.getHeader();
    expect(h.numTileEntries).toBe(21_845);
    expect(h.leafDirectoryLength).toBeGreaterThan(0);
    expect(await p.getMetadata()).toEqual({ name: 'synthetic' });
    for (const [z, x, y] of [[0, 0, 0], [5, 17, 11], [7, 127, 0], [7, 68, 45]]) {
      expect(text((await p.getZxy(z, x, y))!.data)).toBe(`${z}/${x}/${y}`);
    }
  });

  it('extracts exactly the tiles inside each zoom band', async () => {
    const southTyrol = { west: 10.2, south: 46.1, east: 12.7, north: 47.25 };
    const bands: ZoomBand[] = [
      { minZoom: 0, maxZoom: 3, bbox: { west: -180, south: -85, east: 180, north: 85 } },
      { minZoom: 4, maxZoom: 7, bbox: southTyrol },
    ];
    const result = await extract(memorySource(planet), bands);
    const out = new PMTiles(memorySource(result.archive));
    const h = await out.getHeader();
    expect(h.minZoom).toBe(0);
    expect(h.maxZoom).toBe(7);

    const expected = 85 + [4, 5, 6, 7].reduce((n, z) => {
      const r = tileRange(southTyrol, z);
      return n + (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
    }, 0);
    expect(result.tiles).toBe(expected);

    expect(text((await out.getZxy(2, 3, 1))!.data)).toBe('2/3/1'); // world band
    const r7 = tileRange(southTyrol, 7);
    expect(text((await out.getZxy(7, r7.minX, r7.minY))!.data)).toBe(`7/${r7.minX}/${r7.minY}`);
    expect(await out.getZxy(7, 0, 0)).toBeUndefined(); // outside the detailed band
  });
});
