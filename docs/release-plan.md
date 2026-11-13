# First release – friends and testers

Nov 7, 2026, backend plan added Nov 9 (section 10). Builds on [`roadmap.md`](roadmap.md) and [`share-snapshot.md`](share-snapshot.md)

Goal: hand a link to a small group of friends, see whether they use it, and hear what breaks. The new UI is being built in parallel; everything below is either needed before the link goes out or cheap enough to ride along.

## Scope at a glance

| # | Item | Needed for v1? | Effort |
| --- | --- | --- | --- |
| 1 | App version and release tags | Yes | S |
| 2 | Visit counting (GoatCounter, decided) | Yes | S |
| 3 | Bug report / idea button | Yes | S |
| 4 | GPX upload | Yes | M |
| 5 | Link preview (og tags + daily `og.png`) | Yes, it is how the link looks in chats | S–M |
| 6 | Live location ("Where am I") | Nice to have | S |
| 7 | Share picture for Strava etc. | After v1 (v1.1) | M–L |
| 8 | Domain | No, postponed until after testing | S |

Hosting stays on GitHub Pages (see 9).

## 1. Versions and releases

There are two kinds of deploy and they should not be confused:

- **Data deploys**, three times a day from `main`: same code, fresh data. Not a release.
- **Code releases**: a new version of the app. These get a tag.

Plan:

- **Semantic version in `package.json`.** What is live today (MVP, V2, V3 and everything beyond the plan, up to the layer registry) is **`v0.1.0`**, tagged on `main` at `444afeb`. Still `0.x` because nobody outside has used it yet. Testers' release is **`v0.2.0`**, the share picture **`v0.3.0`**; patch versions (`0.2.1`) for fixes; `1.0.0` for a public launch.
- **Tag and GitHub Release** for each version: `git tag v0.1.0`, a Release with short notes ("What's new"). Notes double as a changelog; no extra tool (changesets etc.) needed at this size.
- **Version in the app** (done Nov 7): Vite `define` injects `__APP_VERSION__` (from `package.json`) and `__APP_COMMIT__` (short SHA from `GITHUB_SHA` in CI, `dev` locally). Shown at the end of the About tab as "Version 0.2.0" and "Build 3972dcd" with a link to the release notes, and sent along with bug reports (3) as `v0.2.0 (3972dcd)` and with analytics page views (2).
- **Data age stays separate**: the data-age line (roadmap 2.4) already tells when data was refreshed.
- Optional later: a small "What's new" toast once per version (remember the last seen version in localStorage).
- Keep deploying from `main` for now. If `main` should be able to move ahead of what testers see, switch the deploy to check out the latest `v*` tag and use `main` only for development; not needed for a handful of friends.

## 2. Analytics – is anyone using it?

GitHub Pages has **no visitor analytics**. The repository's *Insights → Traffic* counts visits to the repository on github.com, not to the Pages site. So something small has to be added. Building our own is not worth it (would need a server to receive the counts).

Options, all free at this scale:

| Tool | Cost | Cookies / banner | Notes |
| --- | --- | --- | --- |
| **GoatCounter** (recommended) | Free for non-commercial use | No cookies, no banner needed | One script tag, open source, simple dashboard, custom events ("gpx-loaded", "share") via `goatcounter.count()` |
| Cloudflare Web Analytics | Free | No cookies | Works without moving DNS to Cloudflare; only page views, no custom events |
| Umami Cloud | Free tier (~100k events/month) | No cookies | Nicer dashboards, custom events |
| Google Analytics | Free | Cookies, needs consent banner in the EU | Overkill and against the "keep it simple" rule |

Recommendation: **GoatCounter**. Count page loads plus a few events that answer real questions:

- which layers get switched on (are via ferratas or sun and shade used at all?),
- GPX loaded, share picture made, bug report opened,
- app version (as a parameter), so it is visible when testers are on an old cached copy.

Privacy: no cookies and no personal data, so no consent banner; one sentence in "About the data" ("Anonymous visit counts via GoatCounter"). Skip counting on `localhost`.

Since the share link lives in the hash, only `/` shows up as a page; layers and places are not leaked into analytics unless sent on purpose.

## 3. Bug report and ideas

