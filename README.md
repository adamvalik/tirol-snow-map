# South Tyrol Snow Map

A read-only 3D miniature of South Tyrol, centred on Bolzano: terrain with OpenStreetMap towns, roads, rivers and 3D buildings, live weather station readings (snow depth, temperature, wind) and a 7-day point forecast. Later phases add satellite snow cover and an estimated snow depth layer (see [`plan.md`](plan.md)).

> **Not for avalanche decisions.** This is a visualisation for orientation only. Always check the official bulletin at [avalanche.report](https://avalanche.report).

Status: **V2 done, awaiting review**: Sentinel-2 satellite picture, satellite snow cover, estimated snow depth with confidence and validation. V3 (time slider, forecast animation, share links, GitHub Pages) is next. The spike findings are in [`docs/spike-report.md`](docs/spike-report.md).

## Run it locally

Requires Node 22+.

```sh
npm ci
npm run basemap             # one-off, ~1-2 min: OSM extract -> web/public/basemap/south-tyrol.pmtiles (~90 MB, not in git)
npm run pipeline            # stations, snow layers, satellite picture -> web/public/data/
                            # needs CDSE_USERNAME / CDSE_PASSWORD (snow cover) and CDSE_CLIENT_ID / CDSE_CLIENT_SECRET (picture)
# or: npm run pipeline:fixtures   (offline, from the saved fixtures)
npm run dev                 # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (parsers, merge, PMTiles extractor, web helpers) against `fixtures/` |
| `npm run dem` | Rebuild `pipeline/assets/dem-grid.bin`, the 250 m elevation grid the snow model uses (static; only when the grid changes) |
| `npm run basemap` | Re-cut the OSM basemap from the newest Protomaps daily build (monthly is plenty) |
| `npm run basemap:assets` | Re-download the fonts and icon sprites the basemap style needs (committed in `web/public/basemap-assets/`) |
| `npm run typecheck` | TypeScript check of app, pipeline and tests |
| `npm run build` | Typecheck and production build into `dist/` (includes whatever is in `web/public/data`) |
| `npm run smoke` | After `build`: opens the built app in Chromium (desktop and phone profiles) and reports load time, console errors and whether the station and forecast panels work. Set `CHROMIUM_PATH` if Playwright's browser is not installed |

## How data flows

```text
Province meteo API v1 (CC0) ----+
                                +--> pipeline (Node, scheduled) --> web/public/data/stations.json --> browser
Euregio station feed (linea) ---+     parse, convert units,              (static file)               |
Copernicus snow cover 500 m ----+     drop stale, merge duplicates,  --> snow.json + snow-*.png -------->+
  (CDSE login, daily)           |     snow depth model on 250 m grid                                  |
Sentinel-2 L2A (Sentinel Hub) --+     newest clear day -> tiles      --> satellite.json + satellite/ ---->+
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
- **Simulated snow** (`web/src/snowline.ts`, the default snow view): the terrain is painted white above a snow line, at the full resolution of the elevation tiles, under the hillshade so it reads like a snowed-in model. The line is fitted in the browser from the station readings (share of stations with at least 2 cm, made non-decreasing with elevation): patches start where about 20 % report snow, the line is at 50 %, closed cover at 80 %. When the satellite snow line is available it moves the line, keeping the band width. One line for the whole region, so it ignores sun and shade. The satellite picture, satellite snow cover and estimated depth layers below are still there but off by default.
- **Snow layers** (`pipeline/src/snow/`, run as part of `npm run pipeline`):
  - **Snow cover**: the Copernicus *Snow Cover Extent Europe 500 m* products (VIIRS and MODIS, one each per day) of the last four days are found in the open CDSE catalogue, downloaded with the account in `CDSE_USERNAME` / `CDSE_PASSWORD` (each is a ZIP around a COG), and decoded onto the grid: codes 100–200 are 0–100 % snow; 255, the GeoTIFF no-data value, is used for clouds and gaps (code 30 from the manual never occurs in these files). Each cell takes its newest clear view ("last clear view" composite). Views up to a day old mask the depth estimate; older ones are drawn fainter and only shown. The composite is cached and rebuilt only when a new product appears (about twice a day).
  - **Estimated snow depth** follows `plan.md`: a least-squares elevation trend fitted to all stations with a snow reading, plus station residuals spread by inverse distance weighting that fade back to the trend about 12 km from a station. Cells the satellite sees as snow-free (under 15 %) are set to 0. Leave-one-out validation (hide each station, predict it from the rest) runs on every update and picks trend-only or trend-plus-residuals, whichever predicts better; its mean absolute error is shown in the app, overall and per elevation band.
  - **Confidence** per cell: high within 10 km of a snow station and inside the stations' elevation range; medium within 25 km and 300 m of the range; low otherwise; one level lower where the satellite has no view (cloud or no data).
  - **Outputs**: `snow.json` (dates, method, trend, validation, snow line), `snow-cover.png`, `snow-depth.png`, `snow-confidence.png`, and `snow-data.png`, which stores depth and cover losslessly in its colour channels so the app can show the value under a click.
  - The grid (`shared/grid.ts`) has 764 × 512 cells of about 250 m, with rows spaced evenly in Web Mercator so the PNGs line up exactly on the map.
- **Satellite picture** (`pipeline/src/satellite/`, `pipeline/src/sources/sentinel2.ts`): the Sentinel Hub catalogue lists Sentinel-2 L2A passes of the last 20 days; each day is scored by how much of the region it shows cloud-free. The newest day above 45 % is rendered in true colour through the Process API (clouds and cirrus made transparent with the scene classification band, snow stays white), and the newest older day above 35 % fills the cloud gaps. Zoom 12 (about 25 m pixels) is rendered in 2048 px chunks and cut into 256 px WebP tiles; zooms 8–11 are built locally. Rendering happens only when the chosen days change, because it costs Copernicus processing units (roughly 300–700 per refresh; check usage in the CDSE dashboard). Output: `satellite.json` (dates, shares) and `satellite/{z}/{x}/{y}.webp` (about 11 MB).
- **Check workflow** (`.github/workflows/snow-check.yml`): runs the tests and the live pipeline with the repository secrets, prints `snow.json`, and uploads the outputs as a workflow artifact. It runs by hand or on pushes to `claude/**` branches; the scheduled production workflow comes in V3.
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
| `docs/` | Spike report |

## Known limits

- **No snow-depth sensors in the valleys.** Inside South Tyrol, snow depth is measured only at about 1700–3000 m; the lowest station in the surrounding region is at about 530 m. A missing marker does not mean there is no snow.
- **The snow depth map is an estimate, not a measurement.** It is a smooth trend with local corrections; real depth varies far more (wind drift, sun-exposed slopes, gullies). The leave-one-out error in the app tells you how far off a station-like spot typically is. Above about 3000 m, and in valleys below the lowest station, it extrapolates.
- **The satellite picture is a few days old at best** (Sentinel-2 passes every 2–5 days, clouds permitting) and 25 m per pixel; it is not a live webcam. Where both days were cloudy the map shows through.
- **Satellite snow cover is 500 m and optical.** Clouds hide the ground: cells are filled from up to three earlier days (fainter) and hatched if never seen. Narrow valleys and thin early-season snow (under 15 % of a 500 m cell) can be missed, and a day's product appears in the afternoon (VIIRS) or evening (MODIS).
- **Station snow depth is a point measurement.** Wind and terrain make real depth vary a lot over short distances.
- **The forecast is model output** (Open-Meteo, best-match blend), downscaled to the clicked elevation. Open-Meteo's own model snow depth is not used: in the spike it read 0 cm where a station measured 5.8 cm.
- **Open-Meteo rate limits are per IP**, with a free non-commercial tier. Normal use is far below them. A shared IP (CI, some networks) can hit them, and the panel then shows the error.
- **Terrain download is heavy.** The first view loads about 50 DEM tiles (about 8 MB, cached by the browser for 7 days). On phones the 3D mesh uses coarser tiles and a capped pixel ratio.
- **Basemap** is a snapshot of OpenStreetMap, refreshed only when `npm run basemap` runs. Zoom 15 is left out to keep the file under 100 MB; closer views over-zoom zoom-14 tiles. Building heights are estimates where OSM has none.
- **Major summit labels** are a curated static list from OpenStreetMap (`web/src/data/summits.json`, ODbL); other peaks come from the basemap.
- **Euregio feed quirk:** some providers publish local time with a `Z` suffix. The pipeline reinterprets future timestamps as Europe/Rome local time.
- **Not deployed yet.** GitHub Pages and the scheduled workflow come in V3.

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
- **Basemap and summits:** © OpenStreetMap contributors (ODbL), via a Protomaps build. Fonts: Noto Sans (OFL).

The app shows all of these in its "Data sources and attribution" dialog.
