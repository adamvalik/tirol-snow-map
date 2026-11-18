// Shade on a terrain grid for one sun position (tier 3 of docs/sun-shade-spike.md).
//
// One sweep from the sun's side of the grid: each cell's shadow line, the height of the line
// from the sun past the highest terrain so far, is the line one step towards the sun lowered by
// the sun's slope over that step, or the cell's own ground if that is higher. A cell lies in
// shadow where the line from upstream is above its ground. The step always crosses exactly one
// column (or row), so the upstream line lies between two cells already done and is interpolated
// between them. This costs a few operations per cell, against a march of up to hundreds of steps
// per cell for rays.
//
// The result is soft, as real shade is: the sun is a disc half a degree wide, so a shadow's edge
// blurs with the distance to the ridge that casts it (about 50 m at 10 km). A cell also counts as
// shaded where its slope turns away from the sun, and where the sun is below the round earth's
// horizon: a summit 3000 m up sees the sun about 1.6° (10 minutes) before the valley floor does,
// so the high peaks light up first and shade the valleys until the sun has risen over them.
//
// Grid conventions as in shared/grid.ts: row 0 is the north edge, values row-major. Azimuth in
// degrees clockwise from north, altitude in degrees (apparent, as SunCalc gives it). The earth's
// curvature is left out of the shadows cast inside the grid: over the 10–30 km of a typical
// shadow it lowers a ridge by 7–60 m, less than the 250 m cells smooth away.

/** The sun's radius in degrees, which sets how soft a shadow's edge is. */
export const SUN_RADIUS = 0.267;
/** Shadow line value for "no terrain upstream casts a line here". */
export const NO_LINE = -1e6;

const RAD = Math.PI / 180;
const EARTH_RADIUS = 6_371_000;
/** Standard refraction coefficient: light bends round the earth a little, lowering the horizon's dip. */
const REFRACTION = 0.13;
/** Facing angles within this of grazing (sin of ~1.5°) are blended between lit and turned away. */
const GRAZING = 0.026;

/** The grid, and optionally the shadow line of the last sweep (so a finer grid inside can start from it). */
export interface ShadowTerrain {
  width: number;
  height: number;
  /** Elevation in metres, row-major from the north-west corner. */
  values: Float32Array;
  /** Cell size in metres for each row (cells are square). */
  cellSize: ArrayLike<number>;
  /** Highest elevation in the grid. */
  zMax: number;
  /** Kept with `keepLine`: height of the shadow line arriving at each cell from the sun's side, or NO_LINE. */
  incoming: Float32Array | null;
  /** Kept with `keepLine`: metres from each cell back to the terrain that casts its line. */
  reach: Float32Array | null;
  /** The elevations column by column, built on the first sun from the east or west (sweeps read along a line). */
  byColumn?: Float32Array;
}

export function shadowTerrain(
  width: number,
  height: number,
  values: ArrayLike<number>,
  cellSize: ArrayLike<number>,
  keepLine = false,
): ShadowTerrain {
  const n = width * height;
  const z = values instanceof Float32Array ? values : Float32Array.from(values);
  let zMax = -Infinity;
  for (let i = 0; i < n; i++) if (z[i] > zMax) zMax = z[i];
  const kept = () => (keepLine ? new Float32Array(n) : null);
  return { width, height, values: z, cellSize, zMax, incoming: kept(), reach: kept() };
}

/** A sun altitude for a whole grid: one value, or a lattice of cols × rows values. */
export type SunAltitude = number | { cols: number; rows: number; values: ArrayLike<number> };

export interface ShadowSun {
  /** Direction of the sun, degrees clockwise from north; one direction for the whole grid. */
  azimuth: number;
  /**
   * Sun altitude in degrees: one value, or a lattice of cols × rows values spread evenly from the
   * grid's north-west to its south-east cell, interpolated in between.
   */
  altitude: SunAltitude;
}

/**
 * The shadow line where it enters the grid from outside: at a fractional (col, row) beyond the
 * grid's edge, its height and the distance back to its ridge, or null when nothing casts one.
 */
export type ShadowEdge = (col: number, row: number) => { line: number; reach: number } | null;

