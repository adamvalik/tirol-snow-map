# Spike report: data sources

Date: 2026-10-20, around 11:45 UTC. Every claim below comes from a real call made that day. The responses are saved in [`fixtures/`](../fixtures/README.md).

## Summary

| Question | Answer |
| --- | --- |
| Station data | Works. Use the **province meteo API v1** (CC0) and the **Euregio station GeoJSON** behind lawinen.report / avalanche.report. Open Data Hub works but is a weaker mirror of the province data: it has no station elevation and returns stale records |
| CORS | Every station, satellite catalogue, Open-Meteo and Mapterhorn endpoint returns `Access-Control-Allow-Origin: *`, and real Chromium `fetch()` calls succeeded. **No proxy is needed.** The browser still reads only pipeline files, as the plan's rules require |
| Snow cover | **Copernicus SCE Europe 500 m is still produced daily**, in a MODIS variant and a VIIRS variant, as NetCDF and as COG. Searching is open, but downloading needs a **free Copernicus Data Space (CDSE) account**. The NASA GIBS fallback needs no login, but it cannot tell clouds from snow-free ground |
| Open-Meteo | Works from the browser. `elevation=` downscales the forecast to a given altitude. Model `snow_depth` is unusable here: it reads 0 cm where a station measures 5.8 cm. Use `snowfall` only |
| Terrain | Mapterhorn tiles are terrarium WebP, 512 px, z0–15 (z16 returns 404), CORS `*`. The South Tyrol 2.5 m DTM inside them is CC0 |
| Biggest surprise | There are only **26 provincial snow depth sensors, all at 1715–3035 m**. With Tirol and Trentino added there are 180 within a buffered bounding box, the lowest at 803 m. No station measures snow depth on the valley floors |

## 1. Station measurements

### 1a. South Tyrol province, meteo API v1 (recommended primary source)

The old host `daten.buergernetz.bz.it/services/meteo/v1/...` now returns 404 with the message "this endpoint has been moved". According to the CKAN catalogue, the new host is `geoservices.buergernetz.bz.it`. The licence is CC0.

| Endpoint | Returns |
| --- | --- |
| `GET https://geoservices.buergernetz.bz.it/services/meteo/v1/stations` | GeoJSON with 229 stations in EPSG:25832 coordinates. Properties: `SCODE`, `NAME_D/I/L/E`, `ALT` (m), `LAT`, `LONG` (WGS84) |
| `GET .../v1/sensors` (optional `?station_code=` and `?sensor_code=`) | Latest values: `[{SCODE, TYPE, DESC_D, DESC_I, DESC_L, UNIT, DATE, VALUE}]`. `DATE` looks like `2026-10-20T13:30:00CEST`, a literal zone name that needs a custom parser. Of 993 rows, 26 have no `DATE` or `VALUE` |
| `GET .../v1/timeseries?station_code=74200MS&sensor_code=HS&date_from=202610060000&date_to=202610201400` | `[{DATE, VALUE}]` at 10-minute steps, newest first. 14 days returned 2098 points, so the V3 time slider can be backfilled |

Sensor codes (`TYPE`) the app needs:

| Variable | Code | Unit | Stations |
| --- | --- | --- | --- |
| Snow depth | `HS` | cm | 26 (23 `…SF` snow-field stations plus 3 `…MS`), elevation 1715–3035 m |
| Air temperature | `LT` | °C | 98 |
| Precipitation | `N` | mm | 60. The accumulation period is not stated: probably per 10-minute interval, to be confirmed in the MVP |
| Wind speed / gust / direction | `WG` / `WG.BOE` / `WR` | m/s, m/s, ° | 83 |
| Also available | `LF` humidity, `LD.RED` pressure, `GS` radiation, `SD` sunshine, `W`/`Q`/`WT` hydrology | | |

Snow sensors read slightly negative values when there is no snow (as low as −2.4 cm today). The pipeline clamps these to 0 rather than dropping them. The plan's "drop negative values" rule would otherwise throw away valid snow-free stations.

