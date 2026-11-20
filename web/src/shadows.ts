// Shade on the map: where the sun of the time slider does not reach, because a ridge stands in the
// way, the slope turns away from it or it is still below the horizon (shared/shadow.ts). The whole
// region is shaded on the 250 m terrain grid; around the view, from zoom 9.5, a finer grid from
// Mapterhorn tiles (13–100 m) sharpens the shadows where they are looked at. The work runs in a
// Web Worker (shadowWorker.ts), which hands back two images; the map drapes them right above the
// hillshade, so roads, data layers and labels stay on top.

import type * as maplibregl from 'maplibre-gl';
import { cellCenter, gridCorners, MODEL_GRID } from '../../shared/grid.ts';
import { horizonDip, SUN_RADIUS } from '../../shared/shadow.ts';
import { lonLatToPixel, TERRARIUM_TILE } from '../../shared/terrarium.ts';
import type { DetailBlock, ShadeLook, ShadowImage, ShadowReply, ShadowRequest, ShadowResult } from './shadowWorker.ts';
import { checkBuildFile } from './app/newDeploy.ts';
import { sunPosition } from './sun.ts';
import type { Grid } from './terrainSampler.ts';

export const SHADOW_LAYER = 'sun-shadows';
const DETAIL_LAYER = 'sun-shadows-detail';

/** The sun's altitude is computed on this lattice and interpolated per cell; it varies by ~1° across the region. */
const LATTICE = { cols: 9, rows: 6 };
/** Below this zoom the 250 m cells are a few pixels at most, and the finer grid is left out. */
const DETAIL_MIN_ZOOM = 9.5;
/** Finest tiles used: zoom 12 has 13 m cells, about one screen pixel at zoom 12.5. */
const DETAIL_MAX_TILE_ZOOM = 12;
/** The finer grid is 2 × 2 tiles of 512 px: 1.4–2.9 thousand screen pixels across. */
const DETAIL_TILES = 2;
/**
 * A shade not back after this long is given up: the light changes without it and play goes on.
 * Far above a slow phone's time for one sun (well under a second), but short enough that the map
 * never seems stuck.
 */
export const SHADE_TIMEOUT_MS = 8000;
/** Below this altitude even the highest summits (3905 m) have lost the sun, so the shade is the same everywhere. */
const ALL_SHADE = -(horizonDip(4000) + SUN_RADIUS + 0.05);

type Coordinates = [[number, number], [number, number], [number, number], [number, number]];

/** Corners of a block of tiles, in MapLibre's order: top-left, top-right, bottom-right, bottom-left. */
function blockCorners(b: DetailBlock): Coordinates {
  const n = 2 ** b.z;
  const lon = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const [w, e, nn, s] = [lon(b.x), lon(b.x + b.nx), lat(b.y), lat(b.y + b.ny)];
  return [
    [w, nn],
    [e, nn],
    [e, s],
    [w, s],
  ];
}

/**
 * The tiles for the finer grid around the map centre, at a zoom where a tile pixel is about one
 * screen pixel, clipped to the grid; null when zoomed out.
 */
export function detailBlock(zoom: number, lon: number, lat: number, size = DETAIL_TILES): DetailBlock | null {
  if (zoom < DETAIL_MIN_ZOOM) return null;
  const z = Math.min(DETAIL_MAX_TILE_ZOOM, Math.floor(zoom - 0.5));
  const T = TERRARIUM_TILE;
  const c = lonLatToPixel(lon, lat, z);
  const nw = lonLatToPixel(MODEL_GRID.west, MODEL_GRID.north, z);
  const se = lonLatToPixel(MODEL_GRID.east, MODEL_GRID.south, z);
  // Tiles touching the grid, and a block of `size` centred on the view within them.
  const fit = (centre: number, first: number, last: number) => {
    const n = Math.min(size, last - first + 1);
    const start = Math.min(Math.max(Math.floor(centre / T - n / 2 + 0.5), first), last - n + 1);
    return { start, n };
  };
  const x = fit(c.px, Math.floor(nw.px / T), Math.floor((se.px - 1) / T));
  const y = fit(c.py, Math.floor(nw.py / T), Math.floor((se.py - 1) / T));
  return { z, x: x.start, y: y.start, nx: x.n, ny: y.n };
}

