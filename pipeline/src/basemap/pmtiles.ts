// Minimal PMTiles v3 extractor: copies the tiles inside a bounding box from a (remote) archive
// into a new, smaller archive. The `pmtiles` npm package only reads archives, and the official
// Go CLI is not installable everywhere this runs, so the writer side lives here.
// Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md

import { gzipSync } from 'node:zlib';
import { Compression, type Entry, type Header, PMTiles, type Source, zxyToTileId } from 'pmtiles';

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Zoom bands to extract: each band has its own bbox, so low zooms can cover a wider area. */
export interface ZoomBand {
  minZoom: number;
  maxZoom: number;
  bbox: Bbox;
}

export function tileRange(bbox: Bbox, z: number) {
  const n = 2 ** z;
  const x = (lon: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const y = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)));
  };
  return { minX: x(bbox.west), maxX: x(bbox.east), minY: y(bbox.north), maxY: y(bbox.south) };
}

export function wantedTileIds(bands: ZoomBand[]): number[] {
  const ids = new Set<number>();
  for (const band of bands) {
    for (let z = band.minZoom; z <= band.maxZoom; z++) {
      const r = tileRange(band.bbox, z);
      for (let x = r.minX; x <= r.maxX; x++) for (let y = r.minY; y <= r.maxY; y++) ids.add(zxyToTileId(z, x, y));
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/** Finds the entry covering `tileId` in a sorted directory, or undefined. */
function findEntry(entries: Entry[], tileId: number): Entry | undefined {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].tileId <= tileId) lo = mid + 1;
    else hi = mid - 1;
  }
  const e = entries[hi];
  if (!e) return undefined;
  if (e.runLength === 0) return e; // leaf directory pointer: caller descends
  return tileId < e.tileId + e.runLength ? e : undefined;
}

interface Located {
  tileId: number;
  /** Absolute byte offset of the tile data in the source archive. */
  offset: number;
  length: number;
}

async function locateTiles(archive: PMTiles, header: Header, ids: number[]): Promise<Located[]> {
  const out: Located[] = [];
  const getDir = (offset: number, length: number) =>
    archive.cache.getDirectory(archive.source, offset, length, header);
  const root = await getDir(header.rootDirectoryOffset, header.rootDirectoryLength);
  for (const id of ids) {
    let entries = root;
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(entries, id);
      if (!e) break;
      if (e.runLength > 0) {
        out.push({ tileId: id, offset: header.tileDataOffset + e.offset, length: e.length });
        break;
      }
      entries = await getDir(header.leafDirectoryOffset + e.offset, e.length);
    }
  }
  return out;
}