**Province API v2** (`https://api-weather.services.siag.it/api/v2/station?categoryId=1|3&lang=en&format=json`, valley and mountain categories) returns one compact row per station with `altitude`, `t`, `hs`, `ff`, `wMax`, `n` and `lastUpdated`. Its drawbacks: numbers come as strings, latitude and longitude use comma decimals (`"46,5417"`), missing values are `"--"`, and `lastUpdated` has no time zone. It has the same 26 snow stations. I keep it as a fallback only.

### 1b. Open Data Hub mobility API (works, not recommended as primary)

- Pattern: `https://mobility.api.opendatahub.com/v2/flat,node/MeteoStation/{datatype}/latest?limit=-1&where=sactive.eq.true`
- Field names: South Tyrol stations (`sorigin=SIAG`) use `snow-level` (cm, "Altezza neve al suolo"), `air-temperature`, `precipitation`, `wind-speed` (m/s), `wind-direction` and `wind-gust-speed`. Trentino (`sorigin=meteotrentino`) uses `snow_depth`, `air_temperature` and `wind10m_speed`
- Record fields: `scode`, `sname`, `scoordinate {x: lon, y: lat}`, `smetadata {name_de, name_it, name_en}`, `mvalue`, `mvalidtime`, `mperiod`, `sorigin`
- Problems:
  - **No station elevation**, which the regression needs
  - Several records per station and datatype, one per `mperiod`, some dating back to 2021. The 201 `snow-level` rows cover only 26 stations
  - Long-term aggregates (`mperiod=86400` and `31536000`) are mixed into the "latest" results
- Verdict: it mirrors the same 26 SIAG snow sensors with less metadata. Its one unique contribution is the Trentino `snow_depth` set (38 stations), which falls outside South Tyrol

### 1c. Euregio stations (lawinen.report / avalanche.report), recommended for coverage

- `GET https://static.avalanche.report/weather_stations/stations.geojson`: 403 stations across Tirol, South Tyrol and Trentino, refreshed about every 10 minutes (`last-modified` header). This answers the plan's open question: **no scraping is needed**
- Geometry is `[lon, lat, elevation_m]`. Properties: `name`, `operator`, `LWD-Region` (for example `IT-32-BZ-03 Schnalser Kamm`), `date` (ISO 8601 with offset), `HS` (cm), `HSD24/48/72` (change in snow depth), `LT`, `LT_MIN/MAX`, `N6/24/48/72`, `WG`, `WG_BOE`, `WR`, `RH`, `TD`, `OFT`, `GS_O`
- 239 stations report `HS`. **180 fall inside a buffered South Tyrol box (10.2–12.6°E, 46.1–47.3°N), spanning 803–3499 m.** South Tyrol itself has 41: the 25 provincial sensors plus 12 Esercito-Meteomont, 3 Eurac and 1 University of Innsbruck
- Wind units are unclear. `WG` does not match the province's m/s values for the same station, and km/h is likely. I treat the province values as the reference for South Tyrol
- **Licence not found.** The website code is AGPL, but the data terms for the third-party stations are not published. The official Tirol source, `https://wiski.tirol.gv.at/lawine/produkte/ogd.geojson`, uses the same schema (221 stations, 119 with `HS`), but I could not confirm its licence either. See the open questions

## 2. Snow cover

### Copernicus Snow Cover Extent, Europe, 500 m, daily, v1 (recommended)

- Status: "Production is on-going according to the plan". The catalogue lists 7832 products, and the newest was for 2026-10-19
- Two variants per day: `c_gls_SCE500_YYYYMMDD0000_CEURO_VIIRS_V1.0.1_{nc|cog}`, published around 15:20 UTC, and `..._MODIS_...`, published around 20:15 UTC. The COG is about 8–9 MB for all of Europe; the MODIS NetCDF is 181 MB. **Use the VIIRS COG.** MODIS runs on Terra, which is at the end of its life, so it stays as the backup variant only
- Search needs no login:
  `https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=Collection/Name eq 'CLMS' and Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'datasetIdentifier' and att/OData.CSC.StringAttribute/Value eq 'sce_europe_500m_daily_v1')&$orderby=ContentDate/Start desc&$top=5&$expand=Attributes`
