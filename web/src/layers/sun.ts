// Sun and shade: the light for a time of day, the night overlay, cast shadows, the sun row of the
// timeline, and "Sunrise, sunset and shade here" (the skyline and sun hours) in the Place tab.
import { $ } from '../app/dom.ts';
import { PAUSE_ICON, PLAY_ICON } from '../app/icons.ts';
import { isOn, switchOn } from '../app/switches.ts';
import { toast } from '../app/toast.ts';
import { registerLoader, reloadRows } from '../panel.ts';
import { type Horizon, horizonProfile } from '../../../shared/horizon.ts';
import { MAX_BOUNDS } from '../map.ts';
import { ShadowLayer } from '../shadows.ts';
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
  sunParam,
  sunPosition,
} from '../sun.ts';
import { type SunHere, sunHereFor, sunHereHtml } from '../sunHere.ts';
import type { SunPosition } from '../sun.ts';
import { type Grid, loadGrid, NEAR_RADIUS, pointTerrain } from '../terrainSampler.ts';
import type { App, LayerModule } from './types.ts';

const NIGHT_LAYER = 'sun-night';
const MINUTE = 60_000;
/** Play runs from a little before sunrise to a little after sunset. */
const PLAY_MARGIN = 40 * MINUTE;

let app: App;
let sunTime = Date.now();
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
  const c = app.map.getCenter();
  return sunDay(localDate(sunTime), c.lat, c.lng);
};

