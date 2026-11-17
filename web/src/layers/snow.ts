// Snow seen from space (the white picture and the 250 m snow share), the estimated snow depth and its
// uncertainty: four pictures from one snow.json, swapped together by the day slider.
import type { SnowFile } from '../../../shared/types.ts';
import { selectedDay } from '../app/day.ts';
import { setAge } from '../app/ages.ts';
import { $ } from '../app/dom.ts';
import { isOn, setAvailable } from '../app/switches.ts';
import { setNewSnow, setWarning } from '../app/warnings.ts';
import { NO_SNOW_SENSOR_COLOR, SNOW_CLASSES } from '../colors.ts';
import { FORECAST_LAYER } from '../forecastAnim.ts';
import { ageHours, formatAge } from '../format.ts';
import { shortDate } from '../satellite.ts';
import {
  loadSnow,
  type PointSnow,
  pointSnowHtml,
  routeSnow,
  routeSnowHtml,
  routeSnowPoints,
  type RouteSnow,
  SNOW_LAYERS,
  type SnowLayer,
  SnowLayers,
  SnowValues,
} from '../snow.ts';
import type { LayerKey } from '../viewState.ts';
import type { App, LayerModule } from './types.ts';

/** The snow layers are rebuilt on every pipeline run. */
const SNOW_STALE_AFTER_HOURS = 14;
const SNOW_TOGGLES: Record<SnowLayer, LayerKey> = { white: 'snow', cover: 'cover', depth: 'depth', confidence: 'confidence' };
const SNOW_KEYS = Object.entries(SNOW_TOGGLES) as [SnowLayer, LayerKey][];

let app: App;
let loading: Promise<SnowFile | null>;
/** The latest snow.json, once loaded. */
let latest: SnowFile | null = null;
/** The one on the map: the latest, or the slider day's. */
let shown: SnowFile | null = null;
let values: SnowValues | null = null;
let layers: SnowLayers | null = null;

export const latestSnow = () => latest;
export const shownSnow = () => shown;

/** The snow summary at a point, or '' while the depth values are not loaded. */
export const pointSnow = (lon: number, lat: number): string => (shown && values ? pointSnowHtml(shown, values.at(lon, lat)) : '');

/** The snow summary along evenly spaced points of a route, or ''. */
export const routeSnowSummary = (points: readonly number[][]): string =>
  shown && values ? routeSnowHtml(shown, routeSnow(values, points)) : '';

/** Snow seen from space along a route, as numbers for a panel or a chart. */
export interface SnowAlong {
  /** Shares of the points in snow and unseen, lowest snow, deepest estimate; null when no point is in the grid. */
  route: RouteSnow | null;
  /** Each point's cell, in the order the points were given. */
  points: PointSnow[];
  sensor: 'Sentinel-2' | 'VIIRS' | 'MODIS';
  /** Newest satellite pass in the picture, YYYY-MM-DD. */
  date: string;
  /** The day slider's day (YYYY-MM-DD), or null for the latest data. */
  day: string | null;
  /** Whether the file has the depth estimate (route.maxDepthCm means something). */
  depth: boolean;
}

/**
 * The snow along evenly spaced [lon, lat, ele] points for the day on the map, or null while the
 * snow is loading or the day has no satellite picture. Ask again after `onSnowShown`.
 */
export function snowAlong(points: readonly number[][]): SnowAlong | null {
  if (!shown || !values || !shown.cover.available) return null;
  const { route, points: states } = routeSnowPoints(values, points);
  return { route, points: states, sensor: shown.cover.sensor, date: shown.cover.date, day: selectedDay(), depth: !!shown.depth };
}

const shownListeners: (() => void)[] = [];

/** Called whenever the snow on the map changes (first load, another day on the slider), once its values are ready. */
export function onSnowShown(listener: () => void) {
  shownListeners.push(listener);
}

/** Puts a snow.json on the map (or none); switches for pictures it lacks are greyed out. */
export async function showSnow(file: SnowFile | null) {
  shown = file;
  values = null;
  const present = file && layers ? layers.show(file) : new Set<SnowLayer>();
  for (const [layer, key] of SNOW_KEYS) {
    setAvailable(key, present.has(layer), selectedDay() ? 'Not available for this day' : 'Not available in the current data');
  }
  $('snow-date').textContent = file?.cover.available ? shortDate(file.cover.date) : '';
  const fresh = file?.cover.available ? file.cover.newSnow : undefined;
  setNewSnow(
    fresh
      ? `Snow has fallen since part of the satellite picture was taken: ${fresh.withSnow} of ${fresh.stations} stations on ground seen bare on ${shortDate(fresh.viewDate)} or earlier now report snow.`
      : null,
  );
  if (!selectedDay()) {
    setAge('satellite', file?.cover.available ? file.cover.date : null, !!file && ageHours(file.generatedAt) > SNOW_STALE_AFTER_HOURS, 'none');
  }
  if (file) {
    const loaded = await SnowValues.load(file).catch(() => null);
    // Another day was picked while these values loaded.
    if (shown !== file) return;
    values = loaded;
  }
  for (const l of shownListeners) l();
}

export const snow: LayerModule = {
  keys: ['snow', 'cover', 'depth', 'confidence'],
  legends: { 'snow-legend': ['stations', 'depth'] },

  setup(a) {
    app = a;
    loading = loadSnow().then(
      (f) => {
        latest = f;
        if (ageHours(f.generatedAt) > SNOW_STALE_AFTER_HOURS) setWarning('snow', `Snow layers were last updated ${formatAge(f.generatedAt)}.`);
        return f;
      },
      (e: unknown) => {
        setWarning('snow', `Snow layers are unavailable (${e instanceof Error ? e.message : String(e)}).`);
        return null;
      },
    );
    // The depth legend: one bar of the classes, with the class boundaries in cm underneath, shown
    // while the station dots or the depth estimate (which share its colours) are on.
    $('legend-bar').innerHTML = SNOW_CLASSES.map((c) => `<span style="background:${c.color}" title="${c.label}"></span>`).join('');
    $('legend-ticks').innerHTML = SNOW_CLASSES.map((c) => `<span>${parseInt(c.label, 10)}</span>`).join('');
    $('no-sensor-swatch').style.background = NO_SNOW_SENSOR_COLOR;
  },

  async init() {
    const { map, basemap } = app;
    // Snow seen by Sentinel-2 goes under the shading so it reads like a snowed-in model; the 250 m
    // cell layers go above the shading and below roads and labels.
    // A layer first added on a day switch still lands in this order, below the forecast.
    const order = [SNOW_LAYERS.cover, SNOW_LAYERS.depth, SNOW_LAYERS.confidence, FORECAST_LAYER];
    layers = new SnowLayers(
      map,
      (key) =>
        key === 'white'
          ? 'hillshade'
          : (order.slice(order.indexOf(SNOW_LAYERS[key]) + 1).find((id) => map.getLayer(id)) ?? basemap.lines[0]?.id),
      { white: isOn('snow'), cover: isOn('cover'), depth: isOn('depth'), confidence: isOn('confidence') },
    );
    await showSnow(await loading);
  },

  setVisible(key, on) {
    const layer = SNOW_KEYS.find(([, k]) => k === key)?.[0];
    if (layer) layers?.setVisible(layer, on);
  },
};
