// Bivouacs as icons and 3D cabins, with the "only favourites" filter.
import * as maplibregl from 'maplibre-gl';
import { $ } from '../app/dom.ts';
import { isOn, switchOn } from '../app/switches.ts';
import { toast } from '../app/toast.ts';
import { addBivouacLayer, BIVOUAC_LAYER_IDS, BIVOUACS, bivouacHtml, bivouacIconUrl, favButtonHtml } from '../bivouacs.ts';
import { Favourites } from '../favourites.ts';
import type { App, LayerModule } from './types.ts';

let favourites: Favourites;
let layer: Awaited<ReturnType<typeof addBivouacLayer>> | null = null;

export const bivouacs: LayerModule = {
  keys: ['bivouacs', 'favourites'],
  clickLayers: BIVOUAC_LAYER_IDS,

  setup() {
    $('bivouac-keys').innerHTML = (['metal', 'wood'] as const)
      .map((k) => `<img class="bivouac-icon" src="${bivouacIconUrl(k)}" alt="" title="${k === 'wood' ? 'Wooden' : 'Metal'}">`)
      .join('');

    favourites = new Favourites();
    const showFavCount = () => {
      $('fav-count').textContent = String(favourites.size);
      $('fav-count').title = 'Saved in this browser';
    };
    showFavCount();
    favourites.onChange(showFavCount);
    // The heart in a bivouac's panel; the panel body is re-rendered when its forecast arrives.
    $('details-body').addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>('.fav-btn');
      const b = btn && BIVOUACS.find((x) => x.osm === btn.dataset.osm);
      if (!btn || !b) return;
      const on = favourites.toggle(b.osm);
      btn.outerHTML = favButtonHtml(b, on);
      if (!on && isOn('favourites')) toast(`${b.name} left your favourites and is hidden by the filter.`);
    });
  },

  /** Below the station dots, which are added next. */
  async init(app: App) {
    layer = await addBivouacLayer(
      app.map,
      favourites,
      (b) =>
        void app.point.show(new maplibregl.LngLat(b.lon, b.lat), {
          title: b.name,
          html: bivouacHtml(b, favourites.has(b.osm)),
          elevation: b.ele,
        }),
      isOn('bivouacs'),
      isOn('favourites'),
    ).catch((e: unknown) => {
      console.warn('Bivouacs:', e);
      return null;
    });
  },

  setVisible(key, on) {
    if (!layer) return;
    if (key === 'bivouacs') {
      layer.setVisible(on);
      return;
    }
    layer.setOnlyFavourites(on);
    if (on && !isOn('bivouacs')) switchOn('bivouacs');
    if (on && favourites.size === 0) toast('No favourites yet: open a bivouac and tap the heart.');
  },
};
