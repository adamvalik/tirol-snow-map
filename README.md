# South Tyrol Snow Map

A read-only 3D miniature of South Tyrol, centred on Bolzano: terrain with OpenStreetMap towns, roads, rivers and 3D buildings, live weather station readings (snow depth, temperature, wind) and a 7-day point forecast. Later phases add satellite snow cover and an estimated snow depth layer (see [`plan.md`](plan.md)).

> **Not for avalanche decisions.** This is a visualisation for orientation only. Always check the official bulletin at [avalanche.report](https://avalanche.report).

Status: **MVP plus OSM basemap**; V2 (satellite picture, snow cover, snow depth estimate) is next. The spike findings are in [`docs/spike-report.md`](docs/spike-report.md).

## Run it locally

Requires Node 22+.

```sh
npm ci
npm run basemap             # one-off, ~1-2 min: OSM extract -> web/public/basemap/south-tyrol.pmtiles (~90 MB, not in git)
npm run pipeline            # fetch live station data -> web/public/data/stations.json
# or: npm run pipeline:fixtures   (offline, from the saved fixtures)
npm run dev                 # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (parsers, merge, PMTiles extractor, web helpers) against `fixtures/` |
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
                                      drop stale, merge duplicates                                    |
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
- **Forecast:** [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).
- **Basemap and summits:** © OpenStreetMap contributors (ODbL), via a Protomaps build. Fonts: Noto Sans (OFL).

The app shows all of these in its "Data sources and attribution" dialog.