Friends mostly do not have GitHub accounts, so GitHub Issues alone is not enough.

Plan: one **"Feedback"** item in "About the data" (and the menu of the new UI) with two choices, *Something is wrong* and *Idea*, opening a short form.

| Option | For testers | For you | Notes |
| --- | --- | --- | --- |
| **Tally or Google Form** (recommended for v1) | No account, works on phones | Answers in a sheet / email | Prefill hidden fields from the URL: version, commit, the current view link, device (user agent), screen size |
| GitHub issue link with template | Needs a GitHub account | Lands in the repo | Keep as the second link for technical testers; add `.github/ISSUE_TEMPLATE/bug.yml` and `idea.yml` |
| `mailto:` with prefilled body | Opens mail app | Inbox | Zero setup fallback |

The view link matters most: "what was on the screen" is then one click away. A screenshot field is optional (Tally free supports file upload).

Later, if wanted: a tiny Cloudflare Worker that turns form posts into GitHub issues, so everything lands in one place. Not for v1.

## 4. GPX upload

Already designed in [`share-snapshot.md`](share-snapshot.md) ("GPX tracks on the snow"). For v1:

- "Add GPX track" in the layer card: file input, parsed in the browser with `DOMParser`; nothing is uploaded anywhere.
- Drawn as a line on the 3D terrain with start and end markers; the map flies to fit the track.
- Small summary in a panel: distance, climb, highest point, share of the track on snow (from the snow-from-space layer for the chosen day).
- One track at a time; a remove button. Remember the last track in IndexedDB so it survives a reload (per device only).
- Not in the share link (tracks are too big for a URL and are personal). Share pictures will include it later.
- New layer module `web/src/layers/gpx.ts` following the registry pattern (roadmap 3).
- Tests: parse fixtures (track with and without elevation, with several segments, routes `<rte>` as well as tracks `<trk>`, a broken file).
- Analytics event `gpx/add`.

**Status (Nov 12): built and released in `v0.2.0`.** The logic and the layer came first; the control and the panel came with the new UI (`web/src/app/track.ts`).

- `web/src/gpx.ts`: `parseGpx` (GPX 1.0 and 1.1, any namespace; tracks win over routes when a file has both; bad points and one-point segments are dropped; a segment keeps elevation only if every point has it), `trackStats` (distance without the gaps between segments, climb with the via ferrata hysteresis, now in `shared/geo.ts`, highest and lowest point), `trackProfile` and camera helpers. Clear messages for broken XML, other XML, waypoints only, a file over 25 MB and a track outside the map area.
- Tracks without elevation (most planned routes) get it from the terrain model: a point every 10 m, read from the ~26 m Mapterhorn tiles, or the 250 m grid when the track spans more than 48 tiles (`terrainAlong` in `terrainSampler.ts`).
- `web/src/gpxStore.ts`: the file's text in IndexedDB (one entry), so a newer parser reads old tracks too. Storage blocked: the track works until the page closes.
- `web/src/layers/gpx.ts` draws the purple line with a white casing (above the via ferratas, below labels), green start and red end dots, a label "Seiser Alm & Schlern  5.2 km" halfway along, and a wide invisible line for taps. It opens no panel itself.
- The layer has no switch (`keys: []`), so nothing about it reaches the link.
- Tests: `web/test/gpx.test.ts` with fixtures in `fixtures/gpx/`. Checked in headless Chromium: load with progress, errors, terrain fill, label, snow along the track on two slider days, reload, remove.

What the new panel and controls can use:

| Need | API |
| --- | --- |
| Load, with a "Reading …" state | `loadGpxFile(file, onProgress)` resolves with a `ShownTrack` or throws a `GpxError` (message for the user). `onProgress` gets `{ stage: 'reading', fileName }`, then `{ stage: 'parsed', title, kind, terrain }`; `terrain: true` means heights are now being read from the terrain model. A newer load or a remove drops an older one. |
| Remove, show the whole track again | `removeGpx()`, `flyToGpx()` (a load flies there by itself) |
| Track came or went | `onGpxChange((track, why) => …)` with `why` `'loaded'`, `'restored'` (kept from the last visit, drawn without moving the camera) or `'removed'`; `gpxTrack()` for the current one |
| Tap on the line | `onGpxSelect((track) => …)`; a tap there opens no point panel |
| Numbers | `ShownTrack`: `title`, `stats` (`distanceM`, `ascentM`, `descentM`, `highest` [lon, lat, ele], `lowestM`; elevation ones null without heights), `source` (`'file'`, `'terrain'` or null), `fileName`, `track.kind` |
| Elevation profile | `ShownTrack.profile`: `points` every 25 m with `distM` (gaps not counted), `ele`, `segment` (break the line where it changes), plus `distanceM` and `highestAtM` |
| Snow along the track, for the day on the map | `gpxSnow()` → `SnowAlong` or null: `route` (`snow` and `unseen` shares, `lowestSnowM`, `maxDepthCm`), `points` (`'snow'`, `'bare'`, `'unseen'` or null for each profile point, same order), `sensor`, `date` (newest pass), `day` (slider day, null for latest), `depth`. `onGpxSnow(cb)` calls again on a new track, when the snow loads and when the day slider moves. |
| Forecast for a coordinate | `getForecast(lat, lon, elevation, signal)` (forecast.ts), drawn alone by `forecastHtml` (panel.ts). Works for a track's highest point and for stations. |
| Sun for a coordinate | `sunHereAt(lon, lat)` (layers/sun.ts) → `SunHere`, drawn by `sunHereHtml`; skylines are kept for the last 8 places, so asking again is instant. `onSunDayChange(cb)` when the sun slider moves to another day; `sunDate()` is the day used. |
| Toast with icon and action | `toast(text, { icon, action: { label, run }, durationMs })` (app/toast.ts); with an action it stays 8 s |

The UI on top (`web/src/app/track.ts`): "Add a GPX track" in the Layers tab (choose a file, or drop it on the map), a reading state, the track's row, and its Place panel with the numbers, an elevation profile with the snow-covered stretches marked, and the forecast at the highest point. Loading a track counts the analytics event `gpx/add`. A track can still be loaded from the console: `__snowmap.gpx.loadFile(file)` or `__snowmap.gpx.load(text, 'name.gpx')`.

## 5. Link preview

Designed in [`share-snapshot.md`](share-snapshot.md) ("Link previews"). Worth doing for v1, because the first thing testers see is the link in a chat. `og:` and `twitter:` tags in `index.html`, plus `og.png` (1200 × 630) rendered by the deploy workflow with Playwright from today's default view. Needs an absolute URL, so it is easiest to do after the domain decision (8), or with the Pages address and changed later.

**Built Nov 13 (for `v0.2.1`).** Tags in `web/index.html`, filled from `SITE_URL` (a repository variable, defaulting to the Pages address) by `vite.config.ts`. `scripts/og-image.mjs` renders the picture in the deploy after the build: the default view a little wider and steeper (more peaks, a strip of sky), panels hidden, a centred card with the icon, the name and "Snow on <day of the data>", credits in the corner. Two changes from the plan: it is **`og.jpg`**, not PNG, kept under 280 KB because WhatsApp drops larger pictures (a PNG of terrain is around 1 MB); and the card is centred, because WhatsApp and Signal often show a square cut from the middle. The address carries the build date (`og.jpg?v=20261113`) against chat apps' caches. If rendering fails, the deploy copies the live site's picture. The build job moved to `ubuntu-24.04`, like CI, for Playwright 1.56. **To do: check the preview in WhatsApp and Signal after the next deploy.**

## 6. Live location ("Where am I")

Roadmap 2.5 kept this for later; small enough to add now. **Built Nov 13** (`web/src/app/locate.ts`): a round location button under the map buttons on desktop and phone, with the toast outside the data area. MapLibre 6 has no heading arrow, so there is none. The smoke test checks it on desktop.

- MapLibre's built-in `GeolocateControl`: blue dot, accuracy circle, heading on phones, optional follow mode. Pages is HTTPS, which the browser requires.
- One round button near the zoom controls (fits the "every control earns its place" rule, since on a hike this is the first question).
- Outside the data area: still show the dot, plus a short toast "You are outside the map area".
- Only asks for permission when tapped; the position never leaves the device and is not in share links or analytics.
- Later, with GPX: "Record track" is a different, much larger feature (background tracking does not work reliably in a web app). Out of scope.

