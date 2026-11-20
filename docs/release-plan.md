# Releases

How versions are numbered and made, and what each one brought. **What goes into a coming version is not here:** it is the version's [milestone](https://github.com/adamvalik/tirol-snow-map/milestones) on GitHub (see [`README.md`](README.md) in this folder, "How work is tracked").

The Releases table at the end is read by scripts: `npm run release` adds a row, CI checks it, the deploy publishes it as the GitHub Release, and the app's What's new card shows it (`scripts/release-notes.mjs`). Keep its format.

## How versions are numbered

`MAJOR.MINOR.PATCH`, as in semantic versioning, read for an app (there is no API to keep compatible, so the numbers tell people what to expect):

- **`0.x`** means "not launched": testers and friends, things may still change a lot. **`1.0.0`** is the public launch, the first version we would post where strangers see it.
- **Minor** (`0.2.0` → `0.3.0`): new features. Each one is a release with notes and a What's new card.
- **Patch** (`0.3.0` → `0.3.1`): fixes only, no new feature. Its row still lists the fixes for the GitHub Release, but the first item is one short line for people ("Fixes for a steadier and faster map"): the What's new card adds only that line under the minor version's notes, and does not come back for someone who saw the minor version.
- Data deploys three times a day change no number.

So the number follows the audience, not the amount of work. `1.0.0` comes when the app is posted where strangers see it; settle the name and the domain before that, since a rename after it costs more (links, the picture people remember).

## How to make a release

1. The version's milestone has no open issues, and its release checklist issue (template *Release checklist*) is ticked off.
2. On `dev`: `npm run release 0.3.0` (`scripts/release.mjs`). It bumps `version` in `package.json` and `package-lock.json` and adds a row to the Releases table below, drafted from the `feat`, `fix` and `perf` commit subjects since the last tag (older subjects without a type are kept too). Rewrite the row's "What" into short user-facing notes: a comma-separated list, one item per change (commas inside brackets do not split). Commit it as `chore(release): v0.3.0`.
3. Try the dev preview on a phone (<https://adamvalik.github.io/tirol-snow-map/dev/>, updated on every push to `dev`). Open the pull request `dev` → `main`. CI's release check (`ci.yml`, job `check`) fails if the version is not above the last tag, is tagged already, or has no row, and prints the notes as they will appear. Merge when green, or turn on auto-merge.
4. The deploy publishes it. Once the live site serves the build, `deploy.yml` (job `release`) tags the deployed commit `v0.3.0` and publishes the GitHub Release with the row as a list. Nothing to tag or publish by hand.

A merge without a version bump only deploys. If the release job fails, the next deploy from `main` (at most 8 hours later) tries again; it can also be started from the Actions tab (*Update data and deploy*, Run workflow). A tag pushed by hand still works: `release.yml` checks it against `package.json` and `main` and publishes the release. The notes can be edited on GitHub after publishing. Close the milestone and the checklist issue once the release is out.

## Releases

| Version | Date | What |
| --- | --- | --- |
| `v0.3.2` | Nov 20, 2026 | Link previews in chats show where the snow is (the main ridge above Meran), visits counted by where the link was posted (no personal data) |
| `v0.3.1` | Nov 20, 2026 | Fixes for a steadier and faster map, white outline under slopes and lifts again, a clear screen when the map cannot start (no WebGL 2, an old browser, JavaScript off, the phone dropped the map), an open tab reloads once when it needs a file a newer version replaced, a lighter first view (snow values load after the map, an earlier connection to the terrain tiles), sun and shade does less repeated work, own not-found page, What's new comes back only for new features, not listed in search engines until the domain is settled, anonymous error counts (no details leave the device), MIT licence for the code |
| `v0.3.0` | Nov 20, 2026 | Winter sports layer (slopes by difficulty, lifts in 3D, cross-country trails, toboggan runs and ski touring routes), new map look (land cover, softer relief light, valley and mountain names, a brown dot for no snow), one name per place when zoomed out, softer and more detailed shadows with a smooth sunrise, sun and shade goes dark at night, What's new card, feedback without e-mail (an anonymous form for problems, a voting board for ideas), phone sheet that drags smoothly and hides for more map, a scrolling row of layer buttons on phones, no more reloads on phones with heavy layers on, home screen app on iPhone fills the screen |
| `v0.2.2` | Nov 16, 2026 | Roads and places come back by themselves after a failed download (no reload needed), clearer new-snow note, sun slider stays on the chosen day at its end, calendar opens with a click on the date, releases tagged and published automatically after the merge |
| `v0.2.1` | Nov 13, 2026 | Link preview for shared links (daily picture of the map), "Where am I" location button, avalanche warning region named in the place panel with a link to its bulletin, upstream quota tracking with an issue near the free limits, daily log of the snow depth model's error, deploy schedule kept alive past 60 days without commits, draft GitHub Release on a version tag |
| `v0.2.0` | Nov 12, 2026 | Euregio station feeds with frozen-upstream checks, 24/48/72 h snow depth change at stations, GPX tracks (load, measure, draw, keep), new UI (design C2), feedback links and anonymous visit counting (off until configured), CI on pull requests |
| `v0.1.0` | Nov 7, 2026 (tagged after the fact) | Everything in roadmap section 1: 3D terrain, stations, snow from space, depth estimate, satellite photo, day slider, forecast animation, share links, bivouacs, favourites, via ferratas, sun and shade, island cut, layer registry |
