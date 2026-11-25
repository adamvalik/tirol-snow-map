# Roadmap – direction and decisions

Where the app is going and the decisions that shape it. Updated Nov 24, 2026. It holds no task lists: the work itself is tracked in GitHub issues and milestones (see [`README.md`](README.md) in this folder). The original build plan is [`initial-plan.md`](initial-plan.md); everything in it shipped by `v0.1.0`.

## Principles

- **One screen, the map first, and every control earns its place.** Improvements remove and group rather than add.
- **Avalanches: link, never assess.** No danger levels, no slope angle layer.
- **Nothing personal leaves the device.** GPX tracks, favourites and the position stay in the browser.
- **Few hosts.** The browser calls only the site, Mapterhorn and Open-Meteo (plus GoatCounter).

## Decisions

Decided, with the date. Open questions are issues.

- **No snow line on the map.** It varies too much by slope and aspect; snow from space and the station dots already show where snow lies (Nov 4).
- **No slope angle layer.** Too close to avalanche assessment (Nov 4).
- **GPX tracks and link previews: yes.** Shipped in `v0.2.0` and `v0.2.1` (Nov 4).
- **Faded surroundings by default, the island as a switch** and as a look for share pictures (Nov 4). See Area.
- **Lazy loading of layers: later** (Nov 4), an idea issue.
- **Visit counting with GoatCounter:** no cookies, free (Nov 7).
- **Versions:** the app before testers was `v0.1.0`, testers got `v0.2.0` (Nov 7). How the numbers work is in [`release-plan.md`](release-plan.md).
- **Domain after testing, once the name is settled,** about €5 a year; `github.io` until then (Nov 7).
- **Logo:** "Sun and shade", one summit with a gentler sunlit side and a steep north face in shade (Nov 23). It needs no snow, so it fits summer and terrain too. It replaces the "Depth bands" icon (Nov 12), which round avatars cut off and whose colours ran against the map's snow ramp. See [`design/logo.md`](design/logo.md).
- **Ship only what is solid** (Nov 18): `v0.3.0` brings the map look, winter sports, the sun and shade fixes and a What's new card, after a review and a phone check. Features that add controls wait for a UI designed for all of them, drafts wait until they are checked. The order after `v0.3.x` changed on Nov 24, see below.
- **Work is tracked in GitHub issues and milestones, not in docs** (Nov 18). See [`README.md`](README.md) in this folder.
- **The launch is `1.0.0`, on Nov 26** (Nov 24): the link goes to a WhatsApp group and onto Instagram (`@cimamap`), and from there the app is developed and marketed in the open. A public Instagram account is a place where strangers see it, so it is the launch, not a step before it. It ships what `v0.3.3` has, plus search indexing and a home screen hint; the first visit already gets a welcome card. The home screen hint moved to `1.1.0` (Nov 25), so the launch ships search indexing only.
- **Share picture before the new UI** (Nov 24): `v1.1.0` is the share picture, `v1.2.0` the UI for the whole feature set. The Instagram page needs pictures now, and each one shared from the app carries the address. The picture extends the share button the app already has, so it adds no control. The UI design waits for a week of real visits after the launch, since the visits before it were mostly our own.
- **New features that add controls come after the new UI** (Nov 24): sun maps, the fog note and webcam links are `v1.3.0`. Today's UI has no room for more controls; `v1.2.0` makes that room, then they fit in. Their branches are brought up to date with `dev` when the work starts, not before.
- **The name is Cima Map, on cimamap.com** (Nov 23). *Cima* is Italian for peak; "Map" is always part of the name. Tied to neither snow nor the region, so it fits summer use and a larger area. How it was chosen and what was dropped: [`spikes/name-spike.md`](spikes/name-spike.md). See Name.

## Area

### The island and its edge

The map is cut to the snow grid (10.2–12.7° E, 46.1–47.25° N) in `web/src/island.ts`: elevation tiles are cut in the browser so the terrain ends in a cliff over a plain floor, a mask hides the basemap outside, and labels, stations, bivouacs and via ferratas outside are not drawn. Tiles fully outside are no longer downloaded. "About the data" names the area. No pipeline change.

