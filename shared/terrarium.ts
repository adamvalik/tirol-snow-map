// Mapterhorn terrain tiles: 512 px Web Mercator tiles with elevation in terrarium encoding.
// Used by the pipeline's grid builder and by the app's horizon near a clicked point.

export const TERRARIUM_TILE = 512;

/** Global pixel coordinates at `zoom` for 512 px tiles. */
export function lonLatToPixel(lon: number, lat: number, zoom: number): { px: number; py: number } {
  const n = TERRARIUM_TILE * 2 ** zoom;
  const r = (lat * Math.PI) / 180;
  return { px: ((lon + 180) / 360) * n, py: ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n };
}

/** Decodes terrarium RGB into metres. */
export const terrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;
