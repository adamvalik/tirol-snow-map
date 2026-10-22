import * as maplibregl from 'maplibre-gl';
import type { ForecastFile, HistoryDay, HistoryFile, SatelliteFile, SnowFile, StationsFile, StatusFile } from '../../shared/types.ts';
import { SCHEMA_VERSION } from '../../shared/types.ts';
import './style.css';
import { SNOW_CLASSES, NO_SNOW_SENSOR_COLOR } from './colors.ts';
import { getForecast } from './forecast.ts';
import { FORECAST_LAYER, ForecastAnimation, forecastInfoHtml, frameLabel, loadForecast } from './forecastAnim.ts';
import { ageHours, escapeHtml, formatAge, formatTime, formatTimeShort } from './format.ts';
import { BASEMAP_SOURCE, basemapLayers } from './basemap.ts';
import { addBivouacLayer, BIVOUAC_LAYER_IDS, BIVOUACS, bivouacHtml, bivouacIconUrl, favButtonHtml } from './bivouacs.ts';
import { Favourites } from './favourites.ts';
import { addFerrataLayer, FERRATA_LAYER_IDS, ferrataHtml, ferrataLines, type FerrataLayer, GRADE_CLASSES, highestPoint } from './ferratas.ts';
import { resample } from '../../shared/geo.ts';
import { createMap, DEFAULT_EXAGGERATION, DEFAULT_VIEW, isLowPowerDevice, MAX_BOUNDS } from './map.ts';
import { loadingHtml, openPanel, pointHtml, stationHtml, updatePanelBody } from './panel.ts';
import { addSatelliteLayer, loadSatellite, SATELLITE_LAYER, satelliteInfoHtml, shortDate } from './satellite.ts';
import {
  loadSnow,
  pointSnowHtml,
  routeSnow,
  routeSnowHtml,
  SNOW_LAYERS,
  type SnowLayer,
  SnowLayers,
  snowInfoHtml,
  SnowValues,
} from './snow.ts';
import { addStationLayer, loadStations, STATION_LAYER_ID } from './stations.ts';
import { horizonProfile } from '../../shared/horizon.ts';
import { type SunHere, sunHereFor, sunHereHtml } from './sunHere.ts';
import { ShadowLayer } from './shadows.ts';
import { type Grid, loadGrid, NEAR_RADIUS, pointTerrain } from './terrainSampler.ts';
import {
  clockTime,
  DEFAULT_SKY,
  dayGradient,
  dayMinutes,
  hillshadePaint,
  type HillshadePaint,
  localDate,
  localMidnight,
  NIGHT_COLOR,
  nightOpacity,
  skyFor,
  sunDay,
  sunLabel,
  sunParam,
  sunPosition,
} from './sun.ts';
import { LAYER_KEYS, type LayerKey, parseHash, toHash, type ViewState } from './viewState.ts';

/**
 * Station data older than this gets a visible warning. The pipeline runs three times a day, up to
 * 10 hours apart, and GitHub may start a run late.
 */
const STALE_AFTER_HOURS = 14;
/** The snow layers are rebuilt on every run as well. */
const SNOW_STALE_AFTER_HOURS = 14;
/** The forecast grid is fetched on every run (at most every 6 hours). */
const FORECAST_STALE_AFTER_HOURS = 14;
const DATA = `${import.meta.env.BASE_URL}data/`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = (key: LayerKey) => $<HTMLInputElement>(`toggle-${key}`);

// The address can carry a shared view (see viewState.ts).
const initial = parseHash(window.location.hash);
if (initial.layers) for (const key of LAYER_KEYS) toggle(key).checked = initial.layers.includes(key);

