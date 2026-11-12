// The timeline: one strip of days from two weeks back to three days ahead, with today in between.
// A past day shows the snow layers and stations as of that day; a forecast day shows the forecast
// snowfall accumulated by its evening; play runs the forecast frames. Replaces the day slider and
// the forecast player of the first version (roadmap 2.1).
import type { HistoryDay, HistoryFile, SnowFile, StationsFile } from '../../../shared/types.ts';
import {
  currentFrame,
  forecastDays,
  forecastPlaying,
  forecastReady,
  frameInfo,
  hasForecast,
  localDay,
  onForecastFrame,
  pauseForecast,
  playForecast,
  setForecastFrame,
} from '../layers/forecast.ts';
import { latestSnow, showSnow } from '../layers/snow.ts';
import { latestStations, showStations } from '../layers/stations.ts';
import type { App } from '../layers/types.ts';
import { loadSnow } from '../snow.ts';
import { loadStations } from '../stations.ts';
import { TZ } from '../format.ts';
import { DATA, loadJson } from './data.ts';
import { selectedDay, setSelectedDay } from './day.ts';
import { $ } from './dom.ts';
import { icon, PAUSE_ICON, PLAY_ICON } from './icons.ts';
import { isOn, toggle } from './switches.ts';

let historyFile: HistoryFile | null = null;
let loading: Promise<HistoryFile | null> | null = null;

/** Starts loading history.json. */
export function loadHistory() {
  loading = loadJson<HistoryFile>('history.json').then((h) => (historyFile = h));
}

/** The day list, once loaded (for "About the data"). */
export const history = () => historyFile;

/** What the timeline keeps in a shared link (the forecast frame is the forecast layer's). */
export const dayView = () => ({ day: selectedDay() });

type Cell = { kind: 'day'; date: string; index: number } | { kind: 'forecast'; date: string; frame: number };

let app: App;
/** History days, oldest first; the newest is the live data. */
let days: HistoryDay[] = [];
let cells: Cell[] = [];
let selected = 0;
let nowCell = 0;
/** The forecast layer was switched on by the timeline, so leaving the forecast switches it off again. */
let forecastByTimeline = false;
let dayRequest = 0;
/** What the map shows for a past day, once its files have loaded. */
let pastNote = '';

const dayText = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