const blockKey = (b: DetailBlock | null) => (b ? `${b.z}/${b.x}/${b.y}/${b.nx}/${b.ny}` : '-');

export class ShadowLayer {
  private worker: Worker | null = null;
  private lastKey = '';
  private nextId = 0;
  /** Worker answers older than this were overtaken by shade drawn without the worker. */
  private minId = 0;
  /** What to do once a request's shade is on the map (the light that goes with it), by request id. */
  private readonly pending = new Map<number, () => void>();
  private visible = false;
  private drawn = false;
  private hasDetail = false;
  /** The image on each source, closed once replaced. */
  private readonly shown = new Map<string, ShadowImage>();
  /** Gives up on the pending shade when the worker does not answer (see SHADE_TIMEOUT_MS). */
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  /** Called with the worker's time for each drawn result, in ms. */
  onDrawn: ((ms: number) => void) | null = null;
  /** Called once when the worker fails or stops answering; the shade is then left off. */
  onFailed: ((reason: string) => void) | null = null;

  constructor(
    private readonly map: maplibregl.Map,
    beforeId: string | undefined,
    private readonly tiles: string,
  ) {
    const raster = (id: string) =>
      map.addLayer(
        {
          id,
          type: 'raster',
          source: id,
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
        },
        beforeId,
      );
    map.addSource(SHADOW_LAYER, { type: 'image', coordinates: gridCorners(MODEL_GRID) });
    map.addSource(DETAIL_LAYER, { type: 'image', coordinates: gridCorners(MODEL_GRID) });
    raster(SHADOW_LAYER);
    raster(DETAIL_LAYER);
  }

  /** Whether shade asked for is still being worked out. */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  hide() {
    this.visible = false;
    this.pending.clear();
    // Whatever is on its way is not wanted any more: the next show asks again.
    this.lastKey = '';
    clearTimeout(this.watchdog);
    this.map.setLayoutProperty(SHADOW_LAYER, 'visibility', 'none');
    this.map.setLayoutProperty(DETAIL_LAYER, 'visibility', 'none');
  }

