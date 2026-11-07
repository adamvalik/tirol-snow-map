// "About the data": sources, licences and the state of the last pipeline run; and the warning when
// that run could not refresh some layers.
import type { StatusFile } from '../../../shared/types.ts';
import { BIVOUACS } from '../bivouacs.ts';
import { forecastInfoHtml } from '../forecastAnim.ts';
import { escapeHtml, formatAge, formatTime } from '../format.ts';
import { AREA } from '../island.ts';
import { ferrataCount as ferrataRoutes } from '../layers/ferratas.ts';
import { forecastFile as forecast } from '../layers/forecast.ts';
import { satelliteFile as satellite } from '../layers/satellite.ts';
import { shownSnow } from '../layers/snow.ts';
import { latestStations, stationsError as stationsLoadError } from '../layers/stations.ts';
import { satelliteInfoHtml } from '../satellite.ts';
import { snowInfoHtml } from '../snow.ts';
import { VERSION_LABEL } from '../version.ts';
import { loadJson } from './data.ts';
import { history } from './daySlider.ts';
import { $ } from './dom.ts';
import { setWarning } from './warnings.ts';

const STEP_NAMES: Record<string, string> = {
  stations: 'weather stations',
  snow: 'snow layers',
  satellite: 'satellite picture',
  forecast: 'forecast snowfall',
};

let statusFile: StatusFile | null = null;

function renderSources() {
  const stationsFile = latestStations();
  const stationsError = stationsLoadError();
  const snowFile = shownSnow();
  const satelliteFile = satellite();
  const forecastFile = forecast();
  const historyFile = history();
  const ferrataCount = ferrataRoutes();
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
    <h3>Area</h3>
    <p>The map is cut to the area the snow layers cover, ${AREA.west}–${AREA.east}° E and ${AREA.south}–${AREA.north}° N: South Tyrol with
    the edges of North and East Tyrol, Trentino, Graubünden and Belluno. Stations, bivouacs and via ferratas outside it are not shown,
    although stations just outside still feed the snow depth estimate.</p>
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
    <a href="https://avalanche.report" target="_blank" rel="noopener">avalanche.report</a>.</p>
    <h3>App version</h3>
    <p class="muted">${escapeHtml(VERSION_LABEL)} · <a href="https://github.com/adamvalik/tirol-snow-map/releases" target="_blank" rel="noopener">release notes</a></p>`;
}

/** Loads status.json and wires the "About the data" button. */
export function setupSources() {
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

  const dialog = $<HTMLDialogElement>('sources-dialog');
  $('sources-btn').addEventListener('click', () => {
    renderSources();
    dialog.showModal();
  });
}