## 7. Share picture (Strava, Instagram)

Fully designed in [`share-snapshot.md`](share-snapshot.md). Larger than the rest, and it depends on the new UI, the name and the icon. Plan it as **v0.3.0**, the first update testers get, which also tests the release flow (1).

## 8. Domain

No reliable free domains exist any more (Freenom is gone, free subdomain services come and go). Cheap and solid options, prices per year roughly:

| Option | Price | Notes |
| --- | --- | --- |
| Keep `adamvalik.github.io/tirol-snow-map` | Free | Fine for testers |
| Free subdomain, e.g. `*.is-a.dev`, `*.pages.dev` | Free | Depends on a third party; `.pages.dev` means moving to Cloudflare Pages |
| `.eu`, `.it`, `.at`, `.cz` | ~€5–12 | `.it` / `.at` fit South Tyrol; `.it` needs an EU resident |
| `.app`, `.dev` | ~€12–15 | HTTPS-only by design, fine on Pages |
| `.xyz`, `.online` etc. | ~€1–2 first year | Renewals cost far more; avoid |

Buy at cost at **Cloudflare Registrar** or Porkbun (no markup, free WHOIS privacy). GitHub Pages supports a custom domain with free HTTPS: a `CNAME` file in the build output plus DNS records, then tick *Enforce HTTPS*.

**Decided (Nov 7): postponed.** The `github.io` address stays through testing. After testing, once the name is settled, buy one at about €5 a year (a `.eu` or similar). The domain follows the name (roadmap 5). If the domain comes later, old links keep working because GitHub redirects the `github.io` address to the custom domain.

## 9. Is GitHub Pages free enough?

Yes, by a wide margin for a tester group, and likely for a public launch in the region.

| Limit (GitHub Pages) | Ours |
| --- | --- |
| Published site up to 1 GB | App + data + basemap well below; basemap is the big file and is under the 100 MB file limit |
| ~100 GB bandwidth per month (soft) | Most first-visit weight (7–12 MB) is terrain tiles from Mapterhorn, not Pages. Even at ~3 MB from Pages per visit that is ~30,000 visits a month |
| 10 builds per hour (soft) | Three scheduled deploys a day |
| Public repo for free Pages | Already public |
| Not for commercial use / no SaaS | Fine for a free hobby app |

What actually limits scale is the **upstream quotas**, not Pages: Mapterhorn terrain tiles (watch their usage policy if visits grow), Sentinel Hub processing units and the Open-Meteo free tier, all used by the pipeline, not per visit. If the Euregio extension (roadmap 4.2) makes the basemap pass 100 MB, Cloudflare R2 (10 GB free, no egress fees) is the next step for that one file.

## 10. Backend and other work alongside the UI

Added Nov 9. The new UI is built in parallel; this is the work that does not touch it (or only adds a link or a button to it).

### 10.1 Needed for `v0.2.0`

| Item | What | Effort |
| --- | --- | --- |
| **CI on pull requests** (done Nov 9) | `.github/workflows/ci.yml`: tests, typecheck, build and the browser smoke test on every pull request, on fixture data (no secrets), with the basemap from production's cache when there is one. Smoke screenshots are uploaded as an artifact, handy for reviewing the UI branch. Before this, pull requests were not checked at all and the smoke test never ran in CI | S |
| **GoatCounter** (2, built Nov 9) | `web/src/app/analytics.ts`: an image request to GoatCounter's counting endpoint instead of its script (no foreign code, one host), off without the `GOATCOUNTER_CODE` repository variable, on localhost and in automated browsers. Page views carry the version as title; events `layer/<key>`, `share`, `about`, `feedback/…`, once per page load. `gpx/add` came with the GPX panel. Variable set Nov 12 | S |
| **Feedback** (3, built Nov 9) | `mailto:` for v1 instead of Tally: *Something is wrong* and *Idea* at the top of "About the data" open an e-mail to the `FEEDBACK_EMAIL` repository variable with version, view link, browser and screen size filled in; GitHub issue forms `.github/ISSUE_TEMPLATE/bug.yml` and `idea.yml`, prefilled from the URL. Without the variable only the GitHub links show. A Tally form can replace the e-mail later. Variable set Nov 12; the new UI's menu links to the same thing | S |
| **GPX logic, without drawing** (4) | A pure module in `shared/`: parse `<trk>` and `<rte>`, several segments, missing elevation, broken files; distance, climb (the ferrata 5 m hysteresis), highest point, share on snow (the ferrata "snow along the route" code). Fixture tests. The layer module then only draws it, so this can land before the new UI | M |
| **Link preview plumbing** (5) | `og:` and `twitter:` tags; a deploy step that renders `og.png` (1200 × 630) with Playwright after the build. Can be built now; it picks up the new look when the UI lands | S–M |
| **Release on tag** (1, built Nov 13) | A workflow on `v*` tags: check the tag matches `package.json`, create a draft GitHub Release. Replaces step 4 of "How to make a release". Built as `.github/workflows/release.yml`; it also checks the tagged commit is on `main`, and fills the draft from the tag's row of the Releases table | S |