const map = createMap('map', {
  center: initial.center ?? DEFAULT_VIEW.center,
  zoom: initial.zoom ?? DEFAULT_VIEW.zoom,
  pitch: initial.pitch ?? DEFAULT_VIEW.pitch,
  bearing: initial.bearing ?? DEFAULT_VIEW.bearing,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

let stationsFile: StationsFile | null = null;
/** Stations on the map: the latest, or the slider day's. */
let shownStations: StationsFile | null = null;
let stationsError: string | null = null;
let exaggeration = initial.exaggeration ?? DEFAULT_EXAGGERATION;

// --- Warnings ----------------------------------------------------------------

const warnings = new Map<string, string>();
function setWarning(key: string, text: string | null) {
  if (text) warnings.set(key, text);
  else warnings.delete(key);
  const el = $('data-warning');
  el.hidden = warnings.size === 0;
  el.textContent = [...warnings.values()].join(' ');
  // A dot on the layers button tells a collapsed panel that something is worth a look.
  document.body.classList.toggle('has-warning', warnings.size > 0);
}

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

// The map's corner controls sit above the timeline dock, whose height changes with its rows.
const dock = $('dock');
new ResizeObserver(() => document.body.style.setProperty('--dock-h', `${dock.offsetHeight}px`)).observe(dock);

// One bar of the depth classes, with the class boundaries in cm underneath.
$('legend-bar').innerHTML = SNOW_CLASSES.map((c) => `<span style="background:${c.color}" title="${c.label}"></span>`).join('');
$('legend-ticks').innerHTML = SNOW_CLASSES.map((c) => `<span>${parseInt(c.label, 10)}</span>`).join('');
$('no-sensor-swatch').style.background = NO_SNOW_SENSOR_COLOR;
$('bivouac-keys').innerHTML = (['metal', 'wood'] as const)
  .map((k) => `<img class="bivouac-icon" src="${bivouacIconUrl(k)}" alt="" title="${k === 'wood' ? 'Wooden' : 'Metal'}">`)
  .join('');
$('ferrata-keys').innerHTML =
  GRADE_CLASSES.map((c) => `<span class="ferrata-key"><i style="background:${c.color}"></i>${c.label}</span>`).join('') +
  '<span class="ferrata-key"><i class="ungraded"></i>ungraded</span>';

// --- Favourite bivouacs --------------------------------------------------------

const favourites = new Favourites();
const showFavCount = () => {
  $('fav-count').textContent = String(favourites.size);
  $('fav-count').title = 'Saved in this browser';
};
showFavCount();
favourites.onChange(showFavCount);
// The heart in a bivouac's panel; the panel body is re-rendered when its forecast arrives.
$('details-body').addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('.fav-btn');
  const b = btn && BIVOUACS.find((x) => x.osm === btn.dataset.osm);
  if (!btn || !b) return;
  const on = favourites.toggle(b.osm);
  btn.outerHTML = favButtonHtml(b, on);
  if (!on && toggle('favourites').checked) toast(`${b.name} left your favourites and is hidden by the filter.`);
});

const exaggerationInput = $<HTMLInputElement>('exaggeration');
const showExaggeration = () => {
  exaggerationInput.value = String(exaggeration);
  $('exaggeration-value').textContent = `${exaggeration.toFixed(1)}×`;
};
showExaggeration();
exaggerationInput.addEventListener('input', () => {
  exaggeration = Number(exaggerationInput.value);
  showExaggeration();
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

// --- Shareable view ----------------------------------------------------------

let selectedDay: string | null = null;
let forecastFrame: number | null = null;

function currentView(): ViewState {
  const c = map.getCenter();
  return {
    center: [c.lng, c.lat],
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
    exaggeration,
    layers: LAYER_KEYS.filter((k) => toggle(k).checked),
    day: selectedDay,
    frame: toggle('forecast').checked ? forecastFrame : null,
    sun: toggle('sun').checked ? sunParam(sunTime) : null,
  };
}

let hashTimer: number | undefined;
function syncHash() {
  window.clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => window.history.replaceState(null, '', toHash(currentView())), 300);
}
map.on('moveend', syncHash);
$('layers-body').addEventListener('change', syncHash);
exaggerationInput.addEventListener('change', syncHash);

let toastTimer: number | undefined;
function toast(text: string) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 4000);
}

$('share-btn').addEventListener('click', async () => {
  window.history.replaceState(null, '', toHash(currentView()));
  const url = window.location.href;
  try {
    // Phones get the system share sheet; desktops a copied link.
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: document.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link to this view copied.');
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    toast('Copy the address from the address bar to share this view.');
  }
});

// --- Sources dialog ----------------------------------------------------------

