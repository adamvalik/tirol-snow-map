// The Place tab: what was picked on the map (a station, a point of the terrain, a bivouac, a via
// ferrata, a GPX track). A header with an icon tile, then the body; rows such as the forecast and
// "Sun here" open in place and load their content the first time they open.
import type { Station, StationsFile } from '../../shared/types.ts';
import { currentTab, isPhone, setSheet, showTab } from './app/layout.ts';
import { icon, type IconName } from './app/icons.ts';
import { isOn } from './app/switches.ts';
import { type Forecast, getForecast } from './forecast.ts';
import { fillBulletins } from './regions.ts';
import { depthCardHtml, depthValue, factsHtml, metaHtml } from './placeHtml.ts';
import { compass, escapeHtml, fmt, fmtChange, formatAge, formatTime, TZ, weatherText } from './format.ts';

const details = document.getElementById('details')!;
const empty = document.getElementById('place-empty')!;
const iconEl = document.getElementById('details-icon')!;
const title = document.getElementById('details-title')!;
const sub = document.getElementById('details-sub')!;
const body = document.getElementById('details-body')!;

export interface PanelHead {
  title: string;
  sub?: string;
  icon: IconName;
  /** The icon tile's colour: blue for a layer's own feature, grey for the terrain, purple for a track. */
  tone?: 'blue' | 'grey' | 'track' | 'orange';
}

let onClose: (() => void) | null = null;
let abort = new AbortController();
let returnTab: 'layers' | 'about' = 'layers';

/** Whether something is shown in the Place tab. */
export const panelOpen = () => !details.hidden;

export function openPanel(head: PanelHead, html: string, closeHandler?: () => void) {
  // Replacing one place with another: the old one's close handler still runs.
  if (panelOpen()) finish();
  const tab = currentTab();
  if (tab !== 'place') returnTab = tab;
  abort = new AbortController();
  iconEl.className = `place-icon ${head.tone ?? 'grey'}`;
  iconEl.innerHTML = icon(head.icon, 24);
  title.textContent = head.title;
  sub.textContent = head.sub ?? '';
  body.innerHTML = html;
  details.hidden = false;
  empty.hidden = true;
  showTab('place');
  document.getElementById('tab-place')!.scrollTop = 0;
  onClose = closeHandler ?? null;
  loadOpenRows();
  fillBulletins(body);
}

export function updatePanelBody(html: string) {
  body.innerHTML = html;
  loadOpenRows();
  fillBulletins(body);
}

/** Changes the header line under the title (a track's height source once it is known). */
export function updatePanelSub(text: string) {
  sub.textContent = text;
}

function finish() {
  abort.abort();
  const close = onClose;
  onClose = null;
  close?.();
}

export function closePanel() {
  if (!panelOpen()) return;
  finish();
  details.hidden = true;
  empty.hidden = false;
  body.innerHTML = '';
  if (currentTab() === 'place') showTab(returnTab, false);
  // On a phone the map comes back: the sheet goes down with the place.
  if (isPhone()) setSheet(false);
}

document.getElementById('details-close')!.addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && panelOpen() && !(e.target instanceof HTMLInputElement)) closePanel();
});

// --- Rows that open in place --------------------------------------------------------

/** Where a row's content comes from: a point and its elevation. */
export interface RowPoint {
  lon: number;
  lat: number;
  ele: number | null;
}

type Loader = (p: RowPoint, signal: AbortSignal) => Promise<string>;
const loaders = new Map<string, Loader>();

/** A kind of row ("forecast", "sun") and how to fill it. */
export function registerLoader(kind: string, loader: Loader) {
  loaders.set(kind, loader);
}

async function fill(row: HTMLDetailsElement) {
  const kind = row.dataset.kind!;
  const loader = loaders.get(kind);
  const target = row.querySelector<HTMLElement>('.act-body');
  if (!loader || !target) return;
  row.dataset.loaded = '1';
  const signal = abort.signal;
  const p: RowPoint = { lon: Number(row.dataset.lon), lat: Number(row.dataset.lat), ele: row.dataset.ele ? Number(row.dataset.ele) : null };
  if (!target.innerHTML.trim()) target.innerHTML = `<p class="loading">${kind === 'sun' ? 'Tracing the skyline…' : 'Loading the forecast…'}</p>`;
  let html: string;
  try {
    html = await loader(p, signal);
  } catch (e) {
    html = `<p class="banner">${icon('warning-fill', 18)}<span>${escapeHtml(e instanceof Error ? e.message : String(e))}</span></p>`;
    delete row.dataset.loaded;
  }
  if (!signal.aborted && row.isConnected) target.innerHTML = html;
}