### 10.2 Data that comes cheap

The Euregio station feed the pipeline already reads carries more than it uses:

- **New snow at stations** (roadmap 7, done Nov 9). Features have `HSD_24`, `HSD_48`, `HSD_72` (change in snow depth) and `PSUM_6`, `PSUM_48`, `PSUM_72`. Add them as optional fields on `Station` in `shared/types.ts` (optional, so no `SCHEMA_VERSION` bump) and map them in `pipeline/src/sources/linea.ts`; for province-only stations, take the difference from the pipeline's own 14-day history. Effort S. Built from the feed alone: provincial stations get the change from the feed's avalanche-service copy when they merge, which covers 186 of 196 snow stations on the map in the fixtures, so the history fallback was left out. Shown as "Depth change" in the station panel and next to the depth in the tooltip. Also feeds the "new snow since the satellite view" warning, and later a storm correction of the depth estimate (an open item from `plan.md`).
- **Avalanche region for any point** (roadmap 7, built Nov 13). Stations carry `microRegionID` (for example `IT-32-BZ-03 Schnalser Kamm`). For a clicked point, a pipeline script like `bivouacs-run.ts` fetches the EAWS micro-region outlines, cuts them to the grid, simplifies them and commits `web/src/data/regions.json`; the app finds the region of the point and links to that region's bulletin. Effort S–M. Check the licence of the outlines and the exact avalanche.report link format first. **Built:** the outlines are CC0 (`regions.avalanches.org`, the EAWS repository); `npm run regions` keeps the 103 regions valid now that touch the data area, simplified to about 30 m (225 KB, 57 KB compressed, fetched on the first panel). avalanche.report has **no link to a single region** (only `/bulletin/latest` and `/bulletin/<date>`, checked in its code), so the bulletin row names the region in English and the local languages with its id, and links to `avalanche.report/bulletin/latest` for Euregio regions and to the neighbours' services (AINEVA, SLF, Salzburg, Carinthia, Livigno) at the edges.

### 10.3 Keep it running while friends test

- **The schedule can switch itself off.** GitHub disables scheduled workflows in a public repository after 60 days without commits, and data deploys do not count. A monthly step that runs `gh workflow enable` on the deploy workflow, or a warning from `scripts/monitor.mjs` before the 60 days are up. Effort S. **Built Nov 13:** both. A `keep-schedule` job in `deploy.yml` re-enables the workflow through the API on every scheduled run (the approach of the keepalive-workflow action, which restarts the count without dummy commits), and opens an issue once the last commit is 50 days old, in case that ever stops working. It also runs on a manual start, so it can be tried from the Actions tab.
- **Upstream budgets in `status.json`.** Record Sentinel Hub processing units used per run and Open-Meteo calls (273 points per fetch); the monitor opens an issue when monthly use nears the free limit. These quotas, not Pages, are what limits growth (see 9). Effort S. **Built Nov 13:** `pipeline/src/usage.ts` counts Sentinel Hub requests and the processing units from the `x-processingunits-spent` header, and Open-Meteo calls; `status.json` keeps the month's totals (`usage`) against 10,000 PU and 10,000 requests a month (CDSE "Copernicus General") and 10,000 calls a day, 300,000 a month (Open-Meteo); the monitor opens an `upstream-budget` issue at 80 %. **To check after the first live run:** that the PU header arrives (the run log prints the run's PU; 0 PU with requests > 0 means it does not), and that the CDSE dashboard agrees.
- **Model error over time.** Keep each day's leave-one-out error in `history.json`, so a few weeks of testing show whether the depth estimate holds this winter. Effort S. **Built Nov 13** as its own file, `model-error.json`, since `history.json` drops days after 14: one entry per day (method, error, both methods' errors, station count, error per elevation band), kept 400 days. Published with the data, not shown in the app yet.

