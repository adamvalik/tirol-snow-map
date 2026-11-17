# CLAUDE.md

South Tyrol Snow Map: a 3D snow map of South Tyrol in the browser (MapLibre GL JS, Vite, TypeScript, no UI framework). A Node pipeline fetches stations, satellite snow and the forecast three times a day and writes static files; GitHub Pages serves the app with them. Live at <https://adamvalik.github.io/tirol-snow-map/>. `README.md` explains how the data flows and the known limits.

## Branches and merging

- **Work happens on `dev`.** Commit and push there. Feature branches are fine for parallel work, but they merge into `dev`, not `main`.
- **`dev` reaches `main` through a pull request** (`dev` → `main`), so `ci.yml` checks it: CI runs only on pull requests, and a push to `main` deploys to the live site straight away. Merge it with a normal merge commit (**Create a merge commit**). No sync back is needed: `main` only gets commits through these merges, so `dev` never misses code (GitHub may still show `dev` as behind by the merge commits).
- **Never delete `dev`.** The repository deletes head branches after a merge; a ruleset protects `dev` from deletion. Do not work around it.
- Never push to `main` directly, and never rewrite history on `main` or `dev`.
- Wait for CI to be green before merging (`check` and `smoke` are required on `main`; auto-merge waits for them). Do not open or merge a pull request unless asked.

## Releases

Versions follow `0.x` semver (`v0.2.0` testers, `v0.3.0` share picture, `1.0.0` public launch; patches for fixes). Data deploys are not releases. Steps (also in `docs/release-plan.md`, "How to make a release"):

1. On `dev`: `npm run release X.Y.Z`. It bumps `package.json` and the lockfile and adds a row to the Releases table in `docs/release-plan.md`, drafted from the commit subjects since the last tag. Rewrite the row's "What" into short user-facing notes, a comma-separated list; it becomes the release notes as is. Commit.
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
- `docs/` – `release-plan.md` (current plan and checklist), `roadmap.md`, design notes and spike reports.
- `.github/workflows/` – `ci.yml` (pull requests), `deploy.yml` (schedule and pushes to `main`; tags and publishes a new version), `release.yml` (fallback for a `v*` tag pushed by hand), `snow-check.yml` (live pipeline check by hand).

## Rules for the app

- The browser calls only the site itself, `tiles.mapterhorn.com` and `api.open-meteo.com` (plus GoatCounter when `GOATCOUNTER_CODE` is set). The smoke test checks this; do not add hosts.
- Avalanches: link to avalanche.report, never assess. No danger levels, no slope-angle layer.
- Keep the UI simple: improvements remove and group rather than add.
- Nothing personal leaves the device: GPX tracks, favourites and location stay in the browser and are not in share links or analytics.
- `FEEDBACK_EMAIL` and `GOATCOUNTER_CODE` are repository variables read at build time; they end up in the public page.

## Writing

- Plain, short English sentences in docs, commit messages and UI text.
- Use an en dash (–), never an em dash (—).
- Do not use middle dots (·) as separators. Write it out ("Stations 12 min, Satellite 5 d"), or use a comma, an en dash or a new line.
- Keep `README.md` and `docs/release-plan.md` up to date when a change affects them (features, limits, checklist).
