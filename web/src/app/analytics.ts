// Anonymous visit and event counts with GoatCounter (no cookies, no personal data), only on the
// live site with a site code set (app/env.ts). The count is a single request to GoatCounter's
// counting endpoint, without loading its script, so the page adds one host and runs no foreign code.
// The address hash (the view: place, layers, day) is never sent; pages are counted as "/".
// Chat and social apps open links without a referrer, so a link we post carries its channel instead
// (`?ref=wa-erasmus`): it is sent as the referrer and then removed from the address.
// `?count=off` once in a browser stops counting there for good (our own devices), `?count=on` undoes it.
import { APP_VERSION } from '../version.ts';
import { GOATCOUNTER_CODE } from './env.ts';
import { icon } from './icons.ts';
import { toast } from './toast.ts';

const SKIP_KEY = 'snowmap-skip-count';

/** Whether this browser was told not to count (`?count=off`). */
function skipped(): boolean {
  try {
    return window.localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether counting is on: a site code, not a local build, not an automated browser, not switched off here. */
export function analyticsEnabled(
  code = GOATCOUNTER_CODE,
  host = location.hostname,
  webdriver = navigator.webdriver,
  skip = skipped(),
): boolean {
  return /^[a-z0-9-]+$/.test(code) && !/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host) && !webdriver && !skip;
}

/** `?count=off` or `?count=on` in the address, else null. */
export function countSwitch(search: string): 'off' | 'on' | null {
  const value = new URLSearchParams(search).get('count');
  return value === 'off' || value === 'on' ? value : null;
}

/** Stores the switch in this browser and says so. Nothing leaves the device. */
function applyCountSwitch(value: 'off' | 'on') {
  try {
    if (value === 'off') window.localStorage.setItem(SKIP_KEY, '1');
    else window.localStorage.removeItem(SKIP_KEY);
  } catch {
    toast('Visit counting could not be changed: this browser does not keep settings.', { icon: icon('warning', 18), tone: 'warn' });
    return;
  }
  toast(value === 'off' ? 'Visits from this browser are no longer counted.' : 'Visits from this browser are counted again.', {
    icon: icon('check-circle', 18),
    tone: 'ok',
  });
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

/** Query parameters that name where a link was posted. */
const SOURCE_KEYS = ['ref', 'utm_source'];
/** Parameters removed from the address once read: the source and the counting switch. */
const isCountKey = (key: string) => key === 'ref' || key === 'count' || key.startsWith('utm_');

/**
 * The channel a link was posted in (`?ref=wa-erasmus`, or `utm_source`), or '' when there is none.
 * Only a short plain name is kept: it names a channel, never a person.
 */
export function sourceFrom(search: string): string {
  const q = new URLSearchParams(search);
  for (const key of SOURCE_KEYS) {
    const value = (q.get(key) ?? '').trim().toLowerCase();
    if (value) return /^[a-z0-9-]{1,32}$/.test(value) ? value : '';
  }
  return '';
}

/** The address without `ref`, `utm_*` and `count`, so a view shared on from here carries neither. */
export function withoutCountParams(href: string): string {
  const url = new URL(href);
  for (const key of [...url.searchParams.keys()]) if (isCountKey(key)) url.searchParams.delete(key);
  return url.pathname + url.search + url.hash;
}

const counted = new Set<string>();

function send(path: string, event: boolean, referrer = '') {
  if (!analyticsEnabled()) return;
  const url = countUrl(GOATCOUNTER_CODE, path, event, screen.width, referrer);
  try {
    // GoatCounter's documented image pixel: a plain GET, no script.
    new Image().src = url;
  } catch {
    // Counting must never break the app.
  }
}

/**
 * Counts this visit once, with the link's source if it has one, then drops the source from the
 * address. A counting switch in the address is applied first, so `?count=off` itself is not counted.
 */
export function trackVisit() {
  const sw = countSwitch(location.search);
  if (sw) applyCountSwitch(sw);
  send('/', false, sourceFrom(location.search) || document.referrer);
  const clean = withoutCountParams(location.href);
  if (clean !== location.pathname + location.search + location.hash) {
    try {
      history.replaceState(history.state, '', clean);
    } catch {
      // Counting must never break the app.
    }
  }
}

/** Counts an event, at most once per page load (the question is "is it used", not how often). */
export function track(event: string) {
  if (counted.has(event)) return;
  counted.add(event);
  send(event, true);
}