- Download: `https://download.dataspace.copernicus.eu/odata/v1/Products({Id})/$value`. **Without a token it returns 401** `{"code":"DAT-ZIP-604","message":"Token not found"}`. A token comes from `POST https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token` with `grant_type=password&client_id=cdse-public&username=…&password=…`. The pipeline needs these credentials as GitHub secrets
- Pixel coding, from the product user manual: `100–200` means snow fraction = code − 100 (0–100 %), `30` cloud, `20/21/22` sea, lake and river, `251` polar night, `254` input error, `255` no data, `0` outside the area. The manual warns that the file layout "may differ" from what it describes, so I will verify the coding on the first real download
- Grid: EPSG:4326 at 0.005°. South Tyrol is about 450 × 190 px
- **Update from V2 (real downloads, 20 Oct 2026):** each product downloads as a ZIP holding one single-band COG of all Europe (12200 × 7400 px). Code 30 (cloud) never occurs; clouds and gaps are written as 255, the file's no-data value. The app treats 255 as "no clear view" and fills cloudy cells from the previous days

### NASA fallback

- **GIBS WMS** needs no login and sends CORS `*`:
  `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_NOAA20_NDSI_Snow_Cover&CRS=EPSG:4326&BBOX=46.2,10.3,47.15,12.55&WIDTH=450&HEIGHT=190&FORMAT=image/png&TIME=2026-10-19`.
  The layers `VIIRS_NOAA20_*`, `VIIRS_SNPP_*` and `MODIS_Terra_NDSI_Snow_Cover` are all current to 2026-10-20 at 500 m. `MODIS_Terra_L3_NDSI_Snow_Cover_Daily` returned an empty image
- Limitation: the PNG is a coloured visualisation. NDSI values 1–100 can be decoded through the colormap XML, but **NDSI 0, cloud and night are all transparent**, so cloud gaps cannot be told apart from snow-free ground. NDSI is also not a snow fraction
- Raw MOD10A1 or VNP10A1 data from NSIDC needs a free NASA Earthdata login, so it needs an account just like Copernicus

**Recommendation:** use Copernicus SCE VIIRS with a free CDSE account. Fall back to GIBS snow presence when CDSE fails, and show the layer with a "cloud gaps unknown" warning.

## 3. Open-Meteo

- Forecast: `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&elevation=…&hourly=temperature_2m,precipitation,snowfall,snow_depth,freezing_level_height,weather_code,wind_speed_10m,wind_gusts_10m,cloud_cover&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,weather_code,wind_speed_10m_max&current=…&timezone=Europe/Rome&forecast_days=7`
- Units: `snowfall` and `snowfall_sum` in **cm**, `snow_depth` in **m**, `freezing_level_height` in m, wind in km/h. The response includes `elevation`, the value used for downscaling
- `elevation=3035` makes Open-Meteo downscale temperature to that altitude. Without it, the API uses its own 90 m DEM: Bolzano came back as 273 m, against 267 m from Mapterhorn. For click forecasts the app passes the Mapterhorn elevation
- Elevation API: `https://api.open-meteo.com/v1/elevation?latitude=a,b,c&longitude=x,y,z` → `{"elevation":[273,2426,1963]}`
- Models: `best_match` and `icon_seamless` give 168 h. `icon_d2` gives only about 60 h and `meteoswiss_icon_ch1` about 45 h. `ecmwf_ifs025` gives 168 h. For the 7-day panel I use `best_match`. A later option is to stitch ICON-D2 for the first 2 days
- **Model snow depth check:** at Teufelsegg (3035 m), the station measured HS 5.8 cm, while `snow_depth` from every model was 0–1 cm. This confirms that model snow depth must not feed the depth layer
- Terms: free for non-commercial use, under 600 calls per minute, 5000 per hour and 10 000 per day, licensed CC BY 4.0. Browser calls count against each viewer's own IP. GitHub Actions runners share IPs, so the V3 forecast animation should use a few multi-location requests (comma-separated coordinates) per run

