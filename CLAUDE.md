# CLAUDE.md

Cima Map (formerly South Tyrol Snow Map): a 3D snow and terrain map of South Tyrol in the browser (MapLibre GL JS, Vite, TypeScript, no UI framework). A Node pipeline fetches stations, satellite snow and the forecast three times a day and writes static files; GitHub Pages serves the app with them. Live at <https://cimamap.com/> (the repository keeps the name `tirol-snow-map`). `README.md` explains how the data flows and the known limits.

## Branches and merging

- **Work happens on `dev`.** Commit and push there. Feature branches are fine for parallel work, but they merge into `dev`, not `main`.
- **Branch names: `<type>/<issue>-<short-name>`**, lowercase words joined by hyphens, two to four words, for example `feat/28-webcam-links`, `fix/34-lift-cache`, `docs/25-share-picture-concept`. Types: `feat` (feature), `fix` (bug), `docs`, `chore`, `spike` (trying out an idea). Leave out the issue number only when there is no issue.
- **Cloud sessions get a branch named `claude/<random>`. Do not use it.** Create a branch named as above and push there instead; this rule is the permission to. Name it at the start of the work, from the issue.
- **`dev` reaches `main` through a pull request** (`dev` → `main`), so `ci.yml` checks it: CI runs only on pull requests, and a push to `main` deploys to the live site straight away. Merge it with a normal merge commit (**Create a merge commit**). No sync back is needed: `main` only gets commits through these merges, so `dev` never misses code (GitHub may still show `dev` as behind by the merge commits).
- **A push to `dev` deploys the dev preview** at `/dev/` of the live site, with `main`'s data, or with `dev`'s own pipeline when `dev` changes `pipeline/` or `shared/` (README, Deployment). A push to `main` deploys both.
- **Never delete `dev`.** The repository deletes head branches after a merge; a ruleset protects `dev` from deletion. Do not work around it.
- Never push to `main` directly, and never rewrite history on `main` or `dev`.
- Wait for CI to be green before merging (`check` and `smoke` are required on `main`; auto-merge waits for them). Do not open or merge a pull request unless asked.

## Commits

Commit messages follow Conventional Commits: `<type>(<scope>): <summary>`.

- **Types**: `feat` (something people can see or do), `fix` (a bug), `perf` (faster or lighter, same behaviour), `refactor` (code change, same behaviour), `test`, `docs`, `ci` (workflows), `chore` (tooling, dependencies, data scripts), `spike` (trying out an idea).
- **Scope** (optional): the area label without `area: `, so `ui`, `sun`, `winter`, `snow`, `pipeline` or `release`. Leave it out when the change spans areas.
- **Summary**: plain English, lowercase first word (unless it is a name), no full stop, at most 72 characters. Say what changes for the person using the map where you can: `feat(winter): show the toboggan runs in purple`, not `feat: add layer`.
- **Body** (optional, after a blank line): why, in short sentences, wrapped at 72 characters.
- **Footer**: `Refs #12` for the issue. `!` after the type (`feat(ui)!:`) and a `BREAKING CHANGE:` line only when a share link or the data contract (`shared/types.ts`) stops working the old way.
- One change per commit; a commit that needs "and" in its summary is usually two.
- Merges keep git's message (`Merge chore/85-preconnect into dev`); the version bump is `chore(release): vX.Y.Z`.
- `npm run release` drafts the notes from `feat`, `fix` and `perf` subjects only, without the prefix, so write those for people.

## Tracking work

Work is tracked on GitHub, not in docs (`docs/README.md`, "How work is tracked"). In a session:

- Start from an issue. If there is none for the task, say so and suggest one; do not open issues the person did not ask for, except for findings below.
- A pull request names its issue ("Closes #12") and fills in the template's checks.
- Findings along the way (a bug, a leftover, a review point, an idea) become issues with a type label (`feature`, `bug`, `review`, `idea`, `docs`, `chore`) and an area label (`area: ui`, `area: sun`, `area: winter`, `area: snow`, `area: pipeline`, `area: release`), in the milestone of the version they block, and a sub-issue of that milestone's "Release vX.Y.Z" issue when it has one. Only `idea` issues go without a milestone ("later"). Not notes in the docs.
- When you touch issues, check that none is untriaged (open, not an `idea`, no milestone) and suggest a milestone for each. Sessions cannot reach the project board; it shows the milestones and labels.
- Docs say how things work and why. No task lists, no "to do", no status lines in them.
- What goes into which version is the milestones; `docs/release-plan.md` only says how releases work.