const STEP_NAMES: Record<string, string> = {
  stations: 'weather stations',
  snow: 'snow layers',
  satellite: 'satellite picture',
  forecast: 'forecast snowfall',
};

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
  const failing = statusFile ? Object.entries(statusFile.steps).filter(([, s]) => !s.ok) : [];
  $('sources-body').innerHTML = `
    ${
      failing.length
        ? `<h3>Last update</h3>${failing
            .map(
              ([id, s]) =>
                `<p class="warning">Problems with the ${escapeHtml(STEP_NAMES[id] ?? id)} since ${formatTime(s.failingSince)}: ${escapeHtml(s.problems.join('; '))}</p>`,
            )
            .join('')}<p class="muted">The layers keep showing their last good data, each with its own date.</p>`
        : ''
    }
    <h3>Terrain</h3>
    <p><a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a>, built from open elevation data:
    South Tyrol DGM 2.5 m (Autonomous Province of Bolzano, CC0), TINITALY 10 m (INGV, CC BY 4.0),
    Trentino LiDAR (Autonomous Province of Trento, CC BY 2.5), Austria DGM (BEV, CC BY 4.0), Copernicus GLO-30. Static dataset.</p>
    <h3>Weather stations</h3>
    ${stationPart}
    <p class="muted">Stations reported by more than one source are merged. The pipeline refreshes this data three times a day: early in the morning, after lunch and in the evening;
    the file you are viewing was generated ${stationsFile ? `${formatTime(stationsFile.generatedAt)} (${formatAge(stationsFile.generatedAt)})` : '–'}.</p>
    <h3>Snow cover and estimated snow depth</h3>
    ${snowFile ? snowInfoHtml(snowFile) : '<p class="muted">Not loaded.</p>'}
    ${snowFile?.cover.available ? `<p>Satellite snow cover: <a href="${escapeHtml(snowFile.cover.source)}" target="_blank" rel="noopener">${escapeHtml(snowFile.cover.attribution)}</a>. ${escapeHtml(snowFile.cover.licence)}.</p>` : ''}
    <p class="muted">The depth map is the app's own estimate from station readings and elevation (method in plan.md); it is not an official product.
    The day slider shows the last update of each of the past ${historyFile?.days.length ?? 14} days.</p>
    <h3>Satellite picture</h3>
    ${satelliteFile ? satelliteInfoHtml(satelliteFile) : '<p class="muted">Not loaded.</p>'}
    ${satelliteFile?.available ? `<p>${escapeHtml(satelliteFile.attribution)}. Free and open Copernicus data.</p>` : ''}
    <h3>Forecast snowfall and point forecast</h3>
    ${forecastFile ? forecastInfoHtml(forecastFile) : ''}
    <p><a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a>, licensed CC BY 4.0.
    The point forecast is fetched live when you click the map and cached in your browser for one hour.</p>
    <h3>Roads, places, rivers, buildings and summits</h3>
    <p>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL),
    via a <a href="https://protomaps.com/" target="_blank" rel="noopener">Protomaps</a> basemap build served from this site.
    Fonts: Noto Sans (OFL).</p>
    <h3>Bivouacs</h3>
    <p>${BIVOUACS.length} huts and shelters named bivacco, Biwak or bivouac in
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL),
    a static list taken with the Overpass API. Red = metal box, brown = wood where OSM says so (the build is rarely mapped,
    so most are drawn red). Not checked for whether they are open, equipped or still standing.</p>
    <h3>Via ferratas</h3>
    <p>${ferrataCount ?? 'The'} routes tagged as via ferrata (<code>highway=via_ferrata</code>, or a path with <code>via_ferrata_scale</code>,
    and <code>route=via_ferrata</code> relations) in
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL),
    a static list taken with the Overpass API. Sections that touch, share a relation or carry the same name close together are
    one route, so linked ferratas show as one system. Grades are shown as A–E, converted from the OSM scale 0–6
    (1–5 are A–E, 0 counts as A and 6 as E, a plus or minus becomes an in-between grade such as C/D); a route takes its
    hardest section's grade. Length, elevation and climb are computed from the Mapterhorn terrain over the mapped
    sections only. The data is drawn by volunteers and may be incomplete, wrong or out of date; closures are only shown where
    a mapper recorded them. Not for navigation.</p>
    <h3>Map library</h3>
    <p><a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre GL JS</a> (BSD-3-Clause).
    Sun position: <a href="https://github.com/mourner/suncalc" target="_blank" rel="noopener">SunCalc</a> (BSD-2-Clause).</p>
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
  if (!stationsFile) {
    time.textContent = stationsError ? 'Stations unavailable' : 'Loading stations…';
    setWarning('stations', stationsError ? 'Station data could not be loaded. Terrain and forecasts still work.' : null);
    return;
  }
  const f = stationsFile;
  const withSnow = f.stations.filter((s) => s.snowDepthCm !== null).length;
  if (!selectedDay) {
    time.textContent = `${f.stations.length} stations · updated ${formatTimeShort(f.generatedAt)}`;
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

// --- Data files --------------------------------------------------------------

let snowFile: SnowFile | null = null;
let latestSnow: SnowFile | null = null;
let snowValues: SnowValues | null = null;
const snowPromise = loadSnow().then(
  (f) => {
    latestSnow = f;
    if (ageHours(f.generatedAt) > SNOW_STALE_AFTER_HOURS) setWarning('snow', `Snow layers were last updated ${formatAge(f.generatedAt)}.`);
    return f;
  },
  (e: unknown) => {
    setWarning('snow', `Snow layers are unavailable (${e instanceof Error ? e.message : String(e)}).`);
    return null;
  },
);

let satelliteFile: SatelliteFile | null = null;
const satellitePromise = loadSatellite().then(
  (f) => {
    satelliteFile = f;
    if (f.available && f.date) $('satellite-date').textContent = shortDate(f.date);
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

let forecastFile: ForecastFile | null = null;
const forecastPromise = loadForecast().then(
  (f) => {
    forecastFile = f;
    if (f.available && (f.stale || ageHours(f.fetchedAt) > FORECAST_STALE_AFTER_HOURS)) {
      setWarning('forecast', `Forecast snowfall is from ${formatAge(f.fetchedAt)}; newer forecasts could not be fetched.`);
    }
    return f;
  },
  () => null,
);

async function loadJson<T extends { schemaVersion: number }>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`${DATA}${name}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const f = (await res.json()) as T;
    return f.schemaVersion === SCHEMA_VERSION ? f : null;
  } catch {
    return null;
  }
}

