// The 72 h forecast snowfall animation. The timeline (app/timeline.ts) drives it: its forecast days
// pick a frame, its play button plays the frames.
import type { ForecastFile } from '../../../shared/types.ts';
import { setAge } from '../app/ages.ts';
import { isOn, setAvailable, toggle } from '../app/switches.ts';
import { setWarning } from '../app/warnings.ts';
import { ForecastAnimation, loadForecast } from '../forecastAnim.ts';
import { ageHours, formatAge, TZ } from '../format.ts';
import type { App, LayerModule } from './types.ts';

/** The forecast grid is fetched on every pipeline run (at most every 6 hours). */
const FORECAST_STALE_AFTER_HOURS = 14;

let app: App;
let file: ForecastFile | null = null;
let loading: Promise<ForecastFile | null>;
let anim: ForecastAnimation | null = null;
let frame: number | null = null;
let ready: () => void;
/** Resolves once the animation is on the map, or it is clear there is none. */
export const forecastReady = new Promise<void>((r) => (ready = r));
const frameListeners: ((k: number) => void)[] = [];

/** The forecast metadata, once loaded (for "About the data"). */
export const forecastFile = () => file;

/** The local day (YYYY-MM-DD) of an ISO time. */
export const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });

/** Each forecast day after `after` (YYYY-MM-DD) with its last frame: the snow accumulated by that evening. */
export function forecastDays(after: string): { date: string; frame: number }[] {
  const frames = anim ? (file?.frames ?? []) : [];
  const days = new Map<string, number>();
  frames.forEach((f, k) => {
    const d = localDay(f.time);
    if (d > after) days.set(d, k);
  });
  return [...days].map(([date, k]) => ({ date, frame: k }));
}

/** Frame `k`'s time and the most new snow anywhere by then. */
export const frameInfo = (k: number) => file?.frames?.[k] ?? null;

export const currentFrame = () => frame;
export const forecastPlaying = () => !!anim?.playing;
export const hasForecast = () => !!anim;

/** Called with the frame whenever it changes (a pick on the timeline or playback). */
export function onForecastFrame(listener: (k: number) => void) {
  frameListeners.push(listener);
}

export function setForecastFrame(k: number) {
  anim?.setFrame(k);
}

export function playForecast() {
  if (!anim) return;
  if (!isOn('forecast')) {
    toggle('forecast').checked = true;
    toggle('forecast').dispatchEvent(new Event('change', { bubbles: true }));
  }
  anim.play();
}

export function pauseForecast() {
  anim?.pause();
}

export const forecast: LayerModule = {
  keys: ['forecast'],

  setup(a) {
    app = a;
    loading = loadForecast().then(
      (f) => {
        file = f;
        const stale = f.available && (f.stale || ageHours(f.fetchedAt) > FORECAST_STALE_AFTER_HOURS);
        setAge('forecast', f.available ? (f.fetchedAt ?? null) : null, !!stale, 'none');
        if (stale) setWarning('forecast', `Forecast snowfall is from ${formatAge(f.fetchedAt)}; newer forecasts could not be fetched.`);
        return f;
      },
      () => {
        setAge('forecast', null, false, 'none');
        return null;
      },
    );
  },

  /** Above the snow cells, below roads and labels. */
  async init() {
    const f = await loading;
    if (!f?.available || !f.frames?.length) {
      toggle('forecast').checked = false;
      setAvailable('forecast', false, f?.reason ?? 'No forecast in the current data');
      ready();
      return;
    }
    anim = new ForecastAnimation(app.map, f, app.basemap.lines[0]?.id, isOn('forecast'), (k) => {
      frame = k;
      for (const l of frameListeners) l(k);
      app.syncHash();
    });
    anim.setFrame(Math.min(app.initial.frame ?? f.frames.length - 1, f.frames.length - 1));
    ready();
  },

  setVisible(_key, on) {
    // The timeline listens to the switch itself.
    anim?.setVisible(on);
  },

  view: () => ({ frame: isOn('forecast') ? frame : null }),
};
