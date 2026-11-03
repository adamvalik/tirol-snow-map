# Roadmap – what is done, what comes next

Nov 3, 2026 · live at <https://adamvalik.github.io/tirol-snow-map/>

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
- [ ] **Name.** Open. See 5.
- [ ] **Frame style for the share picture** (minimal or poster). Open until mock-ups exist.
- [ ] **Visit counting.** Open.

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

**Does it slow the app down? No.** Vite bundles all modules into the same JavaScript either way, so splitting the file does not change load or render speed. What costs time on the first visit is the 7–12 MB of terrain tiles, not the code.

**Why do it anyway:** `main.ts` (~990 lines) wires up every layer, the URL state, the legends and the dock. Each UI change in section 2 touches it in several places, and that is where bugs creep in. A layer registry (one file per layer with `init`, `setVisible`, `legend`, `onClick`, and one list that drives the switches, the URL and the legends) makes section 2 and the GPX layer much easier.

**Later: lazy-load the layers you use less.** Load the code (and data) for via ferratas, sun and shade with cast shadows, and the forecast animation only when the layer is first switched on, as ferratas already do with their data. The layers on by default (snow from space, stations, bivouacs) then load first and faster. Fits naturally after the registry, since each layer is already its own module. A service worker that keeps terrain tiles for repeat visits is the other half.

Do the refactor right before the UI round, with no visible change, tests green.

## 4. Area

### 4.1 The island (done, Nov 3)

The map is cut to the snow grid (10.2–12.7° E, 46.1–47.25° N) in `web/src/island.ts`: elevation tiles are cut in the browser so the terrain ends in a cliff over a plain floor, a mask hides the basemap outside, and labels, stations, bivouacs and via ferratas outside are not drawn. Tiles fully outside are no longer downloaded. "About the data" names the area. No pipeline change.

Follow-ups if wanted: a small spike of terrain mesh at some corners at low zoom; and whether to tighten how far the camera can pan away from the island.

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

Decide when the area decision is made, not before. For share pictures the printed address matters more than the name: `adamvalik.github.io/tirol-snow-map` is long but works, and the QR code carries the exact view.

## 6. Share pictures

Design in [`share-snapshot.md`](share-snapshot.md): a camera button that renders the current view at 4:5, 9:16, 1:1 or 16:9 without UI, with a slim frame (place, data date, key number, legend, address, QR, credits), straight into the phone's share sheet. GPX tracks on the snow and link previews follow later.

## 7. Other improvements

| Idea | What it gives | Effort |
| --- | --- | --- |
| Avalanche bulletin link per region | Point panel shows the region name and links to that region on avalanche.report | S |
| New snow 24/48/72 h at stations | The change in snow depth, not only the total, in the station panel | S |
| Offline repeat visits | Service worker for the app, latest data and recent terrain tiles | M |
| Orbit video | 10-second turn around a peak for stories | M, after share pictures |
| Accessibility pass | Keyboard reach, contrast, labels on dock outputs | S |

## 8. Order

1. ~~Housekeeping~~ and ~~the island~~ (done Nov 3).
2. **Refactor** (3): layer registry, no visible change.
3. **UI round** (2.1–2.4): quieter dock, shorter layer card, calmer stations, data-age line.
4. **Share picture v1** (6): camera button, formats, frame, share sheet.
5. **Avalanche bulletin link** and **new snow at stations**.
6. **Later:** GPX on the snow, link previews, lazy-loaded layers, one timeline, wider area.