/** The lattice altitude at a fractional position, in lattice units (0 … cols − 1, 0 … rows − 1). */
export function latticeAltitude(altitude: SunAltitude, x: number, y: number): number {
  if (typeof altitude === 'number') return altitude;
  const { cols, rows, values } = altitude;
  const cx = Math.min(Math.max(x, 0), cols - 1);
  const cy = Math.min(Math.max(y, 0), rows - 1);
  const i0 = Math.min(Math.floor(cx), Math.max(cols - 2, 0));
  const j0 = Math.min(Math.floor(cy), Math.max(rows - 2, 0));
  const i1 = Math.min(i0 + 1, cols - 1);
  const j1 = Math.min(j0 + 1, rows - 1);
  const fx = cx - i0;
  const fy = cy - j0;
  const top = values[j0 * cols + i0] * (1 - fx) + values[j0 * cols + i1] * fx;
  const bottom = values[j1 * cols + i0] * (1 - fx) + values[j1 * cols + i1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Apparent dip of the sea-level horizon seen from `z` metres up, in degrees. */
export const horizonDip = (z: number): number => Math.sqrt((2 * Math.max(z, 0) * (1 - REFRACTION)) / EARTH_RADIUS) / RAD;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Per-row lattice values of the sun terms, and per-column weights, so each cell interpolates cheaply. */
function sunTerms(altitude: SunAltitude, w: number, h: number) {
  const lattice = typeof altitude === 'number' ? { cols: 1, rows: 1, values: [altitude] } : altitude;
  const { cols, rows } = lattice;
  const a = Array.from(lattice.values);
  const terms = [a.map((v) => v), a.map((v) => Math.tan(v * RAD)), a.map((v) => Math.sin(v * RAD)), a.map((v) => Math.cos(v * RAD))];
  // [alt, tan, sin, cos] × cols for each row.
  const perRow = terms.map(() => new Float64Array(h * cols));
  for (let row = 0; row < h; row++) {
    const y = rows > 1 ? (row / Math.max(h - 1, 1)) * (rows - 1) : 0;
    const j0 = Math.min(Math.floor(y), Math.max(rows - 2, 0));
    const j1 = Math.min(j0 + 1, rows - 1);
    const fy = y - j0;
    for (let k = 0; k < terms.length; k++) {
      for (let i = 0; i < cols; i++) perRow[k][row * cols + i] = terms[k][j0 * cols + i] * (1 - fy) + terms[k][j1 * cols + i] * fy;
    }
  }
  const colI0 = new Int32Array(w);
  const colF = new Float64Array(w);
  for (let col = 0; col < w; col++) {
    const x = cols > 1 ? (col / Math.max(w - 1, 1)) * (cols - 1) : 0;
    colI0[col] = Math.min(Math.floor(x), Math.max(cols - 2, 0));
    colF[col] = x - colI0[col];
  }
  return { cols, step: cols > 1 ? 1 : 0, alt: perRow[0], tan: perRow[1], sin: perRow[2], cos: perRow[3], colI0, colF, min: Math.min(...a), max: Math.max(...a) };
}

/**
 * How much of the sun each cell misses: 0 in full sun, 255 in full shade, soft in between.
 * `edge` brings in the shadow line from terrain outside the grid (a coarser grid around it).
 */
export function castShadows(t: ShadowTerrain, sun: ShadowSun, edge?: ShadowEdge): Uint8Array {
  const { width: w, height: h, values: z, cellSize, incoming, reach } = t;
  const out = new Uint8Array(w * h);
  const s = sunTerms(sun.altitude, w, h);
  // Below the dip of the highest summit's horizon (and the sun's radius) nothing can see the sun.
  if (s.max < -(horizonDip(t.zMax) + SUN_RADIUS + 0.05)) {
    incoming?.fill(NO_LINE);
    return out.fill(255);
  }
  const earthMatters = s.min < SUN_RADIUS + 0.05;
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
  // Sun direction on the ground, east and north.
  const sunE = dx;
  const sunN = -dy;
  const sunRadius = SUN_RADIUS * RAD;
  const { cols, step, colI0, colF } = s;
  const flat = cols === 1;
  // Elevations laid out line by line, so a sweep reads memory in order; the shade likewise.
  let zz = z;
  if (byColumn) {
    if (!t.byColumn) {
      t.byColumn = new Float32Array(w * h);
      for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) t.byColumn[col * h + row] = z[row * w + col];
    }
    zz = t.byColumn;
  }
  const shadeLines = byColumn ? new Uint8Array(w * h) : out;
  // The line leaving each cell of the previous line (the higher of its ground and the line it
  // received), and the distance back to its ridge; the current line is written beside it.
  let upTop = new Float32Array(span);
  let upReach = new Float32Array(span);
  let curTop = new Float32Array(span);
  let curReach = new Float32Array(span);
  let tan = s.tan[0];
  let sin = s.sin[0];
  let cos = s.cos[0];
  let altRad = s.alt[0] * RAD;
  // The upstream point is a fixed offset along the line: between cells p0 and p0 + 1, fp of the way.
  const a0 = Math.floor(across);
  const fp = across - a0;
  const first = Math.max(-a0, 0);
  const last = Math.min(span - 1 - a0 - (fp > 0 ? 1 : 0), span - 1);
  // Per row: the length of a step, and 1 / (2 × cell size) for the slopes.
  const runOf = Float64Array.from({ length: h }, (_, row) => stepCells * cellSize[row]);
  const halfInv = Float64Array.from({ length: h }, (_, row) => 1 / (2 * cellSize[row]));

  for (let k = 0; k < lines; k++) {
    // Start at the line nearest the sun and work away from it.
    const line = along > 0 ? lines - 1 - k : k;
    const base = line * span;
    // Neighbours one line back and forward, clamped at the grid's edge.
    const back = line > 0 ? -span : 0;
    const fwd = line + 1 < lines ? span : 0;
    for (let pos = 0; pos < span; pos++) {
      const j = base + pos;
      const row = byColumn ? pos : line;
      const col = byColumn ? line : pos;
      const size = cellSize[row];
      const run = runOf[row];
      if (!flat) {
        // The sun at this cell, interpolated on the lattice.
        const li = row * cols + colI0[col];
        const f = colF[col];
        tan = s.tan[li] + (s.tan[li + step] - s.tan[li]) * f;
        sin = s.sin[li] + (s.sin[li + step] - s.sin[li]) * f;
        cos = s.cos[li] + (s.cos[li + step] - s.cos[li]) * f;
        if (earthMatters) altRad = (s.alt[li] + (s.alt[li + step] - s.alt[li]) * f) * RAD;
      }
      const ground = zz[j];

      // The line arriving from one step towards the sun.
      let arriving = NO_LINE;
      let arrivingReach = 0;
      if (k > 0 && pos >= first && pos <= last) {
        const p0 = pos + a0;
        const p1 = fp > 0 ? p0 + 1 : p0;
        arriving = upTop[p0] + (upTop[p1] - upTop[p0]) * fp - run * tan;
        arrivingReach = upReach[p0] + (upReach[p1] - upReach[p0]) * fp + run;
      } else if (edge) {
        const p = pos + across;
        const e = byColumn ? edge(line + along, p) : edge(p, line + along);
        if (e && e.line > NO_LINE / 2) {
          arriving = e.line - run * tan;
          arrivingReach = e.reach + run;
        }
      }
      if (ground >= arriving) {
        curTop[pos] = ground;
        curReach[pos] = 0;
      } else {
        curTop[pos] = arriving;
        curReach[pos] = arrivingReach;
      }
      if (incoming) {
        const i = row * w + col;
        incoming[i] = arriving;
        reach![i] = arrivingReach;
      }

      // Cast: soft over the sun's disc seen from the cell, and over half a cell.
      let shade = 0;
      if (arriving > NO_LINE / 2) {
        const soft = Math.max(sunRadius * arrivingReach, 0.5 * size * Math.max(tan > 0 ? tan : -tan, 0.01));
        shade = smooth(-soft, soft, arriving - ground);
      }
      if (shade < 1) {
        // Turned away: the slope's normal (-slopeE, -slopeN, 1) against the sun, as the cosine of
        // the angle of incidence. Along a line and across lines, as the layout has them.
        const dAlong = (zz[pos + 1 < span ? j + 1 : j] - zz[pos > 0 ? j - 1 : j]) * halfInv[row];
        const dAcross = (zz[j + fwd] - zz[j + back]) * halfInv[row];
        // Columns grow eastwards and rows southwards.
        const slopeE = byColumn ? dAcross : dAlong;
        const slopeN = byColumn ? -dAlong : -dAcross;
        const facing = ((-slopeE * sunE - slopeN * sunN) * cos + sin) / Math.sqrt(1 + slopeE * slopeE + slopeN * slopeN);
        if (facing < GRAZING) {
          const away = smooth(GRAZING, -GRAZING, facing);
          if (away > shade) shade = away;
        }
      }
      if (earthMatters && shade < 1) {
        // Below the round earth's horizon, measured with the sun's disc.
        const dip = Math.sqrt((2 * (ground > 0 ? ground : 0) * (1 - REFRACTION)) / EARTH_RADIUS);
        const below = smooth(sunRadius, -sunRadius, altRad + dip);
        if (below > shade) shade = below;
      }
      shadeLines[j] = (shade * 255 + 0.5) | 0;
    }
    [upTop, curTop] = [curTop, upTop];
    [upReach, curReach] = [curReach, upReach];
  }
  if (byColumn) for (let col = 0; col < w; col++) for (let row = 0; row < h; row++) out[row * w + col] = shadeLines[col * h + row];
  return out;
}