let statusFile: StatusFile | null = null;
void loadJson<StatusFile>('status.json').then((s) => {
  statusFile = s;
  // Station and forecast problems have their own, more specific warnings.
  const failing = s ? (['snow', 'satellite'] as const).filter((id) => !s.steps[id]?.ok) : [];
  setWarning(
    'status',
    failing.length
      ? `The last update could not refresh the ${failing.map((id) => STEP_NAMES[id]).join(' and ')}; they show their last good data (details under Data sources).`
      : null,
  );
});

let historyFile: HistoryFile | null = null;
const historyPromise = loadJson<HistoryFile>('history.json').then((h) => (historyFile = h));

// --- Snow layers and the day slider -------------------------------------------

let snowLayers: SnowLayers | null = null;
let stationLayer: ReturnType<typeof addStationLayer> | null = null;
const SNOW_TOGGLES: Record<SnowLayer, LayerKey> = { white: 'snow', cover: 'cover', depth: 'depth', confidence: 'confidence' };

async function showSnow(file: SnowFile | null) {
  snowFile = file;
  snowValues = null;
  const present = file && snowLayers ? snowLayers.show(file) : new Set<SnowLayer>();
  for (const [layer, key] of Object.entries(SNOW_TOGGLES) as [SnowLayer, LayerKey][]) {
    const input = toggle(key);
    input.disabled = !present.has(layer);
    input.parentElement!.title = input.disabled ? (selectedDay ? 'Not available for this day' : 'Not available in the current data') : '';
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
  if (file) snowValues = await SnowValues.load(file).catch(() => null);
}

// Oldest first, so the slider runs left to right through time; the newest day is the live data.
let days: HistoryDay[] = [];
let dayRequest = 0;

const dayLabel = (d: HistoryDay, latest: boolean) =>
  `${new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}${latest ? ' · latest' : ''}`;

async function showDay(i: number) {
  const day = days[i];
  const latest = i === days.length - 1;
  const request = ++dayRequest;
  selectedDay = latest ? null : day.date;
  $('day-label').textContent = dayLabel(day, latest);
  const note = $('day-note');
  let snow: SnowFile | null = latestSnow;
  let stations: StationsFile | null = stationsFile;
  if (!latest) {
    [snow, stations] = await Promise.all([
      loadSnow(day.snow).catch(() => null),
      day.stations ? loadStations(`${DATA}${day.stations}`).catch(() => null) : Promise.resolve(null),
    ]);
  }
  if (request !== dayRequest) return;
  await showSnow(snow);
  shownStations = stations;
  stationLayer?.setStations(stations?.stations ?? []);
  if (latest) {
    note.hidden = true;
    showStationsStatus();
  } else {
    note.hidden = false;
    note.textContent = day.backfilled
      ? 'Only snow seen from space, rebuilt from the satellite passes up to that day.'
      : `Snow layers and stations as of ${formatTime(snow?.generatedAt)}.`;
    $('stations-time').textContent = stations
      ? `${stations.stations.length} stations · ${shortDate(day.date)}`
      : `No station readings for ${shortDate(day.date)}`;
  }
  syncHash();
}

function setupDaySlider(h: HistoryFile | null) {
  days = [...(h?.days ?? [])].reverse();
  if (days.length < 2) return;
  const slider = $<HTMLInputElement>('day');
  slider.max = String(days.length - 1);
  const start = initial.day ? days.findIndex((d) => d.date === initial.day) : -1;
  slider.value = String(start >= 0 ? start : days.length - 1);
  $('day-first').textContent = shortDate(days[0].date);
  $('day-label').textContent = dayLabel(days[Number(slider.value)], start < 0 || start === days.length - 1);
  $('day-group').hidden = false;
  let timer: number | undefined;
  slider.addEventListener('input', () => {
    const i = Number(slider.value);
    $('day-label').textContent = dayLabel(days[i], i === days.length - 1);
    // Wait until the thumb rests so dragging does not fire a request per step.
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void showDay(i), 150);
  });
  if (start >= 0 && start < days.length - 1) void showDay(start);
}

// --- Forecast animation --------------------------------------------------------

const PLAY_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
const PAUSE_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/></svg>';

