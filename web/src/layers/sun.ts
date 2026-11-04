// Sun and shade: the light for a time of day, the night overlay, cast shadows, the sun player in
// the dock, and "Sun here" (the skyline and sun hours) in a point's panel.
import type * as maplibregl from 'maplibre-gl';
import { $ } from '../app/dom.ts';
import { PAUSE_ICON, PLAY_ICON } from '../app/icons.ts';
import type { OpenPoint } from '../app/point.ts';
import { isOn, switchOn } from '../app/switches.ts';
import { toast } from '../app/toast.ts';
import { escapeHtml } from '../format.ts';
import { horizonProfile } from '../../../shared/horizon.ts';
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
  sunLabel,
  sunParam,
  sunPosition,
} from '../sun.ts';
import { type SunHere, sunHereFor, sunHereHtml } from '../sunHere.ts';
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
  sunSlider.max = String(minutes);
  sunSlider.value = String(Math.round((sunTime - start) / MINUTE));
  sunSlider.style.setProperty('--sun-track', dayGradient(day, start, minutes));
  $('sun-rise').textContent = day.sunrise === null ? '' : `☀ Sunrise ${clockTime(day.sunrise)}`;
  $('sun-set').textContent = day.sunset === null ? '' : `Sunset ${clockTime(day.sunset)}`;
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
    $('sun-label').textContent = sunLabel(sunTime, sun);
  }
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
  // The skyline stays; only the sun's path moves with the day.
  if (dayChanged && isSunHere(sunHere)) sunHere = sunHereFor(sunHere.lon, sunHere.lat, sunHere.horizon, localDate(t), sunHere.sunAt);
  showSunHere();
  app.syncHash();
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

async function traceSunHere({ lngLat, signal }: { lngLat: maplibregl.LngLat; signal: AbortSignal }) {
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
    app.map.on('moveend', () => {
      if (!isOn('sun')) return;
      showSunControls();
      applyLight();
    });

    // "Sun here" sits in a point's panel; with the sun light on, the skyline is traced straight away.
    app.point.extend({
      html: sunHereSection,
      open: (p: OpenPoint) => {
        if (isOn('sun')) void traceSunHere(p);
      },
      close: () => {
        sunHere = 'off';
      },
    });
    $('details-body').addEventListener('click', (e) => {
      const p = app.point.current;
      if (p && (e.target as Element).closest('#sun-here-btn')) void traceSunHere(p);
    });
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
    const p = app.point.current;
    if (on && p && sunHere === 'off') void traceSunHere(p);
  },

  view: () => ({ sun: isOn('sun') ? sunParam(sunTime) : null }),
};
