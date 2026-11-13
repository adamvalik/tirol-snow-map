# Roadmap – what is done, what comes next

Nov 4, 2026 · live at <https://adamvalik.github.io/tirol-snow-map/>

The original build plan ([`plan.md`](../plan.md)) is finished: every phase up to V3 shipped, plus several layers that were never in it. This document takes stock and sets out the next round. The share picture has its own design in [`share-snapshot.md`](share-snapshot.md).

## Decisions so far

- [x] **No snow line on the map.** It varies too much by slope and aspect; snow from space and the station dots already show where snow lies. The snow line number stays only where it is today.
- [x] **Avalanche: link, never assess.** Point panels link to the official bulletin for that region (avalanche.report). The app shows no danger levels of its own.
- [x] **Keep the UI simple.** Improvements remove and group rather than add.
- [x] **GPX upload: yes, later.**
- [x] **Link previews: yes, later.**
- [x] **Wider area one day; until then, cut the map at the data edge** so it stands as an island (done, see 4.1).
- [x] **No slope angle layer.** Too close to avalanche assessment.
- [x] **Lazy loading of layers: later** (see 3).
- [ ] **Name.** Open, settle after testing. See 5.
- [x] **Domain: after testing, once the name is settled** (about €5 a year). `github.io` until then.
- [x] **Island or faded surroundings: both, decide later.** Faded is the default, a switch cuts it to the island, kept in share links (Nov 4). See 4.1.
- [x] **New app icon:** "Depth bands", the peak in the snow-depth ramp (Nov 12, design canvas option 2).
- [ ] **Frame style for the share picture.** Mock-ups exist (Nov 13); recommendation: Poster for portrait, story and square, a Minimal card for wide, no picker. See [`share-snapshot.md`](share-snapshot.md), "Decisions for you".
- [x] **Visit counting: GoatCounter** (no cookies, free), Nov 7, see [`release-plan.md`](release-plan.md).
- [x] **Versions: today's app is `v0.1.0`; first release to friends and testers is `v0.2.0`** (Nov 7): versions, feedback form, GPX, live location, link preview. See [`release-plan.md`](release-plan.md).

## 1. What was done

| Phase | What shipped |
| --- | --- |
| Spike | Endpoints confirmed, fixtures saved, snow product chosen ([`spike-report.md`](spike-report.md)) |
| MVP | MapLibre 3D terrain (Mapterhorn), hillshade, station markers coloured by snow depth, click for point weather and a 7-day forecast |
| MVP+ | Self-hosted OSM basemap (PMTiles), fonts and icons, 3D buildings |
| V2 | Sentinel-2 true colour with cloud-gap filling; snow seen from space (S2 ~60 m, Copernicus 500 m fallback); estimated snow depth on a 250 m grid with uncertainty layer and leave-one-out error |
| V3 | 14-day day slider, 72 h forecast snowfall animation, shareable view links, scheduled deploy to GitHub Pages three times a day, monitoring issue on failures |
| Beyond the plan | Bivouacs (icons, then 3D cabins), favourites, via ferratas with A–E grades and snow along the route, sun and shade with cast shadows and real sunrise/sunset at a point, "new snow since the satellite view" warning, home-screen icon |

### What the live site looks like (Nov 3, headless Chromium)

- **Phone (390 px):** the layer card is folded into a top bar, which works well. The dock at the bottom (day slider plus the avalanche line) takes about a sixth of the screen even when you are not using the slider. Place labels are large relative to the map. Stations without a snow sensor show as dark grey dots and are the most visible thing on the map at the default view, although they carry the least snow information.
- **Desktop (1440 px):** the layer card shows ten switches, the depth legend and a hint text at once; with "More layers" open it gets taller than a laptop screen.
- **Load:** about 7 MB on the phone and 12 MB on desktop for the first view, almost all of it terrain tiles. Only the two expected hosts are called (the site itself and Mapterhorn). No console errors.

### Loose ends

- [x] README status line and live address updated, this roadmap linked (Nov 3).

## 2. Better UI, kept simple

Guiding rule: one screen, the map first, and every control earns its place.

### 2.1 Quieter dock

- On phones, collapse the day slider to a single line ("Tue 3 Nov · latest ›") that expands when tapped. The avalanche line stays, one line, always visible.
- Later, with the forecast and sun rows: merge Day and Forecast into **one timeline**, from 14 days back to 3 days ahead with "Now" in the middle. Same data, one control instead of two.

### 2.2 Shorter layer card

- Show the four layers most people use up front: *Snow from space*, *Stations*, *Bivouacs*, *Via ferratas*. Move the rest into two small groups that open on tap: *Snow details* (depth estimate, uncertainty, forecast, snow share) and *Map and light* (satellite photo, sun and shade, basemap, labels, hillshade, relief, terrain height).
- Show a legend only for layers that are on. Today the depth legend is always visible.
- Drop the hint paragraph after the first visit (remember it in localStorage).

