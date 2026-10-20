import * as maplibregl from 'maplibre-gl';
import type { SatelliteFile, SnowFile, StationsFile } from '../../shared/types.ts';
import './style.css';
import { SNOW_CLASSES, NO_SNOW_SENSOR_COLOR } from './colors.ts';
import { getForecast } from './forecast.ts';
import { ageHours, escapeHtml, formatAge, formatTime } from './format.ts';
import { BASEMAP_SOURCE, basemapLayers } from './basemap.ts';
import { createMap, DEFAULT_EXAGGERATION, isLowPowerDevice } from './map.ts';
import { loadingHtml, openPanel, pointHtml, stationHtml, updatePanelBody } from './panel.ts';
import { addSatelliteLayer, loadSatellite, SATELLITE_LAYER, satelliteInfoHtml, shortDate } from './satellite.ts';
import { addSnowLayers, addSnowWhite, loadSnow, pointSnowHtml, SNOW_LAYERS, SNOW_WHITE_LAYER, type SnowLayer, snowInfoHtml, SnowValues } from './snow.ts';
import { addStationLayer, loadStations, STATION_LAYER_ID } from './stations.ts';

/** Station data older than this gets a visible warning (the pipeline runs every 30 minutes). */
const STALE_AFTER_HOURS = 3;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const map = createMap('map');
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

let stationsFile: StationsFile | null = null;
let stationsError: string | null = null;
let exaggeration = DEFAULT_EXAGGERATION;

// --- Layer panel -------------------------------------------------------------

const layersPanel = $('layers');
const layersToggle = $('layers-toggle');
const setLayersCollapsed = (collapsed: boolean) => {
  layersPanel.classList.toggle('collapsed', collapsed);
  layersToggle.setAttribute('aria-expanded', String(!collapsed));
};
// On phones the layer sheet starts collapsed so the map gets the screen.
setLayersCollapsed(isLowPowerDevice() && window.innerWidth <= 700);
layersToggle.addEventListener('click', () => setLayersCollapsed(!layersPanel.classList.contains('collapsed')));

$('legend-items').innerHTML =
  SNOW_CLASSES.map((c) => `<li><span class="swatch" style="background:${c.color}"></span>${c.label}</li>`).join('') +
  `<li><span class="swatch" style="background:${NO_SNOW_SENSOR_COLOR}"></span>No snow sensor</li>`;

const exaggerationInput = $<HTMLInputElement>('exaggeration');
exaggerationInput.addEventListener('input', () => {
  exaggeration = Number(exaggerationInput.value);
  $('exaggeration-value').textContent = `${exaggeration.toFixed(1)}×`;
  map.setTerrain({ source: 'terrain', exaggeration });
});

const bindToggle = (id: string, apply: (on: boolean) => void) => {
  const input = $<HTMLInputElement>(id);
  input.addEventListener('change', () => apply(input.checked));
};
bindToggle('toggle-hillshade', (on) => map.setLayoutProperty('hillshade', 'visibility', on ? 'visible' : 'none'));
bindToggle('toggle-relief', (on) => map.setLayoutProperty('relief', 'visibility', on ? 'visible' : 'none'));

// Layer groups from the OSM basemap, toggled together.
const basemap = basemapLayers();
const setGroup = (ids: string[], on: boolean) => {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
};
bindToggle('toggle-basemap', (on) =>
  setGroup([...basemap.fills, ...basemap.lines, basemap.buildings].map((l) => l.id), on),
);
bindToggle('toggle-labels', (on) => setGroup(basemap.labels.map((l) => l.id), on));

// --- Sources dialog ----------------------------------------------------------

