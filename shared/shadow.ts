// Cast shadows on the terrain grid for one sun position (tier 3 of docs/sun-shade-spike.md).
//
// One sweep from the sun's side of the grid: each cell's shadow top, the height of the shadow
// line above it, is the shadow top one step towards the sun lowered by the sun's slope over that
// step, or the cell's own ground if that is higher. A cell lies in shadow where the shadow top
// from upstream is above its ground. The step always crosses exactly one column (or row), so the
// upstream value lies between two cells already done and is interpolated between them. This costs
// a few operations per cell, against a march of up to hundreds of steps per cell for rays.
//
// Grid conventions as in shared/grid.ts: row 0 is the north edge, values row-major. Azimuth in
// degrees clockwise from north, altitude in degrees. The earth's curvature is left out: over the
// 10–30 km of a typical shadow it lowers a ridge by 7–60 m, less than the 250 m cells smooth away.

export const LIT = 0;
/** Faces the sun but a ridge between it and the sun blocks it. */
export const CAST = 1;
/** Turned away from the sun (or the sun is down): dark through the slope alone, as the hillshade draws it. */
export const AWAY = 2;

/** The grid with what does not depend on the sun worked out once. */
export interface ShadowTerrain {
  width: number;
  height: number;
  /** Elevation in metres, row-major from the north-west corner. */
  values: Float32Array;
  /** Cell size in metres for each row (cells are square). */
  cellSize: ArrayLike<number>;
  /** Rise per metre towards the east and the north, from central differences. */
  slopeE: Float32Array;
  slopeN: Float32Array;
  // Scratch space reused between calls.
  top: Float32Array;
  tan: Float32Array;
  sin: Float32Array;
  cos: Float32Array;
}

export function shadowTerrain(width: number, height: number, values: ArrayLike<number>, cellSize: ArrayLike<number>): ShadowTerrain {
  const n = width * height;
  const z = Float32Array.from(values);
  const slopeE = new Float32Array(n);
  const slopeN = new Float32Array(n);
  for (let row = 0; row < height; row++) {
    const size = cellSize[row];
    const up = Math.max(row - 1, 0);
    const down = Math.min(row + 1, height - 1);
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      slopeE[i] = (z[row * width + Math.min(col + 1, width - 1)] - z[row * width + Math.max(col - 1, 0)]) / (2 * size);
      slopeN[i] = (z[up * width + col] - z[down * width + col]) / (2 * size);
    }
  }
  const scratch = () => new Float32Array(n);
  return { width, height, values: z, cellSize, slopeE, slopeN, top: scratch(), tan: scratch(), sin: scratch(), cos: scratch() };
}

export interface ShadowSun {
  /** Direction of the sun, degrees clockwise from north; one direction for the whole grid. */
  azimuth: number;
  /**
   * Sun altitude in degrees: one value, or a lattice of cols × rows values spread evenly from the
   * grid's north-west to its south-east cell, interpolated in between.
   */
  altitude: number | { cols: number; rows: number; values: ArrayLike<number> };
}

const RAD = Math.PI / 180;

