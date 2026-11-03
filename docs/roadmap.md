# Roadmap – what is done, what comes next

Nov 3, 2026

The original build plan ([`plan.md`](../plan.md)) is finished: every phase up to V3 shipped, plus several layers that were never in it. This document takes stock and proposes the next round. It has three parts: what exists today, the two themes asked for (a better UI, and pictures that are easy to share), and other improvements worth considering. The snapshot feature has its own design in [`share-snapshot.md`](share-snapshot.md).

Proposals here are from reading the code and docs, not from a screenshot review on real devices. Step 0 below fixes that before any UI work starts.

## 1. What was done

| Phase | What shipped | Notes |
| --- | --- | --- |
| Spike | Endpoints confirmed, fixtures saved, snow product chosen | [`spike-report.md`](spike-report.md) |
| MVP | MapLibre 3D terrain (Mapterhorn), hillshade, station markers coloured by snow depth, click-for-point weather and 7-day forecast | |
| MVP+ | Self-hosted OSM basemap (Protomaps PMTiles, ~90 MB), self-hosted fonts and icons, 3D buildings | Browser still calls only two external hosts |
| V2 | Sentinel-2 true-colour "today from space" with cloud-gap filling; snow seen from space (S2 at ~60 m, Copernicus 500 m fallback); estimated snow depth on a 250 m grid with confidence layer and leave-one-out error | Snow line shown as a number only, the contour was not built |
| V3 | 14-day day slider, 72 h forecast snowfall animation, shareable view links in the URL hash, scheduled deploy to GitHub Pages, monitoring that opens and closes an issue | Deploy now runs three times a day (03:47, 11:47, 17:47 UTC) |
| Beyond the plan | Bivouacs (icons, then 3D cabins from zoom 13), favourite bivouacs in localStorage, via ferratas with A–E grades and snow along the route, sun and shade (time-of-day hillshade, cast shadows in a worker, real sunrise and sunset behind the skyline at a clicked point), "new snow since the satellite view" warning, home-screen icon and web manifest | |

**Size of the app today:** about 4,800 lines in `web/` (of which `main.ts` is ~990 and `style.css` ~1,070), no UI framework, 16 test files.

### Loose ends found while reading

- The README status line still says "V3 built, awaiting review and first deploy". Update it once the deploy is confirmed live.
- `plan.md` is titled "Build Plan" and still reads as the plan for work now finished. Keep it as history and link this roadmap from the README.
- The snow line contour from V2 was never drawn (number only).
- `main.ts` has grown into the place where every layer is wired up. It is the main obstacle to UI work and should be split before it grows further (see 2.6).
- There are no `og:` or Twitter card tags in `index.html`, so a shared link shows as a bare URL in WhatsApp, Signal, Slack and Strava comments.

## 2. Better UI

### 2.0 Step 0: screenshot review

Before changing anything, capture the current app at three sizes (phone 390×844, tablet, desktop 1440×900) in three states (default, a station panel open, forecast playing) with Playwright, and put the shots in `docs/screens/`. Every proposal below gets judged against those shots and re-shot after.

### 2.1 One timeline instead of three sliders

The dock can stack three separate rows: Day (last 14 days), Forecast (next 72 h) and Sun (time of day). On a phone that is a third of the screen, and the first two are really one axis: time.

Proposal: a single timeline from −14 days to +3 days with "Now" in the middle. Left of now it steps through history (snow from space, depth, stations), right of now it plays the forecast. Play runs forward through both. The sun time stays separate, as a small clock control that appears only when "Sun and shade" is on.

### 2.2 Fewer switches, grouped by what you want to know

The layer card has 10 switches up front and 6 more under "More layers". Proposal:

- **Group** them: *Snow* (from space, depth, forecast, uncertainty, cover share), *Mountains* (bivouacs, favourites, via ferratas, stations), *Light* (sun, shadows), *Map* (satellite photo, basemap, labels, hillshade, relief, height).
- **Scenes**: three or four one-tap presets at the top, each setting layers and a camera: "Fresh snow" (snow from space + forecast, high oblique view), "Snow depth" (depth + stations), "Ferrata day" (ferratas + snow, sun on), "Bivouac trip" (bivouacs + favourites). A scene is just a view-state, so it reuses `viewState.ts`.
- **Legends follow the layers**: the snow depth legend is always shown today. Show one legend per active layer, stacked, and none when nothing needs one.

### 2.3 A clear "freshness" header

Every layer has a different age (stations minutes, satellite days, forecast hours). Today the ages are chips spread across rows. Proposal: one compact line under the title, for example "Stations 12 min · Satellite 2 d · Forecast 4 h", coloured amber when stale, tapping it opens "About the data".

### 2.4 Find places

There is no search. A small offline search over what the app already holds (summits, bivouacs, ferratas, basemap place names) that flies the camera there. No geocoding service, so no new external host. Add a "Where am I" button (Geolocation API, stays in the browser) next to it.

### 2.5 Phone polish

