# South Tyrol 3D Snow Map - Build Plan

Oct 20, 2026

## Goal and scope

A web app that shows South Tyrol as an interactive 3D terrain model, with snow cover, estimated snow depth and weather data draped over it, so you can see at a glance where snow already lies and roughly how much. It is read-only: viewers can orbit the model, toggle layers and click for detail, but nothing is edited or saved. It is for personal use and for showing to friends on free hosting.

**In scope**

- 3D terrain of South Tyrol and its surroundings, tilt and rotate freely, centred on Bolzano
- Snow cover layer from satellite (where is there snow)
- Estimated snow depth layer (how much), built from station measurements
- Live station markers with current temperature, snow depth, wind and precipitation
- Click any point for elevation plus point weather and a short forecast
- Works on desktop and phone browsers

**Out of scope for now**

- Avalanche danger assessment. This is a visualisation for orientation, not a safety tool, and the app must say so
- User accounts, saved routes, social features
- Native mobile apps
- Other regions. South Tyrol only at first; Trentino and Tirol can follow later

**Success looks like:** on the first real snowfall of the season you can open the app, tilt to a view of the Dolomites, and the snow line visibly matches what you see out of the window.

## Data sources

Four kinds of free data cover the whole app. Terrain is solved; snow is the part that needs care, because no source gives measured snow depth at every point.

