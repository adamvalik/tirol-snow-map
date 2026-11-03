# Share snapshot – design

Nov 3, 2026 · Part of the [roadmap](roadmap.md), section 3

## Goal

One tap turns the current view into a picture that looks good as a Strava activity photo, an Instagram story or a chat message, and that brings people back to the site: the address is on it and a QR code opens exactly the same view.

**Success looks like:** after a tour, you open the app, tilt to the valley you were in, tap the camera, pick "Strava" and the picture is in the activity in under 30 seconds, and a friend who scans the code lands on the same 3D view.

## What the picture shows

```text
┌──────────────────────────────┐
│                              │
│                              │
│      3D map, no UI           │
│      (optional GPX track,    │
│       selected point pin)    │
│                              │
│                              │
├──────────────────────────────┤
│ Sella Group      3 Nov 2026  │  ← place name, date of the data shown
│ Snow line 2,150 m · New 18 cm│  ← 1–2 key numbers, depends on layers
│ ▁▂▃▅▇ depth cm   [QR]        │  ← compact legend of active layers, QR
│ snowmap.example  · © OSM …   │  ← address and required attribution
└──────────────────────────────┘
```

- **Map**: rendered at the export size, not a crop of the screen, so a phone in portrait and a desktop in landscape give equally sharp results. Panels, dock, toasts and controls are not in it.
- **Place name**: the nearest summit or place label to the map centre (from `summits.json` and basemap labels), editable before export.
- **Date**: the date of the data shown (slider day or forecast time), not the export time. A forecast frame says "Forecast for Thu 5 Nov, 15:00".
- **Key numbers**, chosen by what is on: snow line from snow cover; depth or new snow at the selected point; for a GPX track its distance, climb and share on snow.
- **Legend**: only for active layers, at most two, in the frame's compact style.
- **QR code** encoding the full view link (the same hash `viewState.ts` writes) plus `ref=snap`. Optional, on by default.
- **Address** in plain text, as short as possible. This is why the custom-domain decision matters.
- **Attribution**, small but legible. Required by the licences: OpenStreetMap (ODbL), Mapterhorn and its sources, and "Contains modified Copernicus Sentinel data 2026" when a Sentinel layer is shown. Build the line from the active layers, reusing the attribution text the app already has.
- **"Not for avalanche decisions"**: one short line when any snow layer is shown, because a picture travels without the app around it.

## Formats

| Preset | Size | Use |
| --- | --- | --- |
| Portrait 4:5 (default) | 1080 × 1350 | Strava activity photo, Instagram feed |
| Story 9:16 | 1080 × 1920 | Instagram and WhatsApp stories; frame moves up to stay clear of the story UI at the bottom |
| Square 1:1 | 1080 × 1080 | Safe everywhere |
| Wide 16:9 | 1920 × 1080 | Chats, desktop wallpaper, slides |

Frame styles to mock up before choosing (decision in the roadmap): **Minimal** (a thin bar at the bottom, map is the hero) and **Poster** (a big place name and number over a soft gradient on the map). Light and dark versions of each, picked automatically from the map's brightness under the frame.

## Flow

1. Camera button in the panel head, next to the link button. Also a "Snapshot of this place" button in the point and bivouac panels, which centres the view on that point first.
2. A small sheet: format preset, frame style, toggles for QR, numbers and place name (with the name editable). A live preview at reduced size.
3. **Share** on phones: `navigator.share({ files: [png], title, url })` when `navigator.canShare({ files })` says yes, so it goes straight to Strava, Instagram or Photos. **Download** on desktop and as a fallback. **Copy image** where the Clipboard API supports images.

## How it works

- **Render off-screen at the export size.** Create a second, hidden MapLibre map (or temporarily resize a hidden container) at the export size divided by a pixel ratio of 2, with the current style, camera, terrain and exaggeration, wait for `idle`, then read the canvas. This avoids the screen's aspect ratio and keeps the visible map untouched. The project uses MapLibre 6.12; reading the WebGL canvas needs either `preserveDrawingBuffer` on that hidden map only (fine, it is short-lived) or reading inside the render callback. Verify which works on iOS Safari early.
- **Custom layers**: cast shadows and the 3D cabins are custom layers. Check they draw in the second map (they may need re-adding). If that turns out costly, v1 can capture the visible map instead and crop to the aspect ratio, accepting lower resolution.
- **Compose** on a 2D canvas: map image, then the frame drawn with canvas text using the self-hosted Noto Sans (already loaded as a web font for UI; make sure `document.fonts.ready` before drawing).
- **QR code**: a small dependency (around 10–20 KB) loaded only when the sheet opens, or a hand-written encoder if no dependency is wanted. Error correction level M so the code survives Strava's compression.
- **Memory on phones**: a 1080×1920 WebGL canvas plus a 2D canvas is fine on recent phones but can fail on older ones. Release the hidden map right after capture, and fall back to 1:1 at 810 px if creating the context fails.
- **No new external hosts.** Everything stays in the browser.

## Your track on the snow (v2)

- "Add a GPX track" in the layer card: a file input, parsed in the browser (GPX is plain XML, `DOMParser` is enough), drawn as a line on the terrain with a start and end marker.
- The camera fits the track with a pleasant pitch and a bearing that looks along it.
- Track numbers: distance, climb (reuse the ferrata climb code with its 5 m hysteresis), highest point and the share of the track on snow (reuse the ferrata "snow along the route" code).
- The track is kept only in memory. It is not put in the share link (too large, and private); the QR link opens the view without it. Say so in the sheet.
- Later, maybe: drag and drop, several tracks, colour by speed. A Strava API connection is out of scope: it needs OAuth and a server, and the GPX export already covers it.

## Link previews (separate, small)

The share link is a hash, which servers never see, so every link previews the same way. Make that one preview good:

- Add `og:title`, `og:description`, `og:image`, `og:url` and `twitter:card=summary_large_image` to `index.html`.
- The deploy workflow renders `og.png` (1200 × 630) after the build with the Playwright already in the toolchain: the default view with today's snow and the date. So the preview in WhatsApp or a Strava comment shows today's snow on the Dolomites.

## Acceptance

- Portrait export on a mid-range phone in under 5 seconds, sharp at 1080 px wide, no UI in the map area.
- Shares straight into the Strava app from iOS Safari and Android Chrome (manual check on both).
- Scanning the QR code from a phone screen photo opens the same camera, layers and day.
- Attribution present for every source in the picture.
- A unit test for the frame layout (text fits, numbers chosen by layers) and a Playwright smoke test that exports each preset without console errors.

## Open questions

- Custom domain, so the printed address is short.
- Minimal or Poster frame, after seeing mock-ups.
- Keep `ref=snap` in the link if no visit counter is added? It costs nothing and lets a counter be added later.
