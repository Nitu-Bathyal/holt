# The backtest: does the answer predict what happens next?

The golden set pins down what the engine *says*. It can't tell whether the
engine is *right*. The backtest checks that. It reads a repository as Holt
would have read it on a past date, then looks at what actually happened to
the outside pull requests opened in the weeks after that date.

It answers one question per engine change: **if someone had taken Holt's
answer on that date and sent a pull request, would the answer have held up?**

## What is recorded

For each repository (the golden set's list, `golden/repos.json`) and each
as-of date, one file in `golden/backtests/<as-of date>/`, with two parts:

- **before**: exactly what a live report would have read on the *as-of* date
  (`LiveGitHubProvider` with that cutoff: the newest 200 pull requests created
  before it, older ones where the settle window needs them, the repository's
  facts, and README and CONTRIBUTING at the commit of that day). Nothing dated
  after the as-of date is kept.
- **after**: the pull requests *opened* in the window that follows (as-of date
  to as-of + 45 days), read from the as-of date forward (oldest first, up to 8
  pages), with everything that happened to them up to the moment of capture.

The first run uses an as-of date of **15 June 2026**, so the window is 15 June
to 30 July. The capture date is 29 or 30 September, so every pull request in
the window had at least 60 days to get an answer.

**Known leaks.** Some things can only be read as they are today, not as they
were on the as-of date: a pull request's author association, its labels and
draft state, and the star count. The engine reads them at fetch time in live
use too, so this matches a live read made today. It doesn't match a read made
on the as-of date, and this is said once here rather than per repository.

## What counts as the outcome (fixed before the first run)

These definitions were written before any recording existed, so the results
can't shape them.

**Outside pull request in the window.** Opened after the as-of date and no
later than 45 days after it. The author is not a bot, not OWNER, MEMBER or
COLLABORATOR, and not on the project's team as `people.maintainers` finds it
over the before and after records together. Drafts and pull requests labelled
as spam are left out (`rates.excluded`), as the engine leaves them out.

**The unit is a person's first pull request in the window.** A reader asks
"will *my* pull request get in?", and they send one. A person who sends
twenty pull requests would otherwise weigh twenty times as much as a person
who sends one.

**Outcomes, per repository:**

| Outcome | Definition |
|---|---|
| `merged` | share of people whose first window PR was merged (or landed another way, `landing_detection`) by the capture date |
| `replied_14d` | share of people whose first window PR got a maintainer reply within 14 days |
| `people` | how many people opened an outside PR in the window |

A repository with **fewer than 8 people** in the window is *untested*: nobody
tried often enough to say what would have happened. It is reported but not
scored, because an answer that was never tested is neither right nor wrong.

**Scoring.** Each verdict is a promise about `merged`:

| Verdict on the as-of date | Promise | Broken if `merged` is |
|---|---|---|
| Worth your time | your PR has a real chance | under 15% (a **false green**) |
| Long shot | it gets in sometimes, probably not yours | not scored as right or wrong; its group should sit between the other two |
| Not worth your time | almost nothing gets in | 40% or more (a **false red**) |
| Not enough evidence, Personal project | no promise | not scored; the outcomes are shown |

The 15% and 40% lines come from outside the golden set. Newcomer PRs in popular
repositories merged 42% of the time in 2024–25 (Hoshikawa et al. 2026,
arXiv 2604.27532). So a Worth repository where fewer than 1 in 7 newcomers got
in is clearly wrong, and a Not worth repository at the population average is
clearly wrong too.

Reported for every counting method:

1. **False greens** and **false reds**, as counts out of the scored
   repositories, each one named.
2. **Order**: the median `merged` and `replied_14d` for each verdict group.
   Worth should sit above Long shot, and Long shot above Not worth.
3. **Rank agreement**: Spearman's correlation between the verdict (Worth 3,
   Long shot 2, Not worth 1) and `merged`. Stats vocabulary is fine here; it
   is a research document and never product copy.
4. **A baseline to beat**: the same scores for the plainest possible predictor,
   the first-PR merge rate in the before sample itself (Worth at 30% or more,
   Not worth under 10%, Long shot between). If the rules can't beat
   this, they add nothing.

## Counting methods compared

The engine's rules stay as they are; only what they count changes.

- `prs`: engine 4 as shipped. Every decided outside pull request counts once.
- `people`: every person counts once. Merged if any of their pull requests
  merged; unanswered if none of them got a reply.
