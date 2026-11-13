// The About tab: feedback first, then where each data set comes from (with its state from the last
// pipeline run), the area, safety, privacy and the version. Also the warning when that run could not
// refresh some layers.
import type { StatusFile } from '../../../shared/types.ts';
import { BIVOUACS } from '../bivouacs.ts';
import { forecastInfoHtml } from '../forecastAnim.ts';
import { escapeHtml, formatAge, formatTime } from '../format.ts';
import { AREA } from '../island.ts';
import { ferrataCount as ferrataRoutes } from '../layers/ferratas.ts';
import { forecastFile as forecast } from '../layers/forecast.ts';
import { satelliteFile as satellite } from '../layers/satellite.ts';
import { latestSnow } from '../layers/snow.ts';
import { latestStations, stationsError as stationsLoadError } from '../layers/stations.ts';
import { satelliteInfoHtml, shortDate } from '../satellite.ts';
import { snowInfoHtml } from '../snow.ts';
import { APP_COMMIT, APP_VERSION } from '../version.ts';
import { analyticsEnabled, track } from './analytics.ts';
import { $ } from './dom.ts';
import { feedbackHtml } from './feedback.ts';
import { icon, type IconName } from './icons.ts';
import { loadJson } from './data.ts';
import { onTab } from './layout.ts';
import { history } from './timeline.ts';
import { setWarning } from './warnings.ts';

const STEP_NAMES: Record<string, string> = {
  stations: 'weather stations',
  snow: 'snow layers',
  satellite: 'satellite picture',
  forecast: 'forecast snowfall',
};

let statusFile: StatusFile | null = null;
/** Rows the reader opened, kept open when the tab is drawn again. */
const openRows = new Set<string>();

