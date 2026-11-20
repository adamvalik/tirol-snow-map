# GPX track data API

What the GPX track module (`web/src/gpx.ts`, `web/src/layers/gpx.ts`) offers to the track panel (`web/src/app/track.ts`), and to the share picture or anything else that uses the track.

| Need | API |
| --- | --- |
| Load, with a "Reading …" state | `loadGpxFile(file, onProgress)` resolves with a `ShownTrack` or throws a `GpxError` (message for the user). `onProgress` gets `{ stage: 'reading', fileName }`, then `{ stage: 'parsed', title, kind, terrain }`; `terrain: true` means heights are now being read from the terrain model. A newer load or a remove drops an older one. |
| Remove, show the whole track again | `removeGpx()`, `flyToGpx()` (a load flies there by itself) |
| Track came or went | `onGpxChange((track, why) => …)` with `why` `'loaded'`, `'restored'` (kept from the last visit, drawn without moving the camera) or `'removed'`; `gpxTrack()` for the current one |
| Tap on the line | `onGpxSelect((track) => …)`; a tap there opens no point panel |
| Numbers | `ShownTrack`: `title`, `stats` (`distanceM`, `ascentM`, `descentM`, `highest` [lon, lat, ele], `lowestM`; elevation ones null without heights), `source` (`'file'`, `'terrain'` or null), `fileName`, `track.kind` |
| Elevation profile | `ShownTrack.profile`: `points` every 25 m with `distM` (gaps not counted), `ele`, `segment` (break the line where it changes), plus `distanceM` and `highestAtM` |
| Snow along the track, for the day on the map | `gpxSnow()` → `SnowAlong` or null: `route` (`snow` and `unseen` shares, `lowestSnowM`, `maxDepthCm`), `points` (`'snow'`, `'bare'`, `'unseen'` or null for each profile point, same order), `sensor`, `date` (newest pass), `day` (slider day, null for latest), `depth`. `onGpxSnow(cb)` calls again on a new track, when the snow loads and when the day slider moves. |
| Forecast for a coordinate | `getForecast(lat, lon, elevation, signal)` (forecast.ts), drawn alone by `forecastHtml` (panel.ts). |
| Sun for a coordinate | `sunHereAt(lon, lat)` (layers/sun.ts) → `SunHere`, drawn by `sunHereHtml`; skylines are kept for the last 8 places. `onSunDayChange(cb)` when the sun slider moves to another day; `sunDate()` is the day used. |
| Toast with icon and action | `toast(text, { icon, action: { label, run }, durationMs })` (app/toast.ts); with an action it stays 8 s |

A track can also be loaded from the console: `__snowmap.gpx.loadFile(file)` or `__snowmap.gpx.load(text, 'name.gpx')`.
