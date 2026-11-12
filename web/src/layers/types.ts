import type * as maplibregl from 'maplibre-gl';
import type { PointPanel } from '../app/point.ts';
import type { BasemapLayers } from '../basemap.ts';
import type { LayerKey, ViewState } from '../viewState.ts';

/** What every layer gets: the map and the app's shared parts. */
export interface App {
  readonly map: maplibregl.Map;
  /** The basemap's layer groups, which other layers are inserted below or above. */
  readonly basemap: BasemapLayers;
  /** What the address asked for at start (see viewState.ts). */
  readonly initial: Partial<ViewState>;
  /** Updates the address shortly after a change worth keeping in a link. */
  syncHash(): void;
  /** The panel for a clicked point. */
  readonly point: PointPanel;
}

/**
 * One layer of the map, or a few that share a module (the four snow pictures, bivouacs and their
 * favourites filter). The registry (registry.ts) runs them; nothing else needs to know a layer exists.
 */
export interface LayerModule {
  /**
   * The switches this layer answers to: `#toggle-<key>` in index.html and `layers=` in links. Empty
   * for a layer that is not kept in links and has controls of its own (the GPX track).
   */
  readonly keys: readonly LayerKey[];
  /** At start, before the map has loaded: data requests, legend keys, the layer's own controls. */
  setup?(app: App): void;
  /**
   * Once the style has loaded: adds the map layers, reading the switches for whether they start shown.
   * Runs in registry order, one after the other, which sets the drawing order.
   */
  init?(app: App): void | Promise<void>;
  /**
   * A switch of this layer was flipped. Called from the start, so before or during `init` the
   * layer may not be on the map yet; `init` then reads the switch itself.
   */
  setVisible?(key: LayerKey, on: boolean): void;
  /** Legends (element ids in index.html) shown while one of the given switches is on. */
  readonly legends?: Readonly<Record<string, readonly LayerKey[]>>;
  /** Map layers whose features open their own panel; a click on them opens no point panel. */
  readonly clickLayers?: readonly string[];
  /** What this layer keeps in a shared link besides its switches. */
  view?(): Partial<ViewState>;
}
