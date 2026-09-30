# How Holt is evaluated

> **Historical:** this benchmark was the competition-era evaluation. It was
> retired as a gate on 27 Sep 2026: it was expensive to run and shared the
> engine's blind spot (its label counted maintainers as outsiders too). What
> gates an engine change now is the golden set (`golden/README.md`): 52
> recorded repositories, 10 of them hand-checked, replayed offline in CI.
> The verdict rules and the evidence for each threshold are in
> [REVIEW-2026-09-30.md](REVIEW-2026-09-30.md). This page is kept as the
> history and method of the competition result.

## Verdict tiers (engine 4, 29 Sep 2026)

Three field tests (a product critic, a 10-year contributor, a first-timer)
found the answer too green: facebook/react (71% of outside PRs unanswered),
simonw/llm (63%), moment/moment (first replies ~100 days, a sample reaching
back to 2021) and microsoft/vscode all read "Worth your time", while
vercel/next.js (1 of 30 merged) and fastapi/fastapi (0 of 95) read "Not
enough evidence". Engine 4 adds **Long shot** between Worth and Not worth,
and **Personal project** beside Not enough evidence. This section is the
rule table and the evidence for every threshold; the product only ever
shows each rule's own plain sentence.

### The rules (live readings; the first that applies decides)

Only outside pull requests opened between 14 days and 12 months before the
reading count.