function setForecastSwitch(on: boolean) {
  const input = toggle('forecast');
  if (input.checked === on || input.disabled) return;
  input.checked = on;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function showPlaying() {
  const playing = forecastPlaying();
  const btn = $<HTMLButtonElement>('forecast-play');
  btn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  btn.setAttribute('aria-label', playing ? 'Pause the forecast' : 'Play the forecast');
  btn.disabled = !hasForecast();
  btn.title = hasForecast() ? '' : 'No forecast in the current data';
}

function renderCells() {
  const strip = $('days');
  strip.innerHTML = cells
    .map((c, i) => {
      const d = Number(c.date.slice(8));
      const month = d === 1 && i > 0;
      const top = month ? dayText(c.date, { month: 'short' }) : dayText(c.date, { weekday: 'short' });
      const label = dayText(c.date, { weekday: 'long', day: 'numeric', month: 'long' }) + (c.kind === 'forecast' ? ', forecast' : i === nowCell ? ', now' : '');
      const cls = ['day', c.kind === 'forecast' ? 'fc' : '', month ? 'month' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" role="radio" aria-checked="false" tabindex="-1" data-i="${i}" data-date="${c.date}" aria-label="${label}"><span>${top}</span><b>${d}</b></button>`;
    })
    .join('');
}

/** Labels, badge, caption, the way back, the strip's selection and the map chip. */
function showSelection() {
  const c = cells[selected];
  if (!c) return;
  const forecastMode = c.kind === 'forecast' || (forecastPlaying() && isOn('forecast'));
  const k = currentFrame();
  const info = k === null ? null : frameInfo(k);
  $('day-label').textContent = dayText(c.date, { weekday: 'short', day: 'numeric', month: 'short' });
  const badge = $('day-badge');
  const kind = forecastMode ? 'forecast' : selected === nowCell ? 'now' : 'past';
  badge.className = `badge ${kind}`;
  badge.textContent = kind === 'forecast' ? 'Forecast' : kind === 'now' ? 'Now' : 'Past';
  $('day-note').textContent =
    forecastMode && info
      ? `New snow up to ${info.maxCm} cm by ${clock(info.time)}`
      : kind === 'past'
        ? pastNote || 'Loading…'
        : 'Measured and from space';
  $('day-back').hidden = kind === 'now';
  const strip = $('days');
  for (const b of strip.querySelectorAll<HTMLElement>('.day')) {
    const on = Number(b.dataset.i) === selected;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  // Keep the picked day in view where the strip scrolls (phones).
  const btn = strip.querySelector<HTMLElement>(`[data-i="${selected}"]`);
  if (btn && strip.scrollWidth > strip.clientWidth) {
    const left = btn.offsetLeft - strip.offsetLeft - (strip.clientWidth - btn.offsetWidth) / 2;
    strip.scrollTo({ left, behavior: 'smooth' });
  }
  const chip = $('map-chip');
  chip.hidden = !isOn('forecast') || !info;
  if (info) chip.innerHTML = `${icon('cloud-snow', 14)}Forecast snowfall, ${new Date(info.time).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

/** Puts a history day's snow layers and stations on the map (the newest: the live data). */
async function showDay(index: number) {
  const day = days[index];
  if (!day) return;
  const latest = index === days.length - 1;
  const request = ++dayRequest;
  setSelectedDay(latest ? null : day.date);
  let snow: SnowFile | null = latestSnow();
  let stations: StationsFile | null = latestStations();
  if (!latest) {
    pastNote = '';
    [snow, stations] = await Promise.all([
      loadSnow(day.snow).catch(() => null),
      day.stations ? loadStations(`${DATA}${day.stations}`).catch(() => null) : Promise.resolve(null),
    ]);
  }
  if (request !== dayRequest) return;
  await showSnow(snow);
  showStations(stations, latest ? null : day);
  if (!latest) {
    pastNote = day.backfilled
      ? 'Only snow from space, rebuilt from the passes'
      : snow
        ? `Snow and stations as of ${clock(snow.generatedAt)}`
        : 'No data saved for this day';
  }
  showSelection();
  app.syncHash();
}

/** Picks a cell of the strip. */
function select(i: number) {
  const c = cells[i];
  if (!c) return;
  selected = i;
  if (c.kind === 'day') {
    pauseForecast();
    if (forecastByTimeline) {
      forecastByTimeline = false;
      setForecastSwitch(false);
    }
    if (c.index >= 0 && (c.index !== days.length - 1 || selectedDay() !== null)) void showDay(c.index);
  } else {
    // A forecast day starts from today's snow.
    if (selectedDay() !== null) void showDay(days.length - 1);
    pauseForecast();
    if (!isOn('forecast')) {
      forecastByTimeline = true;
      setForecastSwitch(true);
    }
    setForecastFrame(c.frame);
  }
  showPlaying();
  showSelection();
}

/** The cell for a frame's day: its forecast day, or today for frames before tomorrow. */
function cellForFrame(k: number): number {
  const info = frameInfo(k);
  if (!info) return nowCell;
  const d = localDay(info.time);
  const i = cells.findIndex((c) => c.kind === 'forecast' && c.date === d);
  return i >= 0 ? i : nowCell;
}

function setupControls() {
  const strip = $('days');
  strip.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.day');
    if (b) select(Number(b.dataset.i));
  });
  strip.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const i = Math.max(0, Math.min(cells.length - 1, selected + step));
    select(i);
    strip.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus();
  });
  $('day-back').addEventListener('click', () => select(nowCell));
  $('forecast-play').addEventListener('click', () => {
    if (forecastPlaying()) pauseForecast();
    else {
      if (selectedDay() !== null) void showDay(days.length - 1);
      if (!isOn('forecast')) forecastByTimeline = true;
      playForecast();
    }
    showPlaying();
    showSelection();
  });
  onForecastFrame((k) => {
    $('timeline').dataset.frame = String(k);
    if (forecastPlaying() || cells[selected]?.kind === 'forecast') selected = cellForFrame(k);
    showSelection();
  });
  // The forecast switch in Snow details: off leaves a forecast day for today.
  toggle('forecast').addEventListener('change', () => {
    if (!isOn('forecast')) {
      forecastByTimeline = false;
      if (cells[selected]?.kind === 'forecast') selected = nowCell;
    }
    showPlaying();
    showSelection();
  });
}

/** Once the layers are on the map: builds the strip from the history and the forecast. */
export async function setupTimeline(a: App) {
  app = a;
  showPlaying();
  await forecastReady;
  days = [...((await loading)?.days ?? [])].reverse();
  const today = days.at(-1)?.date ?? localDay(latestStations()?.generatedAt ?? new Date().toISOString());
  const past: Cell[] = days.length ? days.map((d, index) => ({ kind: 'day', date: d.date, index })) : [{ kind: 'day', date: today, index: -1 }];
  cells = [...past, ...forecastDays(today).map((f) => ({ kind: 'forecast' as const, ...f }))];
  nowCell = past.length - 1;
  selected = nowCell;
  renderCells();
  setupControls();
  showPlaying();

  const start = a.initial.day ? days.findIndex((d) => d.date === a.initial.day) : -1;
  if (start >= 0 && start < days.length - 1) {
    selected = start;
    void showDay(start);
  } else if (isOn('forecast') && a.initial.frame !== undefined && a.initial.frame !== null) {
    selected = cellForFrame(a.initial.frame);
  }
  showSelection();
}