### 2.3 Calmer map

- Make stations without a snow sensor smaller and lighter than stations with one, so the snow information stands out.
- Slightly smaller place labels on phones.

### 2.4 One line for data age

Replace "483 stations · updated 19:40" with the ages of all sources in one line, for example "Stations 12 min · Satellite 5 d · Forecast 4 h", amber when stale, tap for "About the data".

### 2.5 Later, if still wanted

Offline search over peaks, bivouacs and ferratas; a "Where am I" button. Both are useful, both add controls, so only after 2.1–2.4 and only if the map feels hard to navigate.

## 3. `main.ts` refactor

### Done (Nov 4)

`main.ts` is down from about 1000 lines to about 75 that only start things. The rest:

- **`web/src/layers/`**: one module per layer: `terrain` (hillshade, elevation tint, the island cut, terrain height), `osm` (roads and labels), `sun` (light, night, cast shadows, the sun player and "Sun here"), `satellite`, `snow` (the four snow pictures), `forecast`, `ferratas`, `bivouacs` (with the favourites filter) and `stations`. Each one has `setup` (before the map loads: data requests, legend keys, its own controls), `init` (adds its map layers once the style has loaded), `setVisible` (its switches), and optionally `legends`, `clickLayers` (features that open their own panel) and `view` (what it keeps in a link besides its switches). The interface is in `layers/types.ts`.
- **`layers/registry.ts`**: the one list, in drawing order. It binds every switch to its layer, shows or hides the legends, adds the layers on load, sends a click on plain terrain to the point panel and collects the link state. At start it checks that every key in `viewState.ts` has exactly one layer.
- **`web/src/app/`**: what sits around the layers: the point panel with an extension point for layers (`point.ts`; "Sun here" and the via ferrata highlight use it), the day slider, the address bar and share button, "About the data", warnings, toast, switch helpers, the layer card fold and the dock height.

No visible change, with one exception: the warning line in the layer card used to show its messages in whatever order the data files arrived. It now uses a fixed order (basemap, snow, stations, forecast, last update, new snow, via ferratas), which is the usual order the files arrive in. A side-by-side run of the old and new build in headless Chromium (load, every switch, the forecast player, a point with "Sun here", the sun slider, terrain height, "About the data"; default view and a shared link with most layers on) found no other differences in map layers, their order and visibility, light, switches, dock, panels or the address. Tests, typecheck and the smoke test's checks pass.

Adding a layer (GPX, say) now means: a module in `layers/`, its key in `viewState.ts`, a switch in `index.html` and an entry in the registry list. The switches themselves stay in `index.html`, so the layer card shows at once instead of waiting for the script.

### Background

**Does it slow the app down? No.** Vite bundles all modules into the same JavaScript either way, so splitting the file does not change load or render speed. What costs time on the first visit is the 7–12 MB of terrain tiles, not the code.

**Why do it anyway:** `main.ts` (~990 lines) wires up every layer, the URL state, the legends and the dock. Each UI change in section 2 touches it in several places, and that is where bugs creep in. A layer registry (one file per layer with `init`, `setVisible`, `legend`, `onClick`, and one list that drives the switches, the URL and the legends) makes section 2 and the GPX layer much easier.

**Later: lazy-load the layers you use less.** Load the code (and data) for via ferratas, sun and shade with cast shadows, and the forecast animation only when the layer is first switched on, as ferratas already do with their data. The layers on by default (snow from space, stations, bivouacs) then load first and faster. Fits naturally after the registry, since each layer is already its own module. A service worker that keeps terrain tiles for repeat visits is the other half.

Planned for right before the UI round, with no visible change and tests green.

## 4. Area

### 4.1 The island (done, Nov 3)

The map is cut to the snow grid (10.2–12.7° E, 46.1–47.25° N) in `web/src/island.ts`: elevation tiles are cut in the browser so the terrain ends in a cliff over a plain floor, a mask hides the basemap outside, and labels, stations, bivouacs and via ferratas outside are not drawn. Tiles fully outside are no longer downloaded. "About the data" names the area. No pipeline change.

Follow-ups if wanted: a small spike of terrain mesh at some corners at low zoom; and whether to tighten how far the camera can pan away from the island.

**Open: island or faded surroundings?** Both were rendered on Nov 3 from the same views.

| | Island (on the branch) | Faded surroundings (prototype) |
| --- | --- | --- |
| Look | A cut block on a plain floor; very clear where data ends; striking as a picture | Real terrain continues outside under a pale veil; the data area glows |
| Context | None: Innsbruck, Trento, the Ortler's far side are gone | Neighbouring ranges and lakes stay visible, so the Alps read as one chain |
| Download | Less: tiles outside are never fetched | More: terrain outside is fetched (the basemap outside is coarse only) |
| Grows with the area | Island just gets bigger | Veil shrinks; ends up as the natural look of a wide Alpine map |
| Code | Elevation tiles cut in the browser | Simpler: only the veil and the label filter; no tile cutting |

