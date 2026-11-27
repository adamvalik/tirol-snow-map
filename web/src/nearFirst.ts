// The first view's elevation tiles, near ones first (#112). Tilted, the opening view asks for about
// 15 elevation tiles of ~200 KB at once, from the slopes in front down to the far horizon at zoom 5.
// On a slow phone connection they all share the bandwidth and all arrive at about the same time,
// so nothing of the terrain shows for half a minute. Here the far tiles (three zoom levels or more
// below the view) wait until the near ones are in, so the terrain in front draws first and the
// horizon fills in after. Only the first view: once open, the gate stays open.

/** How long no near tile may be loading before the far ones go, in ms. */
const SETTLE_MS = 300;
/** The far tiles go after this long in any case, in ms. */
const MAX_WAIT_MS = 30_000;

let zoom = Number.POSITIVE_INFINITY;
let open = false;
let nearLoading = 0;
let settle: ReturnType<typeof setTimeout> | undefined;
const waiting = new Set<() => void>();
const openListeners: (() => void)[] = [];

/** A tile of zoom `z` is far while the view is at `viewZoom`. */
export const isFar = (z: number, viewZoom: number): boolean => z < Math.floor(viewZoom) - 2;

function openGate() {
  if (open) return;
  open = true;
  clearTimeout(settle);
  for (const go of waiting) go();
  waiting.clear();
  for (const l of openListeners) l();
}

/** Follows the map's zoom, which decides which tiles are far. Call once, right after creating the map. */
export function watchZoom(map: { getZoom(): number; on(type: 'zoom', listener: () => void): unknown }) {
  zoom = map.getZoom();
  map.on('zoom', () => (zoom = map.getZoom()));
  setTimeout(openGate, MAX_WAIT_MS);
}

/** Calls `listener` once the near tiles of the first view are in (at once if they are). */
export function onNearLoaded(listener: () => void) {
  if (open) listener();
  else openListeners.push(listener);
}

const aborted = () => new DOMException('The tile request was aborted', 'AbortError');

/** Loads an elevation tile of zoom `z`: at once if it is near, after the near ones if it is far. */
export async function nearFirst<T>(z: number, signal: AbortSignal, load: () => Promise<T>): Promise<T> {
  if (open) return load();
  if (isFar(z, zoom)) {
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        signal.removeEventListener('abort', stop);
        resolve();
      };
      const stop = () => {
        waiting.delete(go);
        reject(aborted());
      };
      waiting.add(go);
      signal.addEventListener('abort', stop, { once: true });
    });
    return load();
  }
  nearLoading++;
  clearTimeout(settle);
  try {
    return await load();
  } finally {
    nearLoading--;
    // MapLibre starts its next queued request as soon as one ends; wait a moment for it.
    if (nearLoading === 0) settle = setTimeout(() => nearLoading === 0 && openGate(), SETTLE_MS);
  }
}