- Bottom-sheet details with two heights (peek and full), swipe to dismiss.
- Larger hit targets on the 3D cabins and ferrata lines at phone zoom.
- First-visit hint: one dismissible line explaining tilt and tap, then never again (localStorage).
- Respect `prefers-reduced-motion` for the camera fly-to and forecast autoplay.

### 2.6 Code structure (enables the above)

Split `main.ts` into one module per layer with a common shape (`init(map)`, `setVisible(on)`, `legend()`, `onClick(feature)`), and a small layer registry that drives the switches, the URL state and the legends from one list. This turns "add a layer" from editing five places into adding one file, and makes grouping, scenes and contextual legends straightforward.

## 3. Pictures for Strava and sharing

Full design in [`share-snapshot.md`](share-snapshot.md). In short:

- A **camera button** next to the link button produces a branded image of the current view: the map without UI, a slim frame with the title, date, the active layers' legend, the place name, key numbers (snow line, depth or new snow at the selected point) and the site address plus a QR code that opens exactly this view.
- **Formats:** 4:5 portrait (1080×1350, good for Strava and Instagram feed), 9:16 story (1080×1920), 1:1, and 16:9 for chats.
- On phones it goes straight to the share sheet as a file (`navigator.share({ files })`), so it lands in Strava, WhatsApp or Photos in one tap; on desktop it downloads.
- **Your track on the snow**: load a GPX file (exported from Strava, Garmin, Komoot) and draw it on the 3D terrain, then snapshot. The file stays in the browser. This is the feature that makes a Strava photo genuinely about *your* day.
- **Link previews**: add Open Graph tags and a daily preview image rendered by the deploy workflow, so a pasted link shows today's snow on the Dolomites instead of a bare URL.
- **A short, memorable address** makes the image point back to the site. A custom domain (for example `snowmap.<something>`) is worth more than any amount of design on the frame. Decision needed.

## 4. Other improvements

Ordered roughly by value for effort.

| Idea | What it gives | Effort | Notes |
| --- | --- | --- | --- |
| Slope angle layer | Shades slopes over 30°, 35°, 40°, the classic ski-touring and winter-hiking reference | S | Computed in the browser from the terrain tiles, like the hillshade. Must keep the "not for avalanche decisions" framing |
| New snow 24/48/72 h at stations | Station markers sized or labelled by the change in snow depth, not only the total | S | Data already in `history.json` |
| Snow line contour | Finish the V2 item: draw the line, not just the number | S | From the snow cover grid |
| Link to the official avalanche bulletin per region | Click a point, see its EAWS region name and a direct link to that region on avalanche.report | S–M | Shows no danger level itself, so it stays inside the plan's scope. Showing the level would be a scope change, see decisions |
| Offline and faster repeat visits | A service worker caching the app shell, the latest data files and recently viewed terrain tiles | M | Useful on a hut terrace with one bar of signal |
| Hike-friendly units and readouts | Distance and climb of a loaded GPX, snow share along it (reuses the ferrata "snow along the route" code) | S once GPX lands | |
| North Tyrol | The repository is called *tirol-snow-map*; the plan always meant to add Tirol. Euregio stations already cover it; needs a larger DEM grid, basemap extract and satellite box | L | Biggest single step in usefulness for the north side |
| Privacy-friendly visit counter | Know whether shared pictures bring people to the site (a `?ref=snap` on the QR link) | S | Cookie-less only (for example GoatCounter or a self-counted log). It is a new external host, so it is a decision, not a default |
| Webcam links | Nearby official webcams listed in the point panel, to check the estimate against reality | M | Needs a curated list; no live embedding |
| Orbit video | A 10-second turn around a peak, recorded from the canvas, for Strava or stories | M | After snapshots work; MediaRecorder support on iOS Safari to be checked |
| Accessibility pass | Keyboard reach for all controls, contrast check on chips and legends, screen-reader labels on dock outputs | S | |

## 5. Proposed order

1. **Housekeeping** (half a day): README status, link this roadmap, OG tags with a static preview image, screenshot review (2.0).
2. **Snapshot v1** (2–3 days): camera button, 4:5 and 9:16, frame with title, date, legend, URL and QR, share sheet. Ship it early, it is the feature asked for.
3. **Layer registry refactor** (1–2 days, no visible change): split `main.ts`, tests stay green.
4. **UI round** (3–5 days): grouped layers, scenes, contextual legends, freshness header, single timeline.
5. **GPX on the snow + snapshot v2** (2–3 days): the Strava story.
6. **Small data wins**: slope angle, new snow at stations, snow line contour, bulletin region link.
7. **Then decide** on North Tyrol, offline mode and the orbit video.

## 6. Decisions needed

- [ ] **Name and address.** Keep "South Tyrol Snow" or pick a name that works on a picture? Custom domain or stay on `adamvalik.github.io/tirol-snow-map`?
- [ ] **Look of the snapshot frame.** Minimal (thin bottom bar) or bold (big title and numbers, poster-like)? A mock-up of both before building.
- [ ] **Avalanche bulletin.** Link only (in scope), or also show the official danger level on the map (a scope change from the plan)?
- [ ] **Visit counting.** None, or a cookie-less counter (one new external host)?
- [ ] **North Tyrol** in the next round, or after the winter?
