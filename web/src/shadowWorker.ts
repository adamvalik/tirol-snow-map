// Shade off the main thread (see shadows.ts). The 250 m grid arrives once and covers the region;
// around the view a finer grid is built from Mapterhorn tiles, which starts from the 250 m grid's
// shadow line at its edge, so ridges outside it still cast into it. Each sun is answered with two
// images ready to drape: the region, with a feathered gap where the finer one takes over.

import { MODEL_GRID, mercY, rowCellSizes, sampleGrid } from '../../shared/grid.ts';
import { castShadows, latticeAltitude, NO_LINE, type ShadowEdge, type ShadowSun, shadowTerrain, type ShadowTerrain, type SunAltitude } from '../../shared/shadow.ts';
import { TERRARIUM_TILE, terrarium } from '../../shared/terrarium.ts';
import { LruMap } from './lru.ts';

/** A block of nx × ny Mapterhorn tiles at zoom z, starting at tile (x, y). */
export interface DetailBlock {
  z: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** Colour of full shade and its opacity (0–1). */
export interface ShadeLook {
  color: readonly [number, number, number];
  opacity: number;
}

export type ShadowRequest =
  | { type: 'terrain'; values: Int16Array; tiles: string }
  | { type: 'sun'; id: number; sun: ShadowSun; look: ShadeLook; detail: DetailBlock | null };

type SunRequest = Extract<ShadowRequest, { type: 'sun' }>;

/** An ImageBitmap where the worker can make one, else the pixels. */
export type ShadowImage = ImageBitmap | ImageData;

export interface ShadowResult {
  id: number;
  coarse: ShadowImage;
  /** The finer shade and the block it covers, or null when there is none to show. */
  detail: { block: DetailBlock; image: ShadowImage } | null;
  /** Time spent on the shade, in ms. */
  ms: number;
}

/** The worker's answer: the shade, or why there is none for this request. */
export type ShadowReply = ShadowResult | { id: number; error: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ShadowRequest>) => void) | null;
  postMessage(message: ShadowReply, transfer?: Transferable[]): void;
};

/** The finer grid fades into the 250 m one over this distance from its edge. */
const FEATHER_M = 1500;
/** Decoded tiles kept (1 MB each): the block on show and the ones around it, the least used dropped first. */
const MAX_TILES = 12;
/** A tile that failed to download is filled from the 250 m grid, and tried again after this long. */
const RETRY_MS = 30_000;
const { width: CW, height: CH } = MODEL_GRID;

let coarse: ShadowTerrain | null = null;
let tileUrl = '';
/** The newest request not answered yet, and the last one answered (asked again when tiles arrive). */
let latest: SunRequest | null = null;
let last: SunRequest | null = null;
let running = false;

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'terrain') {
    coarse = shadowTerrain(CW, CH, m.values, rowCellSizes(MODEL_GRID), true);
    tileUrl = m.tiles;
    return;
  }
  latest = m;
  void run();
};

/** Answers the newest request; the ones that came in meanwhile are skipped. */
async function run() {
  if (running) return;
  running = true;
  try {
    while (latest && coarse) {
      const req = latest;
      latest = null;
      // Set first: tiles that arrive while this is answered ask for it again.
      last = req;
      try {
        await answer(req, coarse);
      } catch (e) {
        // An error here would otherwise only reach the console: the page would wait for ever.
        scope.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    running = false;
  }
}

// --- The finer grid ------------------------------------------------------------------

interface Mosaic {
  block: DetailBlock;
  terrain: ShadowTerrain;
  /** Detail cell (col, row) to 250 m cell coordinates, measured between cell centres: c = a·col + b. */
  ax: number;
  bx: number;
  ay: number;
  by: number;
  /** The covered area in detail cells: [col0, col1) × [row0, row1). */
  area: { col0: number; col1: number; row0: number; row1: number };
}

let mosaic: Mosaic | null = null;
const tiles = new LruMap<string, Float32Array | null>(MAX_TILES);
const loading = new Map<string, Promise<void>>();

const tileKey = (z: number, x: number, y: number) => `${z}/${x}/${y}`;
const sameBlock = (a: DetailBlock | undefined, b: DetailBlock) => !!a && a.z === b.z && a.x === b.x && a.y === b.y && a.nx === b.nx && a.ny === b.ny;

function blockTiles(b: DetailBlock): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let j = 0; j < b.ny; j++) for (let i = 0; i < b.nx; i++) out.push([b.z, b.x + i, b.y + j]);
  return out;
}

