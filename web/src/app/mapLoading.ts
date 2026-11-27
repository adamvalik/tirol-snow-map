// The note over the map while the first view loads (#112): "Loading the map" with a progress bar
// for its terrain and basemap tiles (tileCount.ts). In the middle of the map until the terrain in
// front is in, then small at the side while the rest (roads, land cover, the far horizon) comes,
// and gone once the map has drawn everything. Only the first view: later loads have no note.
import type * as maplibregl from 'maplibre-gl';
import { onNearLoaded } from '../nearFirst.ts';
import { onTileCount } from '../tileCount.ts';
import { $ } from './dom.ts';

/** The bar waits here until the map has drawn everything, so a full bar always means done. */
const BEFORE_DONE = 0.95;

/**
 * The bar's share for `done` of `asked` tiles. It never goes back, though the total grows while
 * the basemap asks for its tiles; it holds still until the tiles catch up.
 */
export const progressShare = (done: number, asked: number, shown: number): number =>
  Math.max(shown, asked ? Math.min(BEFORE_DONE, (done / asked) * BEFORE_DONE) : 0);

export function setupMapLoading(map: maplibregl.Map) {
  const note = $('map-loading');
  const bar = $('map-progress');
  let shown = 0;
  let counting = true;
  const show = (share: number) => {
    shown = share;
    bar.style.setProperty('--progress', String(share));
    // At least 1 once counting starts: 0 is the shining empty track (style.css).
    bar.setAttribute('aria-valuenow', String(Math.max(1, Math.round(share * 100))));
  };
  const stop = onTileCount((done, asked) => show(progressShare(done, asked, shown)));
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
  // Everything is drawn: fill the bar, fade out, then leave the page.
  map.once('idle', () => {
    counting = false;
    stop();
    show(1);
    note.classList.add('done');
    setTimeout(() => (note.hidden = true), 700);
  });
}
