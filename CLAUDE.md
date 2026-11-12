# CLAUDE.md

South Tyrol Snow Map: a 3D snow map of South Tyrol in the browser (MapLibre GL JS, Vite, TypeScript, no UI framework). A Node pipeline fetches stations, satellite snow and the forecast three times a day and writes static files; GitHub Pages serves the app with them. Live at <https://adamvalik.github.io/tirol-snow-map/>. `README.md` explains how the data flows and the known limits.

## Branches and merging

- **Work happens on `dev`.** Commit and push there. Feature branches are fine for parallel work, but they merge into `dev`, not `main`.
- **`dev` reaches `main` through a pull request** (`dev` → `main`), so `ci.yml` checks it: CI runs only on pull requests, and a push to `main` deploys to the live site straight away. Merge with **Rebase and merge** when the history allows, so `main` stays a fast-forward of `dev`; otherwise a merge commit, then bring `main` back into `dev`.
- **Never delete `dev`.** The repository deletes head branches after a merge; a ruleset protects `dev` from deletion. Do not work around it.
- Never push to `main` directly, and never rewrite history on `main` or `dev`.
- Wait for CI to be green before merging. Do not open or merge a pull request unless asked.

## Releases

Versions follow `0.x` semver (`v0.2.0` testers, `v0.3.0` share picture, `1.0.0` public launch; patches for fixes). Data deploys are not releases. Steps (also in `docs/release-plan.md`, "How to make a release"):

1. On `dev`: `npm version X.Y.Z --no-git-tag-version`, and add a row to the Releases table in `docs/release-plan.md`.
2. Pull request `dev` → `main`, CI green, merge. The deploy publishes it; the About tab shows `vX.Y.Z · <sha>`.
3. Tag the commit on `main`: `git tag -a vX.Y.Z -m "vX.Y.Z" <sha>`, `git push origin vX.Y.Z`.
4. GitHub Release from the tag, with short user-facing notes ("What's new").

Cloud sessions can usually push only to `dev`: pushing tags and deleting branches is refused there, so hand those commands to the user.

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

Before pushing, run `npm test` and `npm run typecheck`; for UI changes also `build` and `smoke`. The live pipeline (`npm run pipeline`) needs the CDSE secrets; the basemap (`npm run basemap`) is a ~90 MB download, not in git.

## Layout

- `web/src/` – the app. `layers/` holds one module per map layer behind `layers/registry.ts`; `app/` the panels, timeline, share link, feedback and analytics; `theme.css` the font and colours.
- `pipeline/src/` – data fetch, snow model, satellite, forecast, history, health (`status.ts`).
- `shared/` – types and code used by both; `shared/types.ts` is the data contract.
- `fixtures/` – real API responses used by the tests.
- `docs/` – `release-plan.md` (current plan and checklist), `roadmap.md`, design notes and spike reports.
- `.github/workflows/` – `ci.yml` (pull requests), `deploy.yml` (schedule and pushes to `main`), `snow-check.yml` (live pipeline check by hand).

## Rules for the app

- The browser calls only the site itself, `tiles.mapterhorn.com` and `api.open-meteo.com` (plus GoatCounter when `GOATCOUNTER_CODE` is set). The smoke test checks this; do not add hosts.
- Avalanches: link to avalanche.report, never assess. No danger levels, no slope-angle layer.
- Keep the UI simple: improvements remove and group rather than add.
- Nothing personal leaves the device: GPX tracks, favourites and location stay in the browser and are not in share links or analytics.
- `FEEDBACK_EMAIL` and `GOATCOUNTER_CODE` are repository variables read at build time; they end up in the public page.

## Writing

- Plain, short English sentences in docs, commit messages and UI text.
- Use an en dash (–), never an em dash (—).
- Keep `README.md` and `docs/release-plan.md` up to date when a change affects them (features, limits, checklist).
