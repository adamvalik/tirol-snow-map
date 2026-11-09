// Keeps the address bar on the current view, and the share button.
import type * as maplibregl from 'maplibre-gl';
import { DEFAULT_EXAGGERATION } from '../map.ts';
import { LAYER_KEYS, toHash, type ViewState } from '../viewState.ts';
import { track } from './analytics.ts';
import { $ } from './dom.ts';
import { isOn } from './switches.ts';
import { toast } from './toast.ts';

/**
 * Wires the address bar to the map and the layer switches. `parts` adds what the layers and the
 * day slider keep in a link (exaggeration, day, forecast frame, sun time).
 * Returns `syncHash`, which updates the address shortly after the last change.
 */
export function setupShare(map: maplibregl.Map, parts: () => Partial<ViewState>[]): () => void {
  const currentView = (): ViewState => {
    const c = map.getCenter();
    return Object.assign(
      {
        center: [c.lng, c.lat] as [number, number],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        exaggeration: DEFAULT_EXAGGERATION,
        layers: LAYER_KEYS.filter(isOn),
        day: null,
        frame: null,
        sun: null,
      },
      ...parts(),
    );
  };

  let hashTimer: number | undefined;
  const syncHash = () => {
    window.clearTimeout(hashTimer);
    hashTimer = window.setTimeout(() => window.history.replaceState(null, '', toHash(currentView())), 300);
  };
  map.on('moveend', syncHash);
  $('layers-body').addEventListener('change', syncHash);

  $('share-btn').addEventListener('click', async () => {
    window.history.replaceState(null, '', toHash(currentView()));
    const url = window.location.href;
    track('share');
    try {
      // Phones get the system share sheet; desktops a copied link.
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: document.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('Link to this view copied.');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      toast('Copy the address from the address bar to share this view.');
    }
  });

  return syncHash;
}