function showSunControls() {
  const date = localDate(sunTime);
  const start = localMidnight(date);
  const minutes = dayMinutes(date);
  const day = shownSunDay();
  sunDateInput.value = date;
  // The day ends one step before the next midnight: at the full length the slider's end would be
  // 00:00 of the next day, and holding it there kept moving the day on with every input event.
  const last = minutes - Number(sunSlider.step || 5);
  sunSlider.max = String(last);
  sunSlider.value = String(Math.round((sunTime - start) / MINUTE));
  sunSlider.style.setProperty('--sun-track', dayGradient(day, start, last));
  $('sun-rise').textContent = day.sunrise === null ? '' : `Sunrise ${clockTime(day.sunrise)}`;
  $('sun-set').textContent = day.sunset === null ? '' : `Sunset ${clockTime(day.sunset)}`;
  $('sun-date-label').textContent = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Light, sky and night overlay for the sun at the map centre, or the usual light when off.
 * The satellite photo tones the hillshade down, so it calls this too.
 */
export function applyLight() {
  if (!lightReady) return;
  const { map } = app;
  const c = map.getCenter();
  const sun = isOn('sun') ? sunPosition(sunTime, c.lat, c.lng) : null;
  const paint = hillshadePaint(sun, isOn('satellite'));
  for (const k of Object.keys(paint) as (keyof HillshadePaint)[]) map.setPaintProperty('hillshade', k, paint[k]);
  map.setSky(sun ? skyFor(sun.altitude) : DEFAULT_SKY);
  map.setLayoutProperty(NIGHT_LAYER, 'visibility', sun ? 'visible' : 'none');
  applyShadows(sun);
  if (sun) {
    map.setPaintProperty(NIGHT_LAYER, 'fill-opacity', nightOpacity(sun.altitude));
    showSunLabel(sun);
  }
}

/** "Sun 14:20" and "21° high in the SW" in the sun row. */
function showSunLabel(sun: SunPosition) {
  $('sun-label').textContent = `Sun ${clockTime(sunTime)}`;
  $('sun-alt').textContent =
    sun.altitude >= 0.5 ? `${Math.round(sun.altitude)}° high` : sun.altitude > -6 ? 'on the horizon' : 'night';
}

function applyShadows(sun: ReturnType<typeof sunPosition> | null) {
  if (!shadowLayer) return;
  if (!sun || sun.altitude <= 0 || !isOn('shadows')) {
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
  // The skyline stays (traced once per place); the sun's path is worked out again for the new day.
  if (dayChanged) {
    reloadRows('sun');
    for (const l of sunDayListeners) l(localDate(t));
  }
  app.syncHash();
}

// --- Sun at a place --------------------------------------------------------------

/** Skylines traced recently, by position, so asking again (another day, a reopened panel) is instant. */
const horizons = new Map<string, Promise<Horizon>>();
const MAX_HORIZONS = 8;

function traceHorizon(lon: number, lat: number): Promise<Horizon> {
  const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
  let h = horizons.get(key);
  if (!h) {
    h = pointTerrain(lon, lat).then((terrain) =>
      horizonProfile(lon, lat, terrain.ground, {
        bands: [
          { sampler: terrain.near, until: NEAR_RADIUS, step: 20 },
          { sampler: terrain.far, until: 100_000, step: 125 },
        ],
        zMax: terrain.zMax,
      }),
    );
    // A failure is not kept, so the next ask tries again.
    h.catch(() => horizons.delete(key));
    horizons.set(key, h);
    while (horizons.size > MAX_HORIZONS) horizons.delete(horizons.keys().next().value!);
  }
  return h;
}

/** The sun slider's day (YYYY-MM-DD), which "Sun here" is worked out for; today unless the sun light was moved. */
export const sunDate = (): string => localDate(sunTime);

const sunDayListeners: ((date: string) => void)[] = [];

/** Called with the new day when the sun slider moves to another day; ask `sunHereAt` again then. */
export function onSunDayChange(listener: (date: string) => void) {
  sunDayListeners.push(listener);
}

/**
 * When the sun reaches a point and goes behind the mountains on `sunDate()`, with the skyline seen
 * from it: for any coordinate (a clicked point, a track's highest point, a station). The first ask
 * for a place fetches terrain and takes a moment; `sunHereHtml` draws the result.
 */
export async function sunHereAt(lon: number, lat: number, date = sunDate()): Promise<SunHere> {
  const horizon = await traceHorizon(lon, lat);
  return sunHereFor(lon, lat, horizon, date, (t) => sunPosition(t, lat, lon));
}

// --- Player ------------------------------------------------------------------------

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

export const sun: LayerModule = {
  keys: ['sun', 'shadows'],

  setup(a) {
    app = a;
    if (app.initial.sun) sunTime = Date.parse(app.initial.sun);
    sunPlayBtn.innerHTML = PLAY_ICON;
    sunGroup.hidden = !isOn('sun');
    showSunControls();
    sunSlider.addEventListener('input', () => {
      pauseSun();
      // The slider only moves the time of day; the date changes with the date button.
      const date = localDate(sunTime);
      const minute = Math.min(Number(sunSlider.value), dayMinutes(date) - 1);
      setSunTime(localMidnight(date) + minute * MINUTE);
    });
    // The date input is invisible over its button. Clicking it opens the calendar, not only the
    // part of the native input that has the calendar icon.
    sunDateInput.addEventListener('click', () => {
      try {
        sunDateInput.showPicker();
      } catch {
        // Older browsers: the native input still opens its own picker or takes typing.
      }
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
    app.map.on('moveend', () => {
      if (!isOn('sun')) return;
      showSunControls();
      applyLight();
    });

    // "Sunrise, sunset and shade here" in the Place tab; it opens by itself while the sun light is on.
    registerLoader('sun', async (p) => sunHereHtml(await sunHereAt(p.lon, p.lat), sunTime));
  },

  init() {
    const { map, basemap } = app;
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
  },

  setVisible(key, on) {
    if (key === 'shadows') {
      // Shadows need the sun light; switching them on switches it on.
      if (on && !isOn('sun')) switchOn('sun');
      else applyLight();
      return;
    }
    sunGroup.hidden = !on;
    if (!on) pauseSun();
    // The light is drawn by the hillshade layer, so it has to be on.
    if (on && !isOn('hillshade')) switchOn('hillshade');
    applyLight();
    if (on) for (const row of document.querySelectorAll<HTMLDetailsElement>('#details-body details[data-kind="sun"]')) row.open = true;
  },

  view: () => ({ sun: isOn('sun') ? sunParam(sunTime) : null }),
};