async function fetchTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const res = await fetch(tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`terrain tile: HTTP ${res.status}`);
  // The colours are the elevation, so they must reach the canvas unchanged.
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(TERRARIUM_TILE, TERRARIUM_TILE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, TERRARIUM_TILE, TERRARIUM_TILE).data;
  const values = new Float32Array(TERRARIUM_TILE * TERRARIUM_TILE);
  for (let i = 0; i < values.length; i++) values[i] = terrarium(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  return values;
}

/** Loads the block's missing tiles; a missing or failed tile is filled from the 250 m grid. */
async function loadTiles(b: DetailBlock): Promise<void> {
  await Promise.all(
    blockTiles(b).map(([z, x, y]) => {
      const key = tileKey(z, x, y);
      // Panning back to tiles still kept counts as using them, so they stay.
      if (tiles.has(key)) {
        tiles.get(key);
        return;
      }
      let p = loading.get(key);
      if (!p) {
        p = fetchTile(z, x, y)
          .catch(() => {
            setTimeout(() => tiles.peek(key) === null && tiles.delete(key), RETRY_MS);
            return null;
          })
          .then((values) => {
            tiles.set(key, values);
            loading.delete(key);
          });
        loading.set(key, p);
      }
      return p;
    }),
  );
}

const tilesReady = (b: DetailBlock) => blockTiles(b).every(([z, x, y]) => tiles.has(tileKey(z, x, y)));

function buildMosaic(b: DetailBlock, grid: ShadowTerrain): Mosaic {
  const T = TERRARIUM_TILE;
  const w = b.nx * T;
  const h = b.ny * T;
  const n = T * 2 ** b.z;
  const lonOf = (col: number) => ((b.x * T + col + 0.5) / n) * 360 - 180;
  // Web Mercator y in metres (as shared/grid.ts) of a detail row's centre.
  const yOf = (row: number) => Math.PI * 6378137 * (1 - (2 * (b.y * T + row + 0.5)) / n);
  const latOf = (row: number) => (Math.atan(Math.sinh(yOf(row) / 6378137)) * 180) / Math.PI;
  const values = new Float32Array(w * h);
  for (let j = 0; j < b.ny; j++) {
    for (let i = 0; i < b.nx; i++) {
      const tile = tiles.get(tileKey(b.z, b.x + i, b.y + j));
      for (let r = 0; r < T; r++) {
        const row = j * T + r;
        if (tile) values.set(tile.subarray(r * T, (r + 1) * T), row * w + i * T);
        else {
          const lat = latOf(row);
          for (let c = 0; c < T; c++) values[row * w + i * T + c] = sampleGrid(MODEL_GRID, grid.values, lonOf(i * T + c), lat) ?? 0;
        }
      }
    }
  }
  // Square cells in metres per row, on the same 6371 km sphere as the 250 m grid.
  const cellSize = new Float64Array(h);
  for (let row = 0; row < h; row++) cellSize[row] = ((2 * Math.PI * 6_371_000) / n) * Math.cos((latOf(row) * Math.PI) / 180);
  const { west, east, north, south } = MODEL_GRID;
  const yN = mercY(north);
  const yS = mercY(south);
  const ax = ((360 / n) * CW) / (east - west);
  const bx = ((lonOf(0) - west) / (east - west)) * CW - 0.5;
  const ay = (((2 * Math.PI * 6378137) / n) * CH) / (yN - yS);
  const by = ((yN - yOf(0)) / (yN - yS)) * CH - 0.5;
  // The covered area's edges, in detail cells.
  const clampTo = (v: number, max: number) => Math.min(Math.max(Math.round(v), 0), max);
  const area = {
    col0: clampTo((-0.5 - bx) / ax, w),
    col1: clampTo((CW - 0.5 - bx) / ax, w),
    row0: clampTo((-0.5 - by) / ay, h),
    row1: clampTo((CH - 0.5 - by) / ay, h),
  };
  return { block: b, terrain: shadowTerrain(w, h, values, cellSize), ax, bx, ay, by, area };
}