| Layer | Source | What it gives | Resolution and update | Main caveat |
| --- | --- | --- | --- | --- |
| Terrain | [Mapterhorn](https://mapterhorn.com/) terrain tiles (terrarium encoding, PMTiles) | Elevation for 3D mesh and hillshade | Italy 10 m country-wide, Bozen 2.5 m, Trentino 5 m, Austria 1 m, Switzerland 2 m. Static | Check attribution page for the Bozen and Trentino datasets |
| Snow cover | [Copernicus Snow Cover Extent Europe, 500 m](https://land.copernicus.eu/api/en/products/snow/snow-cover-extent-europe-v1-0-500m) | Fraction of ground covered by snow per pixel, 0 to 100 percent | 500 m, daily, near real time | Optical, so clouds leave gaps. 500 m is coarse for narrow valleys |
| Station measurements | [South Tyrol Open Data Hub](https://databrowser.opendatahub.bz.it) and the provincial open data catalogue (about 120 stations) | Snow depth, temperature, precipitation, wind per station, with coordinates and elevation | 10 to 15 minute readings, but cadence varies per station | Province moved its weather site in January 2026; confirm open data endpoints still work as before |
| Station measurements, north side | [lawinen.report](https://lawinen.report/weather/stations) (Tirol, about 200 stations) | Same variables for Tirol, useful for the northern border | Near real time | Access method for programmatic use unverified; may need scraping or a data request |
| Basemap | [OpenStreetMap](https://www.openstreetmap.org/copyright) via a [Protomaps](https://protomaps.com/) daily build, cut to South Tyrol and self-hosted as one PMTiles file (about 90 MB, up to zoom 14) | Roads, railways, rivers, lakes, land cover, place names, buildings (3D at close zoom) | Refreshed manually (`npm run basemap`), monthly is plenty | ODbL attribution required. Fonts and icons are self-hosted too |
| True-colour satellite image | [Sentinel-2 L2A](https://dataspace.copernicus.eu/) through the Copernicus Data Space Sentinel Hub API | What the region actually looks like, so fresh snow shows up white on the real mountains | 10 m, a new pass every 2–5 days, clouds permitting | Needs a CDSE OAuth client. 10 m pixels look soft at village zoom |
| Weather and forecast | [Open-Meteo](https://open-meteo.com/en/docs/ecmwf-api) | Point weather, snowfall, snow depth model output, hourly, up to 15 days. Downscaled to a chosen elevation | ECMWF 9 km globally; a finer regional model (ICON-D2, about 2 km) is much better in mountains | Free tier is for non-commercial use; check terms. Model snow depth is a derived estimate, not a measurement |

**Two things to verify in the first hour of the build**, because they decide the design:

1. Whether the Copernicus snow product is still produced and how to fetch it programmatically (direct download with registration, or through the Copernicus Data Space Sentinel Hub API). Fallback: NASA MODIS or VIIRS daily snow cover.
2. The exact Open Data Hub endpoints and field names for snow depth, and whether the browser can call them directly or needs a proxy because of CORS.

The sources above come from search results, not from calling the APIs, so treat endpoint details as unconfirmed until the first spike.

## Architecture

```text
Open Data Hub (stations) ---+
Copernicus snow cover -------+--> Scheduled pipeline --> static JSON + PNG files --> Browser app (read-only)
Open-Meteo (V3 forecasts) ---+    fetch, validate, snow model                         3D map, data layers, panels
                                                                                          ^            ^
Mapterhorn terrain tiles (direct) --------------------------------------------------------+            |
Open-Meteo point forecast on click (direct) ---------------------------------------------------------+
```

A scheduled backend job fetches the snow, station and forecast feeds, runs the snow model (the one piece of custom logic), and stores finished files. The browser reads those files and never calls the provincial APIs itself.

**Key technical decisions**

- **Frontend:** TypeScript, Vite and MapLibre GL JS. Terrain is a raster-dem source in terrarium encoding with hillshade on top. Stations are a GeoJSON circle layer
- **Snow layers as small images:** South Tyrol at 250 m is well under one megapixel, so the backend renders snow cover and snow depth as one colour-coded PNG each, placed over the terrain as a map image source. No tile server needed. Confirm in the MVP that the image drapes correctly on 3D terrain
- **Backend as a scheduled job:** a Node script on a schedule (every 30 minutes for stations, daily for satellite) writes static JSON and PNG files. No always-on server. Proposed free hosting: a public GitHub repository where a scheduled GitHub Actions workflow runs the pipeline and publishes the built app plus the generated files to GitHub Pages. GitHub pauses scheduled workflows in repositories with no activity for a while, so verify the current rules and check the schedule now and then
- **Click forecasts without a server:** the browser calls Open-Meteo directly when you click a point, and caches the answer for an hour. Friends-only traffic stays far below the free limits. Confirm in the spike that Open-Meteo accepts browser calls
- **Repository layout:** `web/` for the app, `pipeline/` for the fetch and model code, `fixtures/` for saved API responses used in tests

**Hosting options.** You need a GitHub account either way, because Claude Code works in a repository and both hosts deploy from it. The scheduled data job runs on GitHub Actions in both cases, since Vercel's free plan cannot run jobs more often than daily.

| Option | How it works | Good for this app | Limits to know |
| --- | --- | --- | --- |
| GitHub Pages plus Actions (recommended) | GitHub serves the website and runs the scheduled job. One service, one account | Actions is free for public repositories. Fewest moving parts | Scheduled runs can be delayed. In a public repository they are disabled after 60 days without activity, so push a small change now and then |
| Vercel Hobby plus Actions | Vercel serves the site and redeploys on every push. Actions still runs the data job | Easiest setup and preview links, and optional serverless functions later | Free plan is for personal, non-commercial use, which fits. Its own scheduler allows one run per day with up to an hour of imprecision. Every data refresh that redeploys counts toward 100 deployments per day |

If you prefer Vercel, nothing else in the plan changes, only where the built site is published.

## Estimating snow depth at every point

The estimate combines three inputs: station depth gives the amount, elevation gives the shape, and satellite snow cover says where snow can exist at all. The result is a grid of depths over South Tyrol at about 250 m resolution, recomputed whenever new data arrives.

1. **Collect** the latest snow depth, elevation and coordinates for every station with a valid reading. Drop stations with missing or implausible values (negative, or above 5 m).
2. **Fit the elevation trend.** Snow depth rises with altitude, so fit a simple regression of depth on station elevation. Fit it per sub-region (for example Etsch valley, Pustertal, Dolomites, main Alpine ridge) if one global line fits badly.
3. **Spread the residuals.** Each station's difference from the trend is interpolated across the map with inverse distance weighting, so a station that reads far above the trend lifts its surroundings.
4. **Evaluate on the terrain grid** using the Mapterhorn elevation for each cell.
5. **Mask with satellite snow cover.** Where the snow product says under about 15 percent cover, set depth to zero. Where it is cloudy, keep the estimate but mark it as lower confidence.
6. **Attach a confidence value** per cell, based on distance to the nearest station and whether the cell is above the highest station elevation.

In formula form, with h the cell elevation, S\_i the station depths and r\_i their residuals:

```latex
S(x,y) = \max\bigl(0,\; a + b\,h(x,y) + \sum_i w_i(x,y)\, r_i\bigr), \qquad r_i = S_i - (a + b\,h_i)
```

**Honest limits, which the app should show to the user**

- Most stations sit in valleys and mid-altitudes. Above roughly 2500 m the estimate is extrapolation
- Wind moves snow from ridges into gullies, so real depth varies far more than any smooth map
- The satellite product is 500 m, so narrow north-facing valleys may be wrongly shown as snow-free
- Label the layer "estimated" in the interface and show the confidence layer as a toggle

**Validation:** run leave-one-out cross-validation (hide one station, predict it, compare) and show the mean absolute error in the app's info panel. This is cheap and tells you whether the method is trustworthy this winter.

**Later improvements, not for the first version:** add recent snowfall from the forecast model as a correction after storms, use slope and aspect from the terrain model, and compare against the finer-resolution snow model approach used by the Swiss SLF as a benchmark for what a good result looks like.

## Features and interface

The app opens on a tilted 3D view of Bolzano and the surrounding peaks, with one panel for layers and one for details on whatever you click.

| Feature | What the user sees | Phase |
| --- | --- | --- |
| 3D terrain with hillshade | Free tilt and rotate, vertical exaggeration slider (default 1.5), summit labels | MVP |
| Station markers | Dots coloured by snow depth, tooltip with temperature, depth, wind, time of last reading | MVP |
| Click for point weather | Elevation, current conditions and a 7-day forecast for the clicked point, with snowfall bars | MVP |
| OSM basemap | Towns, villages, roads, railways, rivers, lakes, forests, summit and place labels, 3D buildings at close zoom, so the map reads like a miniature of the real valleys | MVP+ (done) |
| "Today from space" layer | Latest cloud-free Sentinel-2 true-colour picture draped over the terrain, with its acquisition date; cloud gaps filled from the newest older clear day | V2 (done) |
| Snow cover layer | Satellite snow fraction draped over the terrain, with date and a cloud-gap indicator | V2 (done) |
| Estimated snow depth layer | Colour ramp from 0 to 200 cm and above, transparent where no snow | V2 (done) |
| Snow line indicator | Elevation above which snow cover exceeds 50 percent, shown as a number and a contour | V2 (done, number only) |
| Confidence toggle | Grey-out of cells far from any station or above the highest station | V2 (done) |
| Time slider | Step through the last 14 days of snow cover, depth and station readings; days before the first deploy are rebuilt from cached Sentinel-2 passes (snow cover only) | V3 (done) |
| Forecast animation | Play forecast new snow in 3-hour steps over the next 72 hours, on the 250 m grid with the terrain deciding rain or snow | V3 (done) |
| Shareable view link | The address stores camera position, exaggeration, active layers, slider day and forecast frame, so a friend opens the same view | V3 (done) |

**Interface decisions**

- Default camera: centred near Bolzano, pitch 60 degrees, bearing facing north toward the Dolomites
- Snow depth uses a sequential colour ramp that stays readable on hillshaded terrain, and is colour-blind safe
- On phones the layer panel collapses into a bottom sheet, and the details panel replaces it on tap
- A permanent footer line states data sources, update times and the "not for avalanche decisions" notice
- Every layer shows its own timestamp, because the satellite, station and model data all have different ages

## Build plan

```text
Spike (first hour)
  -> gate: Data confirmed (snow source chosen)
MVP (afternoon to weekend)
  -> gate: MVP review (smooth on a phone)
MVP+ basemap (OpenStreetMap roads, places, rivers, 3D buildings)
  -> gate: basemap review
V2 (a few days; satellite picture, snow cover, snow depth estimate)
  -> gate: Estimate trusted (error acceptable)
V3 (1 to 3 weeks)
  -> gate: Shipped (deployed, tested)
```

Effort ranges are rough estimates. V2 is where the risky part arrives: the snow depth estimate. Claude Code should stop at each gate so you can review before it continues.

| Phase | Concrete tasks | Acceptance criteria |
| --- | --- | --- |
| Spike | Call Open Data Hub for stations and read the field names. Test browser calls against it. Fetch the Copernicus snow product, or the NASA fallback. Call Open-Meteo for one point. Save every response in `fixtures/` | A short report says which endpoints work, whether a backend proxy is needed, and which snow product to use |
| MVP | Vite and MapLibre project. Terrain from Mapterhorn with hillshade. Camera preset over Bolzano. Station markers from cached JSON. Click handler that shows elevation and a 7-day forecast. Footer with attribution | Opens in under 5 seconds on desktop. Tilt and rotate stay smooth on a phone. No console errors. Station values match the official site for three spot checks |
| MVP+ | Self-hosted OSM basemap from a Protomaps extract (PMTiles), self-hosted fonts and icons, muted style under the data layers, 3D buildings | Towns and roads make it easy to find your way. No new external hosts in the browser. No console errors |
| V2 | Manual GitHub Actions workflow that logs in to Copernicus with the repository secrets and verifies the snow cover product. Pipeline fetches the latest cloud-free Sentinel-2 true-colour image (Sentinel Hub Process API, needs a CDSE OAuth client) and serves it as image tiles with its date. Pipeline renders the daily snow cover PNG (VIIRS 500 m) with cloud gaps. Interpolation code with unit tests on fixtures. Snow depth PNG draped on terrain. Confidence layer. Leave-one-out validation with error shown in an info panel | The satellite picture shows today's or the last clear day's snow, with its date. Snow line in the app matches what you see from the window on a clear day. Validation error is displayed and you accept it. Layers show their own timestamps |
| V3 | Time slider over the last 14 days. Forecast snowfall animation. A shareable link that stores camera position and layers. Scheduled jobs in production. README and monitoring for failed fetches | Deployed at a stable address. A failed upstream fetch shows stale data with a warning instead of breaking the app |

## Risks and open questions

The biggest risk is that the snow depth estimate looks convincing but is wrong in places that matter. Everything else is routine engineering.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Snow depth estimate is misleading at high altitude or in unmeasured valleys | High | Confidence layer, cross-validation error shown in app, clear "estimated" label and safety notice |
| Provincial APIs block browser calls (CORS) or change format | Medium | The scheduled pipeline fetches and stores the data, so the browser only reads your own static files |
| Satellite snow product is delayed, discontinued or hard to fetch | Medium | Spike on day one; fallback to NASA MODIS or VIIRS snow cover; app still works with stations only |
| Clouds hide the ground for days | Medium | Show last clear observation with its date, and fall back to the station-based estimate |
| 3D rendering is slow on phones | Medium | Cap terrain zoom, limit mesh detail on mobile, test on a mid-range phone early |
| Licence or attribution terms not followed | Low to medium | Collect required attribution text per source in phase 1, show it in the footer |
| Free API rate limits hit if the app becomes popular | Low | The pipeline caches the bulk data, and click forecasts are cached in the browser for an hour |

**Decisions made, and what is still open**

- [x] Use: personal, shown to friends. Fits the non-commercial terms of the free weather API and of Vercel's free plan
- [x] Hosting: GitHub Pages plus a scheduled GitHub Actions workflow in a public repository. Vercel is a workable alternative, see Hosting options
- [x] Area: South Tyrol only, extend later if needed
- [x] Language: English only
- [x] Experience: a read-only 3D model you orbit and zoom, with layer toggles and click-for-detail. No accounts, nothing saved
- [x] Technology: Vite, TypeScript and MapLibre with no UI framework. The app is one full-screen map, so a framework adds little, and fewer dependencies mean fewer surprises for Claude Code and a lighter page on phones
- [x] Station source: province API plus the Euregio station feed (linea), merged
- [x] Basemap: self-hosted OSM extract instead of a bare terrain model; MapLibre stays, no three.js
- [x] V2 scope adds the Sentinel-2 "today from space" layer next to snow cover and snow depth
- [x] V3: forecast snowfall from an Open-Meteo grid fetched by the pipeline every 6 hours (not from the browser), so it stays inside the free limits; pipeline state carried between scheduled runs in an Actions cache; failures reported as an automatically opened and closed GitHub issue
- [x] GitHub: you have an account. Claude Code runs git init first, then you create the GitHub repository and connect it, and only after that are Pages and the scheduled workflow set up

## Kickoff prompt for Claude Code

Paste this as the first message, then attach or paste the rest of this plan. Edit the bracketed parts once you have answered the open questions.

```text
I want to build a web app: a 3D map of South Tyrol (Italy, centred on Bolzano) that shows terrain with snow cover, estimated snow depth and weather data on top. The full plan is attached; read it first.

Stack: TypeScript, Vite, MapLibre GL JS for 3D terrain, Mapterhorn terrain tiles (terrarium encoding, 512 px). A scheduled Node script (GitHub Actions) fetches upstream data and writes static JSON and PNG files; hosting is GitHub Pages; no always-on server. Click forecasts call Open-Meteo directly from the browser. The app is read-only and English only. [Change if I chose otherwise.]

Start with git init, a .gitignore and a first commit, then tell me so I can create the GitHub repository and connect it. Set up GitHub Pages and the scheduled Actions workflow only after that. Work in this order and stop for my review at each gate:

1. Spike (no app code yet). Call the real APIs and write a short report: Open Data Hub endpoints and field names for snow depth, temperature, wind, precipitation; whether browser calls work or CORS blocks them; how to fetch the Copernicus 500 m snow cover product (or the NASA MODIS fallback); Open-Meteo snow and elevation parameters. Save sample responses in a fixtures folder.
2. MVP. 3D terrain around Bolzano with hillshade, tilt and rotate, station markers coloured by snow depth, click a point for elevation and a 7-day forecast. Acceptance: loads under 5 seconds on desktop, runs smoothly on a phone, no console errors.
3. V2. Snow cover layer, estimated snow depth layer using the method in the plan (elevation regression plus residual interpolation, masked by snow cover), confidence toggle, leave-one-out validation error shown in the app.
4. V3. Time slider, forecast animation, shareable view link, deployment to GitHub Pages.

Rules: the browser may call only the Mapterhorn tiles and Open-Meteo directly, and everything else comes from files the pipeline generated; show data source, timestamp and attribution for every layer; label snow depth as an estimate and include the notice that this is not for avalanche decisions; write tests for the interpolation code using the fixtures; keep a README with how to run, how data flows, and known limits.

Start with step 1 and tell me what you find before writing the app.
```