- `first_pr`: each person's first pull request in the sample counts once.

## Running it

```sh
# Record (needs a token; about 25 GraphQL points per repository)
GITHUB_TOKEN=$(gh auth token) uv run python -m golden.backtest record --as-of 2026-06-15
# Score every counting method, offline
uv run python -m golden.backtest run
```

`record` stops before the token's remaining points fall under 1,500, the same
floor the server's warm pass keeps, and picks up where it left off next time.

## Results: first run (as of 15 June 2026, engine 4)

73 repositories were recorded on 29 Sep 2026, using about 2,400 GraphQL
points. 51 of them were tested (8 or more people opened an outside PR in the
window), and 49 of those got a Worth, Long shot or Not worth answer.

| method | scored | false greens | false reds | rank agreement | Worth: merged / replied | Long shot | Not worth |
|---|---|---|---|---|---|---|---|
| prs (engine 4) | 49 | 3 | 5 | 0.38 | 44% / 72% (n=29) | 6% / 28% (n=4) | 9% / 22% (n=16) |
| people | 49 | 5 | 5 | 0.31 | 40% / 71% (n=31) | 10% / 28% (n=2) | 9% / 22% (n=16) |
| first_pr | 49 | 4 | 5 | 0.35 | 42% / 71% (n=30) | 11% / 36% (n=2) | 7% / 20% (n=17) |
| baseline | 49 | 1 | 2 | 0.75 | 56% / 78% (n=25) | 18% / 35% (n=11) | 5% / 20% (n=13) |

All five of engine 4's false reds are catalogues and lists: winget-pkgs,
homebrew-cask, first-contributions, free-programming-books and hacs. There
"Not worth" means "a merge here isn't a software contribution", and people do
get merged. That is a promise about something else, so the same table is also
shown without the 8 catalogues. This view was added after the first run and is
marked as such:

| method | scored | false greens | false reds | rank agreement | Worth: merged / replied | Long shot | Not worth |
|---|---|---|---|---|---|---|---|
| prs (engine 4) | 41 | 3 | 0 | 0.68 | 44% / 72% (n=29) | 6% / 28% (n=4) | 4% / 9% (n=8) |
| people | 41 | 5 | 0 | 0.59 | 40% / 71% (n=31) | 10% / 28% (n=2) | 4% / 9% (n=8) |
| first_pr | 41 | 4 | 0 | 0.62 | 42% / 71% (n=30) | 11% / 36% (n=2) | 5% / 11% (n=9) |
| baseline | 41 | 0 | 1 | 0.80 | 56% / 80% (n=19) | 18% / 35% (n=11) | 5% / 20% (n=11) |

Engine 4's false greens were microsoft/vscode (2 of 15 people got in),
jesseduffield/lazygit (0 of 22) and oppia/oppia (2 of 28).

### What it says

1. **The order is right, but Worth is too wide.** Worth sits above Long shot
   and Not worth under every counting method. But engine 4's 29 Worth
   repositories go on to merge anywhere from 0% to 90% of newcomers, and 9 of
   them are under 25%: vscode, lazygit, oppia, CircuitVerse, django, golang/go,
   bubbletea, zulip and pdf.js. Its Worth line is "2 merges from 2 people, at
   least 1 in 10 merged, at most half unanswered". A newcomer clears that bar
   in repositories where most newcomers don't get in.
2. **The plainest predictor beats the rules on the merge question.** The
   baseline is the before sample's own first-PR merge rate: Worth at 30% or
   more, Not worth under 10%, with both lines fixed in this document before the
   run. It ranks repositories better (0.80 against 0.68 without catalogues, 0.75
   against 0.38 with them), and its Worth group merges 56% of newcomers against
   engine 4's 44%. Its misses are the cases the rules exist for: it calls
   public-apis (a catalogue, 7%) Worth, and it calls keploy and hacs Not worth.
3. **Counting people instead of pull requests doesn't help on its own.** With
   engine 4's thresholds, `people` and `first_pr` score slightly worse than
   `prs` (0.59 and 0.62 against 0.68). The gap is inside the noise at 41
   repositories. Those thresholds were argued for PR counts: `people` lets
   semgrep and git through as Worth, because a few prolific authors' ignored
   PRs stop counting against them. So the thresholds don't carry over
   unchanged. The baseline, which is a first-PR count with its own thresholds,
   is the best of all. The unit is fine; the lines need setting for it.