  /**
   * Shade for the sun at time t, drawn when the worker has it; the old shade stays until then, and
   * `shown` runs once it is on the map, so the light can change with it. Once every summit has lost
   * the sun it is drawn at once, without the terrain. `quick` leaves out the finer grid, for a
   * slider being dragged. Returns false while it needs the terrain grid to go on.
   */
  show(grid: Grid | null, t: number, azimuth: number, look: ShadeLook, quick: boolean, shown: () => void): boolean {
    this.visible = true;
    const { width, height } = MODEL_GRID;
    const values: number[] = [];
    for (let j = 0; j < LATTICE.rows; j++) {
      for (let i = 0; i < LATTICE.cols; i++) {
        const p = cellCenter(MODEL_GRID, (i / (LATTICE.cols - 1)) * (width - 1), (j / (LATTICE.rows - 1)) * (height - 1));
        values.push(sunPosition(t, p.lat, p.lon).altitude);
      }
    }
    const night = Math.max(...values) < ALL_SHADE;
    const c = this.map.getCenter();
    const detail = night || quick ? null : detailBlock(this.map.getZoom(), c.lng, c.lat);
    // Redraw only when the sun, the look or the finer grid's block has changed.
    const key = `${night ? 'night' : `${Math.round(t / 60_000)}/${azimuth.toFixed(1)}`}/${look.color.join(',')}/${look.opacity.toFixed(3)}/${blockKey(detail)}`;
    if (key === this.lastKey) {
      // Still on its way: the light follows it; already shown: change the light now.
      if (this.pending.size) this.pending.set(this.nextId, shown);
      else shown();
      this.reveal();
      return true;
    }
    if (night) {
      this.lastKey = key;
      this.minId = ++this.nextId;
      this.pending.set(this.minId, shown);
      const [r, g, b] = look.color;
      this.draw({ id: this.minId, coarse: new ImageData(new Uint8ClampedArray([r, g, b, Math.round(255 * look.opacity)]), 1, 1), detail: null, ms: 0 });
      return true;
    }
    if (!grid) return false;
    // The worker failed before: no shade, only the light.
    if (this.failed) {
      shown();
      return true;
    }
    this.lastKey = key;
    if (!this.worker) this.startWorker(grid);
    const request: ShadowRequest = { type: 'sun', id: ++this.nextId, sun: { azimuth, altitude: { ...LATTICE, values } }, look, detail };
    this.pending.set(request.id, shown);
    this.worker!.postMessage(request);
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.fail('the shade took too long'), SHADE_TIMEOUT_MS);
    return true;
  }

  private failed = false;

  /**
   * The worker failed or stopped answering: let the light change and the day play on without the
   * shade, and leave it off from now on (a reload tries again).
   */
  private fail(reason: string) {
    clearTimeout(this.watchdog);
    if (this.failed) return;
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const shown of this.pending.values()) shown();
    this.pending.clear();
    this.map.setLayoutProperty(SHADOW_LAYER, 'visibility', 'none');
    this.map.setLayoutProperty(DETAIL_LAYER, 'visibility', 'none');
    this.drawn = false;
    this.onFailed?.(reason);
  }

  private startWorker(grid: Grid) {
    const worker = new Worker(new URL('./shadowWorker.ts', import.meta.url), { type: 'module' });
    const message: ShadowRequest = { type: 'terrain', values: grid.values, tiles: this.tiles };
    worker.postMessage(message);
    worker.onmessage = (e: MessageEvent<ShadowReply>) => ('error' in e.data ? this.fail(e.data.error) : this.draw(e.data));
    // The worker did not start or crashed.
    worker.onerror = (e) => {
      // The worker file of an older build, replaced by a deploy? Then this module's own file (the
      // hashed app chunk) is gone too, and the page reloads once (app/newDeploy.ts).
      checkBuildFile(import.meta.url);
      this.fail(e.message || 'the shade worker stopped');
    };
    this.worker = worker;
  }

  private draw(result: ShadowResult) {
    if (result.id < this.minId || this.failed) return;
    // The light for this shade; requests the worker skipped are dropped with theirs.
    const shown = this.pending.get(result.id);
    for (const id of this.pending.keys()) if (id <= result.id) this.pending.delete(id);
    if (!this.pending.size) clearTimeout(this.watchdog);
    // A new image (and its corners) redraws the terrain it is draped on.
    const update = (id: string, image: ShadowImage, coordinates?: Coordinates) => {
      (this.map.getSource(id) as maplibregl.ImageSource).updateImage({ image, coordinates });
      const old = this.shown.get(id);
      if (old && 'close' in old) old.close();
      this.shown.set(id, image);
    };
    update(SHADOW_LAYER, result.coarse);
    if (result.detail) update(DETAIL_LAYER, result.detail.image, blockCorners(result.detail.block));
    this.hasDetail = !!result.detail;
    this.onDrawn?.(result.ms);
    this.drawn = true;
    this.reveal();
    shown?.();
  }

  /** Shows the layers once they have something drawn, unless hidden meanwhile. */
  private reveal() {
    if (!this.visible || !this.drawn) return;
    this.map.setLayoutProperty(SHADOW_LAYER, 'visibility', 'visible');
    this.map.setLayoutProperty(DETAIL_LAYER, 'visibility', this.hasDetail ? 'visible' : 'none');
  }
}
