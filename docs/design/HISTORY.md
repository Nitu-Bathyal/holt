# Contribution history

Status: **prototype** (29 Sep 2026). `/lab/history` (throwaway, never merged) shows
four concepts on made-up data. Nothing real changes until the owner picks one.
The pick then becomes a section of *Your pull requests* ([DASHBOARD.md](DASHBOARD.md)),
built by the dashboard rollout.

Skills used: `frontend-design:frontend-design` (lead), `mattpocock-skills:prototype`
(the /lab route), `marketing-skills:referrals` (the card as a growth loop),
`pm-go-to-market:growth-loops`.

## The rules every concept follows

- **Honest numbers only.** A line appears only when the data behind it exists. No
  report on a repo means no comparison for it ("check this repo →" instead).
- **No streaks, no gaps, no guilt.** Nothing counts days since your last PR. Closed
  PRs are never called failures. Nothing is shown for a quiet month.
- **1 PR or 300.** Each concept was built on three people: a newcomer with one merged
  PR, a student with 15, a veteran with 312. Long lists fold, short ones don't pad.
- **Team repos stay out of the counts.** Repos you help run are left out unless you
  count them (the lab bar's "count team repos" stands in for that setting). When
  counted, they carry a `team` tag.
- **One moment of motion per concept**, and reduced motion gets the finished state
  (the lab bar previews it). Phone first: everything works at 360px.

## The four concepts

### A. Where it landed (`?concept=tree`)

Your work as `holt tree ~/<login>`: every repo you got merged in, its folders, and the
files your PRs touched, with the PR numbers on each file. The map is the codebase
itself. The headline is the one fact: *You're in pallets/click: docs/testing.rst* for
the newcomer, *You're in 95 files across 8 repos* for the veteran. "everything" adds
waiting and closed PRs. Big folders fold (the veteran's `python-modules/` shows 6 of
40). Click a file for its PRs. Motion: the tree prints line by line, once.

Why it could win: it's the one view GitHub can't draw, it matches Holt's "where
outside work lands" idea, and it looks like nothing else.

### B. Changelog (`?concept=changelog`)

You, released: `rae-builds v1.5.10`. Every first is a release (first merge, first
merge in a new repo, first in a new language, a merge faster than that repo's usual,
10/25/50/100/200 merged, a PR found on Holt). The merged PRs in between ride along
("+ 23 more merged"). Waiting PRs sit under **Unreleased**. The version reads back:
1.5.10 is five repos, ten merged, and 0.x means nothing merged yet. Motion: the
version counts up to where you are.

Why it could win: milestones without a scoreboard, and the joke is one developers
get at once. It grows gracefully: 1 release for the newcomer, 17 for the veteran.

### C. You got in (`?concept=odds`)

Each repo's usual odds for an outside PR (from Holt's report on it) beside yours:
ten cells for "1 in 10 outside PRs get merged here", your own PRs as cells below, and
a line of your merges against the repo's usual wait. The headline picks the proudest
true thing: *You got into microsoft/vscode, where most outside PRs don't*, else a merge
faster than usual, else where you landed. "Most don't" means 3 in 10 or fewer.
Motion: the cells fill, row by row.

Why it could win: it's the most Holt thing here, the verdict engine turned into
personal pride. Risk: it needs a current report per repo, and it's the least playful.

### D. Your year (`?concept=wrapped`)

A short story (tap or arrow keys), the cat reacting on each slide, ending on a card:
PRs opened, merged, where it landed, a repo you got into, the fastest merge,
languages. A slide appears only if the data says it, so the newcomer's story is
four slides and ends *first PR merged, in pallets/click*. "October" turns it into a
Hacktoberfest story in violet. The card is private until the owner publishes it, and
they tick each line that goes on it. Closed PRs never go on a card.

**As a growth loop** (referrals, growth-loops): the card is the product's one
naturally shareable output. Trigger moments: the first merge, the end of
Hacktoberfest, New Year. The link (`githolt.com/@login/2026`) opens a public page with
the card and the paste box, so a visitor checks a repo, signs in, connects GitHub and
gets their own card. No reward: pride is the incentive, and a reward would invite
gaming. Measure: cards published, visits per card, and sign-ins from card pages.

## What each needs

Today, `GET /v1/me/contributions` gives each PR's repo, number, title, state,
opened/merged/closed times, the repo's verdict and `found_via_holt`, for the last
365 days, at most 200 PRs, team repos already dropped.

| Needs | A tree | B changelog | C got in | D year | Server work |
|---|---|---|---|---|---|
| PR list, states, times | ✓ | ✓ | ✓ | ✓ | have |
| Files each PR touched | **core** | | | folder slide | **new**: `files(first: 20) { path }` in the search query (more GitHub points), or top-level folders only |
| Repo language | | new-language firsts | | languages slide | **new**, cheap: `primaryLanguage` in the same query |
| Repo's outside merge share | | "got in" note | **core** | "got in" slide | have, from the latest report; repos without one show "check this repo →" |
| Repo's typical merge time | | faster-than-usual | speed line | fastest slide | **coming** (repo stats) |
| Team repos kept but not counted | ✓ | ✓ | ✓ | ✓ | **coming** (store `own_projects`, a toggle) |
| First merged PR ever | footer line | "first merge of the year" vs "first PR merged" | | first-PR wording | **new**: one extra search, `is:merged sort:created-asc`, once |
| More than 200 PRs a year | ✓ | ✓ | ✓ | ✓ | **new**: raise `MAX_PRS` (the veteran has 312) |
| Public card | | | | **core** | **new**: an opt-in public snapshot (the lines the owner ticked), a public page and an image |

## Recommendation

Build **B (changelog)** into *Your pull requests* first, and **D (your year)** for
Hacktoberfest if there's time.

- B works on today's data (versions, repos, counts, found via Holt) and gets better
  as repo stats land. It's small: one pure function (`releases()` in the lab) and a
  list. It's personal, it motivates without streaks, and it scales from 1 to 300.
- D is the growth loop, but it needs the public snapshot and an image, so it's a
  launch-week stretch: ship the story first, the public card after.
- C's comparison is the strongest idea but the most data-hungry. Fold its best line
  ("you got in where most don't") into B's notes and D's slides, where it already is.
- A is the most original. Adding `files` to the search costs GitHub points on every
  refresh, so it's worth doing after launch, perhaps as a view inside B's releases.

## The prototype

`/lab/history` on staging. The bar at the bottom switches concept (`[` and `]`),
person (`1` `2` `3`), counts team repos and previews reduced motion. The URL keeps
`?concept=` and `?person=`. Lab "today" is 31 Oct 2026, so October has data. Publish
and copy on the card are stubs.
