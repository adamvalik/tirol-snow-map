// A tab or home-screen app opened before a deploy keeps the old index.html and asks for the old
// build's files when it needs them later: the winter sports, via ferrata and regions data, the
// terrain grid, the shade worker. A deploy replaces the whole site, so those are gone (404) and
// that part of the app would silently not work. Their names carry a content hash, so a 404 on one
// means a newer build is live: reload once to get it. The view is in the address, so the reload
// opens at the same place.

const KEY = 'snowmap:deploy-reload';
/** No second reload within this time, so a file missing for another reason cannot loop. */
export const GUARD_MS = 60_000;

const RELOAD_DELAY_MS = 600;

/** Whether a reload may happen now, given when the last one for a new deploy was (ms, or null). */
export const mayReload = (last: number | null, now: number): boolean => last === null || !(now - last < GUARD_MS);

/** Reloads the page for a newer deploy, at most once a minute. Returns whether it reloads. */
export function reloadForNewDeploy(): boolean {
  try {
    const stored = sessionStorage.getItem(KEY);
    const now = Date.now();
    if (!mayReload(stored === null ? null : Number(stored) || 0, now)) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // Without storage there is no guard against a loop: do not reload.
    return false;
  }
  // After the address has caught up with the last change (app/share.ts writes it 300 ms after),
  // so the layer just switched on is still on after the reload.
  window.setTimeout(() => location.reload(), RELOAD_DELAY_MS);
  return true;
}

/** fetch() for a file of this build (a hashed name from a `?url` import). */
export async function fetchBuildFile(url: string): Promise<Response> {
  const res = await fetch(url);
  if (res.status === 404) reloadForNewDeploy();
  return res;
}

/** After a file of this build failed to load where no status is seen (a worker): is it gone? */
export function checkBuildFile(url: string | URL) {
  void fetch(url, { method: 'HEAD', cache: 'no-store' })
    .then((res) => {
      if (res.status === 404) reloadForNewDeploy();
    })
    .catch(() => undefined);
}

/** Lazily imported code (Vite's preload of a dynamic import) from an older build. */
export function setupNewDeployReload() {
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadForNewDeploy()) e.preventDefault();
  });
}