const ext = (href: string, text: string) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${text}</a>`;

/** The problem the last pipeline run had with a step, as a line for its row, or null. */
function problem(step: keyof StatusFile['steps']): string | null {
  const s = statusFile?.steps[step];
  if (!s || s.ok) return null;
  return `Not refreshed since ${formatTime(s.failingSince)}. ${s.problems.join('; ')}`;
}

function row(id: string, title: string, sub: string, body: string, opts: { problem?: string | null; status?: boolean } = {}) {
  // A green check for data that is in and current, a grey one for data the current run does not have.
  const missing = sub === 'Not available';
  const status =
    opts.status === false
      ? '<span class="status" aria-hidden="true"></span>'
      : `<span class="status${missing && !opts.problem ? ' off' : ''}" aria-hidden="true">${icon(opts.problem ? 'warning-fill' : missing ? 'minus' : 'check-circle-fill', 18)}</span>`;
  const subText = opts.problem ? `${sub}. ${opts.problem}` : sub;
  return `<details class="data-row${opts.problem ? ' problem' : ''}" data-row="${id}"${openRows.has(id) ? ' open' : ''}>
    <summary>${status}<span class="data-text"><strong>${title}</strong><span>${escapeHtml(subText)}</span></span><span class="caret">${icon('caret-down', 18)}</span></summary>
    <div class="data-body">${body}</div>
  </details>`;
}

const info = (ic: IconName, title: string, html: string, warn = false) =>
  `<section class="about-info"><span class="info-icon${warn ? ' warn' : ''}" aria-hidden="true">${icon(ic, 20)}</span><div><h2>${title}</h2>${html}</div></section>`;

function render() {
  const stationsFile = latestStations();
  const snowFile = latestSnow();
  const satelliteFile = satellite();
  const forecastFile = forecast();
  const historyFile = history();
  const ferrataCount = ferrataRoutes();

  const stationProblem =
    problem('stations') ??
    (stationsFile && (stationsFile.stale || stationsFile.sources.some((s) => !s.ok))
      ? `Last update could not reach: ${stationsFile.sources.filter((s) => !s.ok).map((s) => s.name).join(', ') || 'the sources'}`
      : null);
  const stationBody = stationsFile
    ? stationsFile.sources
        .map(
          (s) => `<p>${ext(s.url, escapeHtml(s.name))}<br>
          <small class="muted">${escapeHtml(s.attribution)}. Licence: ${escapeHtml(s.licence)}.<br>
          ${s.ok ? `Fetched ${formatTime(s.fetchedAt)}, ${s.stationCount} records.` : `Last fetch failed (${escapeHtml(s.error ?? 'unknown error')}); last success ${formatTime(s.fetchedAt)}.`}</small></p>`,
        )
        .join('') +
      `<p class="muted">Stations reported by both are merged into one dot. Refreshed three times a day: early morning, after lunch and in the evening;
      this file is from ${formatTime(stationsFile.generatedAt)} (${formatAge(stationsFile.generatedAt)}).</p>`
    : `<p class="muted">${escapeHtml(stationsLoadError() ?? 'Loading…')}</p>`;

  const cover = snowFile?.cover;
  const coverSub = cover?.available ? `${cover.sensor}, ${shortDate(cover.date)}, Copernicus data` : 'Not available';
  const coverBody = snowFile
    ? snowInfoHtml(snowFile, 'cover') +
      (cover?.available ? `<p>${ext(cover.source, escapeHtml(cover.attribution))}. ${escapeHtml(cover.licence)}.</p>` : '')
    : '<p class="muted">Not loaded.</p>';
  const depth = snowFile?.depth;
  const depthBody = snowFile
    ? `${snowInfoHtml(snowFile, 'depth')}<p class="muted">The app's own estimate from station readings and elevation; not an official product.
      The timeline shows the last update of each of the past ${historyFile?.days.length ?? 14} days.</p>`
    : '<p class="muted">Not loaded.</p>';

  const sat = satelliteFile;
  const satSub = sat?.available && sat.date ? `Sentinel-2, ${shortDate(sat.date)}, newest clear day` : 'Not available';
  const satBody = sat
    ? satelliteInfoHtml(sat) + (sat.available ? `<p>${escapeHtml(sat.attribution)}. Free and open Copernicus data.</p>` : '')
    : '<p class="muted">Not loaded.</p>';

  const fcBody =
    (forecastFile ? forecastInfoHtml(forecastFile) : '') +
    `<p>${ext('https://open-meteo.com/', 'Weather data by Open-Meteo.com')}, licensed CC BY 4.0. The point forecast is fetched when you open a place and
    kept in your browser for one hour.</p>`;

  const mapBody = `<p>Terrain: ${ext('https://mapterhorn.com/attribution', '© Mapterhorn')}, built from open elevation data:
    South Tyrol DGM 2.5 m (Autonomous Province of Bolzano, CC0), TINITALY 10 m (INGV, CC BY 4.0),
    Trentino LiDAR (Autonomous Province of Trento, CC BY 2.5), Austria DGM (BEV, CC BY 4.0), Copernicus GLO-30.</p>
    <p>Roads, places, rivers, buildings and summits: © ${ext('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors')} (ODbL),
    via a ${ext('https://protomaps.com/', 'Protomaps')} basemap build served from this site.</p>`;

  const featuresBody = `<p>${BIVOUACS.length} bivouacs: huts and shelters named bivacco, Biwak or bivouac in
    © ${ext('https://www.openstreetmap.org/copyright', 'OpenStreetMap')} (ODbL), a static list taken with the Overpass API. Red = metal box, brown = wood
    where OSM says so. Not checked for whether they are open, equipped or still standing.</p>
    <p>${ferrataCount ?? 'The'} via ferratas tagged in OpenStreetMap (<code>highway=via_ferrata</code>, a path with <code>via_ferrata_scale</code>, and
    <code>route=via_ferrata</code> relations), a static list. Linked sections are one route. Grades A–E from the OSM scale 0–6; a route takes its hardest
    section's grade. Length, elevation and climb come from the Mapterhorn terrain over the mapped sections only. Drawn by volunteers, so it may be
    incomplete, wrong or out of date. Not for navigation.</p>
    <p>Avalanche warning regions: the ${ext('https://regions.avalanches.org', 'EAWS micro-regions')} (CC0), a static copy simplified to about 30 m,
    so a place within a few hundred metres of a border may be given the neighbouring region. The place panel only names the region and links
    to the service that publishes its bulletin; this app never shows or judges avalanche danger.</p>`;

  const softwareBody = `<p>${ext('https://maplibre.org/', 'MapLibre GL JS')} (BSD-3-Clause), sun position by
    ${ext('https://github.com/mourner/suncalc', 'SunCalc')} (BSD-2-Clause). Type: Barlow and, on the map, Noto Sans (both OFL).
    Icons: ${ext('https://phosphoricons.com/', 'Phosphor')} (MIT).</p>`;

  const runs = statusFile ? '3 updates a day' : '';
  $('sources-body').innerHTML = `
    ${feedbackHtml()}
    <section class="about-section" aria-labelledby="src-h">
      <div class="about-head"><h2 id="src-h">Where the data comes from</h2><span>${runs}</span></div>
      <div class="data-rows">
        ${row('stations', 'Weather stations', stationsFile ? `${stationsFile.stations.length} stations, Province of Bolzano and Euregio` : 'Loading', stationBody, { problem: stationProblem })}
        ${row('cover', 'Snow from space', coverSub, coverBody, { problem: problem('snow') })}
        ${row('depth', 'Estimated snow depth', depth ? `This app's estimate from ${depth.stationCount} stations` : 'Not available', depthBody, { problem: problem('snow') })}
        ${row('satellite', 'Satellite photo', satSub, satBody, { problem: problem('satellite') })}
        ${row('forecast', 'Forecast', 'Open-Meteo, 3 days ahead, CC BY 4.0', fcBody, { problem: problem('forecast') })}
        ${row('map', 'Terrain and map', 'Mapterhorn, OpenStreetMap, Protomaps', mapBody, { status: false })}
        ${row('features', 'Bivouacs, via ferratas, avalanche regions', 'OpenStreetMap volunteers, EAWS, static lists', featuresBody, { status: false })}
        ${row('software', 'Software', 'MapLibre GL JS, SunCalc, Barlow, Noto Sans', softwareBody, { status: false })}
      </div>
    </section>
    ${info(
      'frame',
      'Area',
      `<p>${AREA.west}–${AREA.east}° E and ${AREA.south}–${AREA.north}° N: South Tyrol with the edges of North and East Tyrol, Trentino, Graubünden and Belluno.
      Stations just outside still feed the snow depth estimate.</p>`,
    )}
    ${info(
      'warning',
      'Not for avalanche decisions',
      `<p>For orientation only. Station values are point readings and forecasts are model output.</p>
      <a href="https://avalanche.report" target="_blank" rel="noopener">Read the bulletin on avalanche.report${icon('arrow-up-right', 13)}</a>`,
      true,
    )}
    ${
      analyticsEnabled()
        ? info(
            'lock',
            'Privacy',
            `<p>Visits are counted anonymously with ${ext('https://www.goatcounter.com', 'GoatCounter')}: no cookies, nothing personal, and the place you look at
            is not sent. Your position, favourites and GPX tracks never leave your device.</p>`,
          )
        : ''
    }
    <section class="version-row" aria-label="Version">
      <span class="info-icon" aria-hidden="true">${icon('tag', 20)}</span>
      <span><span>Version ${escapeHtml(APP_VERSION)}</span><small>Build ${escapeHtml(APP_COMMIT)}</small></span>
      <a href="https://github.com/adamvalik/tirol-snow-map/releases" target="_blank" rel="noopener">Release notes${icon('arrow-up-right', 13)}</a>
    </section>`;
}

/** Loads status.json and draws the About tab each time it is shown. */
export function setupSources() {
  void loadJson<StatusFile>('status.json').then((s) => {
    statusFile = s;
    // Station and forecast problems have their own, more specific warnings.
    const failing = s ? (['snow', 'satellite'] as const).filter((id) => !s.steps[id]?.ok) : [];
    setWarning(
      'status',
      failing.length
        ? `The last update could not refresh the ${failing.map((id) => STEP_NAMES[id]).join(' and ')}; they show their last good data (details under About).`
        : null,
    );
  });

  onTab('about', () => {
    render();
    track('about');
  });
  const body = $('sources-body');
  body.addEventListener('click', (e) => {
    const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-feedback]')?.dataset.feedback;
    if (kind) track(`feedback/${kind}`);
  });
  body.addEventListener(
    'toggle',
    (e) => {
      const d = e.target as HTMLDetailsElement;
      const id = d.dataset?.row;
      if (!id) return;
      if (d.open) openRows.add(id);
      else openRows.delete(id);
    },
    true,
  );
}
