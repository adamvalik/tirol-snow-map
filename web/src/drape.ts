// With 3D terrain, MapLibre draws the flat layers (fills, lines, rasters, hillshade, relief) into a
// texture for each terrain tile and lays it on the ground. A run of flat layers shares one texture;
// a circle, symbol or 3D layer between two flat layers starts a new run, and every tile then holds
// one more texture. Each is 2048 px square by default (about 21 MB with its mipmaps), so a few
// labels between line layers cost hundreds of MB, and phones closed the tab (#55).
//
// So all flat layers are kept below all the others, in their own order. On the ground nothing
// changes: the flat layers lie on the terrain and the rest stand on it either way.
import type * as maplibregl from 'maplibre-gl';

/** The layer types MapLibre draws into the terrain's textures. */
const DRAPED = new Set(['background', 'fill', 'line', 'raster', 'hillshade', 'color-relief']);

/** The layer order with every draped layer first, each group in its own order. */
export function drapedFirst(layers: readonly { id: string; type: string }[]): string[] {
  const draped = layers.filter((l) => DRAPED.has(l.type));
  const rest = layers.filter((l) => !DRAPED.has(l.type));
  return [...draped, ...rest].map((l) => l.id);
}

/** How many textures each terrain tile holds when every layer is shown. */
export function drapeRuns(layers: readonly { type: string }[]): number {
  let runs = 0;
  let prevDraped = false;
  for (const l of layers) {
    const draped = DRAPED.has(l.type);
    if (draped && !prevDraped) runs++;
    prevDraped = draped;
  }
  return runs;
}

/** Moves the map's layers so the draped ones come first. Call once all layers are added. */
export function drapeTogether(map: maplibregl.Map) {
  const layers = map.getLayersOrder().map((id) => ({ id, type: map.getLayer(id)!.type }));
  if (drapeRuns(layers) <= 1) return;
  // Moving each other layer to the top, in order, leaves the draped ones below in theirs.
  for (const l of layers) if (!DRAPED.has(l.type)) map.moveLayer(l.id);
}