## Releases

Versions follow semver (`v0.2.0` testers, `v0.3.0` winter release, `v0.3.3` the name Cima Map, `1.0.0` the public launch on WhatsApp and Instagram, `v1.1.0` share picture, `v1.2.0` UI for all features, `v1.3.0` sun maps and the fog note in it; patches for fixes). What goes into which version is its GitHub milestone. Data deploys are not releases. Steps (also in `docs/release-plan.md`, "How to make a release"):

1. The milestone has no open issues and its release checklist issue is ticked off. On `dev`: `npm run release X.Y.Z`. It bumps `package.json` and the lockfile and adds a row to the Releases table in `docs/release-plan.md`, drafted from the commit subjects since the last tag. Rewrite the row's "What" into short user-facing notes, a comma-separated list; it becomes the release notes as is. Commit.
2. Pull request `dev` → `main`. CI's release check fails if the version is not above the last tag or has no row. Merge when green (or turn on auto-merge).
3. Nothing else: after the deploy is live, `deploy.yml` (job `release`) tags the deployed commit `vX.Y.Z` and publishes the GitHub Release. The About tab shows the new version and commit.

A merge without a version bump only deploys. Cloud sessions need no tag push for this; pushing tags and deleting branches is refused there. `release.yml` is the fallback for a tag pushed by hand.

## Commands

Node 22+.

| Command | What |
| --- | --- |
| `npm test` | Unit tests (vitest) against `fixtures/` |
| `npm run typecheck` | TypeScript check of app, pipeline and tests |
| `npm run pipeline:fixtures` | Pipeline offline, from the saved fixtures (no secrets) |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run smoke` | After `build`: browser smoke test (desktop and phone) |
| `npm run dev` | Local app at http://localhost:5173 |
| `npm run release X.Y.Z` | Bump the version and add its Releases row (see Releases) |

Before pushing, run `npm test` and `npm run typecheck`; for UI changes also `build` and `smoke`. The live pipeline (`npm run pipeline`) needs the CDSE secrets; the basemap (`npm run basemap`) is a ~90 MB download, not in git.

## Layout

- `web/src/` – the app. `layers/` holds one module per map layer behind `layers/registry.ts`; `app/` the panels, timeline, share link, feedback and analytics; `theme.css` the font and colours.
- `pipeline/src/` – data fetch, snow model, satellite, forecast, history, health (`status.ts`).
- `shared/` – types and code used by both; `shared/types.ts` is the data contract.
- `fixtures/` – real API responses used by the tests.
- `docs/` – `README.md` (index, how work is tracked), `release-plan.md` (how releases work, the Releases table), `roadmap.md` (direction and decisions), `design/`, `spikes/`.
- `.github/workflows/` – `ci.yml` (pull requests), `deploy.yml` (schedule and pushes to `main` and `dev`, builds the dev preview; tags and publishes a new version), `release.yml` (fallback for a `v*` tag pushed by hand), `snow-check.yml` (live pipeline check by hand).

## Rules for the app

- The browser calls only the site itself, `tiles.mapterhorn.com` and `api.open-meteo.com` (plus GoatCounter when `GOATCOUNTER_CODE` is set). The smoke test checks this; do not add hosts.
- Avalanches: link to avalanche.report, never assess. No danger levels, no slope-angle layer.
- Keep the UI simple: improvements remove and group rather than add.
- Nothing personal leaves the device: GPX tracks, favourites and location stay in the browser and are not in share links or analytics.
- `FEEDBACK_FORM_URL`, `IDEAS_URL`, `FEEDBACK_EMAIL` and `GOATCOUNTER_CODE` are repository variables read at build time; they end up in the public page. The form and the board are links that open in a new tab, never embedded, so the page calls no new host.

## Writing

- Plain, short English sentences in docs, commit messages and UI text.
- Use an en dash (–), never an em dash (—).
- Do not use middle dots (·) as separators. Write it out ("Stations 12 min, Satellite 5 d"), or use a comma, an en dash or a new line.
- Keep `README.md` and `docs/` up to date when a change affects how things work (features, limits).