Built Nov 4: both, with a **Cut at the data edge** switch under "More layers and map style" (`layers=…,island` in a link); faded is the default. Leaning stays: **faded surroundings in the app** (context, fits the Alpine direction and summer use), and keep the **island as a look for share pictures**, where a self-contained block on a plain background reads like a poster. Both share the label and data filtering already built.

### 4.2 Extend later

Growing the island means enlarging one box (`MODEL_GRID`) that the pipeline and the app share, plus the basemap extract. Two sizes:

- **Euregio** (North, East and South Tyrol, Trentino): about 2–3 times today's area. Stations are already in the Euregio feed. Fits the current setup with care: basemap near GitHub's 100 MB file limit (split by zoom or host it elsewhere), more Sentinel Hub processing units per day, a longer Open-Meteo grid (watch the free limit).
- **The Alps**: roughly 10–20 times today's area. Each country has its own station network and format (GeoSphere Austria, MeteoSwiss/SLF, ARPA regions, Météo-France, ARSO), the basemap is several GB and needs real tile hosting, the 250 m snow grid and Sentinel-2 processing no longer fit in a GitHub Actions run, and the Open-Meteo grid exceeds the free tier. It is a different project in size: tiling the pipeline by region, and likely a paid host or two.

A sensible path: Euregio first, built so that a region is a configuration entry (box, station sources, basemap file), then add Alpine regions one at a time if it is worth it.

## 5. Name

The repository is *tirol-snow-map*, the app is *South Tyrol Snow Map*. No change needed now; the name follows the area:

- South Tyrol only: keep **South Tyrol Snow Map**.
- Euregio: **Tirol Snow Map** covers it and matches the repository.
- The Alps: a region-free name (for example *Alpine Snow Map*, or a short brand word) and a new repository name or a GitHub redirect; GitHub keeps redirects after a rename, but the Pages address changes, so old share links would break unless a small redirect page stays at the old address.

Decide when the area decision is made, not before.

**Region or snow in the name?** The app is used for 3D terrain in summer too, and may grow beyond South Tyrol, so a name tied to *both* a region and snow ages twice. A pattern that survives both: a short name tied to neither, plus a descriptive line that can change, for example "*<Name>* · 3D snow and terrain map of South Tyrol". The line carries the region and the snow focus today and is cheap to change later. Candidates to try out loud (availability of domain and trademark unchecked): *Firn*, *Kamm*, *Gipfel*, *Firnline*, *Relief*. The name feeds the share picture, link previews and the icon, so settle it before those. For share pictures the printed address matters more than the name: `adamvalik.github.io/tirol-snow-map` is long but works, and the QR code carries the exact view.

## 6. Share pictures

Concept in [`share-snapshot.md`](share-snapshot.md), reworked Nov 13 with mock-ups and a capture spike: a camera button that renders your GPX track on the snow (numbers, elevation profile with snow along it) or the current view at 3:4, 9:16, 1:1 or 16:9 without UI, captured from the visible map at the export size, in a poster frame (title, date of the data, key numbers, address, credits), straight into the phone's share sheet with the view link copied. The link preview reuses the Wide frame.

## 7. Other improvements

| Idea | What it gives | Effort |
| --- | --- | --- |
| Avalanche bulletin link per region | Point panel shows the region name and links to that region on avalanche.report | S |
| ~~New snow 24/48/72 h at stations~~ (done Nov 9) | The change in snow depth, not only the total, in the station panel | S |
| Offline repeat visits | Service worker for the app, latest data and recent terrain tiles | M |
| Orbit video | 10-second turn around a peak for stories | M, after share pictures |
| New app icon | A clearer home-screen and favicon mark; do it together with the name | S |
| Accessibility pass | Keyboard reach, contrast, labels on dock outputs | S |

## 8. Order

1. ~~Housekeeping~~ and ~~the island~~ (done Nov 3).
2. ~~**Refactor** (3): layer registry, no visible change~~ (done Nov 4).
3. ~~**UI round** (2.1–2.4)~~: rebuilt after design C2 (Nov 12): sidebar with Layers, Place and About on desktop, a bottom sheet on phones, one timeline from 14 days back to 3 days ahead, four layer tiles with two groups, legends only for layers that are on, calmer no-sensor stations, data ages amber when stale, the GPX track UI.
4. **Share picture v1** (6): camera button, formats, frame, share sheet.
5. **Avalanche bulletin link** and **new snow at stations**.
6. **Tester release `v0.2.0`**: see [`release-plan.md`](release-plan.md) for scope and order.
7. **Later:** name and icon (before share pictures and link previews go public), GPX on the snow, link previews, lazy-loaded layers, one timeline, wider area.