4. **Found after seeing the data (needs a second as-of date).** Engine 4's
   rules, with Worth also requiring a first-PR merge rate of at least 30% in the
   before sample (otherwise Long shot), score 0.83 without catalogues, with no
   false greens and no false reds. It keeps the rules' structural answers
   (archived, mirror, catalogue, inactive, personal) and takes the baseline's
   Worth line. The 30% was fixed before the run, but choosing this combination
   was not, so it must be confirmed on a second as-of date before it ships.

## Results: second run (as of 15 April 2026, engine 4)

The same 73 repositories, recorded on 29 Sep 2026 with an as-of date of 15
April (window 15 April to 30 May), about 2,400 more points. 50 were scored.
Nothing was tuned between the runs.

| method | scored | false greens | false reds | rank agreement | Worth: merged / replied | Long shot | Not worth |
|---|---|---|---|---|---|---|---|
| prs (engine 4) | 50 | 3 | 5 | 0.39 | 49% / 62% (n=27) | 11% / 33% (n=9) | 15% / 14% (n=14) |
| people | 50 | 7 | 5 | 0.28 | 44% / 50% (n=32) | 22% / 30% (n=4) | 15% / 14% (n=14) |
| first_pr | 50 | 4 | 5 | 0.38 | 47% / 57% (n=29) | 8% / 30% (n=6) | 14% / 20% (n=15) |
| baseline | 50 | 0 | 1 | 0.76 | 57% / 75% (n=23) | 15% / 24% (n=12) | 6% / 27% (n=15) |

Without the 8 catalogues: engine 4 0.69, people 0.57, first_pr 0.67,
baseline 0.79. Engine 4's false greens were semgrep (1 of 13 got in), lazygit
(1 of 19) and keploy (0 of 9); its false reds were again all catalogues.

**Every finding of the first run holds.** Engine 4's Worth group is too wide
again. The baseline beats the rules again by the same margin. Counting people
with engine 4's thresholds is worse again (people 0.28 against 0.39).

**The combination from finding 4, checked on a date it never saw.** Engine 4's
rules, with Worth also requiring a first-PR merge rate of 30% or more in the
before sample (otherwise Long shot):

| as of | scored (no catalogues) | false greens | false reds | rank agreement | Worth | Long shot | Not worth |
|---|---|---|---|---|---|---|---|
| 15 Jun (where it was found) | 41 | 0 | 0 | 0.83 | 56% (n=19) | 16% (n=14) | 4% (n=8) |
| 15 Apr (unseen) | 42 | 0 | 0 | **0.86** | 53% (n=20) | 12% (n=16) | 3% (n=6) |

It holds out of sample. Its one clear cost is kubernetes/kubernetes: both
times its before sample showed under 30% of first PRs merged, so it moves to
Long shot, yet 49% and 55% of newcomers got in afterwards. Its cold PRs wait
for `/ok-to-test` and a SIG; the ones from people already in a SIG land. The
tested repositories it moves to Long shot on both dates are django,
golang/go, lazygit, bubbletea and kubernetes. It also moves semgrep and keploy
(April), and vscode, zulip, oppia, CircuitVerse and pdf.js (June). Every one of
them except kubernetes merged about 1 in 4 newcomers or fewer afterwards (golang/go
26% in April).

### Limits of this run

- **Two as-of dates, 41–50 scored repositories each**, and the same
  repositories on both, so the dates are not independent samples. One or two
  repositories moving is inside the noise; the Worth spread (finding 1) and the
  baseline gap (finding 2) are not, and both held on both dates.
- **Busy repositories' windows are short.** The after read stops at 200 pull
  requests, which covers only the first days after 15 June on the busiest
  (nixpkgs, vscode, kubernetes). Their outcome is about those days.
- **Association and labels are read today** (see "Known leaks"). A
  contributor who got write access after June counts as team, which slightly
  undercounts outside merges on both sides.
- **Replies are measured, but nothing scores them yet.** `replied_14d` is in
  the tables; the verdict promise is about merging.

### What this changes in the plan

- Step 7 (revisit the verdict rules) now has a target. The Worth line should
  rest on the share of people whose first PR got in, with a threshold near
  30%, and it has to hold on a second as-of date. The next engine PR can be
  judged by this harness before it ships.
