// Every layer of the map, in drawing order. This list drives the switches, the legends, the
// shared link and the map click; adding a layer means a module here, a key in viewState.ts and a
// switch in index.html.
import type * as maplibregl from 'maplibre-gl';
import { $ } from '../app/dom.ts';
import { isOn, toggle } from '../app/switches.ts';
import { inArea } from '../island.ts';
import { LAYER_KEYS, type ViewState } from '../viewState.ts';
import { bivouacs } from './bivouacs.ts';
import { ferratas } from './ferratas.ts';
import { forecast } from './forecast.ts';
import { osm } from './osm.ts';
import { satellite } from './satellite.ts';
import { snow } from './snow.ts';
import { stations } from './stations.ts';
import { sun } from './sun.ts';
import { terrain } from './terrain.ts';
import type { App, LayerModule } from './types.ts';

/**
 * Each `init` adds its map layers relative to the ones before it, so the order matters: the night
 * overlay before the via ferratas (which go above it), the snow pictures before the forecast, the
 * bivouacs before the station dots on top.
 */
export const LAYERS: readonly LayerModule[] = [terrain, osm, sun, satellite, snow, forecast, ferratas, bivouacs, stations];

// Every key in a link has exactly one layer that answers its switch.
for (const key of LAYER_KEYS) {
  const owners = LAYERS.filter((m) => m.keys.includes(key)).length;
  if (owners !== 1) throw new Error(`Layer switch "${key}" has ${owners} layer modules, expected one`);
}

function showLegends() {
  for (const m of LAYERS) for (const [id, keys] of Object.entries(m.legends ?? {})) $(id).hidden = !keys.some(isOn);
}

/** Before the map has loaded: binds every switch to its layer, then runs each layer's setup. */
export function setupLayers(app: App) {
  for (const m of LAYERS) {
    for (const key of m.keys) {
      const input = toggle(key);
      input.addEventListener('change', () => {
        m.setVisible?.(key, input.checked);
        showLegends();
      });
    }
  }
  showLegends();
  for (const m of LAYERS) m.setup?.(app);
}

/** Once the style has loaded: adds the layers one after the other. */
export async function initLayers(app: App) {
  for (const m of LAYERS) await m.init?.(app);
}

/** Opens the point panel for a click on the terrain, unless a layer opens its own panel there. */
export function onMapClick(app: App, e: maplibregl.MapMouseEvent) {
  const { map } = app;
  const layers = LAYERS.flatMap((m) => m.clickLayers ?? []).filter((id) => map.getLayer(id));
  if (map.queryRenderedFeatures(e.point, { layers }).length) return;
  // The floor around the island has no data.
  if (!inArea(e.lngLat.lng, e.lngLat.lat)) return;
  void app.point.show(e.lngLat);
}

/** What the layers keep in a shared link besides their switches. */
export const layersView = (): Partial<ViewState>[] => LAYERS.map((m) => m.view?.() ?? {});
