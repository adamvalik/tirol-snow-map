// Turns model-grid rasters into PNGs the app drapes over the terrain, plus one "data" PNG the app
// reads back on click (depth and cover encoded in the colour channels).

import sharp from 'sharp';
import type { GridSpec } from '../../../shared/grid.ts';
import { snowClassColor } from '../../../shared/snowColors.ts';
import { COVER_CLOUD, COVER_NODATA, SNOW_FREE_BELOW_PCT } from './model.ts';

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

async function png(grid: GridSpec, rgba: Uint8Array): Promise<Buffer> {
  return sharp(rgba, { raw: { width: grid.width, height: grid.height, channels: 4 } })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

/**
 * Snow-covered cells in white (more opaque with more cover); views from earlier days fainter;
 * cells never seen through the clouds hatched grey.
 */
export function coverRgba(grid: GridSpec, cover: Uint8Array, age?: Uint8Array): Uint8Array {
  const out = new Uint8Array(grid.width * grid.height * 4);
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const i = row * grid.width + col;
      const v = cover[i];
      const o = i * 4;
      if (v === COVER_CLOUD) {
        const stripe = (col + row) % 6 < 2;
        out.set(stripe ? [110, 120, 135, 150] : [110, 120, 135, 35], o);
      } else if (v <= 100 && v >= SNOW_FREE_BELOW_PCT) {
        const alpha = 90 + ((v - SNOW_FREE_BELOW_PCT) / (100 - SNOW_FREE_BELOW_PCT)) * 140;
        const older = age && age[i] > 0;
        out.set([250, 252, 255, Math.round(older ? alpha * 0.55 : alpha)], o);
      }
      // Bare ground and no data stay transparent.
    }
  }
  return out;
}

/** Estimated depth in the shared snow colour classes; no snow is transparent. */
export function depthRgba(grid: GridSpec, depthCm: Float32Array): Uint8Array {
  const out = new Uint8Array(grid.width * grid.height * 4);
  for (let i = 0; i < depthCm.length; i++) {
    if (depthCm[i] < 0.5) continue;
    const [r, g, b] = hex(snowClassColor(depthCm[i]));
    out.set([r, g, b, 200], i * 4);
  }
  return out;
}

/** Grey veil over uncertain cells: strong for low confidence, light for medium. */
export function confidenceRgba(grid: GridSpec, confidence: Uint8Array): Uint8Array {
  const out = new Uint8Array(grid.width * grid.height * 4);
  for (let i = 0; i < confidence.length; i++) {
    if (confidence[i] === 0) out.set([80, 80, 80, 150], i * 4);
    else if (confidence[i] === 1) out.set([80, 80, 80, 60], i * 4);
  }
  return out;
}

/**
 * Lossless values for the click readout. Alpha stays 255 so browsers do not premultiply.
 * R = viewAge·16 + confidence·4 + (depth >> 8), G = depth & 255 (depth in whole cm, 0–1023),
 * B = cover value. viewAge is days since the satellite view (0–2, 3 = three or more / none).
 */
export function dataRgba(
  grid: GridSpec,
  depthCm: Float32Array,
  confidence: Uint8Array,
  cover: Uint8Array | null,
  age: Uint8Array | null,
): Uint8Array {
  const out = new Uint8Array(grid.width * grid.height * 4);
  for (let i = 0; i < depthCm.length; i++) {
    const d = Math.min(1023, Math.round(depthCm[i]));
    const a = age ? Math.min(3, age[i]) : 3;
    out.set([a * 16 + confidence[i] * 4 + (d >> 8), d & 255, cover ? cover[i] : COVER_NODATA, 255], i * 4);
  }
  return out;
}

export function decodeData(r: number, g: number, b: number): { depthCm: number; confidence: number; cover: number; viewAge: number } {
  return { depthCm: ((r & 3) << 8) + g, confidence: (r >> 2) & 3, cover: b, viewAge: r >> 4 };
}

export const encodePng = png;

/**
 * Snow line: the lowest 100 m elevation band where at least half of the clear (cloud-free)
 * satellite cells show 50 % or more snow, and the next two bands up agree. Bands with too few
 * clear cells are skipped; returns null when no band qualifies.
 */
export function snowLine(cover: Uint8Array, elevation: Float32Array, opts = { bandM: 100, minCells: 40 }): number | null {
  const clear = new Map<number, number>();
  const snowy = new Map<number, number>();
  for (let i = 0; i < cover.length; i++) {
    if (cover[i] > 100) continue;
    const band = Math.floor(elevation[i] / opts.bandM);
    clear.set(band, (clear.get(band) ?? 0) + 1);
    if (cover[i] >= 50) snowy.set(band, (snowy.get(band) ?? 0) + 1);
  }
  const bands = [...clear.keys()].filter((b) => clear.get(b)! >= opts.minCells).sort((a, b) => a - b);
  for (let k = 0; k < bands.length; k++) {
    const run = bands.slice(k, k + 3);
    if (run.length === 3 && run.every((b) => (snowy.get(b) ?? 0) / clear.get(b)! >= 0.5)) return bands[k] * opts.bandM;
  }
  return null;
}