function loadOpenRows() {
  for (const row of body.querySelectorAll<HTMLDetailsElement>('details[data-kind][open]')) if (!row.dataset.loaded) void fill(row);
}

// `toggle` does not bubble, so listen while capturing.
body.addEventListener(
  'toggle',
  (e) => {
    const row = e.target as HTMLElement;
    if (row instanceof HTMLDetailsElement && row.open && row.dataset.kind && !row.dataset.loaded) void fill(row);
  },
  true,
);

/** Fills open rows of a kind again (the sun's day changed). */
export function reloadRows(kind: string) {
  for (const row of body.querySelectorAll<HTMLDetailsElement>(`details[data-kind="${kind}"]`)) {
    delete row.dataset.loaded;
    if (row.open) void fill(row);
  }
}

const caret = `<span class="caret">${icon('caret-down', 18)}</span>`;

function rowHtml(kind: string, p: RowPoint, label: string, iconName: IconName, open: boolean) {
  const ele = p.ele === null ? '' : ` data-ele="${Math.round(p.ele)}"`;
  return `<details data-kind="${kind}" data-lon="${p.lon}" data-lat="${p.lat}"${ele}${open ? ' open' : ''}>
    <summary class="act">${icon(iconName, 20)}<span class="act-label">${label}</span>${caret}</summary>
    <div class="act-body"></div>
  </details>`;
}

/** The rows under a place: the 7-day forecast, sunrise and shade, and the avalanche bulletin. */
export function actionsHtml(
  p: RowPoint,
  opts: { forecastOpen?: boolean; forecastLabel?: string; sunLabel?: string; bulletin?: boolean } = {},
): string {
  return `<nav class="actions" aria-label="More for this place">
    ${rowHtml('forecast', p, opts.forecastLabel ?? '7-day forecast', 'cloud-snow', opts.forecastOpen ?? false)}
    ${rowHtml('sun', p, opts.sunLabel ?? 'Sunrise, sunset and shade here', 'sun-horizon', isOn('sun'))}
    ${
      opts.bulletin === false
        ? ''
        : // The region and its service are filled in by fillBulletins (regions.ts) once the outlines are loaded.
          `<a class="act" href="https://avalanche.report" target="_blank" rel="noopener" data-bulletin data-lon="${p.lon}" data-lat="${p.lat}">${icon('warning', 20)}<span class="act-label">Avalanche bulletin<span class="act-sub">for this area, at avalanche.report</span></span>${icon('arrow-up-right', 16)}</a>`
    }
  </nav>`;
}

registerLoader('forecast', async (p, signal) => forecastHtml(await getForecast(p.lat, p.lon, p.ele, signal).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))))));

// --- Stations -----------------------------------------------------------------------------

const SOURCE_NAMES: Record<string, string> = {
  'province-bz': 'Province of Bolzano weather service',
  'euregio-linea': 'Euregio station network (avalanche.report)',
};

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '–';

