# Cloud height and inversions – spike report (Nov 18, 2026)

**Question:** can the map show how high the clouds reach, so people know whether there is an inversion and how far up a mountain they must go to be above the fog?

**Short answer:** yes, roughly, and step 1 is built. No open source gives "cloud base" or "cloud top" for the Alps directly. But the station networks we already read have temperature, humidity and sun readings at many heights. With the terrain to tell shade from fog, they show a sea of fog and an inversion fairly well. A forecast of the same is possible from Open-Meteo pressure levels (step 2). Satellites are a possible step 3.

## 1. Sources checked

| Source | What it gives | Verdict |
| --- | --- | --- |
| **Station readings** (province API, Euregio feed) | Temperature, humidity, radiation and sunshine at many heights, now | **Use (step 1, built)** |
| **Open-Meteo pressure levels** | Temperature, humidity, cloud cover and height of each level, every hour, 1000–500 hPa | Use for a forecast (step 2) |
| **Satellites** (EUMETSAT MSG / MTG cloud top; Sentinel-2 cloud mask with our terrain) | Cloud-top pressure or height, a low-cloud mask | Maybe later (step 3) |
| Weather balloons | Full profile, twice a day | No: nearest at Udine, Munich and Milan |
| Cloud-height lasers (ceilometers) | Cloud base at one point | No: none with open data found in South Tyrol |
| Webcams | A picture | No: not data, and many hosts |

### 1.1 Station readings

The province API (`geoservices.buergernetz.bz.it/services/meteo/v1/sensors`) has, per station:

| Sensor | Stations | Height range | Below 750 m / 750–1500 / 1500–2250 / above 2250 |
| --- | --- | --- | --- |
| `LT` temperature | 98 | 212–3399 m | 14 / 32 / 30 / 22 |
| `LF` humidity (%) | 97 | 212–3399 m | 14 / 32 / 29 / 22 |
| `SD` sunshine in the last 10 min (s, 0–600) | 61 | 212–2472 m | 14 / 31 / 15 / 1 |
| `GS` global radiation (W/m²) | 52 | 212–2472 m | 14 / 26 / 11 / 1 |

The Euregio feed adds `RH` (a fraction, 0–1), `TD` (dew point, K) and `ISWR` (incoming shortwave radiation, W/m²) for many stations in Tyrol, Trentino and the rest of the Euregio: in the fixture 479 features have `RH`, 394 `TD`, 275 `ISWR`.

### 1.2 Open-Meteo pressure levels

There is **no cloud base or cloud top variable** (`cloud_base_height`, `ceiling` and similar names are rejected). But for each hour there are `temperature_XXXhPa`, `relative_humidity_XXXhPa`, `cloud_cover_XXXhPa` and `geopotential_height_XXXhPa` (the height of the level in metres), checked live for Bolzano with ICON-D2. From one profile we can read an inversion and the top of a humid layer. Caveats:

- In ICON and ECMWF, cloud cover per level is worked out from humidity, not taken from the model's own clouds. ICON-D2 lacks some levels (800, 900, 925 hPa) and fills them in between its neighbours.
- **Models are weak at valley fog**, above all in narrow basins like Bolzano's. Treat a forecast as a hint.
- **Cost.** Many levels mean many variables, and Open-Meteo counts a large request as several calls. On the pipeline's 273-point grid this would use up the free limit. Fetch one profile in the browser when a place is opened instead, as the point forecast does (`api.open-meteo.com` is already allowed).

### 1.3 Satellites

- EUMETSAT publishes cloud-top products for Meteosat (MSG, and MTG with the FCI imager). They are free but need an account in the EUMETSAT Data Store, a new host for the pipeline, and a few km per pixel at our latitude. Their weak spot is low fog, whose top is about as warm as the ground below it.
- Cheaper: lay a low-cloud mask over our terrain. The highest ground still under cloud is roughly the fog top, which also gives a map of the sea of fog. On Sentinel-2 days (every 2–5 days) the scene classification already gives the cloud mask. That works for those days only.

## 2. What the readings showed (step 1)

Readings of the province's stations within 22 km of Bolzano, every hour from Nov 4 to Nov 18 (`v1/timeseries`), and the live readings of Nov 18, 09:40:

1. **Humidity alone cannot find fog.** Sensors read 99–100 % on clear nights at valley floors (dew and frost), and still read 100 % for an hour or two in full morning sun (Laimburg, Gargazon, Sarnthein, Sterzing). A first version that used humidity at night reported "fog up to 970 m" on clear nights, when only the valley floors were saturated and the slopes above were dry.
2. **A dark station is often in shade, not fog.** At 09:40 on Nov 18 the sun stood at 17°. Salurn lies under cliffs with a 42° skyline in that direction, and Auer under the eastern slope with a 23° skyline. Both read little radiation, but they were in the shade. So each station's skyline towards the sun is traced on the 250 m terrain grid first. Only where the sun clears it by 2° does low radiation count as "sun hidden".
3. **Sun readings decide.** In the sun is clear, whatever the humidity says. Sun hidden and humidity of 90 % or more is in cloud. Humidity of 85 % or less is clear (dry air, perhaps under high cloud).
4. **Those two weeks had no sea of fog around Bolzano.** Days were either overcast at all heights or sunny at all heights. The method found: a cloud deck up to about 1500 m on the morning of Nov 17 (in cloud up to Deutschnofen 1470 m, dry from Radein 1551 m, no sun above); an inversion on the night of Nov 6 (2–3 °C warmer at about 2200 m than in the valley); and inversions in the eastern Pustertal and the Dolomite valleys on the morning of Nov 18 (up to 5 °C warmer at about 2000 m than in the valleys). It found nothing on the overcast and sunny days, which is right.
5. **Patchy valley fog is common.** On Nov 18 at 09:40, Auer and Branzoll were dark and humid while Laimburg and Bolzano, at the same height, were in the sun. This is not a layer with a top, so the method needs most stations below the top to be in cloud, and the first clear station to be at least 150 m above the lowest.

## 3. What is built

- **Pipeline** (`pipeline/src/sources/`, `pipeline/src/sunshine.ts`): reads `LF`, `GS` and `SD` from the province and `RH` (or `TD`), `ISWR` from the Euregio feed. Radiation and sunshine count only when read together with the station's other sensors. For each station it decides `sunshine`: true (sun), false (the sun cleared the station's skyline but did not reach it) or null (night, sun below 8°, behind the terrain, no sensor, or in between). The sunshine sensor wins (half of the 10 minutes or more is sun, a tenth or less is none); otherwise radiation is compared with a clear sky (Haurwitz): 60 % or more is sun, 30 % or less is none. `stations.json` gets the optional fields `humidityPct` and `sunshine` (no schema bump).
- **Analysis** (`shared/inversion.ts`): for a clicked point, the stations within 20 km that were read within an hour of the newest one.
  - **Fog** (by day only: at least 3 stations with a sun reading): each station is in cloud, clear or unknown. Every split by height is tried; a split needs at least 2 stations in cloud below (75 % of the known ones) and at least 2 clear above (80 % of those within 1200 m above the split). The split with the fewest stations on the wrong side wins. The result is the highest station in cloud, the lowest clear one, how many of them had sun, and how much warmer it is above.
  - **Inversion** (also at night): the median temperature of the valley stations (within 250 m of the lowest) against every height window of 300 m with 2 stations or more, up to 3000 m. 1.5 °C or more warmer is an inversion.
- **App** (`web/src/air.ts`): one card in the Place tab, only when there is something to say and the readings are under 6 hours old. Not shown while the slider shows an earlier day.
  - "Fog or low cloud up to about 1,100 m. Sun from about 1,400 m, 4 °C warmer. Stations within 20 km, read at 09:40."
  - Without sun above: "… Drier air from about 1,400 m, but no sun measured up there."
  - "Inversion: 3 °C warmer at about 1,500 m. Than in the valley at about 300 m. …"

## 4. Limits

- **Three snapshots a day.** The pipeline runs at about 04:50, 12:50 and 18:50. Only the midday run has daylight, so fog is reported only then; the morning and evening runs can show an inversion. Fog lifts and forms within hours, so the card says when the stations were read.
- **20 km mixes valleys.** A point in one valley also uses stations in the next. The rules reject a mixed picture rather than guess, so the card is often absent.
- **Few sun sensors up high.** Above 2250 m there is one sunshine sensor in South Tyrol; there, humidity of 85 % or less says clear. A cloud top above about 2200 m is less certain.
- **The terrain grid is 250 m.** A narrow gorge can shade a station that the grid sees in the sun, and the other way round; the 2° margin and the "in between" band catch most of it.
- **Not a forecast.** It says how it was when the stations were read.

## 5. Next steps

1. **Forecast profile** in the Place tab from Open-Meteo pressure levels (temperature, humidity, height of each level), for the clicked point and the next hours. Fetched in the browser like the point forecast.
2. **Map shading** of the ground below the fog top, which would look good in 3D. Needs a regional fog top (per valley), not just per point.
3. **Satellite** low-cloud mask with the terrain, if 1 and 2 leave gaps.

Sources: [Open-Meteo forecast API](https://open-meteo.com/en/docs), [Open-Meteo DWD ICON API](https://open-meteo.com/en/docs/dwd-api), [Open-Meteo ECMWF API](https://open-meteo.com/en/docs/ecmwf-api), [Open-Meteo upper-air forecasts](https://openmeteo.substack.com/p/upper-air-weather-forecasts-via-api), [EUMETSAT METIS cloud products](https://metis.eumetsat.int/cloud), [CEDA MSG cloud top height](https://catalogue.ceda.ac.uk/uuid/5ebdfec65fc547fd8a65264f9980a7b2/).