function renderSources() {
  const stationPart = stationsFile
    ? stationsFile.sources
        .map(
          (s) => `<p><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a><br>
          ${escapeHtml(s.attribution)}. Licence: ${escapeHtml(s.licence)}.<br>
          <span class="muted">${s.ok ? `Fetched ${formatTime(s.fetchedAt)}, ${s.stationCount} records.` : `Last fetch failed (${escapeHtml(s.error ?? 'unknown error')}); last success ${formatTime(s.fetchedAt)}.`}</span></p>`,
        )
        .join('')
    : `<p class="muted">${escapeHtml(stationsError ?? 'Loading…')}</p>`;
  $('sources-body').innerHTML = `
    <h3>Terrain</h3>
    <p><a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a>, built from open elevation data:
    South Tyrol DGM 2.5 m (Autonomous Province of Bolzano, CC0), TINITALY 10 m (INGV, CC BY 4.0),
    Trentino LiDAR (Autonomous Province of Trento, CC BY 2.5), Austria DGM (BEV, CC BY 4.0), Copernicus GLO-30. Static dataset.</p>
    <h3>Weather stations</h3>
    ${stationPart}
    <p class="muted">Stations reported by more than one source are merged. The pipeline refreshes this data every 30 minutes;
    the file you are viewing was generated ${stationsFile ? `${formatTime(stationsFile.generatedAt)} (${formatAge(stationsFile.generatedAt)})` : '–'}.</p>
    <h3>Snow cover and estimated snow depth</h3>
    ${snowFile ? snowInfoHtml(snowFile) : '<p class="muted">Not loaded.</p>'}
    ${snowFile?.cover.available ? `<p>Satellite snow cover: <a href="${escapeHtml(snowFile.cover.source)}" target="_blank" rel="noopener">${escapeHtml(snowFile.cover.attribution)}</a>. ${escapeHtml(snowFile.cover.licence)}.</p>` : ''}
    <p class="muted">The depth map is the app's own estimate from station readings and elevation (method in plan.md); it is not an official product.</p>
    <h3>Satellite picture</h3>
    ${satelliteFile ? satelliteInfoHtml(satelliteFile) : '<p class="muted">Not loaded.</p>'}
    ${satelliteFile?.available ? `<p>${escapeHtml(satelliteFile.attribution)}. Free and open Copernicus data.</p>` : ''}
    <h3>Point forecast</h3>
    <p><a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a>, licensed CC BY 4.0.
    Fetched live when you click the map and cached in your browser for one hour.</p>
    <h3>Roads, places, rivers, buildings and summits</h3>
    <p>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL),
    via a <a href="https://protomaps.com/" target="_blank" rel="noopener">Protomaps</a> basemap build served from this site.
    Fonts: Noto Sans (OFL).</p>
    <h3>Map library</h3>
    <p><a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre GL JS</a> (BSD-3-Clause).</p>
    <h3>Safety</h3>
    <p><strong>This map is for orientation only and must not be used for avalanche decisions.</strong>
    Station values are point measurements and forecasts are model output. Always check the official avalanche bulletin at
    <a href="https://avalanche.report" target="_blank" rel="noopener">avalanche.report</a>.</p>`;
}

const dialog = $<HTMLDialogElement>('sources-dialog');
$('sources-btn').addEventListener('click', () => {
  renderSources();
  dialog.showModal();
});

// --- Station data ------------------------------------------------------------

function showStationsStatus() {
  const time = $('stations-time');
  const warning = $('data-warning');
  if (!stationsFile) {
    time.textContent = `Stations: ${stationsError ?? 'loading…'}`;
    warning.hidden = !stationsError;
    warning.textContent = stationsError ? 'Station data could not be loaded. Terrain and forecasts still work.' : '';
    return;
  }
  const f = stationsFile;
  const withSnow = f.stations.filter((s) => s.snowDepthCm !== null).length;
  time.textContent = `Stations: ${f.stations.length} (${withSnow} with snow depth), updated ${formatTime(f.generatedAt)}.`;
  const failed = f.sources.filter((s) => !s.ok);
  const messages: string[] = [];
  if (f.stale || ageHours(f.generatedAt) > STALE_AFTER_HOURS) {
    messages.push(`Station data is out of date (${formatAge(f.generatedAt)}).`);
  }
  if (failed.length) messages.push(`Last update could not reach: ${failed.map((s) => s.name).join(', ')}.`);
  warning.hidden = messages.length === 0;
  warning.textContent = messages.join(' ');
}

// --- Snow layers -------------------------------------------------------------

let snowFile: SnowFile | null = null;
let snowValues: SnowValues | null = null;
const snowPromise = loadSnow().then(
  async (f) => {
    snowFile = f;
    $('snow-info').innerHTML = snowInfoHtml(f);
    snowValues = await SnowValues.load(f).catch(() => null);
    return f;
  },
  (e: unknown) => {
    $('snow-info').textContent = `Snow layers unavailable (${e instanceof Error ? e.message : String(e)}).`;
    return null;
  },
);

let satelliteFile: SatelliteFile | null = null;
const satellitePromise = loadSatellite().then(
  (f) => {
    satelliteFile = f;
    $('satellite-info').innerHTML = satelliteInfoHtml(f);
    if (f.available && f.date) $('satellite-date').textContent = `(${shortDate(f.date)})`;
    return f;
  },
  () => null,
);

const stationsPromise = loadStations().then(
  (f) => {
    stationsFile = f;
    showStationsStatus();
    return f;
  },
  (e: unknown) => {
    stationsError = e instanceof Error ? e.message : String(e);
    console.warn(stationsError);
    showStationsStatus();
    return null;
  },
);

// --- Point click: elevation + forecast ----------------------------------------

const pointMarker = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'point-marker' }) });
let forecastAbort: AbortController | null = null;

function clearPoint() {
  forecastAbort?.abort();
  pointMarker.remove();
}

