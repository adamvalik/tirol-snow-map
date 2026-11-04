import { $ } from './dom.ts';

/**
 * Warnings are shown in this order, so the line does not depend on which data file arrived first.
 * It is the order the files are usually loaded in; topics not listed follow in the order they came.
 */
const ORDER = ['basemap', 'snow', 'stations', 'forecast', 'status', 'new-snow', 'ferratas'];
const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);

const warnings = new Map<string, string>();

/** Sets or clears (null) one warning in the layer card, by topic. */
export function setWarning(key: string, text: string | null) {
  if (text) warnings.set(key, text);
  else warnings.delete(key);
  const el = $('data-warning');
  el.hidden = warnings.size === 0;
  el.textContent = [...warnings]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([, t]) => t)
    .join(' ');
  // A dot on the layers button tells a collapsed panel that something is worth a look.
  document.body.classList.toggle('has-warning', warnings.size > 0);
}