- Catalogues need their own answer, not "Not worth your time". The critic
  said so (#9), and the backtest agrees: their merge odds are high.
- Done: the second as-of date (15 April) confirms the combination above.
  The next engine PR is that rule, judged by this harness on both dates.

## Engine 5: what the backtest led to

Engine 5 makes two changes, each scored here before it shipped.

1. **A new first reason for "Long shot", `few_newcomers_merged`.** It applies
   when fewer than 3 in 10 of at least 8 people got their first pull request
   in the sample merged (`Signals.first_pr_people`, `first_pr_merged`). This
   is finding 4's combination, but built into the engine and not bolted onto
   it.
2. **Catalogues and lists get their own answer**, "A list, not code"
   (`catalogue`, neutral), instead of "Not worth your time". Their answer is
   about what a merge there is worth, not whether one happens.

**One more correction came out of the golden diff.** A first version counted
every first pull request older than the 14-day settle window as "not merged"
if it was still open. On today's golden recordings that turned pytorch,
openssl, react-native, golang/go, llvm, kubernetes and ruff into long shots.
Yet each of them merged 40–76% of newcomers in the backtest windows. On
projects where review takes weeks, a first pull request two to eight weeks old
is usually still on its way in. So an open first pull request now counts only
once it is 60 days old (`FIRST_PR_OPEN_DAYS`).

That change also made the first-PR rate a better predictor of what happens
next: rank agreement between the before sample's rate and the next newcomers'
rate went from 0.79 and 0.81 to 0.87 and 0.88 (April and June). Waiting 30,
45 or 90 days did nearly as well. Kubernetes, the one repository June's
combination got wrong on both dates, is now right on both.

| engine | as of | scored | false greens | false reds | rank agreement | Worth: merged | Long shot | Not worth |
|---|---|---|---|---|---|---|---|---|
| 4 | 15 Apr | 50 | 3 | 5 | 0.39 | 49% | 11% | 15% |
| 5 | 15 Apr | 42 | 1 | 0 | **0.83** | 50% | 11% | 3% |
| 4 | 15 Jun | 49 | 3 | 5 | 0.38 | 44% | 6% | 9% |
| 5 | 15 Jun | 41 | 0 | 0 | **0.81** | 52% | 10% | 4% |

Engine 5 scores fewer repositories because catalogues now get their own
answer, which makes no promise about merging. Its one miss is semgrep in
April: it read Worth, and 1 of the next 13 newcomers got in. No Long shot
went on to merge 40% or more of newcomers on either date. On today's golden
recordings, 14 verdicts change: 8 catalogues move to "A list, not code", and
bubbletea, material-components-android, pdf.js, rustlings, tldr and zulip move
from Worth to Long shot. The hand checks agree 10/10; the two registry hand
checks now expect the catalogue answer.

Caveats: the 30% line and the 60-day wait were both chosen on these same two
dates, so they need a third date or a fresh set of repositories before they
are treated as settled. The winget-pkgs hand check was written for "Not
worth"; its reason still holds under the new answer.


## Engine 6: the way in

Engine 6 changes what a report says about closes and requirements, not the
rules. Unmerged closes with no reply are sorted (a bot's check within three
days, a stale bot, the author withdrawing, closed without a word), and the
next step names what a project requires (an accepted ticket, no AI-written
pull requests, approved tests, a team to find). All of these stay decided
attempts that weren't merged, so no rule's input moves.

One change does reach the counts: titles a maintainer rewrote as spam ("AI
junk", "[rejected AI] …") now leave them, like a spam label already did. On
the backtest that only touches the outcome side for flask and itsdangerous:
the people who sent AI junk after the date no longer count as newcomers who
tried, so flask in April falls under the 8-person line and isn't scored.

| engine | as of | scored | false greens | false reds | rank agreement | Worth: merged | Long shot | Not worth |
|---|---|---|---|---|---|---|---|---|
| 5 | 15 Apr | 42 | 1 | 0 | 0.83 | 50% | 11% | 3% |
| 6 | 15 Apr | 41 | 1 | 0 | 0.83 | 50% | 12% | 3% |
| 5 | 15 Jun | 41 | 0 | 0 | 0.81 | 52% | 10% | 4% |
| 6 | 15 Jun | 41 | 0 | 0 | 0.81 | 52% | 13% | 4% |

No verdict changes on either date or on the golden set. Kubernetes and
semgrep stay where engine 5 had them: the new asks tell a newcomer how to get
in, and don't touch the answer.