Both looks were compared on Nov 3:

| | Island | Faded surroundings |
| --- | --- | --- |
| Look | A cut block on a plain floor; very clear where data ends; striking as a picture | Real terrain continues outside under a pale veil; the data area glows |
| Context | None: Innsbruck, Trento, the Ortler's far side are gone | Neighbouring ranges and lakes stay visible, so the Alps read as one chain |
| Download | Less: tiles outside are never fetched | More: terrain outside is fetched (the basemap outside is coarse only) |
| Grows with the area | Island just gets bigger | Veil shrinks; ends up as the natural look of a wide Alpine map |
| Code | Elevation tiles cut in the browser | Simpler: only the veil and the label filter; no tile cutting |

Both are built: a **Cut at the data edge** switch in the Map style group (`layers=…,island` in a link), faded by default. The choice: **faded surroundings in the app** (context, fits the Alpine direction and summer use), and keep the **island as a look for share pictures**, where a self-contained block on a plain background reads like a poster. Both share the label and data filtering already built.

### Growing the area

Growing the island means enlarging one box (`MODEL_GRID`) that the pipeline and the app share, plus the basemap extract. Two sizes:

- **Euregio** (North, East and South Tyrol, Trentino): about 2–3 times today's area. Stations are already in the Euregio feed. Fits the current setup with care: basemap near GitHub's 100 MB file limit (split by zoom or host it elsewhere), more Sentinel Hub processing units per day, a longer Open-Meteo grid (watch the free limit).
- **The Alps**: roughly 10–20 times today's area. Each country has its own station network and format (GeoSphere Austria, MeteoSwiss/SLF, ARPA regions, Météo-France, ARSO), the basemap is several GB and needs real tile hosting, the 250 m snow grid and Sentinel-2 processing no longer fit in a GitHub Actions run, and the Open-Meteo grid exceeds the free tier. It is a different project in size: tiling the pipeline by region, and likely a paid host or two.

A sensible path: Euregio first, built so that a region is a configuration entry (box, station sources, basemap file), then add Alpine regions one at a time if it is worth it.

## Name

The app is **Cima Map**, at **cimamap.com** (cimamap.app too), with the handle `@cimamap`. *Cima* is Italian for peak or summit: the app is built in Italy, and the word is easy to explain. "Map" is always part of the name; it says what the app is and keeps it apart from other uses of *Cima*, such as a bouldering app and a weather research foundation.

The name is tied to neither snow nor a region, because the app is used in summer too (3D terrain, sun and shade, via ferratas) and the area may grow (see Area). The region and the snow focus go into a descriptive line that can change: "Cima Map – 3D snow and terrain map of South Tyrol". The name feeds the share picture, link previews and the icon.

The repository stays *tirol-snow-map*. Old `adamvalik.github.io/tirol-snow-map` links redirect to `cimamap.com`.

The research, the checks and the dropped ideas (Kamm, Alpmap, Tirol Snow Map and others) are in [`spikes/name-spike.md`](spikes/name-spike.md).

## Hosting

GitHub Pages is enough for testers and likely for a regional launch:

| Limit (GitHub Pages) | Ours |
| --- | --- |
| Published site up to 1 GB | App, data and basemap well below; the basemap is the big file and under the 100 MB file limit |
| About 100 GB bandwidth a month (soft) | Most of a first visit's 7–12 MB is terrain tiles from Mapterhorn, not Pages. At about 3 MB from Pages per visit, that is about 30,000 visits a month |
| 10 builds an hour (soft) | Three scheduled deploys a day |
| Public repository, not for commercial use | A free hobby app |

What limits growth is the upstream quotas: Mapterhorn terrain tiles, Sentinel Hub processing units and the Open-Meteo free tier (the pipeline counts the last two in `status.json`). If the Euregio makes the basemap pass 100 MB, Cloudflare R2 (10 GB free, no egress fees) is the next step for that one file.