export function stationHtml(s: Station, file: StationsFile): string {
  const wind =
    s.windSpeedKmh === null
      ? '–'
      : s.windSpeedKmh < 2
        ? 'Calm'
        : `${fmt(s.windSpeedKmh, 'km/h')} ${compass(s.windDirDeg)}` + (s.windGustKmh === null ? '' : `<small>gusts ${fmt(s.windGustKmh, 'km/h')}</small>`);
  const changes = (
    [
      ['24 h', s.snowChange24hCm],
      ['48 h', s.snowChange48hCm],
      ['72 h', s.snowChange72hCm],
    ] as const
  ).filter(([, v]) => v !== null && v !== undefined) as [string, number][];
  const change =
    s.snowDepthCm === null || !changes.length
      ? ''
      : `<div class="change">
          <span class="change-title">Depth change</span>
          <dl>${changes.map(([label, v]) => `<div><dt>${label}</dt><dd${v > 0 ? ' class="gain"' : ''}>${fmtChange(v, 'cm')}</dd></div>`).join('')}</dl>
          <p>New snow minus settling and melt, so usually less than the snowfall.</p>
        </div>`;
  const depth =
    s.snowDepthCm === null
      ? depthCardHtml('Snow depth', null, '<span class="depth-value none">No snow sensor</span>')
      : depthCardHtml('Snow depth', s.snowDepthCm, depthValue(s.snowDepthCm), [], change);
  const sources = s.sources.map((id) => SOURCE_NAMES[id] ?? id).join(', ');
  const read = s.observedAt ? `Read at ${clock(s.observedAt)}, ${formatAge(s.observedAt)}` : 'Reading time unknown';
  return `
    ${metaHtml([
      ['mountains', `${s.elevation.toLocaleString('en-GB')} m`],
      ['clock', read],
    ])}
    ${depth}
    ${factsHtml([
      ['Air', fmt(s.airTempC, '°C', 1), 'thermometer-simple'],
      ['Wind', wind, 'wind'],
      ['Rain 24 h', s.precip24hMm === null || s.precip24hMm === 0 ? '–' : fmt(s.precip24hMm, 'mm', 1), 'drop'],
    ])}
    ${actionsHtml({ lon: s.lon, lat: s.lat, ele: s.elevation })}
    <p class="source-note">${escapeHtml(sources)}${s.operator ? `, operated by ${escapeHtml(s.operator)}` : ''}. Collected ${formatTime(file.generatedAt)}.
    Snow depth is measured at a single point and can differ a lot on nearby slopes.</p>`;
}

// --- Forecast -------------------------------------------------------------------------------

function weatherIcon(code: number | null | undefined): IconName {
  if (code === null || code === undefined) return 'cloud';
  if (code <= 1) return 'sun';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'cloud-snow';
  if (code >= 51) return 'drop';
  return 'cloud';
}

/**
 * The forecast for a point: now, then 7 days with the new snow as bars. For any point that has one
 * (`getForecast` takes a coordinate and an elevation): a clicked point, a station, a track's highest point.
 */
export function forecastHtml(f: Forecast | Error): string {
  if (f instanceof Error) return `<p class="banner">${icon('warning-fill', 18)}<span>Forecast unavailable: ${escapeHtml(f.message)}</span></p>`;
  const c = f.current;
  const maxSnow = Math.max(1, ...f.daily.snowfall_sum);
  const rows = f.daily.time
    .map((day, i) => {
      const snow = f.daily.snowfall_sum[i] ?? 0;
      const label = new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
      const text = weatherText(f.daily.weather_code[i]);
      return `<div class="fc-row" title="${escapeHtml(`${text}, ${f.daily.precipitation_sum[i].toFixed(1)} mm`)}">
        <span>${label}</span>${icon(weatherIcon(f.daily.weather_code[i]), 18)}<span class="fc-weather">${escapeHtml(text)}</span>
        <span class="fc-temp">${Math.round(f.daily.temperature_2m_min[i])}° / ${Math.round(f.daily.temperature_2m_max[i])}°</span>
        <span class="fc-snow"><span class="fc-bar" aria-hidden="true"><span style="width:${((snow / maxSnow) * 100).toFixed(0)}%"></span></span>${snow < 0.5 ? '0' : Math.round(snow)}</span>
      </div>`;
    })
    .join('');
  return `
    <p class="fc-now">Now: ${escapeHtml(weatherText(c.weather_code).toLowerCase())}, ${fmt(c.temperature_2m, '°C', 1)}, wind ${fmt(c.wind_speed_10m, 'km/h')} ${compass(c.wind_direction_10m)}</p>
    <div class="forecast fc-list" role="table" aria-label="7-day forecast">${rows}<span class="fc-unit">new snow, cm</span></div>
    <p class="source-note">Forecast: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0), adjusted to
    ${Math.round(f.elevation).toLocaleString('en-GB')} m, fetched ${formatTime(f.fetchedAt)}. Model output, not a measurement.</p>`;
}
