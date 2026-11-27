// The screen for a map that cannot start, or that stopped drawing and did not come back (#70).
// Its markup and styles are in index.html, so the inline script there and <noscript> can show it
// even when this code never runs (a browser too old for the app, JavaScript off).
import type * as maplibregl from 'maplibre-gl';
import { track } from './analytics.ts';
import { bugTarget } from './feedback.ts';

export type StartProblem = 'webgl' | 'start' | 'context';

const TEXT: Record<StartProblem, [reason: string, tryThis: string]> = {
  webgl: ['This browser or device cannot draw the 3D map. It needs WebGL 2.', 'Try a recent Chrome, Firefox or Safari.'],
  start: ['Something went wrong while the map was starting.', 'Reload the page. If it happens again, try another browser.'],
  context: [
    'Phones do this when they run low on memory, often after switching apps.',
    'Reload the page to draw it again. It opens at the same place.',
  ],
};

/**
 * What to try without WebGL 2, for the device in hand. iPhones and iPads have it from iOS 15; on a
 * computer, Chrome and Edge lose it when graphics acceleration is off. Read here only, never sent.
 */
export function webglHelp(userAgent: string, touchPoints: number): string {
  // iPadOS asks for desktop pages and names itself a Mac; only its touch screen tells it apart.
  const apple = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  if (apple) return 'Update the iPhone or iPad to iOS 15 or later: Settings, General, Software Update.';
  const mobile = /Android|Mobile/.test(userAgent);
  if (!mobile && /Edg\//.test(userAgent))
    return 'In Edge, open Settings, System and performance, turn on “Use graphics acceleration when available” and restart Edge.';
  if (!mobile && /Chrome\//.test(userAgent) && !/OPR\//.test(userAgent))
    return 'In Chrome, open Settings, System, turn on “Use graphics acceleration when available” and relaunch Chrome.';
  return TEXT.webgl[1];
}

/** Whether the browser can give the map a WebGL 2 context. */
export function supportsWebgl2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * Shows the screen with what happened and what to try, and counts it (no details leave the device).
 */
export function showStartError(problem: StartProblem) {
  const el = document.getElementById('start-error');
  if (!el) return;
  const [reason, generic] = TEXT[problem];
  const tryThis = problem === 'webgl' ? webglHelp(navigator.userAgent, navigator.maxTouchPoints) : generic;
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
