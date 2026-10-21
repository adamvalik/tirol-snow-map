> Status (2026-10-21): tier 1, the sun slider, is built (`web/src/sun.ts`, see the README). The light direction was checked on the real terrain: with the light from the east, south, west or north, brightness correlates with slopes facing that way (r ≈ 0.7), also with the map rotated.
>
> Tier 2, click a point, is built (`shared/horizon.ts`, `web/src/sunHere.ts`). Two changes from the plan below: it uses the existing 250 m grid in `pipeline/assets/dem-grid.bin` (Web Mercator cells, but rays are measured in true metres on the sphere, so no UTM reprojection is needed), and the first 5 km come from 26 m Mapterhorn tiles fetched on the click, which covers the close ridges the 250 m grid misses. Checks on the real grid: Bolzano gets its first sun on 21 December at about 11:00, behind the slope 1.7 km to the south; the Ortler summit sees the sun about 10–15 minutes before flat-horizon sunrise and after sunset.
>
> Tier 3, cast shadows on the map, is not built. `shared/horizon.ts` is written so the pipeline or a browser worker can reuse its ray marching for it. The prototype code (`shadow.mjs`, `horizon.mjs`) is not in the repository.

# Spike: sun, shade and sunrise/sunset visibility

Date: 2026-10-21. Scope: can the 3D snow map show where the sun shines at a chosen time of day, and where sunrise and sunset are visible from?

## Verdict

Feasible, in three tiers of increasing effort. Tier 1 is an afternoon, Tier 2 is a day or two, Tier 3 is a few days. Everything below was tested on synthetic terrain only, because the sandbox cannot reach the real terrain tiles. The real-data checks are listed in "First steps for the build".

| Tier | What the user gets | Where it runs | Effort |
| --- | --- | --- | --- |
| 1. Sun slider | Hillshade light follows a date and time-of-day control. Slopes facing the sun are bright. No shadows cast by one mountain onto another | Browser only, no new data | Hours |
| 2. Click a point | Panel with the horizon silhouette seen from that spot and the exact times the sun is visible that day, including the gap while a ridge blocks it | Browser, needs a small DEM file | 1 to 2 days |
| 3. Shadow and sunrise layers | Map layer with real cast shadows for a time step, plus a map of the time the sun first reaches each cell and the time it last shines there | Scheduled pipeline, shipped as images | A few days |

## What MapLibre gives us (checked against the installed spec, version 6.15)

- The hillshade layer shades by slope and a light direction. It does not cast shadows, so a valley floor behind a ridge stays bright. Real shadows must come from our own code (Tier 3).
- Properties: `hillshade-illumination-direction` (0 to 359 degrees), `hillshade-illumination-altitude` (0 to 90 degrees), `hillshade-illumination-anchor`, `hillshade-method`, `hillshade-exaggeration`.
- The anchor defaults to `viewport`. It must be set to `map`, otherwise the light turns with the screen when the user rotates the map.
- Direction is the compass bearing of the light source, default 335 (north-west, the cartographic convention), so the sun azimuth from SunCalc can be passed straight in. Not yet checked visually: confirm that slopes facing the sun look bright.
- Altitude cannot go below 0, so at night the layer needs a dark overlay instead of a negative altitude.

## What was built and tested

Files are in the zip: `shadow.mjs` (cast-shadow mask and per-cell sunrise/sunset), `horizon.mjs` (horizon silhouette and exact sun windows for one point), `terrain.mjs` (synthetic terrain), tests and benchmarks. Plain JavaScript with no dependencies except `suncalc`, written so it ports directly to TypeScript. Run with `npm install && npm test`.

Correctness checks, all passing (18 in total):

- Shadow length behind a wall equals height divided by tan(sun altitude), for sun from east, west and south, which also confirms the compass and row-axis conventions (row 0 is north).
- A diagonal sun casts the shadow diagonally; a slope facing away from the sun is self-shadowed below the slope angle and lit above it.
- Earth curvature with refraction: a 1500 m peak 100 km away blocks a 0.6 degree sun on a flat-earth model but not on a round one.
- Horizon angle toward a 100 m wall 200 m away equals atan(100/200).
- The shadow-mask method and the horizon method, which are independent algorithms, agree on all 144,000 cells in a cross-check.
- A ridge 12 degrees high delays visible sunrise to exactly the minute the sun clears it.

## Measured speed (single thread, Node 22, grid covering about 160 x 100 km)

