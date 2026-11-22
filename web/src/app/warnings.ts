// Warnings at the top of the Layers tab: stale or missing data (amber, amber only for that), and
// the new-snow note with its fix ("Show depth", and "Hide depth" to undo it).
import { $ } from './dom.ts';
import { track } from './analytics.ts';
import { icon } from './icons.ts';
import { isOn, setSwitch } from './switches.ts';

/**
 * Warnings are shown in this order, so the line does not depend on which data file arrived first.
 * It is the order the files are usually loaded in; topics not listed follow in the order they came.
 */
const ORDER = ['basemap', 'snow', 'stations', 'forecast', 'status', 'ferratas', 'winter'];
const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);

const warnings = new Map<string, string>();

function showMark() {
  // A dot on the Layers tab (and the phone's name pill) tells a closed panel that something is worth a look.
  document.body.classList.toggle('has-warning', warnings.size > 0);
}

/** Sets or clears (null) one warning in the Layers tab, by topic. */
export function setWarning(key: string, text: string | null) {
  if (text) {
    warnings.set(key, text);
    // Only the topic is counted ("warning/snow"), never the text.
    track(`warning/${key}`);
  }
  else warnings.delete(key);
  const el = $('data-warning');
  el.hidden = warnings.size === 0;
  const span = document.createElement('span');
  span.textContent = [...warnings]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([, t]) => t)
    .join(' ');
  el.innerHTML = icon('warning-fill', 18);
  el.append(span);
  showMark();
}

let newSnowText: string | null = null;

function showNewSnow() {
  $('new-snow').hidden = !newSnowText;
  // The note stays while the depth is on, so it can be turned off where it was turned on.
  $('new-snow-show').textContent = isOn('depth') ? 'Hide depth' : 'Show depth';
}

/**
 * The satellite view misses snow that fell since its pass: the note says so and turns the
 * estimated depth, which follows the stations, on and off.
 */
export function setNewSnow(text: string | null) {
  newSnowText = text;
  $('new-snow-text').textContent = text ?? '';
  showNewSnow();
}

export function setupWarnings() {
  $('new-snow-show').addEventListener('click', () => setSwitch('depth', !isOn('depth')));
  $('toggle-depth').addEventListener('change', showNewSnow);
}
