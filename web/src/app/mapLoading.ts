// The note over the map while the first view loads (#112): "Loading the map, 6 of 15", counting
// the terrain and basemap tiles (tileCount.ts). In the middle of the map until the terrain in
// front is in, then small at the side while the rest (roads, land cover, the far horizon) comes,
// and gone once the map has drawn everything. Only the first view: later loads have no note.
import type * as maplibregl from 'maplibre-gl';
import { onNearLoaded } from '../nearFirst.ts';
import { onTileCount } from '../tileCount.ts';
import { $ } from './dom.ts';

export function setupMapLoading(map: maplibregl.Map) {
  const note = $('map-loading');
  const count = $('map-loading-count');
  // The count is for the eye only; a screen reader hears "Loading the map" once.
  let counting = true;
  const stop = onTileCount((done, asked) => (count.textContent = `, ${done} of ${asked}`));
  // Hidden for a frame before it shows at the side, so it is a new box there, not one that moved:
  // browsers count a moved box as a layout shift even when it floats over the map.
  onNearLoaded(() => {
    note.hidden = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        note.classList.add('aside');
        note.hidden = !counting;
      }),
    );
  });
  map.once('idle', () => {
    counting = false;
    stop();
    note.hidden = true;
  });
}
