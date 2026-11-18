# Docs

The docs say how the app works and why. They do not say what is left to do: that changes with every session, so it lives on GitHub (below).

| File | What |
| --- | --- |
| [`roadmap.md`](roadmap.md) | Direction and decisions: principles, area, name, hosting |
| [`release-plan.md`](release-plan.md) | How versions are numbered and made, and the Releases table (read by scripts, keep its format) |
| [`design/`](design/) | How parts of the app are built, and designs for what comes: [`layers.md`](design/layers.md), [`gpx-api.md`](design/gpx-api.md), [`share-snapshot.md`](design/share-snapshot.md) |
| [`spikes/`](spikes/) | Research before building: [`data-sources-spike.md`](spikes/data-sources-spike.md), [`sun-shade-spike.md`](spikes/sun-shade-spike.md) |
| [`initial-plan.md`](initial-plan.md) | The original build plan, finished by `v0.1.0`; kept for the snow model's reasoning |

The repository's [`README.md`](../README.md) explains how the data flows, how to run it and the known limits.

## How work is tracked

On GitHub, in the [issues](https://github.com/adamvalik/tirol-snow-map/issues), the [milestones](https://github.com/adamvalik/tirol-snow-map/milestones) and the project board.

- **One issue per piece of work**: a feature, a bug, something to review, an idea, a doc or a chore. A loose note becomes an issue labelled `idea`, so nothing lives only in a head or a branch.
- **Labels.** The type: `feature`, `bug`, `review` (built or to check, not yet trusted), `idea`, `docs`, `chore`, and `feedback` for what testers send. The area, optional: `area: ui`, `area: sun`, `area: winter`, `area: snow`, `area: pipeline`, `area: release`.
- **Milestones are versions** (`v0.3.0`, `v0.4.0`, `v0.5.0`, `1.0.0`). An issue without one is "later". A version is ready when its milestone has no open issues; then it is released as in [`release-plan.md`](release-plan.md).
- **The board** shows the state: Inbox (new, not sorted), Planned (has a milestone), In progress, Needs review, Done.
- **At most two features in progress at a time.** A new idea is an issue in the Inbox, not a new branch.
- **A pull request names its issue** ("Closes #12"), and the template asks whether `README.md` and these docs still say how things work.
- **Once a week, about 15 minutes:** sort the Inbox (a milestone or later), look at Needs review, check that the next milestone still fits.
