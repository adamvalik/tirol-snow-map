// One card, shown once per version: "What you can do" on a first visit, "What's new" when the app
// has a new version since the last visit. Only the version seen is kept, in localStorage, nothing
// else. The notes are the version's row of the Releases table (docs/release-plan.md, read at build
// time), the same list as the GitHub Release.
import { track } from './analytics.ts';
import { icon, type IconName } from './icons.ts';
import { escapeHtml } from '../format.ts';
import { APP_VERSION, RELEASE_NOTES } from '../version.ts';

const SEEN_KEY = 'snowmap-seen-version';
/** Keys this app kept before the card existed (favourites, cached forecasts): their visitors are not new. */
const OLDER_KEYS = ['bivouac-favourites'];
const OLDER_PREFIXES = ['om1:'];
export const RELEASES_URL = 'https://github.com/adamvalik/tirol-snow-map/releases';

export type IntroKind = 'welcome' | 'new';

/** Which card to show, if any. `seen` is the version last seen, `returning` whether the app was used before. */
export function introFor(seen: string | null, returning: boolean, version: string, notes: readonly string[]): IntroKind | null {
  if (seen === version) return null;
  if (seen === null && !returning) return 'welcome';
  // A newer version seen before: this is an old copy from the cache, say nothing.
  if (seen !== null && newer(seen, version)) return null;
  return notes.length ? 'new' : null;
}

/** Whether version a is above b ("0.3.0" > "0.2.2"). */
function newer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

const WELCOME: [IconName, string][] = [
  ['snowflake', 'Where the snow lies: seen from space, measured at the stations, estimated for every 250 m of terrain.'],
  ['calendar-blank', 'The timeline goes 14 days back and 3 days ahead, with the snowfall forecast.'],
  ['mountains', 'Tap anywhere for the snow, the forecast and the sun at that place.'],
  ['stack', 'More layers: winter sports, sun and shade, bivouacs, via ferratas, and your own GPX track.'],
];

/** The card's inner markup. */
export function introHtml(kind: IntroKind, version: string, notes: readonly string[]): string {
  const body =
    kind === 'welcome'
      ? `<ul class="intro-list">${WELCOME.map(([name, text]) => `<li><span class="intro-icon" aria-hidden="true">${icon(name, 18)}</span><span>${text}</span></li>`).join('')}</ul>`
      : `<ul class="intro-notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`;
  const title = kind === 'welcome' ? 'Welcome to South Tyrol Snow' : `What's new in ${escapeHtml(version)}`;
  const link =
    kind === 'new' ? `<a href="${RELEASES_URL}" target="_blank" rel="noopener">All release notes${icon('arrow-up-right', 13)}</a>` : '<span></span>';
  return `
    <div class="intro-head">
      <h2 id="intro-title">${title}</h2>
      <button type="button" class="icon-btn" data-intro-close aria-label="Close">${icon('x', 18)}</button>
    </div>
    ${body}
    <div class="intro-foot">${link}<button type="button" class="intro-ok" data-intro-close>Got it</button></div>`;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readSeen(): { seen: string | null; returning: boolean } {
  try {
    const s = storage();
    if (!s) return { seen: null, returning: false };
    const keys = Array.from({ length: s.length }, (_, i) => s.key(i) ?? '');
    const returning = keys.some((k) => OLDER_KEYS.includes(k) || OLDER_PREFIXES.some((p) => k.startsWith(p)));
    return { seen: s.getItem(SEEN_KEY), returning };
  } catch {
    return { seen: null, returning: false };
  }
}

function markSeen() {
  try {
    storage()?.setItem(SEEN_KEY, APP_VERSION);
  } catch {
    // Storage blocked: the card comes again next time, which is all that is lost.
  }
}

let card: HTMLElement | null = null;

function close() {
  card?.remove();
  card = null;
}

/** Shows a card now. Marked as seen when it opens, so it shows once even if never closed. */
export function showIntro(kind: IntroKind) {
  close();
  const el = document.createElement('section');
  el.className = 'intro-card';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'intro-title');
  el.innerHTML = introHtml(kind, APP_VERSION, RELEASE_NOTES);
  el.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-intro-close]')) close();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  document.body.append(el);
  card = el;
  markSeen();
  track(`intro/${kind}`);
}

/** The card for this visit, if any, and "What's new" in the About tab. Not in automated browsers (smoke test, link preview). */
export function setupWhatsNew() {
  document.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.('[data-whats-new]')) showIntro(RELEASE_NOTES.length ? 'new' : 'welcome');
  });
  if (navigator.webdriver) return;
  const { seen, returning } = readSeen();
  const kind = introFor(seen, returning, APP_VERSION, RELEASE_NOTES);
  if (kind) showIntro(kind);
}
