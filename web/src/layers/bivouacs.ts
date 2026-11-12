// Bivouacs as icons and 3D cabins, with the "only favourites" filter.
import * as maplibregl from 'maplibre-gl';
import { $ } from '../app/dom.ts';
import { isOn, switchOn } from '../app/switches.ts';
import { toast } from '../app/toast.ts';
import { addBivouacLayer, BIVOUAC_LAYER_IDS, BIVOUACS, bivouacFootHtml, bivouacHtml, bivouacSub, favButtonHtml } from '../bivouacs.ts';
import { Favourites } from '../favourites.ts';
import type { App, LayerModule } from './types.ts';

let favourites: Favourites;
let layer: Awaited<ReturnType<typeof addBivouacLayer>> | null = null;

export const bivouacs: LayerModule = {
  keys: ['bivouacs', 'favourites'],
  clickLayers: BIVOUAC_LAYER_IDS,

  setup() {
    favourites = new Favourites();
    // The chip on the Bivouacs tile: "All", or how many are saved while only favourites are shown.
    const showFavCount = () => {
      $('fav-count').textContent = isOn('favourites') ? `${favourites.size} saved` : 'All';
      $('fav-count').parentElement!.title = isOn('favourites')
        ? 'Showing only your favourite bivouacs, saved in this browser'
        : 'Show only your favourite bivouacs';
    };
    showFavCount();
    $('toggle-favourites').addEventListener('change', showFavCount);
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
        app.point.show(new maplibregl.LngLat(b.lon, b.lat), {
          head: { title: b.name, sub: bivouacSub(b), icon: 'tent', tone: 'blue' },
          html: bivouacHtml(b, favourites.has(b.osm)),
          elevation: b.ele,
          footHtml: bivouacFootHtml(b),
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