function setupForecast(file: ForecastFile | null) {
  const input = toggle('forecast');
  const player = $('forecast-player');
  if (!file?.available || !file.frames?.length) {
    input.checked = false;
    input.disabled = true;
    input.parentElement!.title = file?.reason ?? 'No forecast in the current data';
    return;
  }
  const frameInput = $<HTMLInputElement>('forecast-frame');
  const playBtn = $('forecast-play');
  frameInput.max = String(file.frames.length - 1);
  playBtn.innerHTML = PLAY_ICON;
  const showPlaying = (playing: boolean) => {
    playBtn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', playing ? 'Pause the forecast' : 'Play the forecast');
  };
  const anim = new ForecastAnimation(map, file, basemap.lines[0]?.id, input.checked, (k) => {
    forecastFrame = k;
    frameInput.value = String(k);
    $('forecast-label').textContent = frameLabel(file, k);
    syncHash();
  });
  anim.setFrame(Math.min(initial.frame ?? file.frames.length - 1, file.frames.length - 1));
  player.hidden = !input.checked;
  bindToggle('toggle-forecast', (on) => {
    anim.setVisible(on);
    player.hidden = !on;
    showPlaying(false);
  });
  playBtn.addEventListener('click', () => {
    if (anim.playing) anim.pause();
    else anim.play();
    showPlaying(anim.playing);
  });
  frameInput.addEventListener('input', () => {
    anim.pause();
    showPlaying(false);
    anim.setFrame(Number(frameInput.value));
  });
}

// --- Sun light -----------------------------------------------------------------

const NIGHT_LAYER = 'sun-night';
const MINUTE = 60_000;
/** Play runs from a little before sunrise to a little after sunset. */
const PLAY_MARGIN = 40 * MINUTE;

let sunTime = initial.sun ? Date.parse(initial.sun) : Date.now();
/** Set once the style has loaded and the light can be painted. */
let lightReady = false;
let shadowLayer: ShadowLayer | null = null;
/** The 250 m terrain for cast shadows, loaded the first time they are shown. */
let terrainGrid: Grid | null = null;
let terrainGridLoading = false;
let sunTimer: number | undefined;

const sunGroup = $('sun-group');
const sunSlider = $<HTMLInputElement>('sun-time');
const sunDateInput = $<HTMLInputElement>('sun-date');
const sunPlayBtn = $('sun-play');

/** Sun times for the shown day at the map centre. */
const shownSunDay = () => {
  const c = map.getCenter();
  return sunDay(localDate(sunTime), c.lat, c.lng);
};

function showSunControls() {
  const date = localDate(sunTime);
  const start = localMidnight(date);
  const minutes = dayMinutes(date);
  const day = shownSunDay();
  sunDateInput.value = date;
  sunSlider.max = String(minutes);
  sunSlider.value = String(Math.round((sunTime - start) / MINUTE));
  sunSlider.style.setProperty('--sun-track', dayGradient(day, start, minutes));
  $('sun-rise').textContent = day.sunrise === null ? '' : `☀ Sunrise ${clockTime(day.sunrise)}`;
  $('sun-set').textContent = day.sunset === null ? '' : `Sunset ${clockTime(day.sunset)}`;
}

/** Light, sky and night overlay for the sun at the map centre, or the usual light when off. */
function applyLight() {
  if (!lightReady) return;
  const c = map.getCenter();
  const sun = toggle('sun').checked ? sunPosition(sunTime, c.lat, c.lng) : null;
  const paint = hillshadePaint(sun, toggle('satellite').checked);
  for (const k of Object.keys(paint) as (keyof HillshadePaint)[]) map.setPaintProperty('hillshade', k, paint[k]);
  map.setSky(sun ? skyFor(sun.altitude) : DEFAULT_SKY);
  map.setLayoutProperty(NIGHT_LAYER, 'visibility', sun ? 'visible' : 'none');
  applyShadows(sun);
  if (sun) {
    map.setPaintProperty(NIGHT_LAYER, 'fill-opacity', nightOpacity(sun.altitude));
    $('sun-label').textContent = sunLabel(sunTime, sun);
  }
}

