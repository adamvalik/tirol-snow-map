// The layer switches in the Layers tab (tiles and rows): one checkbox `#toggle-<key>` per key in viewState.ts.
import { LAYER_KEYS, type LayerKey, type ViewState } from '../viewState.ts';
import { $ } from './dom.ts';

export const toggle = (key: LayerKey) => $<HTMLInputElement>(`toggle-${key}`);
export const isOn = (key: LayerKey): boolean => toggle(key).checked;

/** Turns a switch on as if it were tapped, so the layer and everything that follows it update. */
export function switchOn(key: LayerKey) {
  const input = toggle(key);
  input.checked = true;
  // Bubbles, so the panel's listeners (the phone's layer buttons, the address) see it too.
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Greys out a switch whose layer has nothing to show, with the reason as its tooltip. */
export function setAvailable(key: LayerKey, available: boolean, reason = '') {
  const input = toggle(key);
  input.disabled = !available;
  input.closest('label')!.title = available ? '' : reason;
  const quick = document.querySelector<HTMLButtonElement>(`.quick-btn[data-key="${key}"]`);
  if (quick) quick.disabled = !available;
}

/** A shared link sets every switch; without one the defaults in index.html stay. */
export function applyLinkSwitches(initial: Partial<ViewState>) {
  if (initial.layers) for (const key of LAYER_KEYS) toggle(key).checked = initial.layers.includes(key);
}
