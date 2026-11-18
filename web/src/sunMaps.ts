// Sun maps for a whole day, shown instead of the shade at one time: when the sun first reaches each
// place, when it last leaves it, and how many hours it shines there. The same shade as the time
// slider's (shared/shadow.ts), worked out every 10 minutes through the day on the 250 m grid in a
// Web Worker (sunMapsWorker.ts), and draped on the map as one colour ramp: lighter is sunnier.

import type * as maplibregl from 'maplibre-gl';
import { cellCenter, gridCorners, MODEL_GRID } from '../../shared/grid.ts';
import type { ShadowSun } from '../../shared/shadow.ts';
import type { SunDayMaps } from '../../shared/sunDay.ts';
import { sunLattice } from './shadows.ts';
import type { SunMapsRequest, SunMapsResult } from './sunMapsWorker.ts';
import { clockTime, localDate, localMidnight, sunDay, sunPosition } from './sun.ts';
import type { Grid } from './terrainSampler.ts';
import type { SunMapKind } from './viewState.ts';

export const SUN_MAP_LAYER = 'sun-day-map';

const MINUTE = 60_000;
/** Steps through the day; the crossings are interpolated between them. */
const STEP = 10 * MINUTE;
/** Before the first flat sunrise and after the last flat sunset: summits see the sun earlier and later. */
const MARGIN = 30 * MINUTE;
/** Days kept, so going back to one is instant. */
const MAX_DAYS = 3;

/** One day's maps, with the instant their minutes count from. */
export interface SunDayResult extends SunDayMaps {
  start: number;
}

/** The ramp from sunniest (light) to least sun (dark), and the colour for no sun at all. */
export const SUN_RAMP: readonly (readonly [number, number, number])[] = [
  [255, 243, 196],
  [249, 215, 122],
  [238, 168, 60],
  [200, 113, 31],
  [138, 67, 24],
  [74, 36, 18],
];
export const NO_SUN: readonly [number, number, number] = [52, 65, 107];
const OPACITY = 0.7;

