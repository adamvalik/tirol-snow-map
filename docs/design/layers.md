# Layers and the app around them

How `web/src/` is put together. `main.ts` only starts things; it was split from a 1000-line file into a layer registry on Nov 4, 2026.

- **`web/src/layers/`**: one module per layer: `terrain` (hillshade, elevation tint, the island cut, terrain height), `osm` (roads and labels), `sun` (light, night, shade, the sun player and "Sun here"), `satellite`, `snow` (the snow pictures), `forecast`, `winter` (lifts, slopes and trails, lifts in 3D), `ferratas`, `gpx` (the track), `bivouacs` (with the favourites filter) and `stations`.
  - Each one has `setup` (before the map loads: data requests, legend keys, its own controls), `init` (adds its map layers once the style has loaded) and `setVisible` (its switches).
  - Optionally also `legends`, `clickLayers` (features that open their own panel) and `view` (what it keeps in a link besides its switches).
  - The interface is in `layers/types.ts`.
- **`layers/registry.ts`**: the one list, in drawing order. It binds every switch to its layer, shows or hides the legends, adds the layers on load, sends a click on plain terrain to the point panel and collects the link state. At start it checks that every key in `viewState.ts` has exactly one layer.
- **`web/src/app/`**: what sits around the layers: the layout (tabs, phone sheet, quick row, map buttons), the point panel with an extension point for layers (`point.ts`), the timeline, the address bar and share button, "About the data", feedback, analytics, warnings, toast and the What's new card.

## Adding a layer

1. A module in `layers/`.
2. Its key in `viewState.ts`.
3. A switch in `index.html`. The switches stay in the HTML, so the layer card shows at once instead of waiting for the script.
4. An entry in the registry list, at its place in the drawing order.

## Does the split cost speed?

No. Vite bundles all modules into the same JavaScript either way, so the split does not change load or render speed. What costs time on the first visit is the 5–12 MB of terrain tiles, not the code.
