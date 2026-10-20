# Fixtures

These are real API responses captured during the spike on 2026-10-20, between about 11:43 and 11:52 UTC. The interpolation tests use them, and they serve as reference for the field names. See [`docs/spike-report.md`](../docs/spike-report.md) for what each source means.

| File | Source request |
| --- | --- |
| `province-bz/v1-stations.geojson` | `https://geoservices.buergernetz.bz.it/services/meteo/v1/stations` |
| `province-bz/v1-sensors-all.json` | `…/v1/sensors` (latest value for every sensor) |
| `province-bz/v1-sensors-HS.json` | `…/v1/sensors?sensor_code=HS` (26 snow depth sensors) |
| `province-bz/v1-sensors-74200MS.json` | `…/v1/sensors?station_code=74200MS` (Seiser Alm Zallinger) |
| `province-bz/v1-timeseries-74200MS-HS-14d.json` | `…/v1/timeseries?station_code=74200MS&sensor_code=HS&date_from=202610060000&date_to=202610201400` |
| `province-bz/v2-station-category1-valley.json` | `https://api-weather.services.siag.it/api/v2/station?categoryId=1&lang=en&format=json` |
| `province-bz/v2-station-category3-mountain.json` | same with `categoryId=3` |
| `euregio/avalanche-report-stations.geojson` | `https://static.avalanche.report/weather_stations/stations.geojson` (403 stations, Tirol, South Tyrol and Trentino) |
| `euregio/tirol-lwd-ogd.geojson` | `https://wiski.tirol.gv.at/lawine/produkte/ogd.geojson` |
| `opendatahub/meteostation-datatypes.json` | `https://mobility.api.opendatahub.com/v2/flat,node/MeteoStation/*?limit=-1&distinct=true&select=tname,tunit,tdescription,ttype&where=sactive.eq.true` |
| `opendatahub/meteostation-snow-level-latest.json` | `…/v2/flat,node/MeteoStation/snow-level/latest?limit=-1&where=sactive.eq.true` |
| `opendatahub/meteostation-snow_depth-latest-meteotrentino.json` | same for `snow_depth` (Trentino) |
| `opendatahub/meteostation-*-latest-siag-trimmed.json` | same for `air-temperature`, `precipitation` and `wind-speed`, **trimmed** to SIAG records dated 2026-10-20 to keep the files small |
| `copernicus/cdse-odata-search-sce-europe-500m.json` | CDSE OData search for `sce_europe_500m_daily_v1`, newest 5 (see report) |
| `copernicus/cdse-download-without-token-401.json` | download attempt without a token (the 401 body) |
| `nasa-gibs/*-2026-10-19-southtyrol.png` | GIBS WMS GetMap, bbox 46.2,10.3,47.15,12.55, 450×190 px |
| `nasa-gibs/MODIS_NDSI_Snow_Cover-colormap.xml` | `https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDSI_Snow_Cover.xml` |
| `open-meteo/forecast-bolzano-7d.json` | forecast for 46.4983, 11.3548 with hourly, daily and current snow and weather variables |
| `open-meteo/forecast-teufelsegg-3035m-{model}.json` | forecast for 46.7845, 10.7848 with `elevation=3035`, one file per model |
| `open-meteo/elevation-3-points.json` | `https://api.open-meteo.com/v1/elevation?latitude=46.4983,46.4310,46.5404&longitude=11.3548,11.6397,11.8320` |
| `mapterhorn/tilejson.json` | `https://tiles.mapterhorn.com/tilejson.json` |
| `mapterhorn/12-2177-1449-bolzano.webp` | terrain tile z12 over Bolzano (terrarium encoding) |
| `mapterhorn/attribution-subset.json` | entries for this region from `https://download.mapterhorn.com/attribution.json` |