/** Fetches tile bytes with few large range requests by merging nearby ranges. */
async function fetchTiles(
  source: Source,
  tiles: Located[],
  opts: { maxGap: number; maxSpan: number; onProgress?: (done: number, total: number) => void },
): Promise<Map<number, Uint8Array>> {
  const unique = [...new Map(tiles.map((t) => [t.offset, t])).values()].sort((a, b) => a.offset - b.offset);
  const groups: Located[][] = [];
  for (const t of unique) {
    const g = groups.at(-1);
    const end = g ? g.at(-1)!.offset + g.at(-1)!.length : 0;
    if (g && t.offset - end <= opts.maxGap && t.offset + t.length - g[0].offset <= opts.maxSpan) g.push(t);
    else groups.push([t]);
  }
  const data = new Map<number, Uint8Array>();
  let done = 0;
  const queue = [...groups];
  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      const start = g[0].offset;
      const end = g.at(-1)!.offset + g.at(-1)!.length;
      const res = await source.getBytes(start, end - start);
      const buf = new Uint8Array(res.data);
      for (const t of g) data.set(t.offset, buf.slice(t.offset - start, t.offset - start + t.length));
      opts.onProgress?.(++done, groups.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return data;
}

function writeVarint(out: number[], v: number) {
  // Values exceed 2^31, so avoid bitwise operators.
  while (v >= 0x80) {
    out.push((v % 0x80) + 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

export function serializeDirectory(entries: Entry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    writeVarint(out, i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  });
  return gzipSync(Uint8Array.from(out));
}

const HEADER_LENGTH = 127;
const ROOT_MAX = 16384 - HEADER_LENGTH;

/** Splits entries into a root directory and (if needed) leaf directories, as the reference writer does. */
export function buildDirectories(entries: Entry[]): { root: Uint8Array; leaves: Uint8Array } {
  const root = serializeDirectory(entries);
  if (root.length <= ROOT_MAX) return { root, leaves: new Uint8Array() };
  for (let leafSize = 4096; ; leafSize *= 2) {
    const rootEntries: Entry[] = [];
    const leafParts: Uint8Array[] = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const leaf = serializeDirectory(entries.slice(i, i + leafSize));
      rootEntries.push({ tileId: entries[i].tileId, offset, length: leaf.length, runLength: 0 });
      leafParts.push(leaf);
      offset += leaf.length;
    }
    const r = serializeDirectory(rootEntries);
    if (r.length <= ROOT_MAX) return { root: r, leaves: Buffer.concat(leafParts) };
  }
}

function serializeHeader(h: Header & { leafDirectoryLength: number; tileDataLength: number }): Uint8Array {
  const buf = Buffer.alloc(HEADER_LENGTH);
  buf.write('PMTiles', 0, 'ascii');
  buf.writeUInt8(3, 7);
  const u64 = (v: number, at: number) => buf.writeBigUInt64LE(BigInt(v), at);
  u64(h.rootDirectoryOffset, 8);
  u64(h.rootDirectoryLength, 16);
  u64(h.jsonMetadataOffset, 24);
  u64(h.jsonMetadataLength, 32);
  u64(h.leafDirectoryOffset, 40);
  u64(h.leafDirectoryLength, 48);
  u64(h.tileDataOffset, 56);
  u64(h.tileDataLength, 64);
  u64(h.numAddressedTiles, 72);
  u64(h.numTileEntries, 80);
  u64(h.numTileContents, 88);
  buf.writeUInt8(h.clustered ? 1 : 0, 96);
  buf.writeUInt8(h.internalCompression, 97);
  buf.writeUInt8(h.tileCompression, 98);
  buf.writeUInt8(h.tileType, 99);
  buf.writeUInt8(h.minZoom, 100);
  buf.writeUInt8(h.maxZoom, 101);
  const e7 = (v: number, at: number) => buf.writeInt32LE(Math.round(v * 1e7), at);
  e7(h.minLon, 102);
  e7(h.minLat, 106);
  e7(h.maxLon, 110);
  e7(h.maxLat, 114);
  buf.writeUInt8(h.centerZoom, 118);
  e7(h.centerLon, 119);
  e7(h.centerLat, 123);
  return buf;
}

/** Assembles a clustered PMTiles v3 archive from directory entries and tile data in entry order. */
export function writeArchive(o: {
  /** Header of the source archive; tile type and compression are copied from it. */
  base: Header;
  entries: Entry[];
  tileData: Uint8Array[];
  compressedMetadata: Uint8Array;
  numAddressedTiles: number;
  minZoom: number;
  maxZoom: number;
  bbox: Bbox;
}): Uint8Array {
  const { root, leaves } = buildDirectories(o.entries);
  const tileBytes = o.tileData.reduce((n, d) => n + d.length, 0);
  const metaOffset = HEADER_LENGTH + root.length;
  const leafOffset = metaOffset + o.compressedMetadata.length;
  const header = {
    ...o.base,
    rootDirectoryOffset: HEADER_LENGTH,
    rootDirectoryLength: root.length,
    jsonMetadataOffset: metaOffset,
    jsonMetadataLength: o.compressedMetadata.length,
    leafDirectoryOffset: leafOffset,
    leafDirectoryLength: leaves.length,
    tileDataOffset: leafOffset + leaves.length,
    tileDataLength: tileBytes,
    numAddressedTiles: o.numAddressedTiles,
    numTileEntries: o.entries.length,
    numTileContents: o.tileData.length,
    clustered: true,
    internalCompression: Compression.Gzip,
    minZoom: o.minZoom,
    maxZoom: o.maxZoom,
    minLon: o.bbox.west,
    minLat: o.bbox.south,
    maxLon: o.bbox.east,
    maxLat: o.bbox.north,
    centerZoom: Math.min(10, o.maxZoom),
    centerLon: (o.bbox.west + o.bbox.east) / 2,
    centerLat: (o.bbox.south + o.bbox.north) / 2,
  };
  return Buffer.concat([serializeHeader(header), root, o.compressedMetadata, leaves, ...o.tileData]);
}

export interface ExtractResult {
  archive: Uint8Array;
  tiles: number;
  tileBytes: number;
  bytesPerZoom: Record<number, number>;
}

export async function extract(
  source: Source,
  bands: ZoomBand[],
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<ExtractResult> {
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  if (header.internalCompression !== Compression.Gzip) throw new Error('Only gzip internal compression is supported');

  const located = await locateTiles(archive, header, wantedTileIds(bands));
  const data = await fetchTiles(source, located, { maxGap: 256 * 1024, maxSpan: 16 * 1024 * 1024, ...opts });

  // Tile data in tile-id order, de-duplicated by source offset; consecutive ids with the same
  // content become one run-length entry.
  const entries: Entry[] = [];
  const written = new Map<number, { offset: number; length: number }>();
  const parts: Uint8Array[] = [];
  let tileBytes = 0;
  const bytesPerZoom: Record<number, number> = {};
  for (const t of located) {
    let w = written.get(t.offset);
    if (!w) {
      const bytes = data.get(t.offset)!;
      w = { offset: tileBytes, length: bytes.length };
      written.set(t.offset, w);
      parts.push(bytes);
      tileBytes += bytes.length;
    }
    const z = zoomOf(t.tileId, bands);
    bytesPerZoom[z] = (bytesPerZoom[z] ?? 0) + w.length;
    const last = entries.at(-1);
    if (last && last.offset === w.offset && last.tileId + last.runLength === t.tileId) last.runLength++;
    else entries.push({ tileId: t.tileId, offset: w.offset, length: w.length, runLength: 1 });
  }

  const metaRes = await source.getBytes(header.jsonMetadataOffset, header.jsonMetadataLength);
  const meta = new Uint8Array(metaRes.data); // already gzip-compressed with the same internal compression
  const all = bands.map((b) => b.bbox);
  const archiveBytes = writeArchive({
    base: header,
    entries,
    tileData: parts,
    compressedMetadata: meta,
    numAddressedTiles: located.length,
    minZoom: Math.min(...bands.map((b) => b.minZoom)),
    maxZoom: Math.max(...bands.map((b) => b.maxZoom)),
    bbox: {
      west: Math.min(...all.map((b) => b.west)),
      south: Math.min(...all.map((b) => b.south)),
      east: Math.max(...all.map((b) => b.east)),
      north: Math.max(...all.map((b) => b.north)),
    },
  });

  return {
    archive: archiveBytes,
    tiles: located.length,
    tileBytes,
    bytesPerZoom,
  };
}

function zoomOf(tileId: number, bands: ZoomBand[]): number {
  const maxZ = Math.max(...bands.map((b) => b.maxZoom));
  for (let z = 0; z <= maxZ; z++) if (tileId < zxyToTileId(z + 1, 0, 0)) return z;
  return maxZ;
}
