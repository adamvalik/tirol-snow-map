// Cast shadows on the map: where a ridge stands between a sun-facing slope and the sun, for the
// sun of the time slider (shared/shadow.ts on the 250 m terrain grid). The hillshade already
// darkens slopes turned away from the sun, so only the cast shadows are painted.

import type * as maplibregl from 'maplibre-gl';
import { cellCenter, gridCorners, MODEL_GRID, rowCellSizes } from '../../shared/grid.ts';
import { CAST } from '../../shared/shadow.ts';
import type { ShadowRequest, ShadowResult } from './shadowWorker.ts';
import { sunPosition } from './sun.ts';
import type { Grid } from './terrainSampler.ts';

export const SHADOW_LAYER = 'sun-shadows';

/** Shade colour and strength; bluish like snow in shadow, a little lighter than the hillshade's darkest. */
const SHADOW_RGBA = [24, 32, 60, 140] as const;
/** The sun's altitude is computed on this lattice and interpolated per cell; it varies by ~1° across the region. */
const LATTICE = { cols: 9, rows: 6 };

export class ShadowLayer {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private worker: Worker | null = null;
  private lastKey = '';
  private nextId = 0;
  /** A request sent to the worker and not answered yet, and the newest one waiting behind it. */
  private busy = false;
  private queued: Extract<ShadowRequest, { type: 'sun' }> | null = null;
  private visible = false;
  private drawn = false;
  /** Called with the worker's time for each drawn result, in ms. */
  onDrawn: ((ms: number) => void) | null = null;

  constructor(
    private readonly map: maplibregl.Map,
    beforeId: string | undefined,
  ) {
    const { width, height } = MODEL_GRID;
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(width, height);
    map.addSource(SHADOW_LAYER, { type: 'canvas', canvas: this.canvas, animate: false, coordinates: gridCorners(MODEL_GRID) });
    map.addLayer(
      {
        id: SHADOW_LAYER,
        type: 'raster',
        source: SHADOW_LAYER,
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      },
      beforeId,
    );
  }

  hide() {
    this.visible = false;
    this.map.setLayoutProperty(SHADOW_LAYER, 'visibility', 'none');
  }

  /** Shadows for the sun at time t, drawn when the worker has them; the old ones stay until then. */
  show(grid: Grid, t: number, azimuth: number) {
    this.visible = true;
    if (!this.worker) this.startWorker(grid);
    // Redraw only when the sun has moved enough to matter.
    const key = `${Math.round(t / 60_000)}/${azimuth.toFixed(1)}`;
    if (key === this.lastKey) {
      this.reveal();
      return;
    }
    this.lastKey = key;
    const { width, height } = MODEL_GRID;
    const values: number[] = [];
    for (let j = 0; j < LATTICE.rows; j++) {
      for (let i = 0; i < LATTICE.cols; i++) {
        const c = cellCenter(MODEL_GRID, (i / (LATTICE.cols - 1)) * (width - 1), (j / (LATTICE.rows - 1)) * (height - 1));
        values.push(sunPosition(t, c.lat, c.lon).altitude);
      }
    }
    const request = { type: 'sun', id: ++this.nextId, sun: { azimuth, altitude: { ...LATTICE, values } } } as const;
    if (this.busy) this.queued = request;
    else this.send(request);
  }

  private startWorker(grid: Grid) {
    const worker = new Worker(new URL('./shadowWorker.ts', import.meta.url), { type: 'module' });
    const { width, height } = MODEL_GRID;
    const message: ShadowRequest = { type: 'terrain', width, height, values: grid.values, cellSize: rowCellSizes(MODEL_GRID) };
    worker.postMessage(message);
    worker.onmessage = (e: MessageEvent<ShadowResult>) => {
      this.busy = false;
      this.draw(e.data.mask);
      this.onDrawn?.(e.data.ms);
      // Only the newest sun waiting is worth computing; anything older was skipped.
      const next = this.queued;
      this.queued = null;
      if (next) this.send(next);
    };
    this.worker = worker;
  }

  private send(request: Extract<ShadowRequest, { type: 'sun' }>) {
    this.busy = true;
    this.worker!.postMessage(request);
  }

  private draw(mask: Uint8Array) {
    const px = this.image.data;
    for (let i = 0; i < mask.length; i++) {
      px[i * 4] = SHADOW_RGBA[0];
      px[i * 4 + 1] = SHADOW_RGBA[1];
      px[i * 4 + 2] = SHADOW_RGBA[2];
      px[i * 4 + 3] = mask[i] === CAST ? SHADOW_RGBA[3] : 0;
    }
    this.ctx.putImageData(this.image, 0, 0);
    // A paused canvas source copies the canvas when it is paused again.
    const source = this.map.getSource(SHADOW_LAYER) as maplibregl.CanvasSource;
    source.play();
    source.pause();
    this.drawn = true;
    this.reveal();
  }

  /** Shows the layer once it has something drawn, unless it was hidden meanwhile. */
  private reveal() {
    if (!this.visible || !this.drawn) return;
    this.map.setLayoutProperty(SHADOW_LAYER, 'visibility', 'visible');
    this.map.triggerRepaint();
  }
}
