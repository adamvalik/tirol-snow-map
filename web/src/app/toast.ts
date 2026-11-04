import { $ } from './dom.ts';

let toastTimer: number | undefined;

/** A short message at the bottom of the screen that goes away on its own. */
export function toast(text: string) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 4000);
}