## 4. Mapterhorn terrain

- TileJSON: `https://tiles.mapterhorn.com/tilejson.json`, giving `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` with `encoding: terrarium` and `tileSize: 512`. Tiles exist up to **z15**; z16 returns 404, so the MapLibre source needs `maxzoom: 15`
- Decoding check: Bolzano decodes to 266–267 m at z10, z12 and z14
- Attribution comes from `https://download.mapterhorn.com/attribution.json`. The relevant entries:

| Source | Licence |
| --- | --- |
| South Tyrol DGM 2.5 m (`itbozen`) | CC0 |
| TINITALY 10 m (INGV) | CC BY 4.0 |
| Trentino LiDAR (`ittrentino`) | CC BY 2.5 |
| Austria BEV 1 m (`at1`) | CC BY 4.0 |
| Copernicus GLO-30 | Copernicus free and open licence |

The footer will show "© Mapterhorn" plus these sources.

## 5. Browser CORS test

I ran a real headless Chromium `fetch()` from an `http://localhost` origin:

| Endpoint | Result |
| --- | --- |
| Open Data Hub, province v1 stations / sensors / timeseries, province v2, avalanche.report, Open-Meteo forecast and elevation, Mapterhorn tile, CDSE catalogue, NASA GIBS | OK |
| Tirol OGD (`wiski.tirol.gv.at`) | Returns `Access-Control-Allow-Origin: *` to curl, but Chromium got an empty response even in `no-cors` mode. This is a network problem in the sandbox, not CORS, and it does not matter because only the pipeline fetches it |

Conclusion: **no proxy is needed anywhere.** The pipeline-only rule exists for stability and caching, not because of CORS.

## 6. Early look at the snow-depth method (indicative only)

I ran a throwaway leave-one-out test on today's 180 Euregio `HS` stations, with negative values clamped to 0:

| Method | LOO mean absolute error |
| --- | --- |
| Mean only | 4.1 cm |
| Elevation regression (+0.42 cm per 100 m) | 3.9 cm |
| Regression plus IDW residuals (power 2, no radius limit) | **4.4 cm, worse** |

On 20 October there is almost no snow (median 2 cm, one outlier at 55 cm), so this says nothing about midwinter accuracy. It does show that raw IDW spreads single-station noise. V2 should use a search radius or nearest-k limit and a small smoothing term, and should report error per elevation band.

## 7. What this changes in the plan

1. **Station source:** use the province v1 API for South Tyrol (CC0, with elevation) and the Euregio GeoJSON for neighbouring snow stations, instead of Open Data Hub
2. **Low elevations are unmeasured.** No station measures snow depth below about 800 m, or below 1625 m inside South Tyrol. Valley values will come from downward regression extrapolation masked by satellite cover. The confidence layer should therefore also grey out cells *below* the lowest station, not only above the highest
3. **The Copernicus download needs credentials.** You need a free CDSE account, stored as the repository secrets `CDSE_USERNAME` and `CDSE_PASSWORD`
4. **Clamp small negative snow readings to 0**, and drop only readings below −5 cm or above 500 cm

## Open questions for you

1. Is it OK to use the province API plus the Euregio GeoJSON instead of Open Data Hub as the station source?
2. Can you create a free account at https://dataspace.copernicus.eu and add `CDSE_USERNAME` and `CDSE_PASSWORD` as repository secrets? Until then, the MVP can run without the snow cover layer, or with the GIBS fallback.
3. Are you comfortable using the Euregio station data with attribution ("Data: Avalanche Warning Services Tirol, South Tyrol, Trentino via avalanche.report") while its licence is unconfirmed? The alternative is to restrict the stations to the CC0 province data: 26 snow stations, all at or above 1715 m.