/** The 250 m grid's shadow line at a detail cell beyond the finer grid's edge. */
function coarseEdge(m: Mosaic, grid: ShadowTerrain): ShadowEdge {
  const incoming = grid.incoming!;
  const reach = grid.reach!;
  const z = grid.values;
  return (col, row) => {
    const x = m.ax * col + m.bx;
    const y = m.ay * row + m.by;
    if (x < 0 || y < 0 || x > CW - 1 || y > CH - 1) return null;
    const x0 = Math.min(Math.floor(x), CW - 2);
    const y0 = Math.min(Math.floor(y), CH - 2);
    const fx = x - x0;
    const fy = y - y0;
    let line = 0;
    let far = 0;
    let lines = 0;
    for (const [dc, dr, wgt] of [
      [0, 0, (1 - fx) * (1 - fy)],
      [1, 0, fx * (1 - fy)],
      [0, 1, (1 - fx) * fy],
      [1, 1, fx * fy],
    ] as const) {
      const i = (y0 + dr) * CW + x0 + dc;
      // A corner without a line counts as one well below its ground, so the shadow ends between corners.
      const has = incoming[i] > NO_LINE / 2;
      line += wgt * (has ? incoming[i] : z[i] - 500);
      far += wgt * (has ? reach[i] : 0);
      if (has) lines++;
    }
    return lines ? { line, reach: far } : null;
  };
}

/** The sun's altitude over the finer grid: the region's lattice read at its four corners. */
function detailAltitude(altitude: SunAltitude, m: Mosaic): SunAltitude {
  if (typeof altitude === 'number') return altitude;
  const { cols, rows } = altitude;
  const at = (col: number, row: number) =>
    latticeAltitude(altitude, ((m.ax * col + m.bx) / (CW - 1)) * (cols - 1), ((m.ay * row + m.by) / (CH - 1)) * (rows - 1));
  const { width: w, height: h } = m.terrain;
  return { cols: 2, rows: 2, values: [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)] };
}

/**
 * Weight of the finer grid along its columns and rows: 1 inside, easing to 0 towards its edges, 0
 * outside the covered area. A cell's weight is the smaller of its column's and its row's.
 */
function detailWeights(m: Mosaic): { cols: Float32Array; rows: Float32Array; feather: number } {
  const { width: w, height: h, cellSize } = m.terrain;
  // In detail cells.
  const feather = FEATHER_M / cellSize[h >> 1];
  const ease = (d: number) => {
    const t = Math.min(Math.max(d / feather, 0), 1);
    return t * t * (3 - 2 * t);
  };
  const cols = new Float32Array(w);
  const rows = new Float32Array(h);
  for (let col = m.area.col0; col < m.area.col1; col++) cols[col] = ease(Math.min(col, w - 1 - col));
  for (let row = m.area.row0; row < m.area.row1; row++) rows[row] = ease(Math.min(row, h - 1 - row));
  return { cols, rows, feather };
}

// --- Images ----------------------------------------------------------------------------

/** RGBA pixels as 32-bit words (little-endian: red in the low byte), and the image made of them. */
const pixel = (look: ShadeLook, alpha: number) => (look.color[0] | (look.color[1] << 8) | (look.color[2] << 16) | (alpha << 24)) >>> 0;

async function toImage(pixels: Uint32Array<ArrayBuffer>, w: number, h: number): Promise<ShadowImage> {
  const data = new ImageData(new Uint8ClampedArray(pixels.buffer), w, h);
  // MapLibre's raster shader expects premultiplied colours from a bitmap.
  return typeof createImageBitmap === 'function' ? createImageBitmap(data, { premultiplyAlpha: 'premultiply' }) : data;
}

const transferOf = (image: ShadowImage): Transferable => ('close' in image ? image : image.data.buffer);

/** Bilinear value of a 250 m cell array at fractional cell coordinates, clamped at the edge as the GPU samples it. */
function sampleCoarse(values: Uint8Array, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), CW - 1);
  const cy = Math.min(Math.max(y, 0), CH - 1);
  const x0 = Math.min(Math.floor(cx), CW - 2);
  const y0 = Math.min(Math.floor(cy), CH - 2);
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * CW + x0;
  const top = values[i] + (values[i + 1] - values[i]) * fx;
  const bottom = values[i + CW] + (values[i + CW + 1] - values[i + CW]) * fx;
  return top + (bottom - top) * fy;
}

/** Alpha of the 250 m image: the shade, stepping back where the finer image takes over. */
function coarseAlpha(shade: Uint8Array, opacity: number, m: Mosaic | null, weights: ReturnType<typeof detailWeights> | null): Uint8Array {
  const out = new Uint8Array(CW * CH);
  for (let i = 0; i < out.length; i++) out[i] = shade[i] * opacity + 0.5;
  if (!m || !weights) return out;
  const { width: w, height: h } = m.terrain;
  // The finer grid's weight at each 250 m cell centre, by column and by row.
  const at = (v: number, n: number) => Math.round(v) >= 0 && Math.round(v) < n;
  for (let row = 0; row < CH; row++) {
    const r = (row - m.by) / m.ay;
    if (!at(r, h)) continue;
    const wr = weights.rows[Math.round(r)];
    if (!wr) continue;
    for (let col = 0; col < CW; col++) {
      const c = (col - m.bx) / m.ax;
      if (!at(c, w)) continue;
      const weight = Math.min(weights.cols[Math.round(c)], wr);
      const i = row * CW + col;
      out[i] = shade[i] * opacity * (1 - weight) + 0.5;
    }
  }
  return out;
}

