# South Tyrol Snow Map

A read-only 3D miniature of South Tyrol, centred on Bolzano: terrain with OpenStreetMap towns, roads, rivers and 3D buildings, live weather station readings (snow depth, temperature, wind), snow seen by Sentinel-2, an estimated snow depth layer, a day slider over the last 14 days, an animated 3-day snowfall forecast, a 7-day point forecast and the bivouacs (bivacchi, Biwaks) of the region. Every view can be shared as a link (see [`plan.md`](plan.md)).

> **Not for avalanche decisions.** This is a visualisation for orientation only. Always check the official bulletin at [avalanche.report](https://avalanche.report).

Status: **V3 built, awaiting review and first deploy**: day slider over the last 14 days, forecast snowfall animation, shareable view links, the scheduled GitHub Pages workflow with failure monitoring. See [Deployment](#deployment) for the one-time setup. The spike findings are in [`docs/spike-report.md`](docs/spike-report.md).

## Run it locally

Requires Node 22+.

```sh
npm ci
npm run basemap             # one-off, ~1-2 min: OSM extract -> web/public/basemap/south-tyrol.pmtiles (~90 MB, not in git)
npm run pipeline            # stations, snow layers, history, satellite picture, forecast -> web/public/data/
                            # needs CDSE_USERNAME / CDSE_PASSWORD (snow cover) and CDSE_CLIENT_ID / CDSE_CLIENT_SECRET (picture)
                            # caches it keeps between runs go to data/state/ (not published)
# or: npm run pipeline:fixtures   (offline, from the saved fixtures)
npm run dev                 # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (parsers, merge, PMTiles extractor, web helpers) against `fixtures/` |
| `npm run dem` | Rebuild `pipeline/assets/dem-grid.bin`, the 250 m elevation grid the snow model uses (static; only when the grid changes) |
| `npm run basemap` | Re-cut the OSM basemap from the newest Protomaps daily build (monthly is plenty) |
| `npm run bivouacs` | Refresh `web/src/data/bivouacs.json` from OpenStreetMap via the Overpass API (static; `OVERPASS_URL` picks another Overpass instance when the main one is busy) |
| `npm run basemap:assets` | Re-download the fonts and icon sprites the basemap style needs (committed in `web/public/basemap-assets/`) |
| `npm run typecheck` | TypeScript check of app, pipeline and tests |
| `npm run build` | Typecheck and production build into `dist/` (includes whatever is in `web/public/data`) |
| `npm run smoke` | After `build`: opens the built app in Chromium (desktop and phone profiles) and reports load time, console errors, whether the station and forecast panels work, and on desktop the day slider, forecast playback and a shared link. Set `CHROMIUM_PATH` if Playwright's browser is not installed |

## How data flows

```text
Province meteo API v1 (CC0) ----+
                                +--> pipeline (Node, scheduled) --> web/public/data/stations.json --> browser
Euregio station feed (linea) ---+     parse, convert units,              (static file)               |
Copernicus snow cover 500 m ----+     drop stale, merge duplicates,  --> snow.json + snow-*.png -------->+
  (CDSE login, daily)           |     snow depth model on 250 m grid --> history.json + history/<day>/ -->+
Sentinel-2 L2A (Sentinel Hub) --+     newest clear day -> tiles      --> satellite.json + satellite/ ---->+
Open-Meteo grid (every 6 h) ----+     snowfall on the terrain        --> forecast.json + forecast/ ------>+
                                      health of each step            --> status.json ------------------->+
Protomaps OSM build --> npm run basemap --> web/public/basemap/south-tyrol.pmtiles ------------------>+  (same site, range requests)
Mapterhorn terrain tiles --------------------------------------------------------------------------->+  (direct)
Open-Meteo forecast (on click) --------------------------------------------------------------------->+  (direct, cached 1 h)
```

- **The browser calls only two external hosts**: `tiles.mapterhorn.com` for terrain and `api.open-meteo.com` for click forecasts. Everything else comes from files the pipeline generated. The smoke test checks this.
- **Pipeline** (`pipeline/src/run.ts`):
  - Fetches both station sources, converts units (m → cm, K → °C, m/s → km/h) and drops readings older than 24 h.
  - Merges records that describe the same station (within 300 m and 60 m of elevation, from different providers). The freshest record wins, and the province API wins ties.
  - Writes `stations.json` with per-source status, licence and fetch time.
  - If every source fails, it keeps the previous file and marks it `stale`; the app then shows a warning.
- **Basemap** (`pipeline/src/basemap/`): the Protomaps daily planet build is read with HTTP range requests, and only the tiles for South Tyrol are written into a new PMTiles file. Zooms 0–9 cover the whole pannable area, zooms 10–14 South Tyrol. A small built-in writer is used because the `pmtiles` npm package only reads. The style comes from `@protomaps/basemaps` (light flavour), drawn translucently over the terrain tint and under the hillshade.
- **Snow seen from space** (`pipeline/src/snow/s2cover.ts`, `pipeline/src/sources/sentinel2Snow.ts`, the default snow view): every Sentinel-2 pass day of the last 10 days with some clear sky is classified per pixel on a 3056 × 2048 grid (about 60 m) by the Process API: snow where NDSI = (B03 − B11)/(B03 + B11) > 0.4 on bright ground (relaxed in terrain shadow) or where the scene classification says snow; clouds from the scene classification, except pixels that look like snow and not cloud in the shortwave infrared; everything else bare. Each pixel takes its newest clear view. The app draws snow pixels white under the hillshade (older views fainter); cloud-hidden pixels stay unpainted. Classified days are cached in `data/state/s2-snow/`, so each pass day costs processing units once (about 30–40 PU). The same composite, summed into the 250 m cells, is the snow cover that masks the depth estimate (views up to 6 days old); the Copernicus 500 m product is only a fallback when Sentinel-2 is unavailable.
- **Snow layers** (`pipeline/src/snow/`, run as part of `npm run pipeline`):
  - **Snow cover**: the Copernicus *Snow Cover Extent Europe 500 m* products (VIIRS and MODIS, one each per day) of the last four days are found in the open CDSE catalogue, downloaded with the account in `CDSE_USERNAME` / `CDSE_PASSWORD` (each is a ZIP around a COG), and decoded onto the grid: codes 100–200 are 0–100 % snow; 255, the GeoTIFF no-data value, is used for clouds and gaps (code 30 from the manual never occurs in these files). Each cell takes its newest clear view ("last clear view" composite). Views up to a day old mask the depth estimate; older ones are drawn fainter and only shown. The composite is cached and rebuilt only when a new product appears (about twice a day).
  - **Estimated snow depth** follows `plan.md`: a least-squares elevation trend fitted to all stations with a snow reading, plus station residuals spread by inverse distance weighting that fade back to the trend about 12 km from a station. Cells the satellite sees as snow-free (under 15 %) are set to 0. Leave-one-out validation (hide each station, predict it from the rest) runs on every update and picks trend-only or trend-plus-residuals, whichever predicts better; its mean absolute error is shown in the app, overall and per elevation band.
  - **Confidence** per cell: high within 10 km of a snow station and inside the stations' elevation range; medium within 25 km and 300 m of the range; low otherwise; one level lower where the satellite has no view (cloud or no data).
  - **Outputs**: `snow.json` (dates, method, trend, validation, snow line), `snow-cover.png`, `snow-depth.png`, `snow-confidence.png`, and `snow-data.png`, which stores depth and cover losslessly in its colour channels so the app can show the value under a click.
  - The grid (`shared/grid.ts`) has 764 × 512 cells of about 250 m, with rows spaced evenly in Web Mercator so the PNGs line up exactly on the map.
- **Satellite picture** (`pipeline/src/satellite/`, `pipeline/src/sources/sentinel2.ts`): the Sentinel Hub catalogue lists Sentinel-2 L2A passes of the last 20 days; each day is scored by how much of the region it shows cloud-free. The newest day above 45 % is rendered in true colour through the Process API (clouds and cirrus made transparent with the scene classification band, snow stays white), and the newest older day above 35 % fills the cloud gaps. Zoom 12 (about 25 m pixels) is rendered in 2048 px chunks and cut into 256 px WebP tiles; zooms 8–11 are built locally. Process API requests are retried on rate limits, server errors, dropped connections and timeouts. Rendering happens only when the chosen days change, because it costs Copernicus processing units (roughly 300–700 per refresh; check usage in the CDSE dashboard). Output: `satellite.json` (dates, shares) and `satellite/{z}/{x}/{y}.webp` (about 11 MB).
- **Day slider** (`pipeline/src/history.ts`): after each run the snow layers, `snow.json` and `stations.json` are copied to `history/<day>/` (local South Tyrol day; the day's last run wins) and listed in `history.json`, newest first, for 14 days. When the history starts, earlier Sentinel-2 pass days still in the cache are rebuilt as snow-cover-only days (no depth estimate, no station readings), so the slider is not empty on day one. The app swaps the snow pictures, the click readout and the station dots to the chosen day.
- **Forecast snowfall** (`pipeline/src/forecast/`): one multi-location Open-Meteo request (best-match blend) for hourly precipitation and freezing level at 273 points about 10 km apart, at most every 6 hours (each point counts as one call against the free limit, and runner IPs are shared). Both fields are interpolated to the 250 m cells, and the terrain decides how much falls as snow: all of it more than 150 m above the snowfall limit (300 m below the freezing level), none more than 150 m below, 1 cm of snow per mm of water. Every run re-renders the accumulated new snow every 3 hours for the next 72 hours as `forecast/fNN.png`, so the animation starts at the current hour. The model's own snowfall is not used: it belongs to the model's smooth terrain, which misses the snow line. If Open-Meteo fails, the last grid is reused while it reaches at least 12 hours ahead, flagged stale.
- **Health** (`pipeline/src/status.ts`): `status.json` lists each step's problems (an unreachable upstream, an exception; not "no clear pass", which is weather) and how many runs in a row it has failed. The app turns it into warnings; the deploy workflow into an issue. When the Sentinel-2 catalogue is unreachable, the snow map is built from the cached pass days instead.
- **Check workflow** (`.github/workflows/snow-check.yml`): runs the tests and the live pipeline with the repository secrets, prints `snow.json`, and uploads the outputs as a workflow artifact. It starts from production's latest data (the deploy's Actions cache, read only), so the satellite picture and the Sentinel-2 snow days are rendered again only when a newer clear day has appeared; run it by hand with **fresh** to render everything from scratch. It runs by hand or on pushes to `claude/**` branches.
- **Production workflow** (`.github/workflows/deploy.yml`): see [Deployment](#deployment).
- **Data contract**: `shared/types.ts`.
- **Sources**:
  - Province API v1: `geoservices.buergernetz.bz.it/services/meteo/v1`. Official, CC0, about 97 stations, 26 of them with snow depth.
  - Euregio station feed: `static.avalanche.report/eaws_weather_stations/linea.geojson`, the feed behind avalanche.report. It covers Tirol, South Tyrol, Trentino and neighbouring stations, and about 270 within the region box report snow depth. Licence is per operator; LWD Tirol, GeoSphere, ARPAV and SLF data are CC BY 4.0.
  - Within South Tyrol, both sources carry the same provincial stations; the pipeline merges these duplicates.

## Repository layout

| Path | Contents |
| --- | --- |
| `web/` | Vite + TypeScript + MapLibre GL JS app (no UI framework); `web/public/basemap-assets/` holds self-hosted fonts and sprites |
| `pipeline/` | Data fetch and normalisation (run with `tsx`) and its tests |
| `shared/` | Types shared by the pipeline and the app |
| `fixtures/` | Real API responses from 2026-10-20 used by the tests (see `fixtures/README.md`) |
| `scripts/smoke.mjs` | Browser smoke test |
| `scripts/monitor.mjs` | Opens and closes the `data-pipeline` issue from `status.json` (run by the deploy workflow) |
| `docs/` | Spike report |

## Shareable view

The address bar always holds the current view, for example `#map=10.40/46.4700/11.3540/20/60&x=1.5&layers=snow,stations&day=2026-10-18&f=5`: zoom/latitude/longitude/bearing/pitch, vertical exaggeration, the layers switched on, the slider day (left out for the latest data) and the forecast frame. The link button next to the title copies it (phones get the share sheet). Invalid parts fall back to the defaults, and a day that has left the 14-day window opens the latest data.

## Deployment

`.github/workflows/deploy.yml` runs every 30 minutes (at :07 and :37), on every push to `main` and by hand. It restores the previous run's data from an Actions cache, runs the pipeline, saves the data again, builds the app with the data inside and publishes it to GitHub Pages. The basemap is rebuilt once a month and cached. Only the three newest data caches are kept.

A failed upstream never stops a deploy: the files keep the last good data, the app shows a warning, and `scripts/monitor.mjs` opens an issue labelled `data-pipeline` when a step has failed three runs in a row (about 1.5 hours) or the pipeline crashed. The issue is updated while it keeps failing and closed automatically when everything works again, so watching the repository is the alert.

One-time setup:

1. Merge this branch into `main`; scheduled workflows only run on the default branch.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions: `CDSE_USERNAME`, `CDSE_PASSWORD`, `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET` (already set if the check workflow works).
4. Run "Update data and deploy" once from the Actions tab. The first run takes a few minutes longer (basemap, satellite tiles, classifying the Sentinel-2 days). The site appears at `https://<user>.github.io/tirol-snow-map/`.

GitHub disables scheduled workflows in a public repository after 60 days without activity in it, and scheduled runs can start late when GitHub is busy. The station warning in the app ("out of date") shows when that happens; re-enable the workflow from the Actions tab.

## Known limits

- **No snow-depth sensors in the valleys.** Inside South Tyrol, snow depth is measured only at about 1700–3000 m; the lowest station in the surrounding region is at about 530 m. A missing marker does not mean there is no snow.
- **The snow depth map is an estimate, not a measurement.** It is a smooth trend with local corrections; real depth varies far more (wind drift, sun-exposed slopes, gullies). The leave-one-out error in the app tells you how far off a station-like spot typically is. Above about 3000 m, and in valleys below the lowest station, it extrapolates.
- **The satellite picture is a few days old at best** (Sentinel-2 passes every 2–5 days, clouds permitting) and 25 m per pixel; it is not a live webcam. Where both days were cloudy the map shows through.
- **Snow from space needs clear sky.** A pixel shows its newest clear view in the last 10 days, so snow that fell after that view is missing until the next clear pass, and pixels hidden by clouds on every pass show no snow. Dark, shaded slopes and thin early-season snow can be missed; bright cloud over snow can be confused with it.
- **The Copernicus fallback is 500 m and optical.** Clouds hide the ground: cells are filled from up to three earlier days (fainter) and hatched if never seen. Narrow valleys and thin early-season snow (under 15 % of a 500 m cell) can be missed, and a day's product appears in the afternoon (VIIRS) or evening (MODIS).
- **Station snow depth is a point measurement.** Wind and terrain make real depth vary a lot over short distances.
- **The forecast is model output** (Open-Meteo, best-match blend), downscaled to the clicked elevation. Open-Meteo's own model snow depth is not used: in the spike it read 0 cm where a station measured 5.8 cm.
- **Open-Meteo rate limits are per IP**, with a free non-commercial tier. Normal use is far below them. A shared IP (CI, some networks) can hit them, and the panel then shows the error.
- **Terrain download is heavy.** The first view loads about 50 DEM tiles (about 8 MB, cached by the browser for 7 days). On phones the 3D mesh uses coarser tiles and a capped pixel ratio.
- **Basemap** is a snapshot of OpenStreetMap, refreshed only when `npm run basemap` runs. Zoom 15 is left out to keep the file under 100 MB; closer views over-zoom zoom-14 tiles. Building heights are estimates where OSM has none.
- **Bivouacs** are a static OpenStreetMap list (`web/src/data/bivouacs.json`, ODbL), refreshed only when `npm run bivouacs` runs. It holds the huts and shelters inside the station box whose name says bivacco, Biwak, bivak or bivouac (unnamed or differently named emergency huts are missed), without the ones marked private or disused. Red cabins are metal boxes, brown ones wooden; OSM rarely records the material, so a hut is drawn wooden only when `building:material=wood` or its description says it is built of wood, and most are drawn red. Whether a bivouac is open, equipped or still standing is not checked. From zoom 13 the icons give way to small 3D cabins standing on the terrain (`web/src/cabins.ts`): a half-barrel or a gabled hut with a door, turned a fixed but different way for each bivouac (OSM does not record which way they face) and drawn 8 times life size, since a real bivouac of about 3 m would be a single pixel. On steep slopes the uphill side sits slightly in the ground. Clicking one opens the point forecast at its surveyed elevation.
- **Major summit labels** are a curated static list from OpenStreetMap (`web/src/data/summits.json`, ODbL); other peaks come from the basemap.
- **Euregio feed quirk:** some providers publish local time with a `Z` suffix. The pipeline reinterprets future timestamps as Europe/Rome local time.
- **The forecast animation is a sketch of where snow will fall,** not a snow depth forecast. Precipitation comes from about 10 km apart and is spread smoothly between the points; the snow share uses a fixed rule (snowfall limit 300 m below the freezing level, 10:1 snow) that misses heavy-precipitation cooling, wet snow and wind. Settling and melting of the new snow are ignored.
- **The day slider starts with the deployment.** Days before that exist only as snow seen from space (rebuilt from cached passes, at most 10 days back), without depth estimate or station readings. A day shows the last update of that day.
- **Open-Meteo counts every grid point as one call** (273 per fetch, at most 4 fetches a day). A runner IP shared with heavy users can still be refused; the app then animates the last fetched forecast and says how old it is.

## Attribution

Terrain © [Mapterhorn](https://mapterhorn.com/attribution), built from:
- South Tyrol DGM 2.5 m (Autonomous Province of Bolzano, CC0)
- TINITALY (INGV, CC BY 4.0)
- Trentino LiDAR (CC BY 2.5)
- BEV Austria (CC BY 4.0)
- Copernicus GLO-30

Other sources:
- **Stations:** Autonomous Province of Bolzano weather service (CC0); the Euregio avalanche warning services and partner operators via avalanche.report.
- **Satellite picture:** contains modified Copernicus Sentinel data, processed by Sentinel Hub (Copernicus Data Space Ecosystem).
- **Snow cover:** Copernicus Land Monitoring Service, Snow Cover Extent Europe 500 m (European Union), free and open access.
- **Forecast:** [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).
- **Basemap, summits and bivouacs:** © OpenStreetMap contributors (ODbL), via a Protomaps build. Fonts: Noto Sans (OFL).

The app shows all of these in its "About the data" dialog.
