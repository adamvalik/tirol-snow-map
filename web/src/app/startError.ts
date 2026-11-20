// The screen for a map that cannot start, or that stopped drawing and did not come back (#70).
// Its markup and styles are in index.html, so the inline script there and <noscript> can show it
// even when this code never runs (a browser too old for the app, JavaScript off).
import type * as maplibregl from 'maplibre-gl';
import { track } from './analytics.ts';
import { bugTarget } from './feedback.ts';

export type StartProblem = 'webgl' | 'start' | 'context';

const TEXT: Record<StartProblem, [reason: string, tryThis: string]> = {
  webgl: [
    'This browser or device cannot draw the 3D map. It needs WebGL 2.',
    'Try a recent Chrome, Firefox or Safari, or turn on hardware acceleration in the browser settings.',
  ],
  start: ['Something went wrong while the map was starting.', 'Reload the page. If it happens again, try another browser.'],
  context: [
    'Phones do this when they run low on memory, often after switching apps.',
    'Reload the page to draw it again. It opens at the same place.',
  ],
};

/** Whether the browser can give the map a WebGL 2 context. */
export function supportsWebgl2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/** Shows the screen with what happened and what to try, and counts it (no details leave the device). */
export function showStartError(problem: StartProblem) {
  const el = document.getElementById('start-error');
  if (!el) return;
  const [reason, tryThis] = TEXT[problem];
  el.querySelector('h2')!.textContent = problem === 'context' ? 'The map stopped drawing' : 'The map could not start';
  el.querySelector('[data-reason]')!.textContent = reason;
  el.querySelector('[data-try]')!.textContent = tryThis;
  const link = el.querySelector<HTMLAnchorElement>('[data-feedback]');
  if (link) {
    const [href, via] = bugTarget();
    link.href = href;
    // An e-mail opens the mail app; the form and GitHub open in a new tab.
    if (via === 'mail') link.removeAttribute('target');
  }
  el.dataset.problem = problem;
  el.hidden = false;
  track(`error/${problem}`);
}

/**
 * A lost WebGL context (common on phones after switching apps or on low memory) leaves the map
 * blank. MapLibre can restore it, but with this app's terrain the restored map draws with the wrong
 * textures (MapLibre 6.12, #84). So once the page is visible again, the screen asks for a reload;
 * the view is in the address, so the reload comes back to it.
 */
export function watchContext(map: maplibregl.Map) {
  let lost = false;
  const check = () => {
    if (lost && !document.hidden) showStartError('context');
  };
  map.on('webglcontextlost', () => {
    lost = true;
    check();
  });
  document.addEventListener('visibilitychange', check);
}
