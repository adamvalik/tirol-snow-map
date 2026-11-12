// Anonymous visit and event counts with GoatCounter (no cookies, no personal data), only on the
// live site with a site code set (app/env.ts). The count is a single request to GoatCounter's
// counting endpoint, without loading its script, so the page adds one host and runs no foreign code.
// The address hash (the view: place, layers, day) is never sent; pages are counted as "/".
import { APP_VERSION } from '../version.ts';
import { GOATCOUNTER_CODE } from './env.ts';

/** Whether counting is on: a site code, not a local build, not an automated browser. */
export function analyticsEnabled(
  code = GOATCOUNTER_CODE,
  host = location.hostname,
  webdriver = navigator.webdriver,
): boolean {
  return /^[a-z0-9-]+$/.test(code) && !/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host) && !webdriver;
}

/**
 * The counting URL. A page view is path "/" titled with the app version, so testers on an old
 * cached copy show up; an event is a path such as "layer/sun" with `e=true`.
 */
export function countUrl(code: string, path: string, event: boolean, screenWidth: number, referrer = ''): string {
  const q = new URLSearchParams({ p: path, t: `v${APP_VERSION}`, s: String(Math.round(screenWidth)) });
  if (event) q.set('e', 'true');
  else if (referrer) q.set('r', referrer);
  q.set('rnd', Math.random().toString(36).slice(2, 8));
  return `https://${code}.goatcounter.com/count?${q}`;
}

const counted = new Set<string>();

function send(path: string, event: boolean) {
  if (!analyticsEnabled()) return;
  const url = countUrl(GOATCOUNTER_CODE, path, event, screen.width, event ? '' : document.referrer);
  try {
    // GoatCounter's documented image pixel: a plain GET, no script.
    new Image().src = url;
  } catch {
    // Counting must never break the app.
  }
}

/** Counts this visit once. */
export function trackVisit() {
  send('/', false);
}

/** Counts an event, at most once per page load (the question is "is it used", not how often). */
export function track(event: string) {
  if (counted.has(event)) return;
  counted.add(event);
  send(event, true);
}