const css = (c: readonly number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** Colour on the ramp at f (0 sunniest … 1 least sun). */
export function rampColor(f: number): [number, number, number] {
  const x = Math.min(Math.max(f, 0), 1) * (SUN_RAMP.length - 1);
  const i = Math.min(Math.floor(x), SUN_RAMP.length - 2);
  const k = x - i;
  const a = SUN_RAMP[i];
  const b = SUN_RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** What a map shows, ready for the legend: the value range, which end is sunny, and its ticks. */
export interface SunMapScale {
  title: string;
  /** Values (minutes after the day's start, or minutes of sun) at the left and right of the bar. */
  lo: number;
  hi: number;
  /** Whether the left end is the sunny (light) one. */
  sunnyLeft: boolean;
  ticks: string[];
}

/** The value at fraction p (0–1) of the sorted finite values. */
function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/**
 * The legend scale for a map: the times between the 2nd and 98th percentile, rounded out to half
 * hours, so a few odd cells do not stretch the ramp; sun hours from zero to the most there is.
 */
export function sunMapScale(kind: SunMapKind, day: SunDayResult): SunMapScale {
  const values = kind === 'first' ? day.firstSun : kind === 'last' ? day.lastSun : day.sunMinutes;
  const finite = Float32Array.from(values.filter((v) => Number.isFinite(v) && (kind !== 'hours' || v > 0))).sort();
  if (!finite.length) return { title: titleOf(kind), lo: 0, hi: 1, sunnyLeft: true, ticks: [] };
  if (kind === 'hours') {
    const hi = Math.max(60, Math.ceil(percentile(finite, 0.995) / 60) * 60);
    const ticks = [0, hi / 2, hi].map((m) => `${+(m / 60).toFixed(1)} h`);
    // Most sun on the right, as the hours grow.
    return { title: titleOf(kind), lo: 0, hi, sunnyLeft: false, ticks };
  }
  // Rounded to half hours of the clock, which is whole half hours after local midnight.
  const offset = (day.start - localMidnight(localDate(day.start))) / MINUTE;
  const half = (v: number, up: boolean) => (up ? Math.ceil((v + offset) / 30) : Math.floor((v + offset) / 30)) * 30 - offset;
  const lo = half(percentile(finite, 0.02), false);
  const hi = Math.max(half(percentile(finite, 0.98), true), lo + 30);
  const ticks = [lo, (lo + hi) / 2, hi].map((m) => clockTime(day.start + m * MINUTE));
  return { title: titleOf(kind), lo, hi, sunnyLeft: kind === 'first', ticks };
}

const titleOf = (kind: SunMapKind) =>
  kind === 'first' ? 'First sun, terrain only' : kind === 'last' ? 'Last sun, terrain only' : 'Hours of sun, terrain only';

/** The bar's background, left to right as the scale has it. */
export function scaleGradient(s: SunMapScale): string {
  const stops = SUN_RAMP.map((_, i) => css(SUN_RAMP[s.sunnyLeft ? i : SUN_RAMP.length - 1 - i]));
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** RGBA pixels of a map on the 250 m grid. */
export function sunMapPixels(kind: SunMapKind, day: SunDayResult, s: SunMapScale): Uint8ClampedArray<ArrayBuffer> {
  const values = kind === 'first' ? day.firstSun : kind === 'last' ? day.lastSun : day.sunMinutes;
  const out = new Uint8ClampedArray(values.length * 4);
  const alpha = Math.round(255 * OPACITY);
  const span = s.hi - s.lo;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    let c: readonly number[];
    if (!Number.isFinite(v) || (kind === 'hours' && v < 1)) c = NO_SUN;
    else {
      const f = (v - s.lo) / span;
      c = rampColor(s.sunnyLeft ? f : 1 - f);
    }
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = alpha;
  }
  return out;
}

/** The steps through a local day, from before the first summit sees the sun to after the last loses it. */
export function dayTimes(date: string): number[] {
  const { west, east, north, south } = MODEL_GRID;
  const corners = [
    [west, north],
    [east, north],
    [west, south],
    [east, south],
  ].map(([lon, lat]) => sunDay(date, lat, lon));
  const rises = corners.map((d) => d.sunrise).filter((t): t is number => t !== null);
  const sets = corners.map((d) => d.sunset).filter((t): t is number => t !== null);
  if (!rises.length || !sets.length) return [];
  const from = Math.min(...rises) - MARGIN;
  const to = Math.max(...sets) + MARGIN;
  const times: number[] = [];
  for (let t = from; t < to; t += STEP) times.push(t);
  times.push(to);
  return times;
}

/** The sun for the whole grid at time t: the direction at its centre, the altitude on a lattice. */
function gridSun(t: number): ShadowSun {
  const c = cellCenter(MODEL_GRID, MODEL_GRID.width / 2, MODEL_GRID.height / 2);
  return { azimuth: sunPosition(t, c.lat, c.lon).azimuth, altitude: sunLattice(t) };
}

export class SunMapLayer {
  private worker: Worker | null = null;
  private nextId = 0;
  private readonly waiting = new Map<number, (r: SunMapsResult) => void>();
  private readonly days = new Map<string, Promise<SunDayResult>>();
  private added = false;
  /** What is asked for now; an answer for anything else is not drawn. */
  private wanted = '';

  constructor(
    private readonly map: maplibregl.Map,
    private readonly beforeId: () => string | undefined,
  ) {}

  /** The maps for a day, worked out once and kept. */
  day(grid: Grid, date: string): Promise<SunDayResult> {
    let p = this.days.get(date);
    if (!p) {
      p = this.compute(grid, date);
      p.catch(() => this.days.delete(date));
      this.days.set(date, p);
      while (this.days.size > MAX_DAYS) this.days.delete(this.days.keys().next().value!);
    }
    return p;
  }

  private compute(grid: Grid, date: string): Promise<SunDayResult> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./sunMapsWorker.ts', import.meta.url), { type: 'module' });
      const message: SunMapsRequest = { type: 'terrain', values: grid.values };
      this.worker.postMessage(message);
      this.worker.onmessage = (e: MessageEvent<SunMapsResult>) => {
        this.waiting.get(e.data.id)?.(e.data);
        this.waiting.delete(e.data.id);
      };
    }
    const times = dayTimes(date);
    const request: SunMapsRequest = { type: 'day', id: ++this.nextId, times, suns: times.map(gridSun) };
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      this.waiting.set(request.id, (r) => {
        document.body.dataset.sunMapMs = r.ms.toFixed(0);
        resolve({ firstSun: r.firstSun, lastSun: r.lastSun, sunMinutes: r.sunMinutes, start: times[0] ?? localMidnight(date) });
      });
      worker.onerror = (e) => {
        for (const id of this.waiting.keys()) this.waiting.delete(id);
        this.days.clear();
        this.worker = null;
        reject(new Error(e.message || 'the sun map worker stopped'));
      };
      worker.postMessage(request);
    });
  }

  /**
   * Shows a map for a day once it is worked out, and returns its scale for the legend; null when
   * something else was asked for meanwhile.
   */
  async show(grid: Grid, date: string, kind: SunMapKind): Promise<SunMapScale | null> {
    const key = `${date}/${kind}`;
    this.wanted = key;
    const day = await this.day(grid, date);
    if (this.wanted !== key) return null;
    const scale = sunMapScale(kind, day);
    const image = new ImageData(sunMapPixels(kind, day, scale), MODEL_GRID.width, MODEL_GRID.height);
    if (!this.added) {
      // Added on first use, above the snow and the shade, under roads and labels.
      this.map.addSource(SUN_MAP_LAYER, { type: 'image', coordinates: gridCorners(MODEL_GRID) });
      this.map.addLayer(
        {
          id: SUN_MAP_LAYER,
          type: 'raster',
          source: SUN_MAP_LAYER,
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
        },
        this.beforeId(),
      );
      this.added = true;
    }
    (this.map.getSource(SUN_MAP_LAYER) as maplibregl.ImageSource).updateImage({ image });
    this.map.setLayoutProperty(SUN_MAP_LAYER, 'visibility', 'visible');
    return scale;
  }

  hide() {
    this.wanted = '';
    if (this.added) this.map.setLayoutProperty(SUN_MAP_LAYER, 'visibility', 'none');
  }
}
