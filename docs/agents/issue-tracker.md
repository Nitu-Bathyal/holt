# Issue tracker

Holt has two trackers.

- **Outside contributors:** GitHub Issues on holt-oss/holt (good first issues, bugs, feedback). Nothing below applies to you.
- **Maintainer planning:** private local markdown files on the maintainer's server, at `~/.local/state/hq/orchestrators/holt/tickets/`, next to the orchestrator's ledger. They're outside the repo on purpose: the repo is public, and the plan covers unreleased and paid work. Workers receive their ticket's content in their brief. If that path doesn't exist on your machine, you're not a maintainer session; use GitHub Issues.

## Conventions (maintainer tracker)

- One feature per directory: `tickets/<feature-slug>/`
- The spec is `tickets/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `tickets/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is a `Status:` line near the top of each issue file (see `triage-labels.md`)
- Dependencies are a `Blocked by: NN, NN` line near the top
- Comments and history append at the bottom under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `~/.local/state/hq/orchestrators/holt/tickets/<feature-slug>/` (create the directory if needed). Never create GitHub issues for maintainer planning.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user or orchestrator normally passes the path or the issue number.

## Wayfinding operations

Used by `/wayfinder`.

- **Map**: `tickets/<effort>/map.md` (Notes / Decisions so far / Fog).
- **Child ticket**: `tickets/<effort>/issues/NN-<slug>.md`, with a `Type:` line (`research`/`prototype`/`grilling`/`task`) and a `Status:` line (`claimed`/`resolved`).
- **Blocking**: `Blocked by: NN, NN`. A ticket is unblocked when every listed file is `resolved`.
- **Frontier**: open, unblocked, unclaimed files in `tickets/<effort>/issues/`; lowest number first.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under `## Answer`, set `Status: resolved`, and add a pointer to the map's Decisions so far.
