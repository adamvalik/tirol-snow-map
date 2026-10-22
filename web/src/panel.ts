import type { Station, StationsFile } from '../../shared/types.ts';
import { snowColor } from './colors.ts';
import type { Forecast } from './forecast.ts';
import { compass, escapeHtml, fmt, formatAge, formatTime, weatherText } from './format.ts';

const panel = document.getElementById('details')!;
const title = document.getElementById('details-title')!;
const body = document.getElementById('details-body')!;

let onClose: (() => void) | null = null;

export function openPanel(heading: string, html: string, closeHandler?: () => void) {
  title.textContent = heading;
  body.innerHTML = html;
  body.scrollTop = 0;
  panel.hidden = false;
  document.body.classList.add('details-open');
  onClose = closeHandler ?? null;
}

export function updatePanelBody(html: string) {
  body.innerHTML = html;
}

export function closePanel() {
  panel.hidden = true;
  document.body.classList.remove('details-open');
  onClose?.();
  onClose = null;
}

document.getElementById('details-close')!.addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panel.hidden) closePanel();
});

const SOURCE_NAMES: Record<string, string> = {
  'province-bz': 'South Tyrol weather service',
  'euregio-linea': 'Euregio station network (avalanche.report)',
};

export function stationHtml(s: Station, file: StationsFile): string {
  const wind =
    s.windSpeedKmh === null
      ? '–'
      : `${fmt(s.windSpeedKmh, 'km/h')} ${compass(s.windDirDeg)}` +
        (s.windGustKmh === null ? '' : `, gusts ${fmt(s.windGustKmh, 'km/h')}`);
  const snow =
    s.snowDepthCm === null
      ? 'No snow sensor'
      : `<span class="swatch" style="display:inline-block;background:${snowColor(s.snowDepthCm)}"></span> ${fmt(s.snowDepthCm, 'cm')}`;
  const sources = s.sources.map((id) => SOURCE_NAMES[id] ?? id).join(', ');
  return `
    <dl class="kv">
      <dt>Snow depth</dt><dd class="big">${snow}</dd>
      <dt>Air temperature</dt><dd>${fmt(s.airTempC, '°C', 1)}</dd>
      <dt>Wind</dt><dd>${wind}</dd>
      <dt>Precipitation 24 h</dt><dd>${fmt(s.precip24hMm, 'mm', 1)}</dd>
      <dt>Elevation</dt><dd>${s.elevation.toLocaleString('en-GB')} m</dd>
      <dt>Reading</dt><dd>${formatTime(s.observedAt)} (${formatAge(s.observedAt)})</dd>
    </dl>
    <p class="muted">Operator: ${escapeHtml(s.operator || 'unknown')}<br>
    Data: ${escapeHtml(sources)}, collected ${formatTime(file.generatedAt)}.<br>
    Snow depth is measured at a single point and can differ a lot on nearby slopes.</p>`;
}

export const loadingHtml = (elevation: number | null, snowHtml = '', elevationLabel = 'Elevation') => `
  <dl class="kv"><dt>${elevationLabel}</dt><dd class="big">${elevation === null ? '–' : `${Math.round(elevation).toLocaleString('en-GB')} m`}</dd></dl>
  ${snowHtml}
  <p class="muted">Loading forecast…</p>`;

export function pointHtml(
  lat: number,
  lon: number,
  elevation: number | null,
  f: Forecast | Error,
  snowHtml = '',
  elevationLabel = 'Elevation',
): string {
  const head = `
    <dl class="kv">
      <dt>${elevationLabel}</dt><dd class="big">${elevation === null ? '–' : `${Math.round(elevation).toLocaleString('en-GB')} m`}</dd>
      <dt>Position</dt><dd>${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E</dd>
    </dl>
    ${snowHtml}`;
  if (f instanceof Error) {
    return `${head}<p class="warning">Forecast unavailable: ${escapeHtml(f.message)}</p>`;
  }
  const c = f.current;
  const maxSnow = Math.max(1, ...f.daily.snowfall_sum);
  const rows = f.daily.time
    .map((day, i) => {
      const snow = f.daily.snowfall_sum[i] ?? 0;
      const label = new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
      return `<tr>
        <td>${label}</td>
        <td title="${escapeHtml(weatherText(f.daily.weather_code[i]))}">${escapeHtml(weatherText(f.daily.weather_code[i]))}</td>
        <td>${Math.round(f.daily.temperature_2m_min[i])}° / ${Math.round(f.daily.temperature_2m_max[i])}°</td>
        <td>${f.daily.precipitation_sum[i].toFixed(1)}</td>
        <td class="bar-cell"><div class="bar"><span>${snow.toFixed(1)}</span><span class="fill" style="width:${(snow / maxSnow) * 60}%"></span></div></td>
      </tr>`;
    })
    .join('');
  return `${head}
    <dl class="kv">
      <dt>Now</dt><dd>${escapeHtml(weatherText(c.weather_code))}, ${fmt(c.temperature_2m, '°C', 1)}</dd>
      <dt>Wind</dt><dd>${fmt(c.wind_speed_10m, 'km/h')} ${compass(c.wind_direction_10m)}</dd>
    </dl>
    <table class="forecast">
      <thead><tr><th>Day</th><th>Weather</th><th>Min / max</th><th>mm</th><th>Snow cm</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted">Forecast: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0),
    best-match model blend, adjusted to ${Math.round(f.elevation).toLocaleString('en-GB')} m. Fetched ${formatTime(f.fetchedAt)}.
    Model output, not a measurement.</p>`;
}
