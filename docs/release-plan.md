# Release plan

Revised Nov 18, 2026. The tester plan of Nov 7 (`v0.2.0` to `v0.2.2`) is done; what it built is summed up under [Done](#done-v010-to-v022). The longer view is in [`roadmap.md`](roadmap.md), the share picture design in [`share-snapshot.md`](share-snapshot.md).

**The short version:** a lot is built, not all of it is good enough to show. This week **`v0.3.0`** ships only what is already on `dev` or fixes an existing layer, after a review and a check on real phones: the new map look, winter sports, the sun and shade fixes, the analytics events, and one new card (What's new, and a short overview on the first visit). Features that add controls or are still drafts wait: **`v0.4.0`** brings a UI designed for the whole feature set, with sun maps and webcam links in it; the fog note joins when it has been checked against real fog days; the share picture is **`v0.5.0`**.

## How versions are numbered

`MAJOR.MINOR.PATCH`, as in semantic versioning, read for an app (there is no API to keep compatible, so the numbers tell people what to expect):

- **`0.x`** means "not launched": testers and friends, things may still change a lot. **`1.0.0`** is the public launch, the first version we would post where strangers see it.
- **Minor** (`0.2.0` → `0.3.0`): new features. Each one is a release with notes and a What's new card.
- **Patch** (`0.3.0` → `0.3.1`): fixes only, no new feature.
- Data deploys three times a day change no number.

So the number follows the audience, not the amount of work. If this week's release goes only to friends and testers, it is `v0.3.0`. If it is posted publicly (forums, social media), call it `1.0.0` instead: `npm run release 1.0.0`, nothing else changes. A public launch before the name and domain are settled is possible, but a rename after it costs more (links, the picture people remember), see `1.0.0` below.

## Where things stand (Nov 18)

Live: `v0.2.2` (Nov 16). GoatCounter counted about 17 page views from Nov 12 to Nov 18, so the tester link has barely been used yet. A solid first impression matters more than the number of features.

| Work | Where | State | Goes into |
| --- | --- | --- | --- |
| Map look: land cover, softer relief light, valley names, brown for no snow, one place name below zoom 12 | `dev` | Merged, not released | `v0.3.0` |
| Winter sports: slopes by difficulty, lifts (in 3D from zoom 13.3), cross-country, toboggan, ski touring; Winter sports group, legend card on the map, "Map style" group | `dev` | Merged, two days old; review and phone check | `v0.3.0` |
| Sun and shade fixes: no more day light at night, soft detailed shadows, smooth sunrise | [PR #18](https://github.com/adamvalik/tirol-snow-map/pull/18) (`sun-shade` → `dev`) | CI green; review and phone check | `v0.3.0` if fast enough on phones |
| Analytics: health and core-use events (`point`, `timeline`, `locate`, `arrive/link`, `warning/…`, `error/…`) | [PR #19](https://github.com/adamvalik/tirol-snow-map/pull/19) (`claude/exciting-lamport-3t3mcs` → `dev`) | CI green, small | `v0.3.0` |
| What's new and first view card | Not started | | `v0.3.0` |
| Sun maps: first sun, last sun, sun hours for a day; sun or shade hint under the slider | [PR #20](https://github.com/adamvalik/tirol-snow-map/pull/20), stacked on #18 | Built; adds controls | `v0.4.0`, in the new UI |
| UI designed for the whole feature set | Not started | | `v0.4.0` |
| Links to webcams | Not started | | `v0.4.0` |
| Cloud height, step 1: fog and inversion note in the Place tab ([`cloud-height-spike.md`](cloud-height-spike.md) on the branch) | `claude/laughing-shannon-wtds54`, no pull request | Draft: method not checked on real fog days | After it is checked (`v0.4.x`) |
| Share picture: concept, mock-ups, capture spike | `share-picture-concept` (docs and `scripts/share-mockups.mjs` only) | Concept; 5 decisions open | Docs now, the feature in `v0.5.0` |

**Trial merge (Nov 18).** `dev` with #20 (which carries #18), #19 and the cloud height branch merged together: one conflict, two import lines in `web/src/main.ts` (keep both). Typecheck clean, 257 tests pass, build fine, smoke test as on `dev` (only the via ferrata panel check fails, and only in cloud sessions). So holding a branch back costs nothing later.

**Branches.** Fully contained in `dev`, safe to delete by hand: `claude/3d-map-visual-usability-4o9y17`, `claude/great-cerf-qp6etb`, `frontend-c2`. Held branches stay as they are until their version. Never delete `dev`.

## `v0.3.0` – winter release (this week)

Feature freeze on `dev` from Thursday Nov 19: only the items below.

### 1. Review and merge (Wed–Thu)

1. **Review** winter sports (on `dev`) and #18. Findings and their fixes are listed under [Review findings](#review-findings-nov-18).
2. **#19** analytics → `dev`.
3. **#18** sun and shade → `dev`, once its review findings are fixed. If the phone check (4) shows it is too slow, revert the merge on `dev` (`git revert -m 1`, no history rewrite) and keep it for `v0.4.0`.
4. **#20** stays open. When `sun-shade` is deleted after #18's merge, GitHub moves its base to `dev`; do not merge it before `v0.4.0`.
5. **Share picture concept:** a pull request `share-picture-concept` → `dev` (docs only), so all plans live on `dev`.
6. **Cloud height:** no pull request yet (see [Cloud height](#cloud-height-before-it-ships)).

### 2. UI fixes for what ships (Thu Nov 19)

Only what the shipped layers need. The rest waits for the `v0.4.0` UI.

- **Phone quick row** (Snow, Stations, Bivouacs, Ferratas, More) has no Winter sports. Suggested in winter: Snow, Stations, Winter sports, Ferratas, More (bivouacs one tap away in More).
- **Desktop legend card covers popups.** The card in the map's top-left lay over a lift's popup at Col Raiser. Keep popups above it, or hide the card while a popup is open.
- **With Sun and shade on, two time controls on the phone** (the sun row with its own play button and date, above the day timeline). Check whether `dev` with #18 alone shows the same; the sun maps hint line is not in `v0.3.0`. If it does, keep one play button in view and make the dates agree. The labels under the sun slider ran together in the trial build ("Sunrise 07:20NowSunset 16:38").

### 3. What's new and first view (Thu–Fri)

One card with two texts, so the overview comes almost for free. Shown once, in the map's corner on desktop and at the top of the sheet on phones.

- **Returning visitor** whose last seen version is older: "What's new in 0.3.0" with the items of the version's row in the Releases table below (the same list as the GitHub Release, read at build time like `__APP_VERSION__`), and a link to all release notes.
- **First visit:** "What you can do", four short lines: where the snow is, the timeline, tap a place, more layers (winter sports, sun and shade). Shortened from the README.
- Closing it keeps the version in `localStorage`, nothing else. "What's new" also stays reachable from the About tab next to the version.
- Effort S–M. Tests: which text shows for no version, an older and the same version; storage blocked shows the card and does not throw.

### 4. Check on real phones (Fri Nov 20)

Still open from the `v0.2.0` checklist. For a phone to reach a build before the release: `npm run build`, then `npx vite preview --host` on a computer in the same Wi-Fi network.

- iOS Safari and Android Chrome, one desktop browser.
- Lifts in 3D at zoom 14–15: frame rate while panning. If poor, flat lifts on phones.
- Sun and shade while dragging the slider: about 60 ms per position was estimated in Node, never measured on a phone.
- Winter sports and Sun and shade on together: memory, the tab is not reloaded by the browser.
- The What's new card and the sheet on an iPhone with the home bar.
- Link preview in WhatsApp and Signal (open since `v0.2.1`).

### 5. Release (Sat Nov 21, Sunday as buffer)

`npm run release 0.3.0` on `dev`, rewrite the row, pull request `dev` → `main`, merge when green. A suggested row, without what does not make it:

> Winter sports layer (slopes by difficulty, lifts in 3D, cross-country, toboggan and ski touring), new map look (land cover, softer relief light, valley names, brown for no snow), sun and shade without the day light at night, softer and more detailed shadows with a smooth sunrise, What's new card, phone fixes

### 6. After the deploy

- The run log prints Sentinel Hub processing units above 0 (open since `v0.2.1`).
- A week later, read the new analytics events: which layers and places are used, which warnings show. It feeds the `v0.4.0` UI.

### Checklist for `v0.3.0`

- [ ] Winter sports reviewed, findings fixed
- [ ] #18 reviewed, findings fixed, merged
- [ ] #19 merged
- [ ] Share picture concept merged into `dev`
- [ ] Phone quick row decided
- [ ] Legend card does not cover popups
- [ ] Sun and shade on a phone: one play button in view, labels fit
- [ ] What's new and first view card
- [ ] iOS Safari and Android Chrome checked (lifts in 3D, sun and shade)
- [ ] Link preview checked in WhatsApp and Signal
- [ ] Tests, typecheck and smoke test green (CI)
- [ ] Release row written, `dev` → `main` merged, release published

### Review findings (Nov 18)

Filled in by the reviews of winter sports and #18.

## `v0.3.1`

Fixes only: what testers and the phone check find after the release.

## `v0.4.0` – a UI for the whole feature set (December)

Design once for everything planned, then fit each feature in as it is ready:

- **Layout:** the Layers tab and the phone quick row for 7 layers and their groups, by season; one place for time (the day timeline and the hour of the day as one control instead of two); room for the share button and the fog note. Use the analytics of the first weeks: which layers people switch on.
- **Sun maps** (#20): first sun, last sun and sun hours, in the new layout.
- **Links to webcams** in the Place tab: "Webcams nearby", the three nearest within about 10 km with their height, each opening the webcam's page in a new tab. Links only, no thumbnails: a picture from another host would break the rule that the browser calls only the site, Mapterhorn and Open-Meteo. A static file built by a script, like `npm run bivouacs`: OpenStreetMap's `contact:webcam` and `webcam` tags on huts, lifts and summits, plus a short hand-made list of the big providers' cameras (foto-webcam.eu, Panomax, the lift companies) after checking that linking to them is allowed. Spike first: how many cameras OpenStreetMap has in the area. Effort S–M.
- Rule from the roadmap still holds: remove and group, do not add.

### Cloud height, before it ships

The branch `claude/laughing-shannon-wtds54` is a first draft. Before it goes into a release:

- **Check the method on real fog days.** The spike's two weeks had no sea of fog around Bolzano. Collect the province readings (`v1/timeseries`) on a few fog days this winter and compare the note with what was really there: the Sentinel-2 cloud mask on the days it has one, webcams, the forecasters' text. Note when it says fog wrongly, and when it misses fog.
- **Review the code**, as for winter sports.
- **Decide where it sits** in the `v0.4.0` Place tab.
- Then a pull request into `dev`; the `web/src/main.ts` import conflict with #19 is two lines (keep both).

## `v0.5.0` – share picture

Designed and spiked in [`share-snapshot.md`](share-snapshot.md): the visible map resized behind a sheet, a Poster frame (Minimal card for Wide), track pictures first (profile with the snow along it), a picture link copied at share time. Effort M–L, about one to two weeks. Its button needs the `v0.4.0` layout. The decisions it needs:

1. Frame: Poster for 3:4, story and square, Minimal card for Wide, no picker (recommended)?
2. QR code on by default only on Wide (recommended)?
3. "Hide start and end" off by default (recommended)?
4. Story frame inside Instagram's covered zones (recommended)?
5. Name and address printed on every picture: settle the name first, or ship with "South Tyrol Snow" and the `github.io` address (recommended for testers; the name waits for the public launch)?

Also part of it: reading the first `<time>` of a GPX file, shorter picture links in `parseHash`, the `uqr` dependency, a smoke test step for every format.

## Later

- **Cloud height, steps 2 and 3:** a fog and inversion forecast from Open-Meteo pressure levels for the clicked point (in the browser), then shading of the ground under the fog on the map, then perhaps a satellite low-cloud mask.
- **Offline repeat visits and lazy-loaded layers** (roadmap 3 and 7).
- **Accessibility pass** (roadmap 7).
- **Station history:** a season snow-depth curve in the station panel.
- **Region as a configuration entry**, then the Euregio (roadmap 4.2).
- **Orbit video** (after the share picture).
- **A Tally form** instead of the feedback e-mail, if testers do not write.

## `1.0.0` – public launch

When it goes where strangers see it. Before that:

- The name and the domain are settled (roadmap 5; about €5 a year). Renaming after a public launch breaks what people remember, so do it first.
- Real-phone checks pass on iOS and Android.
- A few weeks of tester use with no serious bug left open, and no data outage the monitor missed.
- Good to have, not required: the share picture (it is how a launch spreads) and the accessibility pass.

## Done (`v0.1.0` to `v0.2.2`)

Everything the Nov 7 plan asked for, with what is worth remembering:

- **Versions and releases.** `0.x` semver in `package.json`; version and commit at the end of the About tab and in bug reports. A merge to `main` with a new version is tagged and published by `deploy.yml` after the deploy (see [How to make a release](#how-to-make-a-release)). Data deploys three times a day are not releases.
- **CI on pull requests** (`ci.yml`): tests, typecheck, release check, build and the smoke test, on fixture data.
- **Visit counting with GoatCounter** (`web/src/app/analytics.ts`): an image request, no script and no cookies, off without `GOATCOUNTER_CODE`, on localhost and in automated browsers. Page views carry the version; events once per page load (the list is in the README). The view in the hash is never sent.
- **Feedback:** *Something is wrong* and *Idea* in the About tab open an e-mail to `FEEDBACK_EMAIL` with version, view link, browser and screen size, and the GitHub issue forms for testers with an account.
- **GPX tracks** (`web/src/gpx.ts`, `layers/gpx.ts`, `app/track.ts`): parse, heights from the terrain when the file has none, distance, climb, profile, snow along the track, kept in IndexedDB, never in links. The data API is below; the share picture builds on it.
- **Link preview:** `og.jpg` (1200 × 630, under 280 KB for WhatsApp) rendered in the deploy by `scripts/og-image.mjs`, with a cache-busting date.
- **Where am I:** MapLibre's geolocate control behind one round button; the position stays on the device.
- **Avalanche warning region** of a place, named with a link to its service's bulletin (avalanche.report has no link to a single region). Never a danger level.
- **New snow at stations:** 24/48/72 h depth change from the Euregio feed.
- **Keeping it running:** the deploy workflow re-enables its own schedule (GitHub switches it off after 60 days without commits) and opens an issue at 50 days; Sentinel Hub and Open-Meteo use is counted in `status.json` with an issue at 80 % of the free limits; `model-error.json` keeps the depth model's daily error for 400 days.
- **Hosting:** GitHub Pages is enough for testers and likely a regional launch (most of a first visit's 7–12 MB is Mapterhorn tiles). The real limits are the upstream quotas. If the basemap passes 100 MB (Euregio), Cloudflare R2 for that one file.
- **Domain:** postponed until the name is settled. Old `github.io` links keep working after a custom domain, because GitHub redirects them.

## Reference: GPX data API

For the share picture and anything else that uses the track.

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

## How to make a release

1. On `dev`: `npm run release 0.3.0` (`scripts/release.mjs`). It bumps `version` in `package.json` and `package-lock.json` and adds a row to the Releases table below, drafted from the commit subjects since the last tag. Rewrite the row's "What" into short user-facing notes: a comma-separated list, one item per change (commas inside brackets do not split). Commit.
2. Open the pull request `dev` → `main`. CI's release check (`ci.yml`, job `check`) fails if the version is not above the last tag, is tagged already, or has no row, and prints the notes as they will appear. Merge when green, or turn on auto-merge.
3. The deploy publishes it. Once the live site serves the build, `deploy.yml` (job `release`) tags the deployed commit `v0.3.0` and publishes the GitHub Release with the row as a list. Nothing to tag or publish by hand.

A merge without a version bump only deploys. If the release job fails, the next deploy from `main` (at most 8 hours later) tries again; it can also be started from the Actions tab (*Update data and deploy*, Run workflow). A tag pushed by hand still works: `release.yml` checks it against `package.json` and `main` and publishes the release. The notes can be edited on GitHub after publishing.

## Releases

| Version | Date | What |
| --- | --- | --- |
| `v0.2.2` | Nov 16, 2026 | Roads and places come back by themselves after a failed download (no reload needed), clearer new-snow note, sun slider stays on the chosen day at its end, calendar opens with a click on the date, releases tagged and published automatically after the merge |
| `v0.2.1` | Nov 13, 2026 | Link preview for shared links (daily picture of the map), "Where am I" location button, avalanche warning region named in the place panel with a link to its bulletin, upstream quota tracking with an issue near the free limits, daily log of the snow depth model's error, deploy schedule kept alive past 60 days without commits, draft GitHub Release on a version tag |
| `v0.2.0` | Nov 12, 2026 | Euregio station feeds with frozen-upstream checks, 24/48/72 h snow depth change at stations, GPX tracks (load, measure, draw, keep), new UI (design C2), feedback links and anonymous visit counting (off until configured), CI on pull requests |
| `v0.1.0` | Nov 7, 2026 (tagged after the fact) | Everything in roadmap section 1: 3D terrain, stations, snow from space, depth estimate, satellite photo, day slider, forecast animation, share links, bivouacs, favourites, via ferratas, sun and shade, island cut, layer registry |