| Task | 250 m grid (0.26 M cells) | 100 m grid (1.6 M cells) |
| --- | --- | --- |
| One shadow mask, sun at 3 degrees | 0.2 to 0.4 s | 3 to 6 s |
| One shadow mask, sun at 12 degrees | 0.2 s | 2 to 3 s |
| One shadow mask, sun at 45 degrees | 0.04 s | 0.7 s |
| Whole day of sunrise/sunset maps (10 to 15 minute steps) | 8 s | 86 s |
| Click a point: 360 degree horizon silhouette | 5 ms | 7 ms |
| Whole-map horizon for one direction | 1.5 s | 20 s |

The synthetic terrain is gentler than the real Alps, so shadow shares were not used as findings. Timing is a fair guide because lit cells, which dominate the cost, take the same time on any terrain.

## Findings that change the design

1. **SunCalc 2.x changed its units.** It returns degrees with azimuth clockwise from north. Older versions and many tutorials use radians measured from south. Pin the version and add a test.
2. **Sunrise differs by about 8 minutes across South Tyrol.** On 21 December sunrise is 06:59 UTC at 10.4 E and 06:51 UTC at 12.5 E. One sun position for the whole map is fine for the hillshade light, but sunrise maps should compute the sun position per band of longitude (every 10 km is plenty and costs nothing).
3. **Curvature and refraction matter for long views.** Beyond about 50 km a distant ridge sinks by 100 m or more. The code includes it, with the standard refraction coefficient.
4. **A precomputed horizon map costs too much to ship at fine resolution.** 53 compass directions at 5 degree steps would be about 14 MB at 250 m and 85 MB at 100 m, uncompressed. The click-a-point approach needs none of it.
5. **Clocks change on 25 October 2026.** Show times in Europe/Rome with `Intl.DateTimeFormat`, never as a fixed offset.
6. **Two small conventions.** SunCalc 2.x altitude is refraction-corrected, and its sunrise means the top edge of the sun. The prototype tests the centre of the sun, so visible-sunrise times can be 1 to 2 minutes later than SunCalc's own sunrise on a flat horizon. Subtract about 0.27 degrees (the sun's radius) from the sun altitude to match.

## Recommended design

- **Tier 1:** a date and time control that sets illumination direction and altitude from SunCalc, with anchor `map`, and a darkening overlay when the sun is below the horizon.
- **Tier 2:** ship one DEM file with the pipeline output, 250 m resolution, 16-bit, about 0.5 MB raw. Click a point, run the horizon profile in the browser (5 to 7 ms), draw the silhouette with the sun's path over it, and list the visible sun windows for the chosen date. This answers "from where can I see the sunrise over that ridge" directly.
- **Tier 3:** the pipeline renders two images for a chosen date: the time the sun first reaches each cell and the time it last shines there. Draw them as a colour ramp. For a time slider with real shadows, precompute one mask per 15 minute step for a few key dates (solstices, equinoxes, today); 50 masks at 250 m are about 1.6 MB per date as 1-bit images.
- **Resolution:** 250 m for the map layers. Local blocking in narrow valleys comes from ridges closer than 250 m, which the grid cannot see. Say so in the interface, and consider a 100 m DEM just for the Tier 2 click calculation (3.2 MB raw) if accuracy matters more than load time.

## Limits to state in the app

- A terrain model has no trees or buildings, so a forest edge or a house does not block the sun in the results.
- Sun times are for clear sky. Cloud and haze are not considered.
- At 250 m the map shows regional shading well but misses small local ridges.
- This is for planning where to look, not a guarantee of what you will see.

## First steps for the build (real-data checks I could not do here)

1. **Build the real DEM grid.** Resample the Mapterhorn elevation tiles (terrarium encoding, Web Mercator) into a metric grid. The prototype assumes square cells measured in metres, so reproject to EPSG:25832 (ETRS89 / UTM 32N) at 250 m. Do not run the code on raw Web Mercator tiles: distances there are stretched by about 1.45 at this latitude. Acceptance: the grid reproduces known elevations to within a few metres, for example Bolzano city centre (about 262 m) and the Ortler summit (about 3905 m).
2. **Verify the light direction.** In a test page, set direction to 90 and anchor to `map` and confirm that east-facing slopes are bright while rotating the map. Then compare the light for one date and time against a known photo or sun-position site.
3. **Port to TypeScript.** Put `shadow.ts` and `horizon.ts` in a shared folder used by both `pipeline/` and `web/`, with the tests ported unchanged.
4. **Build Tier 1, then Tier 2, then Tier 3**, with a review gate after each.
5. **Validate against reality once.** On a clear morning, check three spots (a valley floor, a mid-slope and a summit) against the predicted first-sun time.

## Open questions for the owner

- Which matters most: the live time-of-day light, the click-a-point silhouette, or the precomputed sunrise and sunset maps?
- Is 250 m acceptable for the map layers, with a finer grid only for clicks?
- Which dates should be precomputed for the slider: today only, or the solstices and equinoxes as well?
