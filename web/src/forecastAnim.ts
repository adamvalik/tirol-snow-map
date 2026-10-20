// Forecast new snow animation: one image source on the model grid whose picture is swapped frame
// by frame (data/forecast/fNN.png, each the snow accumulated since the forecast start).

import type * as maplibregl from 'maplibre-gl';
import { gridCorners, MODEL_GRID } from '../../shared/grid.ts';
import { type ForecastFile, SCHEMA_VERSION } from '../../shared/types.ts';
import { escapeHtml, formatAge, formatTime } from './format.ts';

const DATA = `${import.meta.env.BASE_URL}data/`;
export const FORECAST_LAYER = 'forecast-snow';
const FRAME_MS = 700;
/** Extra ticks the last frame stays before the loop starts over. */
const HOLD_TICKS = 3;

export async function loadForecast(): Promise<ForecastFile> {
  const res = await fetch(`${DATA}forecast.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`forecast.json: HTTP ${res.status}`);
  const file = (await res.json()) as ForecastFile;
  if (file.schemaVersion !== SCHEMA_VERSION) throw new Error(`forecast.json: unsupported schema ${file.schemaVersion}`);
  return file;
}

/** "Wed 21 Oct, 14:00 · +24 h · up to 31 cm" for frame `k`. */
export function frameLabel(file: ForecastFile, k: number): string {
  const f = file.frames?.[k];
  if (!f || !file.start) return '';
  const when = new Date(f.time).toLocaleString('en-GB', {
    timeZone: 'Europe/Rome',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const hours = Math.round((Date.parse(f.time) - Date.parse(file.start)) / 3_600_000);
  return `${when} · +${hours} h · new snow up to ${f.maxCm} cm`;
}

export function forecastInfoHtml(file: ForecastFile): string {
  if (!file.available || !file.frames?.length) {
    return `<p><strong>Forecast snowfall</strong>: not available (${escapeHtml(file.reason ?? 'unknown')}).</p>`;
  }
  const fl = file.freezingLevelM;
  return (
    `<p><strong>Forecast snowfall</strong>: new snow from ${formatTime(file.start)} for the next ${file.frames.length * (file.stepHours ?? 3)} hours, ` +
    `Open-Meteo precipitation and freezing level at ${file.points} points about 10 km apart, fetched ${formatTime(file.fetchedAt)} (${formatAge(file.fetchedAt)}). ` +
    `The terrain decides rain or snow: snow from about 300 m below the freezing level, 1 cm of snow per mm of water.` +
    (fl ? ` Freezing level ${fl[0].toLocaleString('en-GB')}–${fl[1].toLocaleString('en-GB')} m.` : '') +
    ` Model output, not a measurement.</p>`
  );
}

export class ForecastAnimation {
  private frame = 0;
  private timer: number | null = null;
  private hold = 0;
  private preloaded = false;
  private readonly base: string;

  constructor(
    private map: maplibregl.Map,
    private file: ForecastFile,
    beforeId: string | undefined,
    visible: boolean,
    private onFrame: (k: number) => void,
  ) {
    this.base = new URL(DATA, window.location.href).href;
    map.addSource(FORECAST_LAYER, { type: 'image', url: this.url(0), coordinates: gridCorners(MODEL_GRID) });
    map.addLayer(
      {
        id: FORECAST_LAYER,
        type: 'raster',
        source: FORECAST_LAYER,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      },
      beforeId,
    );
    if (visible) this.preload();
  }

  get count(): number {
    return this.file.frames?.length ?? 0;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  private url(k: number): string {
    return `${this.base}${this.file.frames![k].file}?v=${encodeURIComponent(this.file.generatedAt)}`;
  }

  /** Fetch every frame once so playback swaps pictures from the browser cache. */
  private preload() {
    if (this.preloaded) return;
    this.preloaded = true;
    for (let k = 0; k < this.count; k++) void fetch(this.url(k)).catch(() => undefined);
  }

  setVisible(on: boolean) {
    this.map.setLayoutProperty(FORECAST_LAYER, 'visibility', on ? 'visible' : 'none');
    if (on) this.preload();
    else this.pause();
  }

  setFrame(k: number) {
    this.frame = Math.max(0, Math.min(this.count - 1, k));
    (this.map.getSource(FORECAST_LAYER) as maplibregl.ImageSource).updateImage({ url: this.url(this.frame) });
    this.onFrame(this.frame);
  }

  play() {
    if (this.timer !== null || this.count < 2) return;
    this.preload();
    if (this.frame >= this.count - 1) this.setFrame(0);
    this.timer = window.setInterval(() => {
      if (this.frame < this.count - 1) this.setFrame(this.frame + 1);
      else if (this.hold++ >= HOLD_TICKS) {
        this.hold = 0;
        this.setFrame(0);
      }
    }, FRAME_MS);
  }

  pause() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.hold = 0;
  }
}