### 10.4 After `v0.2.0`

- **Region as a configuration entry** (box, station sources, basemap file) instead of the fixed `MODEL_GRID`: prepares the Euregio extension (roadmap 4.2) without changing the area yet. M.
- **Station history**: the feed lists SMET week and winter files per station, enough for a season snow-depth curve in the station panel. M.
- **Offline repeat visits and lazy-loaded layers** (roadmap 3, 7): frontend performance, after the new UI settles.

## 11. Order

1. **Version and tags** (1) – needed by everything else that reports the version. Done.
2. **CI on pull requests** (10.1) – done Nov 9.
3. **New snow at stations** (10.2) – done Nov 9.
4. **Analytics** (2) and **feedback** (3) – built Nov 9; the repository variables `GOATCOUNTER_CODE` and `FEEDBACK_EMAIL` still to set.
5. **GPX logic** (10.1), then the **GPX layer** (4) once the UI is in.
6. **Keep the schedule alive** and **upstream budgets** (10.3).
7. **Avalanche region link** (10.2).
8. **Live location** (6) – if the new UI has room for the button.
9. **New UI** lands (in progress, roadmap 2).
10. **Link preview** (5) – plumbing any time, final `og.png` after the UI.
11. **Release on tag** (10.1), then tag **`v0.2.0`**, write the release notes, send the link.
12. **v0.3.0**: share picture (7). Name and domain (8) after testing.

Items 2, 3, 5 (logic) and 6 do not touch the UI files, so they do not conflict with the UI branch.

### Release checklist for `v0.2.0`

- [x] Version and commit visible in "About the data"
- [x] GoatCounter counting on the live site, not on localhost (built; needs `GOATCOUNTER_CODE`)
- [x] Feedback e-mail opens with version and view link prefilled (built; needs `FEEDBACK_EMAIL`)
- [x] GPX: load, fly to, summary, remove, survives reload
- [ ] Link preview checked in WhatsApp and Signal
- [ ] Tested on iOS Safari and Android Chrome (phone), one desktop browser
- [x] Tests, typecheck and smoke test green (checked on every pull request by `ci.yml`)
- [x] New snow at stations
- [x] Avalanche region link (Nov 13)
- [x] Deploy schedule protected against the 60-day switch-off (Nov 13)
- [x] Release notes written, tag pushed

## How to make a release

1. Bump `version` in `package.json` (and `package-lock.json`): `npm version 0.2.0 --no-git-tag-version`.
2. Commit, merge to `main`; the deploy publishes it.
3. Tag the merge commit and push the tag: `git tag -a v0.2.0 -m "v0.2.0" <commit>` then `git push origin v0.2.0`.
4. `.github/workflows/release.yml` runs on the tag: it checks that the tag matches `package.json` and that the commit is on `main`, then drafts a GitHub Release with the tag's row of the Releases table below as a list. Edit the draft into short "What's new" notes and publish it.

## Releases

| Version | Date | What |
| --- | --- | --- |
| `v0.2.0` | Nov 12, 2026 | Euregio station feeds with frozen-upstream checks, 24/48/72 h snow depth change at stations, GPX tracks (load, measure, draw, keep), new UI (design C2), feedback links and anonymous visit counting (off until configured), CI on pull requests |
| `v0.1.0` | Nov 7, 2026 (tagged after the fact) | Everything in roadmap section 1: 3D terrain, stations, snow from space, depth estimate, satellite photo, day slider, forecast animation, share links, bivouacs, favourites, via ferratas, sun and shade, island cut, layer registry |
