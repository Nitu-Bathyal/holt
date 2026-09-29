# The golden set

62 real repositories, recorded once from GitHub and replayed offline, that pin
down what Holt's engine says about each one. Any change to the engine
(signals, rules, evidence handling) shows up here as a before/after table, and CI
fails if a verdict or a count changes without being approved.

| File | What | Written by |
|---|---|---|
| `repos.json` | Which repositories, the shape each covers, and for 10 of them the verdict a person checked by hand and why | hand |
| `expected.json` | The engine's current verdict, deciding rules and counts per repository, plus every approved verdict change and its reason | `approve` |
| `recordings/*.json.gz` | The evidence a live report read: the newest 200 pull requests (plus, for a busy repository, older ones reaching past the 14-day settle window) with their comments, reviews, merges and closes (v2 evidence), repository facts, releases, README and CONTRIBUTING | `record` |

The replay is the free report as githolt.com computes it: no model, a 7-day
contributor, read at the moment the recording was made (so a PR opened an hour
before capture is still "too new to judge", as it was live).

## Commands

Run from the repository root.

```sh
uv run python -m golden diff                  # what the current engine changes, vs expected.json
uv run python -m golden diff --base origin/main   # vs what main approved
uv run python -m golden check                 # exit 1 on any unapproved change (CI runs this as a test)
uv run python -m golden approve --reason "..."    # accept the current output
GITHUB_TOKEN=$(gh auth token) uv run python -m golden record owner/name   # add or re-record one
```

`diff` prints a Markdown table, one row per repository whose verdict, rules or
counts moved. Verdict changes come first. The "hand check" column shows whether
the engine agreed with the hand-checked verdict before and after (✓/✗).
Paste it into the PR.

## Changing what the engine says

1. Make the engine change. `uv run pytest tests/test_golden.py` fails and
   prints the table.
2. Read the table. Every verdict that flips should be one you meant to flip.
3. `uv run python -m golden approve --reason "why this is right"`. Every
   flipped verdict gets a history entry with that reason. To give different
   repositories different reasons, run it once per group:
   `approve --reason "..." owner/a owner/b`.
4. Commit `golden/expected.json` in the same PR, and paste the table into the
   PR description.

Count-only changes are approved the same way; they update the numbers without a
history entry. Editing a verdict in `expected.json` by hand fails the check,
because its last history entry no longer matches.

## Adding a repository

Add it to `repos.json` with a `shape` and a one-line `note`, then `record` it
and `approve --reason "added: <why>"`. Use the name GitHub currently uses (a
renamed repository is refused, so every recording is filed under the name
its evidence ids use). A recording is 5–200 KB gzipped. Keep the whole set under 12 MB (a
test checks).

## Hand-checked verdicts

The 10 entries in `repos.json` with an `expected` block were read by a person:
the recorded threads, who merged what, and how PRs were closed. `reason` says
why that verdict is right. `judgment_call`, where present, says what a
reasonable person could see differently. These are targets, not snapshots:
the engine is allowed to disagree with them (the table tracks how often), and
the engine tickets are expected to move it towards them.

The 10 repositories with shape `student favourite (ticket 08)` (freeCodeCamp,
p5.js, oppia, Hacktoberfest and GSSoC regulars) have no `expected` block: they
were checked by the ticket 08 engine worker, not yet by a person. Their
checks and reasons are in `docs/research/REVIEW-2026-09-30.md`; promote them
here once a person agrees.

## The backtest

The golden set pins what the engine says; `golden/backtest.py` checks whether
it was right. `golden/backtests/<date>/` holds, per repository, what a report would
have read on a past date and what happened to the outside pull requests opened
after it. `uv run python -m golden.backtest run` scores any engine change
against that, offline. How it works, what counts as right, and the results so
far: `docs/research/BACKTEST.md`.