function applyShadows(sun: ReturnType<typeof sunPosition> | null) {
  if (!shadowLayer) return;
  if (!sun || sun.altitude <= 0 || !toggle('shadows').checked) {
    shadowLayer.hide();
    return;
  }
  if (terrainGrid) shadowLayer.show(terrainGrid, sunTime, sun.azimuth);
  else if (!terrainGridLoading) {
    terrainGridLoading = true;
    loadGrid().then(
      (g) => {
        terrainGrid = g;
        applyLight();
      },
      (e: unknown) => {
        terrainGridLoading = false;
        toast(`Shadows unavailable: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  }
}

function setSunTime(t: number) {
  const dayChanged = localDate(t) !== localDate(sunTime);
  sunTime = t;
  showSunControls();
  applyLight();
  // The skyline stays; only the sun's path moves with the day.
  if (dayChanged && isSunHere(sunHere)) sunHere = sunHereFor(sunHere.lon, sunHere.lat, sunHere.horizon, localDate(t), sunHere.sunAt);
  showSunHere();
  syncHash();
}

// --- Sun at a clicked point -------------------------------------------------------

/** The open point's skyline and sun: not asked for yet, being traced, failed, or ready. */
let sunHere: 'off' | 'loading' | Error | SunHere = 'off';
const isSunHere = (v: typeof sunHere): v is SunHere => typeof v === 'object' && !(v instanceof Error);

function sunHereSection(): string {
  let html: string;
  if (sunHere === 'off') html = '<button id="sun-here-btn" class="link-btn">☀ When does the sun reach this point?</button>';
  else if (sunHere === 'loading') html = '<h3>Sun here</h3><p class="muted">Tracing the skyline…</p>';
  else if (sunHere instanceof Error) html = `<h3>Sun here</h3><p class="warning">Skyline unavailable: ${escapeHtml(sunHere.message)}</p>`;
  else html = sunHereHtml(sunHere, sunTime);
  return `<section id="sun-here" class="sun-here">${html}</section>`;
}

/** Re-renders the section in the open panel, if it is there. */
function showSunHere() {
  const el = document.getElementById('sun-here');
  if (el) el.outerHTML = sunHereSection();
}

async function traceSunHere(lngLat: maplibregl.LngLat, signal: AbortSignal) {
  sunHere = 'loading';
  showSunHere();
  const { lng: lon, lat } = lngLat;
  try {
    const terrain = await pointTerrain(lon, lat);
    if (signal.aborted) return;
    const horizon = horizonProfile(lon, lat, terrain.ground, {
      bands: [
        { sampler: terrain.near, until: NEAR_RADIUS, step: 20 },
        { sampler: terrain.far, until: 100_000, step: 125 },
      ],
      zMax: terrain.zMax,
    });
    sunHere = sunHereFor(lon, lat, horizon, localDate(sunTime), (t) => sunPosition(t, lat, lon));
  } catch (e) {
    if (signal.aborted) return;
    sunHere = e instanceof Error ? e : new Error(String(e));
  }
  showSunHere();
}

function showSunPlaying(playing: boolean) {
  sunPlayBtn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  sunPlayBtn.setAttribute('aria-label', playing ? 'Pause the day' : 'Play the day');
}

function pauseSun() {
  window.clearInterval(sunTimer);
  sunTimer = undefined;
  showSunPlaying(false);
}

function playSun() {
  const { sunrise, sunset } = shownSunDay();
  if (sunrise === null || sunset === null) return;
  const from = sunrise - PLAY_MARGIN;
  const to = sunset + PLAY_MARGIN;
  if (sunTime < from || sunTime >= to) setSunTime(from);
  showSunPlaying(true);
  // About ten seconds for a winter day, a little more in summer.
  sunTimer = window.setInterval(() => {
    const next = sunTime + 4 * MINUTE;
    setSunTime(Math.min(next, to));
    if (next >= to) pauseSun();
  }, 60);
}

function setupSun() {
  sunPlayBtn.innerHTML = PLAY_ICON;
  sunGroup.hidden = !toggle('sun').checked;
  showSunControls();
  bindToggle('toggle-sun', (on) => {
    sunGroup.hidden = !on;
    if (!on) pauseSun();
    // The light is drawn by the hillshade layer, so it has to be on.
    if (on && !toggle('hillshade').checked) {
      toggle('hillshade').checked = true;
      toggle('hillshade').dispatchEvent(new Event('change'));
    }
    applyLight();
    if (on && openPoint && sunHere === 'off') void traceSunHere(openPoint.lngLat, openPoint.signal);
  });
  bindToggle('toggle-shadows', (on) => {
    // Shadows need the sun light; switching them on switches it on.
    if (on && !toggle('sun').checked) {
      toggle('sun').checked = true;
      toggle('sun').dispatchEvent(new Event('change'));
    } else applyLight();
  });
  sunSlider.addEventListener('input', () => {
    pauseSun();
    setSunTime(localMidnight(localDate(sunTime)) + Number(sunSlider.value) * MINUTE);
  });
  sunDateInput.addEventListener('change', () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sunDateInput.value)) return;
    pauseSun();
    // Keep the time of day on the new date.
    setSunTime(localMidnight(sunDateInput.value) + (sunTime - localMidnight(localDate(sunTime))));
  });
  const jump = (pick: () => number | null) => () => {
    const t = pick();
    if (t === null) return;
    pauseSun();
    setSunTime(t);
  };
  $('sun-rise').addEventListener('click', jump(() => shownSunDay().sunrise));
  $('sun-set').addEventListener('click', jump(() => shownSunDay().sunset));
  $('sun-now').addEventListener('click', jump(() => Date.now()));
  sunPlayBtn.addEventListener('click', () => (sunTimer === undefined ? playSun() : pauseSun()));
  // The sun is computed for the map centre; sunrise moves by about 8 minutes across the region.
  map.on('moveend', () => {
    if (!toggle('sun').checked) return;
    showSunControls();
    applyLight();
  });
}
setupSun();

// --- Point click: elevation + forecast ----------------------------------------

let ferrataLayer: FerrataLayer | null = null;
let ferrataCount: number | null = null;
const pointMarker = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'point-marker' }) });
let forecastAbort: AbortController | null = null;
/** The point whose panel is open; its signal is aborted when the panel closes or another point opens. */
let openPoint: { lngLat: maplibregl.LngLat; signal: AbortSignal } | null = null;

function clearPoint() {
  forecastAbort?.abort();
  pointMarker.remove();
  ferrataLayer?.select(null);
  openPoint = null;
  sunHere = 'off';
}

$('details-body').addEventListener('click', (e) => {
  if (openPoint && (e.target as Element).closest('#sun-here-btn')) void traceSunHere(openPoint.lngLat, openPoint.signal);
});

/**
 * `place` names a clicked map feature (a bivouac, a via ferrata's highest point) and may bring its
 * own elevation, its own label for it and its own snow summary instead of the point's.
 */
async function showPoint(
  lngLat: maplibregl.LngLat,
  place?: { title: string; html: string; elevation: number | null; elevationLabel?: string; snowHtml?: string },
) {
  clearPoint();
  const abort = (forecastAbort = new AbortController());
  // queryTerrainElevation includes the exaggeration, so divide it back out.
  const raw = map.queryTerrainElevation(lngLat);
  const elevation = place?.elevation ?? (raw === null ? null : raw / exaggeration);
  pointMarker.setLngLat(lngLat).addTo(map);
  const snowHtml =
    (place?.html ?? '') +
    (place?.snowHtml ?? (snowFile && snowValues ? pointSnowHtml(snowFile, snowValues.at(lngLat.lng, lngLat.lat)) : ''));
  // The sun section sits under the elevation and snow, above the forecast.
  openPanel(place?.title ?? 'Point forecast', loadingHtml(elevation, snowHtml + sunHereSection(), place?.elevationLabel), clearPoint);
  openPoint = { lngLat, signal: abort.signal };
  // With the sun light on, the skyline is traced straight away; otherwise on request.
  if (toggle('sun').checked) void traceSunHere(lngLat, abort.signal);
  let result;
  try {
    result = await getForecast(lngLat.lat, lngLat.lng, elevation, abort.signal);
  } catch (e) {
    if (abort.signal.aborted) return;
    result = e instanceof Error ? e : new Error(String(e));
  }
  if (!abort.signal.aborted) {
    updatePanelBody(pointHtml(lngLat.lat, lngLat.lng, elevation, result, snowHtml + sunHereSection(), place?.elevationLabel));
  }
}

// --- Map setup -------------------------------------------------------------

map.on('load', async () => {
  // A shared link may switch off layers that the style draws by default.
  if (exaggeration !== DEFAULT_EXAGGERATION) map.setTerrain({ source: 'terrain', exaggeration });
  for (const key of ['hillshade', 'relief', 'basemap', 'labels'] as const) {
    if (!toggle(key).checked) toggle(key).dispatchEvent(new Event('change'));
  }

  // Darkens the map while the sun is below the horizon; roads go under it, labels stay readable.
  const [[w, s], [e, n]] = MAX_BOUNDS;
  map.addLayer(
    {
      id: NIGHT_LAYER,
      type: 'fill',
      source: {
        type: 'geojson',
        data: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      },
      layout: { visibility: 'none' },
      paint: { 'fill-color': NIGHT_COLOR, 'fill-opacity': 0 },
    },
    basemap.labels[0]?.id,
  );
  // Under the night overlay, over the snow cells and roads.
  shadowLayer = new ShadowLayer(map, NIGHT_LAYER);
  // For browser checks and debugging: how long the last shadow computation took.
  shadowLayer.onDrawn = (ms) => (document.body.dataset.shadowMs = ms.toFixed(1));
  lightReady = true;
  applyLight();

  // The picture replaces the drawn land colours but keeps hillshade, roads and labels on top.
  const sat = await satellitePromise;
  const satToggle = toggle('satellite');
  if (sat && addSatelliteLayer(map, sat, 'hillshade', satToggle.checked)) {
    // The photo already has real light and shade, so the drawn hillshade is toned down over it.
    applyLight();
    bindToggle('toggle-satellite', (on) => {
      map.setLayoutProperty(SATELLITE_LAYER, 'visibility', on ? 'visible' : 'none');
      applyLight();
    });
  } else {
    satToggle.checked = false;
    satToggle.disabled = true;
    satToggle.parentElement!.title = 'No satellite picture in the current data';
  }

  // Snow seen by Sentinel-2 goes under the shading so it reads like a snowed-in model; the 250 m
  // cell layers go above the shading and below roads and labels.
  // A layer first added on a day switch still lands in this order, below the forecast.
  const order = [SNOW_LAYERS.cover, SNOW_LAYERS.depth, SNOW_LAYERS.confidence, FORECAST_LAYER];
  snowLayers = new SnowLayers(
    map,
    (key) =>
      key === 'white'
        ? 'hillshade'
        : (order.slice(order.indexOf(SNOW_LAYERS[key]) + 1).find((id) => map.getLayer(id)) ?? basemap.lines[0]?.id),
    { white: toggle('snow').checked, cover: toggle('cover').checked, depth: toggle('depth').checked, confidence: toggle('confidence').checked },
  );
  for (const [layer, key] of Object.entries(SNOW_TOGGLES) as [SnowLayer, LayerKey][]) {
    bindToggle(`toggle-${key}`, (on) => snowLayers!.setVisible(layer, on));
  }
  await showSnow(await snowPromise);

  // Above the snow cells, below roads and labels.
  setupForecast(await forecastPromise);

  // Above roads and buildings, below the place labels, bivouacs and station dots.
  ferrataLayer = addFerrataLayer(
    map,
    (f) => {
      const [lon, lat, ele] = highestPoint(f);
      // Evenly spaced points, so each share is a share of the route's length.
      const points = ferrataLines(f).flatMap((l) => resample(l, 25));
      void showPoint(new maplibregl.LngLat(lon, lat), {
        title: f.properties.name ?? 'Via ferrata',
        html: ferrataHtml(f.properties),
        elevation: ele,
        elevationLabel: 'Highest point',
        snowHtml: snowFile && snowValues ? routeSnowHtml(snowFile, routeSnow(snowValues, points)) : '',
      });
      ferrataLayer!.select(f.properties.id);
    },
    basemap.labels[0]?.id,
  );
  const showFerratas = (on: boolean) => {
    $('ferrata-legend').hidden = !on;
    ferrataLayer!.setVisible(on).then(
      (n) => {
        if (n !== null) ferrataCount = n;
        setWarning('ferratas', null);
      },
      (e: unknown) => {
        console.warn('Via ferratas:', e);
        setWarning('ferratas', 'Via ferratas could not be loaded.');
      },
    );
  };
  if (toggle('ferratas').checked) showFerratas(true);
  bindToggle('toggle-ferratas', showFerratas);

  // Below the station dots, which are added next.
  const bivouacLayer = await addBivouacLayer(
    map,
    favourites,
    (b) =>
      void showPoint(new maplibregl.LngLat(b.lon, b.lat), { title: b.name, html: bivouacHtml(b, favourites.has(b.osm)), elevation: b.ele }),
    toggle('bivouacs').checked,
    toggle('favourites').checked,
  ).catch((e: unknown) => {
    console.warn('Bivouacs:', e);
    return null;
  });
  if (bivouacLayer) {
    bindToggle('toggle-bivouacs', (on) => bivouacLayer.setVisible(on));
    bindToggle('toggle-favourites', (on) => {
      bivouacLayer.setOnlyFavourites(on);
      if (on && !toggle('bivouacs').checked) {
        toggle('bivouacs').checked = true;
        bivouacLayer.setVisible(true);
      }
      if (on && favourites.size === 0) toast('No favourites yet: open a bivouac and tap the heart.');
    });
  }

  const file = await stationsPromise;
  if (file) {
    shownStations ??= file;
    stationLayer = addStationLayer(
      map,
      file.stations,
      (s) => {
        clearPoint();
        openPanel(s.name, stationHtml(s, shownStations ?? file));
      },
      toggle('stations').checked,
    );
    bindToggle('toggle-stations', (on) => stationLayer!.setVisible(on));
  }

  setupDaySlider(await historyPromise);

  map.on('click', (e: maplibregl.MapMouseEvent) => {
    // Stations, bivouacs and via ferratas open their own panels.
    const layers = [STATION_LAYER_ID, ...BIVOUAC_LAYER_IDS, ...FERRATA_LAYER_IDS].filter((id) => map.getLayer(id));
    if (!map.queryRenderedFeatures(e.point, { layers }).length) void showPoint(e.lngLat);
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

map.on('error', (e: maplibregl.ErrorEvent & { sourceId?: string }) => {
  if (e.sourceId === BASEMAP_SOURCE) {
    // The extract is built locally with `npm run basemap` and is not in git; say so instead of failing silently.
    setWarning('basemap', 'Roads and places are unavailable (basemap file missing; run "npm run basemap").');
    return;
  }
  // Missing ocean/edge tiles are expected; anything else is worth surfacing in the console.
  const status = (e.error as { status?: number } | undefined)?.status;
  if (status === 404) return;
  console.warn('Map error:', e.error?.message ?? e);
});
