// Weather stations, coloured by snow depth, and the station line in the layer card's header.
import type { HistoryDay, StationsFile } from '../../../shared/types.ts';
import { selectedDay } from '../app/day.ts';
import { $ } from '../app/dom.ts';
import { isOn } from '../app/switches.ts';
import { setWarning } from '../app/warnings.ts';
import { ageHours, formatAge, formatTimeShort } from '../format.ts';
import { inArea } from '../island.ts';
import { openPanel, stationHtml } from '../panel.ts';
import { shortDate } from '../satellite.ts';
import { addStationLayer, loadStations, STATION_LAYER_ID } from '../stations.ts';
import type { App, LayerModule } from './types.ts';

/**
 * Station data older than this gets a visible warning. The pipeline runs three times a day, up to
 * 10 hours apart, and GitHub may start a run late.
 */
const STALE_AFTER_HOURS = 14;

let loading: Promise<StationsFile | null>;
/** The latest stations.json, once loaded. */
let file: StationsFile | null = null;
/** Stations on the map: the latest, or the slider day's. */
let shown: StationsFile | null = null;
let error: string | null = null;
let layer: ReturnType<typeof addStationLayer> | null = null;

export const latestStations = () => file;
export const stationsError = () => error;

/** Stations drawn on the map: the ones inside the covered area. */
const countInArea = (list: { lon: number; lat: number }[]) => list.filter((s) => inArea(s.lon, s.lat)).length;

/** The header line and the warnings for the latest station data. */
function showStatus() {
  const time = $('stations-time');
  if (!file) {
    time.textContent = error ? 'Stations unavailable' : 'Loading stations…';
    setWarning('stations', error ? 'Station data could not be loaded. Terrain and forecasts still work.' : null);
    return;
  }
  const f = file;
  const withSnow = f.stations.filter((s) => s.snowDepthCm !== null).length;
  if (!selectedDay()) {
    time.textContent = `${countInArea(f.stations)} stations · updated ${formatTimeShort(f.generatedAt)}`;
    time.title = `${withSnow} of them measure snow depth`;
  }
  const failed = f.sources.filter((s) => !s.ok);
  const messages: string[] = [];
  if (f.stale || ageHours(f.generatedAt) > STALE_AFTER_HOURS) {
    messages.push(`Station data is out of date (${formatAge(f.generatedAt)}).`);
  }
  if (failed.length) messages.push(`Last update could not reach: ${failed.map((s) => s.name).join(', ')}.`);
  setWarning('stations', messages.join(' ') || null);
}

/** Puts a day's stations on the map (null: the latest), or none when that day has no readings. */
export function showStations(stations: StationsFile | null, day: HistoryDay | null) {
  shown = stations;
  layer?.setStations(stations?.stations ?? []);
  if (!day) showStatus();
  else {
    $('stations-time').textContent = stations
      ? `${countInArea(stations.stations)} stations · ${shortDate(day.date)}`
      : `No station readings for ${shortDate(day.date)}`;
  }
}

export const stations: LayerModule = {
  keys: ['stations'],
  clickLayers: [STATION_LAYER_ID],

  setup() {
    loading = loadStations().then(
      (f) => {
        file = f;
        showStatus();
        return f;
      },
      (e: unknown) => {
        error = e instanceof Error ? e.message : String(e);
        console.warn(error);
        showStatus();
        return null;
      },
    );
  },

  async init(app: App) {
    const f = await loading;
    if (!f) return;
    shown ??= f;
    layer = addStationLayer(
      app.map,
      f.stations,
      (s) => {
        app.point.clear();
        openPanel(s.name, stationHtml(s, shown ?? f));
      },
      isOn('stations'),
    );
  },

  setVisible(_key, on) {
    layer?.setVisible(on);
  },
};
