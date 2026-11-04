// The 72 h forecast snowfall animation and its player in the dock.
import type { ForecastFile } from '../../../shared/types.ts';
import { $ } from '../app/dom.ts';
import { PAUSE_ICON, PLAY_ICON } from '../app/icons.ts';
import { isOn, setAvailable, toggle } from '../app/switches.ts';
import { setWarning } from '../app/warnings.ts';
import { ForecastAnimation, frameLabel, loadForecast } from '../forecastAnim.ts';
import { ageHours, formatAge } from '../format.ts';
import type { App, LayerModule } from './types.ts';

/** The forecast grid is fetched on every pipeline run (at most every 6 hours). */
const FORECAST_STALE_AFTER_HOURS = 14;

let app: App;
let file: ForecastFile | null = null;
let loading: Promise<ForecastFile | null>;
let anim: ForecastAnimation | null = null;
let frame: number | null = null;

const player = $('forecast-player');
const playBtn = $('forecast-play');

const showPlaying = (playing: boolean) => {
  playBtn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  playBtn.setAttribute('aria-label', playing ? 'Pause the forecast' : 'Play the forecast');
};

/** The forecast metadata, once loaded (for "About the data"). */
export const forecastFile = () => file;

export const forecast: LayerModule = {
  keys: ['forecast'],

  setup(a) {
    app = a;
    loading = loadForecast().then(
      (f) => {
        file = f;
        if (f.available && (f.stale || ageHours(f.fetchedAt) > FORECAST_STALE_AFTER_HOURS)) {
          setWarning('forecast', `Forecast snowfall is from ${formatAge(f.fetchedAt)}; newer forecasts could not be fetched.`);
        }
        return f;
      },
      () => null,
    );
  },

  /** Above the snow cells, below roads and labels. */
  async init() {
    const f = await loading;
    if (!f?.available || !f.frames?.length) {
      toggle('forecast').checked = false;
      setAvailable('forecast', false, f?.reason ?? 'No forecast in the current data');
      return;
    }
    const frameInput = $<HTMLInputElement>('forecast-frame');
    frameInput.max = String(f.frames.length - 1);
    playBtn.innerHTML = PLAY_ICON;
    const a = new ForecastAnimation(app.map, f, app.basemap.lines[0]?.id, isOn('forecast'), (k) => {
      frame = k;
      frameInput.value = String(k);
      $('forecast-label').textContent = frameLabel(f, k);
      app.syncHash();
    });
    a.setFrame(Math.min(app.initial.frame ?? f.frames.length - 1, f.frames.length - 1));
    player.hidden = !isOn('forecast');
    playBtn.addEventListener('click', () => {
      if (a.playing) a.pause();
      else a.play();
      showPlaying(a.playing);
    });
    frameInput.addEventListener('input', () => {
      a.pause();
      showPlaying(false);
      a.setFrame(Number(frameInput.value));
    });
    anim = a;
  },

  setVisible(_key, on) {
    if (!anim) return;
    anim.setVisible(on);
    player.hidden = !on;
    showPlaying(false);
  },

  view: () => ({ frame: isOn('forecast') ? frame : null }),
};
