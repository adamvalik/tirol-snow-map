// The day slider in the dock: the snow layers and stations as of each of the past 14 days.
import type { HistoryDay, HistoryFile, SnowFile, StationsFile } from '../../../shared/types.ts';
import { formatTime } from '../format.ts';
import { latestSnow, showSnow } from '../layers/snow.ts';
import { latestStations, showStations } from '../layers/stations.ts';
import type { App } from '../layers/types.ts';
import { shortDate } from '../satellite.ts';
import { loadSnow } from '../snow.ts';
import { loadStations } from '../stations.ts';
import { DATA, loadJson } from './data.ts';
import { selectedDay, setSelectedDay } from './day.ts';
import { $ } from './dom.ts';

let historyFile: HistoryFile | null = null;
let loading: Promise<HistoryFile | null> | null = null;

/** Starts loading history.json. */
export function loadHistory() {
  loading = loadJson<HistoryFile>('history.json').then((h) => (historyFile = h));
}

/** The day list, once loaded (for "About the data"). */
export const history = () => historyFile;

/** What the slider keeps in a shared link. */
export const dayView = () => ({ day: selectedDay() });

// Oldest first, so the slider runs left to right through time; the newest day is the live data.
let days: HistoryDay[] = [];
let dayRequest = 0;

const dayLabel = (d: HistoryDay, latest: boolean) =>
  `${new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}${latest ? ' · latest' : ''}`;

async function showDay(app: App, i: number) {
  const day = days[i];
  const latest = i === days.length - 1;
  const request = ++dayRequest;
  setSelectedDay(latest ? null : day.date);
  $('day-label').textContent = dayLabel(day, latest);
  const note = $('day-note');
  let snow: SnowFile | null = latestSnow();
  let stations: StationsFile | null = latestStations();
  if (!latest) {
    [snow, stations] = await Promise.all([
      loadSnow(day.snow).catch(() => null),
      day.stations ? loadStations(`${DATA}${day.stations}`).catch(() => null) : Promise.resolve(null),
    ]);
  }
  if (request !== dayRequest) return;
  await showSnow(snow);
  showStations(stations, latest ? null : day);
  if (latest) note.hidden = true;
  else {
    note.hidden = false;
    note.textContent = day.backfilled
      ? 'Only snow seen from space, rebuilt from the satellite passes up to that day.'
      : `Snow layers and stations as of ${formatTime(snow?.generatedAt)}.`;
  }
  app.syncHash();
}

/** Once the layers are on the map: shows the slider if there are at least two days. */
export async function setupDaySlider(app: App) {
  days = [...((await loading)?.days ?? [])].reverse();
  if (days.length < 2) return;
  const slider = $<HTMLInputElement>('day');
  slider.max = String(days.length - 1);
  const start = app.initial.day ? days.findIndex((d) => d.date === app.initial.day) : -1;
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
    timer = window.setTimeout(() => void showDay(app, i), 150);
  });
  if (start >= 0 && start < days.length - 1) void showDay(app, start);
}
