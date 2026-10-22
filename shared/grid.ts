// The model grid shared by the pipeline (which writes rasters on it) and the app (which drapes
// them on the map and reads values on click). Rows are evenly spaced in Web Mercator, so an
// image on this grid lines up exactly when MapLibre places it by its four corners.

export interface GridSpec {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
}

const R = 6378137;
export const mercY = (lat: number): number => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
export const latFromMercY = (y: number): number => (360 / Math.PI) * Math.atan(Math.exp(y / R)) - 90;

/** South Tyrol with a margin, ~250 m cells (764 × 512). */
export const MODEL_GRID: GridSpec = { west: 10.2, south: 46.1, east: 12.7, north: 47.25, width: 764, height: 512 };

/** Longitude/latitude of the centre of cell (col, row); row 0 is the northern edge. */
export function cellCenter(g: GridSpec, col: number, row: number): { lon: number; lat: number } {
  const lon = g.west + ((col + 0.5) / g.width) * (g.east - g.west);
  const yN = mercY(g.north);
  const yS = mercY(g.south);
  const lat = latFromMercY(yN - ((row + 0.5) / g.height) * (yN - yS));
  return { lon, lat };
}

/** Cell containing a point, or null outside the grid. */
export function cellAt(g: GridSpec, lon: number, lat: number): { col: number; row: number } | null {
  if (lon < g.west || lon >= g.east || lat <= g.south || lat > g.north) return null;
  const col = Math.floor(((lon - g.west) / (g.east - g.west)) * g.width);
  const yN = mercY(g.north);
  const row = Math.floor(((yN - mercY(lat)) / (yN - mercY(g.south))) * g.height);
  return { col: Math.min(col, g.width - 1), row: Math.min(row, g.height - 1) };
}

/** Image corners in MapLibre's order: top-left, top-right, bottom-right, bottom-left. */
export const gridCorners = (g: GridSpec): [[number, number], [number, number], [number, number], [number, number]] => [
  [g.west, g.north],
  [g.east, g.north],
  [g.east, g.south],
  [g.west, g.south],
];

/** Bilinear value at a point from grid cell values (row-major from the north-west), or null outside the grid. */
export function sampleGrid(g: GridSpec, values: ArrayLike<number>, lon: number, lat: number): number | null {
  if (lon < g.west || lon > g.east || lat < g.south || lat > g.north) return null;
  const yN = mercY(g.north);
  // Fractional cell coordinates measured between cell centres.
  const x = Math.min(Math.max(((lon - g.west) / (g.east - g.west)) * g.width - 0.5, 0), g.width - 1);
  const y = Math.min(Math.max(((yN - mercY(lat)) / (yN - mercY(g.south))) * g.height - 0.5, 0), g.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, g.width - 1);
  const y1 = Math.min(y0 + 1, g.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = values[y0 * g.width + x0] * (1 - fx) + values[y0 * g.width + x1] * fx;
  const bottom = values[y1 * g.width + x0] * (1 - fx) + values[y1 * g.width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Size of the (square) cells in each row in metres on a 6371 km sphere; Mercator rows shrink towards the north. */
export function rowCellSizes(g: GridSpec): Float64Array {
  const sizes = new Float64Array(g.height);
  const width = (((g.east - g.west) / g.width) * Math.PI * 6_371_000) / 180;
  for (let row = 0; row < g.height; row++) sizes[row] = width * Math.cos((cellCenter(g, 0, row).lat * Math.PI) / 180);
  return sizes;
}