async function showPoint(lngLat: maplibregl.LngLat) {
  clearPoint();
  const abort = (forecastAbort = new AbortController());
  // queryTerrainElevation includes the exaggeration, so divide it back out.
  const raw = map.queryTerrainElevation(lngLat);
  const elevation = raw === null ? null : raw / exaggeration;
  pointMarker.setLngLat(lngLat).addTo(map);
  const snowHtml = snowFile && snowValues ? pointSnowHtml(snowFile, snowValues.at(lngLat.lng, lngLat.lat)) : '';
  openPanel('Point forecast', loadingHtml(elevation, snowHtml), clearPoint);
  let result;
  try {
    result = await getForecast(lngLat.lat, lngLat.lng, elevation, abort.signal);
  } catch (e) {
    if (abort.signal.aborted) return;
    result = e instanceof Error ? e : new Error(String(e));
  }
  if (!abort.signal.aborted) updatePanelBody(pointHtml(lngLat.lat, lngLat.lng, elevation, result, snowHtml));
}

// --- Map setup -------------------------------------------------------------

map.on('load', async () => {
  // The picture replaces the drawn land colours but keeps hillshade, roads and labels on top.
  const sat = await satellitePromise;
  const satToggle = $<HTMLInputElement>('toggle-satellite');
  if (sat && addSatelliteLayer(map, sat, 'hillshade', satToggle.checked)) {
    // The photo already has real light and shade, so the drawn hillshade is toned down over it.
    const shade = (on: boolean) => map.setPaintProperty('hillshade', 'hillshade-exaggeration', on ? 0.12 : 0.3);
    shade(satToggle.checked);
    bindToggle('toggle-satellite', (on) => {
      map.setLayoutProperty(SATELLITE_LAYER, 'visibility', on ? 'visible' : 'none');
      shade(on);
    });
  } else {
    satToggle.checked = false;
    satToggle.disabled = true;
    satToggle.parentElement!.title = 'No satellite picture in the current data';
  }

  const snow = await snowPromise;
  // Snow seen by Sentinel-2: white on the terrain, under the shading so it reads like a snowed-in model.
  const snowToggle = $<HTMLInputElement>('toggle-snow');
  if (snow && addSnowWhite(map, snow, 'hillshade', snowToggle.checked)) {
    if (snow.cover.available) $('snow-date').textContent = `(${shortDate(snow.cover.date)})`;
    bindToggle('toggle-snow', (on) => map.setLayoutProperty(SNOW_WHITE_LAYER, 'visibility', on ? 'visible' : 'none'));
  } else {
    snowToggle.checked = false;
    snowToggle.disabled = true;
    snowToggle.parentElement!.title = 'No satellite snow map in the current data';
  }
  if (snow) {
    const toggles: Record<SnowLayer, HTMLInputElement> = {
      cover: $<HTMLInputElement>('toggle-cover'),
      depth: $<HTMLInputElement>('toggle-depth'),
      confidence: $<HTMLInputElement>('toggle-confidence'),
    };
    // Below roads and labels, above the terrain shading.
    const added = addSnowLayers(map, snow, basemap.lines[0]?.id, {
      cover: toggles.cover.checked,
      depth: toggles.depth.checked,
      confidence: toggles.confidence.checked,
    });
    for (const key of Object.keys(toggles) as SnowLayer[]) {
      if (!added.includes(key)) {
        toggles[key].disabled = true;
        toggles[key].parentElement!.title = 'Not available in the current data';
        continue;
      }
      bindToggle(`toggle-${key}`, (on) => map.setLayoutProperty(SNOW_LAYERS[key], 'visibility', on ? 'visible' : 'none'));
    }
  }

  const file = await stationsPromise;
  if (file) {
    const layer = addStationLayer(map, file.stations, (s) => {
      clearPoint();
      openPanel(s.name, stationHtml(s, file));
    });
    bindToggle('toggle-stations', (on) => layer.setVisible(on));
  }

  map.on('click', (e: maplibregl.MapMouseEvent) => {
    const onStation =
      map.getLayer(STATION_LAYER_ID) &&
      map.queryRenderedFeatures(e.point, { layers: [STATION_LAYER_ID] }).length > 0;
    if (!onStation) void showPoint(e.lngLat);
  });
});

// The Protomaps style names a few POI icons its sprite does not contain; draw those labels without an icon.
map.on('styleimagemissing', (e: { id: string }) => {
  if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
});

// Hooks for the smoke test (scripts/smoke.mjs) and for debugging from the console.
map.once('idle', () => {
  document.body.dataset.mapReadyMs = String(Math.round(performance.now()));
});
Object.assign(window, { __snowmap: { map } });

let basemapWarned = false;
map.on('error', (e: maplibregl.ErrorEvent & { sourceId?: string }) => {
  if (e.sourceId === BASEMAP_SOURCE) {
    // The extract is built locally with `npm run basemap` and is not in git; say so once instead of failing silently.
    if (!basemapWarned) {
      basemapWarned = true;
      const warning = $('data-warning');
      warning.hidden = false;
      warning.textContent = `${warning.textContent ?? ''} Roads and places are unavailable (basemap file missing; run "npm run basemap").`.trim();
    }
    return;
  }
  // Missing ocean/edge tiles are expected; anything else is worth surfacing in the console.
  const status = (e.error as { status?: number } | undefined)?.status;
  if (status === 404) return;
  console.warn('Map error:', e.error?.message ?? e);
});