| # | Rule | Answer | code |
|---|---|---|---|
| 1 | Archived | Not worth | `archived` |
| 1b | **Engine 6.** Pull requests switched off, or only collaborators may open them (GitHub's own settings) | Not worth | `prs_closed` |
| 2 | A mirror or a fork | Not worth | `elsewhere` |
| 3 | **New.** Someone's own or a small team's project (below) | Personal project | `personal` |
| 4 | Nothing merged and nothing pushed in 90 days | Not worth | `inactive` |
| 5 | A catalogue or list | Not worth | `catalogue_shape`, `non_software_kind` |
| 6 | Nobody outside opened a PR we can count | Not enough | `no_attempts` |
| 7 | None merged, over 70% of at least 8 unanswered | Not worth | `ignored` |
| 8 | **Changed.** 20+ decided, under 5% merged, whatever the merge count | Not worth | `long_odds` |
| 8b | **New.** …and none merged while at least half got a reply | Not worth | `replies_no_merges` |
| 9 | 2+ merged from 2+ people, but merges go unreviewed (as before) | Not worth | `rubber_stamp` |
| 10 | **New.** 2+ merged from 2+ people, and any of: under 1 in 10 merged; over half unanswered; typical first reply over 21 days (from 5+ replies) | Long shot | `few_merged`, `mostly_silent`, `slow_replies` |
| 11 | 2+ merged from 2+ people | Worth (slow note if replies exceed the budget) | `merges` |
| 12 | **New.** 20+ decided, but only 1 merge, or every merge from one person | Long shot | `one_merge`, `one_person` |
| 13 | Otherwise | Not enough | `few_merges`, `few_people`, `too_few_attempts` |

Rule 10's silence and reply-time tests are skipped where at least half of
the outside merges landed off GitHub's button (Gerrit, a merge bot): the
review happened there, and GitHub's silence says nothing. golang/go lands all
44 of its outside merges through Gerrit and answers 2 of 152 PRs on GitHub.

Engine 6 sorts unmerged closes that got no reply from the project: closed by
a bot within three days (a check against the project's rules: django's Trac
ticket bot, is-a-dev, hacs, tldr), closed later by a bot (stale bots,
gitgitgadget, gopherbot), and closed by the author. Only the rest are "closed
without a word". All stay decided attempts that weren't merged, so no rule's
input moves. Titles a maintainer rewrote as spam ("AI junk", "[rejected AI]
…" on flask, click and itsdangerous) now leave the counts like a spam label.
None of this changed a verdict on the golden set or the backtest.

The answer never depends on the reader's budget: the reply-time rule uses a
fixed 21 days, and the budget only moves the "replies are slow" note
(`server/report.retime` relies on this; a test holds it).

### Why each threshold

Data: the 311 latest engine-3 rules reports on staging (29 Sep; 260 Worth,
38 Not enough, 13 Not worth), and the 73-repository golden set, 62 of them
replayed before and after.

**12-month cap.** 56 of the 260 staging "Worth" reports read samples reaching
back more than a year (31 more than two), because a quiet project's newest
200 PRs span years. moment's merges were from 2021–2024 while it sat in
maintenance mode. A year covers a full release cycle and a Hacktoberfest; on
the golden set it changes no verdict except monica (its 8 merges were older;
0 of 41 in the last year) and moment.

**Floor from 20 attempts (5%).** The 5% floor is unchanged
(REVIEW-2026-09-30.md). It used to wait for 2 merges, so 1 of 30 read "Not
enough evidence" while 2 of 41 read "Not worth". 20 decided attempts is the
smallest sample where one merge is already the floor (1 in 20), so no sample
under 20 is judged by it, and the ignored rule's 8 stays for the zero-merge,
mostly-unanswered case. On staging it turns 5 "Not enough" reports down
(dotnet/eShop 1/86, excalidraw 1/116, fastapi 0/94, semgrep 1/58, next.js
1/30), all of them repositories where plenty tried and almost nobody got in.

**Replies but never merges.** fastapi answered 67 of its 95 outside PRs and
merged none; "Not enough evidence" read to a beginner as "maybe, give it a
go". Half answered is the cut: below it, the plain floor sentence says it.

**Long shot: over half unanswered.** "Most get silence" is the definition,
and it is the same line the odds already used for "long" (no-reply over 50%),
so a green headline can no longer sit beside red odds (react's complaint).
The staging distribution has no gap near 50% (…0.54, 0.54, 0.52, 0.51, 0.51 |
0.49, 0.49, 0.47…), so the threshold is the definition, not a fitted value:
it turns 24 of 260 Worth reports to Long shot, react, llm, vscode, bat,
tidb and zstd among them. kubernetes (49%) stays Worth.

**Long shot: under 1 in 10 merged.** The odds band "fair" is 5–12%; 10% is
the round number a reader can hold ("fewer than 1 in 10") and the one the
first review already weighed as a Not-worth floor and rejected as too harsh
for that (django 8.2%, git 9.6%). As a Long shot those read right: django
takes cold PRs only with an accepted Trac ticket, git through GitGitGadget.
12 of 260 staging Worth reports are under 10%; 7 of them are also over half
unanswered.

**Long shot: typical first reply over 21 days.** The widest gap in the
staging medians above a week is between 19.3 and 29.7 days (values: 39.9,
29.7, 29.7 | 19.3, 18.6, 18.2, 17.0, 15.3…), so the threshold sits inside it
at three weeks, which is also most of a Hacktoberfest month. It catches
swagger-ui (40 days), highlight.js (30) and moment (59 over its last year),
and leaves efcore (12 days, 41 of 44 merged) Worth with the slow note. It
needs 5 replies: facebook/fresco's 26-day "typical" reply over its last year
came from 2.

**One merge, or one person, among 20+.** Once 20 have tried, a single merge
or a single person's merges means everyone else was turned away: a long shot
rather than a mystery. 4 staging reports (appsmith 1/20, errbit, fuel-core,
consul).

**Personal project** (`agent/personal.py`). All must hold: no outside merge
and at most 2 outside PRs; every PR from at most 5 people; under 25 stars; no
CONTRIBUTING file; and one sign: hackathon or coursework words in the name,
description, topics or the README's opening; a personal-site name
(`*.github.io`, dotfiles, portfolio); or all activity within 60 days and
nothing pushed for 30. Checked on 4 hackathon/team repos (all Personal) and 4
small open projects that must stay out (flint, openbot, VeloGraphX stay "Not
enough evidence"; taskuary stays Worth), all in the golden set. Deliberately
conservative: a solo library with no outside PRs yet stays "Not enough
evidence" unless it says it's a hackathon entry or has stopped.

### What changed

Staging, re-derived from the stored counts (the 12-month cap needs the
threads, so it isn't in these numbers): Worth 260 → 228, Long shot 0 → 36,
Not worth 13 → 18, Not enough 38 → 29.

Golden set (62 replayed): 11 verdicts changed. Worth → Long shot: vscode,
bat, CircuitVerse (over half unanswered); django, git (under 1 in 10). Not
enough → Not worth: next.js, excalidraw, semgrep, lazygit (the floor from
20), fastapi (replies, never merges). Worth → Not worth: monica (nothing
merged in its last year). The 10 hand checks still agree (golang/go stays
Worth through the review-elsewhere rule). Added: react, llm, moment (Long
shot, as the field testers found by hand) and 8 personal-project cases.

### Known limits

- Policy and bot closures (Django's Trac bot, Flask's AI-PR policy) still
  count as outside attempts; engine ticket A.3 turns them into asks.
- CircuitVerse (54% unanswered) was a judgment-call "Worth" in the
  30 Sep review; it is now a Long shot.
- The thresholds were chosen on the data they are shown on; there is no
  held-out set.

---

Holt's product output is a recommendation, so its quality has to be inspectable.
This document explains how the benchmark pool was built, how ground truth is
computed, what the result is sensitive to, and what it does not cover. Exact
commands are in [REPRODUCTION.md](REPRODUCTION.md).

---

## Evaluation design

**Temporal holdout at T = 2026-06-01.** The agent sees only evidence dated at or
before T. Labels are computed only from evidence after it. T sits just past the
models' training cutoff so that the label window falls outside training data;
moving T earlier would drag the label window *into* it, which is the leak that
actually matters.

**The pool is sampled from history, not from today.** GitHub search returns
today's stars and today's activity whatever date filter you apply, so a pool
drawn from it is pre-filtered for repositories that survived. Holt's pool is
sampled from GH Archive events over three contiguous days before T — repositories
as they appeared at the cutoff, with no knowledge of which lived. **Three of the
thirty were deleted before the run**; a search-based sample would have silently
excluded all three.

**Three things about the pool, stated rather than buried:**

- `is-a-dev/register` was **drawn, not placed**. The seed (`20260601`) is
  committed and the draw is verifiable by re-running `eval/sample_pool.py`.
- The busiest volume band drew **6 of 8 available** — a near-census, not a
  sample. "Stratified random" is accurate for three bands and approximately
  exhaustive for the fourth.
- The universe is **1,674 of 40,731** repositories, filtered to those with at
  least two distinct human pull request openers. A repository with one opener
  carries no outsider signal at all.

**The pool is hash-committed** (`eval/pool.json`, sha256 `f100b2209c…`) and was
never edited after results were seen.

**Labels are computed, never hand-judged**, and shipped in two versions. L0 is
the naive outsider merge rate. L1 adds bot exclusion, a diff-shape filter and a
human-review requirement. Both are run; the gap between them is in the changelog.

---

## Measured performance

The frozen benchmark compares Holt with progressively stronger one-prompt
baselines. Scores are mean Matthews correlation coefficient (MCC) across three
recorded runs; higher is better and `0.00` is chance-level correlation.

| Method | Pool 1 | Pool 2 |
|---|---:|---:|
| Repository name only | 0.16 | 0.10 |
| README, one prompt | 0.09 | 0.21 |
| Same evidence as Holt, one prompt | — | 0.32 |
| **Holt** | **0.61** | **0.63** |

Holt returned the same verdict in all three runs for **22 of 22** repositories
in pool 1, compared with **17 of 22** for the README baseline. Across both
pools, Holt was stable on **55 of 55** repositories; the baseline changed its answer on 16 of 55. These figures describe the committed benchmark, not a
guarantee for every repository or model.

---

## What this result depends on

Two sensitivities a reader would otherwise have to find themselves. Both are
reproducible with `PYTHONPATH=. uv run python eval/sensitivity.py`.

**The ground truth is our own definition.** L1 keeps an outsider merge only if
the diff is *substantive* and a human *reviewed* it — both filters chosen by
us, so the honest question is what happens when either is dropped. On the
earlier recorded runs this was a real vulnerability: dropping `substantive`
flipped the advantage to the baseline. On the frozen runs it no longer does —
Holt leads under **every** variant, though the margin narrows to +0.11 at its
thinnest. Mean MCC over the three frozen runs:

| Ground truth | Positives | Holt | Baseline |
|---|---|---|---|
| L1 as shipped | 14/22 | **+0.61** | +0.09 |
| drop the `reviewed` filter | 16/22 | **+0.60** | +0.01 |
| drop the `substantive` filter | 16/22 | **+0.39** | +0.28 |
| drop both (≈ the naive L0) | 18/22 | **+0.38** | +0.22 |

**The lead survives every variant, and the diff-shape filter is where most of
it lives.** Drop that filter and Holt still leads, +0.39 against +0.28, but the
margin is a third of what it was: most of Holt's advantage is against a ground
truth that counts *what a merged contribution changed*.

We think that is the right definition, and it is the first claim this project
makes rather than one introduced afterwards: a merged pull request that appends a
line to a JSON manifest is not a software contribution. A reader who rejects that
premise should reject the project, not just the number. The dependency is real,
it is not hidden, and it is one filter deep.

The honest tension: Stage A's prompt tells the model to judge a repository by
what its merged diffs touch, which is the same concept the `substantive` filter
encodes mechanically. Label and agent operationalise one construct two ways —
one by rule, one by judgement. That is not code sharing, and the temporal split
is intact, but it is closer than "the agent shares no diff-shape rules" implies.

---

## Known limitations

**L1 counts programme-cohort review as review.** Nine repositories in the pool
are GirlScript Summer of Code '26 projects with a points leaderboard — grep
`gssoc` in `fixtures/post_t/leonagoel__hybrid-recommender.json` and you will find
1,605 mentions. Leaderboard-driven pull requests are substantive by our diff-shape
filter and mentors do comment on them, so those repositories label as viable.
"A stranger's patch lands here" is *true* of them. Whether a week spent there is
the opportunity this tool is meant to find is a separate question our ground truth
does not ask, and we did not discover this until it broke a different experiment
(`eval/mover_controls.py`). The labels are hash-committed and were not touched
after the fact.

- **22 of 30 repositories graded** in pool 1. Three were deleted between the
  cutoff and the run; five had no post-cutoff outsider attempts to grade against.
- **Three runs per pool, so the ±0.00 half-ranges measure run-to-run stability
  rather than sampling error.** Sampling error is measured separately, over
  repositories: the Holt−baseline gap is large but not yet formally
  distinguishable at n=22 — see measured performance above.
- **The memorisation probe reaches 0.71 precision knowing only repository
  names.** Some of every method's score here is recognition rather than reading.
  Its recall is 0.36, which bounds how much.
- **Three repositories sit at GitHub search's 1000-result ceiling**, so their
  label figures are a sample rather than a census. An API boundary, not a choice.
- **Star counts are as-of-fetch, not as-of-cutoff.** GitHub exposes no historical
  count. Only the popularity diagnostic reads them.
- **Absence of merged outsider code is not proof of hostility**, and a good
  project can have a quiet quarter. The three-month label window makes this
  sharper than a longer one would.
- **`Homebrew/homebrew-cask` is a genuine disagreement**, not a bug: Holt calls
  it a registry, the label counts eleven qualifying merges. Casks are Ruby files.
  Neither side was tuned to agree with the other.

---

## Provenance

The benchmark inputs, recorded model calls, pool definitions, and result files
are committed so the published numbers can be reproduced without an API key or
GitHub token. Product development continues independently of this frozen
evaluation boundary.

The evaluation design responds to *The Benchmark Ceiling: Human Judgment,
Evaluation Scarcity, and the Political Economy of AI Capability Measurement*
([arXiv:2607.01254](https://arxiv.org/abs/2607.01254)), which argues that
discriminating signal concentrates in hard-tail items while fixed metrics
degrade under strategic optimisation. L0 is such a metric and L1 is the hard-tail
reconstruction; the aggregate scores tie while the hard cases separate cleanly,
which is the shape that argument predicts.