/** tan, sin and cos of the sun's altitude for every cell, interpolated from the lattice. */
function fillSunTerms(t: ShadowTerrain, altitude: ShadowSun['altitude']) {
  const lattice = typeof altitude === 'number' ? { cols: 1, rows: 1, values: [altitude] } : altitude;
  const { cols, rows } = lattice;
  const { width: w, height: h, tan, sin, cos } = t;
  const a = Array.from(lattice.values);
  const latTan = a.map((v) => Math.tan(Math.max(v, 0) * RAD));
  const latSin = a.map((v) => Math.sin(v * RAD));
  const latCos = a.map((v) => Math.cos(v * RAD));
  const rowTan = new Float64Array(cols);
  const rowSin = new Float64Array(cols);
  const rowCos = new Float64Array(cols);
  // Lattice column and weight for each grid column.
  const colI0 = new Int32Array(w);
  const colF = new Float64Array(w);
  for (let col = 0; col < w; col++) {
    const x = cols > 1 ? (col / (w - 1)) * (cols - 1) : 0;
    colI0[col] = Math.min(Math.floor(x), Math.max(cols - 2, 0));
    colF[col] = x - colI0[col];
  }
  const step = cols > 1 ? 1 : 0;
  for (let row = 0; row < h; row++) {
    const y = rows > 1 ? (row / (h - 1)) * (rows - 1) : 0;
    const j0 = Math.min(Math.floor(y), Math.max(rows - 2, 0));
    const j1 = Math.min(j0 + 1, rows - 1);
    const fy = y - j0;
    for (let i = 0; i < cols; i++) {
      const a0 = j0 * cols + i;
      const a1 = j1 * cols + i;
      rowTan[i] = latTan[a0] * (1 - fy) + latTan[a1] * fy;
      rowSin[i] = latSin[a0] * (1 - fy) + latSin[a1] * fy;
      rowCos[i] = latCos[a0] * (1 - fy) + latCos[a1] * fy;
    }
    const base = row * w;
    for (let col = 0; col < w; col++) {
      const i0 = colI0[col];
      const i1 = i0 + step;
      const f = colF[col];
      tan[base + col] = rowTan[i0] + (rowTan[i1] - rowTan[i0]) * f;
      sin[base + col] = rowSin[i0] + (rowSin[i1] - rowSin[i0]) * f;
      cos[base + col] = rowCos[i0] + (rowCos[i1] - rowCos[i0]) * f;
    }
  }
}

/** LIT, CAST or AWAY per cell. */
export function castShadows(t: ShadowTerrain, sun: ShadowSun): Uint8Array {
  const { width: w, height: h, values: z, cellSize, slopeE, slopeN, top } = t;
  fillSunTerms(t, sun.altitude);
  const { tan, sin, cos } = t;
  const out = new Uint8Array(w * h);
  const az = sun.azimuth * RAD;
  // Towards the sun in grid units: columns grow eastwards, rows southwards.
  const dx = Math.sin(az);
  const dy = -Math.cos(az);
  const byColumn = Math.abs(dx) >= Math.abs(dy);
  // Steps of one column (or row), with the fractional offset along the other axis.
  const along = byColumn ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
  const across = byColumn ? dy / Math.abs(dx) : dx / Math.abs(dy);
  const stepCells = Math.hypot(1, across);
  const lines = byColumn ? w : h;
  const span = byColumn ? h : w;
  // Index steps along a line and between lines.
  const posStride = byColumn ? w : 1;
  const lineStride = byColumn ? 1 : w;
  // Sun direction on the ground, east and north.
  const sunE = dx;
  const sunN = -dy;

  for (let k = 0; k < lines; k++) {
    // Start at the line nearest the sun and work away from it.
    const line = along > 0 ? lines - 1 - k : k;
    const base = line * lineStride;
    const upBase = (line + along) * lineStride;
    for (let pos = 0; pos < span; pos++) {
      const i = base + pos * posStride;
      const row = byColumn ? pos : line;
      const ground = z[i];
      let shadowTop = -Infinity;
      const p = pos + across;
      if (k > 0 && p >= 0 && p <= span - 1) {
        const p0 = Math.floor(p);
        const p1 = p0 + 1 < span ? p0 + 1 : p0;
        const f = p - p0;
        const up = top[upBase + p0 * posStride] * (1 - f) + top[upBase + p1 * posStride] * f;
        shadowTop = up - stepCells * cellSize[row] * tan[i];
      }
      top[i] = ground > shadowTop ? ground : shadowTop;
      // Normal (-slopeE, -slopeN, 1) against the sun (cos alt · sunE, cos alt · sunN, sin alt).
      const facing = (-slopeE[i] * sunE - slopeN[i] * sunN) * cos[i] + sin[i];
      if (sin[i] <= 0 || facing <= 0) out[i] = AWAY;
      else if (shadowTop > ground) out[i] = CAST;
      else out[i] = LIT;
    }
  }
  return out;
}
