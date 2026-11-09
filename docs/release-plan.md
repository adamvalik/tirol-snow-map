# First release – friends and testers

Nov 7, 2026 · builds on [`roadmap.md`](roadmap.md) and [`share-snapshot.md`](share-snapshot.md)

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
- **Version in the app** (done Nov 7): Vite `define` injects `__APP_VERSION__` (from `package.json`) and `__APP_COMMIT__` (short SHA from `GITHUB_SHA` in CI, `dev` locally). Shown at the end of "About the data" as `v0.1.0 · 444afeb` with a link to the release notes, and sent along with bug reports (3) and analytics events (2).
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
- Analytics event `gpx-loaded`.

**Status (Nov 9): the part behind the button is built; the button is not.**

- `web/src/gpx.ts`: `parseGpx` (GPX 1.0 and 1.1, any namespace; tracks win over routes when a file has both; bad points and one-point segments are dropped; a segment keeps elevation only if every point has it), `trackStats` (distance without the gaps between segments, climb with the via ferrata hysteresis, now in `shared/geo.ts`, highest and lowest point), camera helpers and the panel summary. Clear messages for broken XML, other XML, waypoints only, a file over 25 MB and a track outside the map area.
- Tracks without elevation (most planned routes) get it from the terrain model: a point every 10 m, read from the ~26 m Mapterhorn tiles, or the 250 m grid when the track spans more than 48 tiles (`terrainAlong` in `terrainSampler.ts`). The panel says where the elevation came from.
- `web/src/gpxStore.ts`: the file's text in IndexedDB (one entry), so a newer parser reads old tracks too. Storage blocked: the track works until the page closes.
- `web/src/layers/gpx.ts`: purple line with a white casing above the via ferratas and below labels, green start and red end dot, a wide invisible line for clicks. Loading draws, flies to the track (pitch 55°, looking from start to end, or to the far point of a loop), opens the point panel at the highest point (summary, snow along the track, sun, forecast) and saves it. A reload draws the kept track without moving the camera. A click on the line reopens the panel; "Remove track" in the panel clears map and storage.
- The layer has no switch (`keys: []`), so nothing about it reaches the link.
- Tests: `web/test/gpx.test.ts` with fixtures in `fixtures/gpx/`. Checked in headless Chromium: load, errors, terrain fill, reload, click, remove.

Still to do: the "Add GPX track" file input (and a remove button) in the layer card, wired to `loadGpxFile(file)` / `removeGpx()` with a toast for a `GpxError`, and `onGpxChange` to show or hide the remove button; then the `gpx-loaded` event once GoatCounter is in. Until then it can be tried from the console: `__snowmap.gpx.load(text, 'name.gpx')`.

## 5. Link preview

Designed in [`share-snapshot.md`](share-snapshot.md) ("Link previews"). Worth doing for v1, because the first thing testers see is the link in a chat. `og:` and `twitter:` tags in `index.html`, plus `og.png` (1200 × 630) rendered by the deploy workflow with Playwright from today's default view. Needs an absolute URL, so it is easiest to do after the domain decision (8), or with the Pages address and changed later.

## 6. Live location ("Where am I")

Roadmap 2.5 kept this for later; small enough to add now.

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

## 10. Order

1. **Version and tags** (1) – needed by everything else that reports the version.
2. **Analytics** (2) and **feedback form** (3) – a few hours together.
3. **GPX upload** (4).
4. **Live location** (6) – if the new UI has room for the button.
5. **New UI** lands (in progress, roadmap 2).
6. **Link preview** (5) – after the UI so `og.png` shows the new look.
7. Tag **`v0.2.0`**, write the release notes, send the link.
8. **v0.3.0**: share picture (7). Name and domain (8) after testing.

### Release checklist for `v0.2.0`

- [x] Version and commit visible in "About the data"
- [ ] GoatCounter counting on the live site, not on localhost
- [ ] Feedback form opens with version and view link prefilled
- [ ] GPX: load, fly to, summary, remove, survives reload
- [ ] Link preview checked in WhatsApp and Signal
- [ ] Tested on iOS Safari and Android Chrome (phone), one desktop browser
- [ ] Tests, typecheck and smoke test green
- [ ] Release notes written, tag pushed

## How to make a release

1. Bump `version` in `package.json` (and `package-lock.json`): `npm version 0.2.0 --no-git-tag-version`.
2. Commit, merge to `main`; the deploy publishes it.
3. Tag the merge commit and push the tag: `git tag -a v0.2.0 -m "v0.2.0" <commit>` then `git push origin v0.2.0`.
4. On GitHub, *Releases → Draft a new release* from the tag, with a few lines of what is new.

## Releases

| Version | Date | What |
| --- | --- | --- |
| `v0.1.0` | Nov 7, 2026 (tagged after the fact) | Everything in roadmap section 1: 3D terrain, stations, snow from space, depth estimate, satellite photo, day slider, forecast animation, share links, bivouacs, favourites, via ferratas, sun and shade, island cut, layer registry |
