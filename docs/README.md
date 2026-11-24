# Docs

The docs say how the app works and why. They do not say what is left to do: that changes with every session, so it lives on GitHub (below).

| File | What |
| --- | --- |
| [`roadmap.md`](roadmap.md) | Direction and decisions: principles, area, name, hosting |
| [`release-plan.md`](release-plan.md) | How versions are numbered and made, and the Releases table (read by scripts, keep its format) |
| [`design/`](design/) | How parts of the app are built, and designs for what comes: [`layers.md`](design/layers.md), [`gpx-api.md`](design/gpx-api.md), [`share-snapshot.md`](design/share-snapshot.md), [`logo.md`](design/logo.md) |
| [`spikes/`](spikes/) | Research before building: [`data-sources-spike.md`](spikes/data-sources-spike.md), [`sun-shade-spike.md`](spikes/sun-shade-spike.md), [`name-spike.md`](spikes/name-spike.md) |
| [`initial-plan.md`](initial-plan.md) | The original build plan, finished by `v0.1.0`; kept for the snow model's reasoning |

The repository's [`README.md`](../README.md) explains how the data flows, how to run it and the known limits.

## How work is tracked

On GitHub, in the [issues](https://github.com/adamvalik/tirol-snow-map/issues), the [milestones](https://github.com/adamvalik/tirol-snow-map/milestones) and the project board.

- **One issue per piece of work**: a feature, a bug, something to review, an idea, a doc or a chore. A loose note becomes an issue labelled `idea`, so nothing lives only in a head or a branch.
- **Labels.** The type: `feature`, `bug`, `review` (built or to check, not yet trusted), `idea`, `docs`, `chore`, and `feedback` for what testers send. The area, optional: `area: ui`, `area: sun`, `area: winter`, `area: snow`, `area: pipeline`, `area: release`.
- **Milestones are versions** (`v0.3.0`, `v0.4.0`, `v0.5.0`, `1.0.0`). An issue without one is "later". Each milestone has an "Update the README for vX.Y.Z" issue (labels `docs` and `area: release`); open one, with the checklist of #47, when a new milestone is made. A version is ready when its milestone has no open issues; then it is released as in [`release-plan.md`](release-plan.md).
- **The release issue is the parent.** A milestone's "Release vX.Y.Z" issue (template *Release checklist*) has every other issue in the milestone as a sub-issue, so its card on the board shows how many are closed ("3 / 5"). An issue added to the milestone is added as a sub-issue too; one moved to another milestone moves to that release issue (or loses its parent, if there is none yet). An issue has only one parent: a feature with its own sub-issues joins the release issue itself, its children stay under it.
- **Every issue that is not an `idea` has a milestone.** A bug or a task without one would hide in the pile. Ideas stay without one ("later") until they are planned.
- **The [board](https://github.com/users/adamvalik/projects/2)** shows the state: Inbox (not started), In progress, Done. Whether an issue is planned is its milestone, not a column. New issues are added on their own, closed ones go to Done. Two more views: **Untriaged** (`no:milestone -label:idea`, should be empty) and **Ideas** (`label:idea`). Milestones and labels are the source of truth: Claude sessions cannot reach the board, only the issues.
- **At most two features in progress at a time.** A new idea is an issue in the Inbox, not a new branch.
- **Branches are named after their issue**: `<type>/<issue>-<short-name>`, for example `feat/28-webcam-links` or `fix/34-lift-cache`. Types: `feat`, `fix`, `docs`, `chore`, `spike`.
- **Commit messages follow Conventional Commits**: `<type>(<scope>): <summary>`, for example `fix(snow): keep the last clear view under new clouds`. The types are the branch types plus `perf`, `refactor`, `test` and `ci`; the scope is an area label. `CLAUDE.md` has the details.
- **A pull request names its issue** ("Closes #12"), and the template asks whether `README.md` and these docs still say how things work.
- **Once a week, about 15 minutes:** sort the Inbox (a milestone or later), look at Needs review, check that the next milestone still fits.
