// Snow seen from space (the white picture and the 250 m snow share), the estimated snow depth and its
// uncertainty: four pictures from one snow.json, swapped together by the day slider.
import type { SnowFile } from '../../../shared/types.ts';
import { selectedDay } from '../app/day.ts';
import { $ } from '../app/dom.ts';
import { isOn, setAvailable } from '../app/switches.ts';
import { setWarning } from '../app/warnings.ts';
import { NO_SNOW_SENSOR_COLOR, SNOW_CLASSES } from '../colors.ts';
import { FORECAST_LAYER } from '../forecastAnim.ts';
import { ageHours, formatAge } from '../format.ts';
import { shortDate } from '../satellite.ts';
import { loadSnow, pointSnowHtml, routeSnow, routeSnowHtml, SNOW_LAYERS, type SnowLayer, SnowLayers, SnowValues } from '../snow.ts';
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
  setWarning(
    'new-snow',
    fresh
      ? `New snow since the last clear satellite view (${shortDate(fresh.viewDate)}): ${fresh.withSnow} of ${fresh.stations} stations ` +
          `on ground it saw bare now report snow, so the satellite layers show less snow than there is. ` +
          `Turn on Estimated snow depth for the picture from the stations.`
      : null,
  );
  if (file) values = await SnowValues.load(file).catch(() => null);
}

export const snow: LayerModule = {
  keys: ['snow', 'cover', 'depth', 'confidence'],

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
    // The depth legend: one bar of the classes, with the class boundaries in cm underneath. Always
    // shown for now, since the station dots use the same colours.
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