/**
 * Pixels of the finer image. Across the feather it blends towards the 250 m shade, and it is
 * drawn over the 250 m image, so it only adds what that image (as the GPU samples it there) lacks:
 * the two then sum to the blend exactly, without a lighter or darker seam.
 */
function detailPixels(m: Mosaic, shade: Uint8Array, coarseShade: Uint8Array, under: Uint8Array, look: ShadeLook, weights: ReturnType<typeof detailWeights>): Uint32Array<ArrayBuffer> {
  const { width: w, height: h } = m.terrain;
  const out = new Uint32Array(w * h);
  const { opacity } = look;
  const full = new Uint32Array(256).map((_, s) => pixel(look, Math.round(s * opacity)));
  // Two 250 m cells inside the feather, the 250 m image is empty underneath.
  const inner = weights.feather + 2 / Math.min(m.ax, m.ay);
  for (let row = 0; row < h; row++) {
    const wr = weights.rows[row];
    if (!wr) continue;
    const y = m.ay * row + m.by;
    const rowInner = wr === 1 && Math.min(row, h - 1 - row) >= inner;
    for (let col = 0; col < w; col++) {
      const wc = weights.cols[col];
      if (!wc) continue;
      const i = row * w + col;
      const weight = wc < wr ? wc : wr;
      if (rowInner && weight === 1 && Math.min(col, w - 1 - col) >= inner) {
        out[i] = full[shade[i]];
        continue;
      }
      const x = m.ax * col + m.bx;
      const target = opacity * (weight * shade[i] + (1 - weight) * sampleCoarse(coarseShade, x, y));
      const a = sampleCoarse(under, x, y);
      out[i] = pixel(look, a >= 255 ? 0 : Math.round(Math.min(Math.max(((target - a) / (255 - a)) * 255, 0), 255)));
    }
  }
  return out;
}

/** Blocks whose tiles are on their way, each with one request to ask again when they are in. */
const awaited = new Set<string>();
const blockKey = (b: DetailBlock) => `${b.z}/${b.x}/${b.y}/${b.nx}/${b.ny}`;

async function answer(req: SunRequest, grid: ShadowTerrain) {
  const t0 = performance.now();
  // The finer grid for the requested block once its tiles are in; until then the one shown before.
  const block = req.detail;
  if (block && !sameBlock(mosaic?.block, block)) {
    const key = blockKey(block);
    if (tilesReady(block)) mosaic = buildMosaic(block, grid);
    // Once per block, however many requests come while its tiles load: each used to ask again,
    // and the same shade was worked out two or three times.
    else if (!awaited.has(key)) {
      awaited.add(key);
      void loadTiles(block).then(() => {
        awaited.delete(key);
        // The last shade again, with the finer grid, unless a newer request is waiting (it gets
        // the grid anyway) or the view has moved on to another block.
        if (!latest && last?.detail && sameBlock(last.detail, block)) {
          latest = last;
          void run();
        }
      });
    }
  }
  const m = block ? mosaic : null;
  const weights = m ? detailWeights(m) : null;

  const coarseShade = castShadows(grid, req.sun);
  const alpha = coarseAlpha(coarseShade, req.look.opacity, m, weights);
  let detail: ShadowResult['detail'] = null;
  if (m && weights) {
    const { width: w, height: h } = m.terrain;
    const shade = castShadows(m.terrain, { azimuth: req.sun.azimuth, altitude: detailAltitude(req.sun.altitude, m) }, coarseEdge(m, grid));
    detail = { block: m.block, image: await toImage(detailPixels(m, shade, coarseShade, alpha, req.look, weights), w, h) };
  }
  const coarsePixels = new Uint32Array(CW * CH);
  for (let i = 0; i < alpha.length; i++) coarsePixels[i] = pixel(req.look, alpha[i]);
  const coarseImage = await toImage(coarsePixels, CW, CH);
  const transfer = [transferOf(coarseImage)];
  if (detail) transfer.push(transferOf(detail.image));
  scope.postMessage({ id: req.id, coarse: coarseImage, detail, ms: performance.now() - t0 }, transfer);
}
