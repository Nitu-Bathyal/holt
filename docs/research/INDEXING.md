# Indexing thousands of repositories on one GitHub budget

Research for the owner, 30 September 2026. It asks how Holt can keep a large,
fresh and honest index for the fewest GitHub points. This is a note, not code.
Every number is either measured (live on GitHub, or offline on the golden
set) or quoted from GitHub's docs, and it says which.

## Summary

**Recommendation: keep full reports as the only thing Holt shows, and stop
paying for reads that can't change the answer.** In order:

1. **Keep each report's evidence and re-derive from it** (ticket A1, already
   planned). An `ENGINE_VERSION` bump then costs 0 points instead of a full
   re-read of the index. This is the biggest saving by far.
2. **Read the same evidence in fewer queries.** Fold the repository facts,
   docs and first page of PRs into one query, and use 29 PRs a page instead
   of 25. The data is identical and the cost drops from about 12 points to
   about 8.5.
3. **Skip refreshes when nothing moved.** One batched query checks 40 repos
   for 1 point. Each repo that didn't change is re-derived from its snapshot
   instead of read again.
4. **Later: read only what changed** (TICKET B1). This matters less than
   expected, because 82% of the seed list has PR activity in any given week.

**Don't do these:**
- Publish a verdict from a cheap screen. The best cheap screen agreed with
  the full verdict on 44 of 73 golden repos.
- Take verdict inputs from ecosyste.ms or OSS Insight. Their data comes
  from GH Archive, which has lost `author_association` since October 2025,
  and the ecosyste.ms licence restricts commercial use.
- Use signed-in users' tokens to index repos for others.

**Points per 1,000 repos per month** (assumes 2 engine bumps a month; the
last 3 days had 6):

| | Weekly freshness | Monthly freshness |
|---|---|---|
| Today: full report on every refresh and every bump | **~76,000** | **~36,000** |
| 1. Snapshots + re-derive (A1) | ~52,000 | ~12,000 |
| 2. + reshaped read (≈8.5 points) | ~37,000 | ~8,500 |
| 3. + change check, skip unchanged repos | ~30,000 | ~7,800 |
| 4. + change-only reads, with a monthly full re-read | **~18,000** | ~7,800 |

**Points aren't the real limit; spikes and wall-clock time are.** GitHub
allows 5,000 points an hour, about 3.6 million a month. Weekly full reports
on all 1,558 seeds would use about 2% of that. What actually hurts:

- **An engine bump re-reads everything at once.** For 1,558 repos that's
  about 19,000 points, 5–6 hours of the budget warm is allowed to use.
- **Warm runs one report at a time,** at about 45 seconds each. One sweep of
  1,558 repos takes about 19 hours of the runner. For 10,000 repos, a weekly
  sweep would barely finish inside the week.

Steps 1 and 3 fix both. A re-derive takes seconds and reads nothing.

**What it costs to build:** one small PR per step (tickets at the end).

- Steps 1–3 are about 3–4 worker-days.
- Step 4 is 2–3 days, plus a week of side-by-side checking.
- Steps 2 and 4 change the evidence reader. They need a golden diff with zero
  changes, plus the proofs listed on each ticket.

**What it risks:**

- **Step 2:** a paging bug could change which PRs are in the sample. The
  proof catches this.
- **Step 3:** a probe could say "unchanged" when something did change, and
  the report goes stale. The monthly full re-read caps how stale.
- **Step 4:** some fields GitHub reports as of today (whether someone is a
  collaborator, labels, draft) can drift on PRs that weren't touched. The
  monthly re-read resets them.

None of the steps changes a verdict rule.

---

## 1. What a report costs today, and cheaper full reads

### Where the points go

GitHub's pricing rule, quoted from
[GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api):
"Add up the number of requests needed to fulfill each unique connection in the
call. Assume every request will reach the `first` or `last` argument limits",
then "divide the number by 100 and round the result to the nearest whole
number", and "the minimum point value of a call to the GraphQL API is 1".

A report (`src/holt/evidence/github_graphql.py`) makes these queries:

| Query | Points | Why |
|---|---|---|
| Existence check before queueing (`server/holt_server/github.py`, `GitHubLookup`) | 1 | The minimum |
| Repository facts (`REPO_META`) | 1 | The minimum |
| README, CONTRIBUTING, AI policy (`docs_query`, 33 file lookups) | 1 | File lookups aren't connections. It's the minimum. |
| PR pages, 25 PRs each, newest 200 (8 pages) | 8 | 1 search + 25 × 5 connections per PR (files, reviews, comments, labels, timeline) = 126 → 1 point per page |
| Older PRs past the 14-day settle window (busy repos only) | 0–8 | Same page, same price |
| **Total** | **10 typical, 12 average, 18 max** | Prod re-run of 304 repos ([REVIEW-2026-09-30.md](REVIEW-2026-09-30.md), section 5) |

A page's cost doesn't depend on how many comments or files a PR returns (the
inner `first:` sizes). It depends only on PRs per page × connections per PR.

### Measured: what reshaping saves

Measured with `rateLimit(dryRun: true)` on `pallets/flask`, reading the cost
GitHub reports:

| Shape | Points |
|---|---|
| Today's page, 25 PRs × 5 connections | 1 |
| Same page, **29 PRs** (146 requests) | **1** |
| Same page, 30 PRs (151 requests) | 2 |
| No timeline, 37 PRs | 1 |
| No labels, 37 PRs | 1 (38: 2) |
| Facts + docs + first page of **25–28** PRs, **in one query** | **1** (today: 3) |
| Facts + docs + first page of 29 PRs, in one query | 2 (the facts add ~6 connections) |

So a report reads the same evidence as today like this:

- **One query:** repository facts, docs and the first 28 PRs, for 1 point.
  Docs are read from the default branch head (`HEAD:README.md`). A live read's
  cutoff is "now", so that is the same commit, unless someone pushes during
  the second or so between the queries.
- **Pages of 29 PRs:** the newest 200 take 1 + 6 = 7 queries instead of 10.
  The settle-window read gets about 1 point cheaper too.
- **Existence check over REST:** `GET /repos/{owner}/{repo}` draws on REST's
  separate budget ("The GraphQL API also has a separate primary rate limit",
  [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
  Holt barely uses REST. That takes 1 GraphQL point off every uncached
  request.

**Estimate: 12 → about 8.5 points per report (−30%), with the evidence
unchanged.** Across the 1,558 seeds (scan below), the estimate without the
settle-window read is 9.6 → 6.7. The estimate comes from each repo's PR count.

### Measured: which parts of the evidence decide verdicts

Offline, on the 73 golden recordings: I removed one part of the evidence at a
time and re-ran the free report (`analyze_without_model`, as
`golden/golden.py` does). Every verdict is compared with the full recording.
The full recording reproduces all 73.

| Removed | Verdicts unchanged | Which flipped |
|---|---|---|
| Labels | 73/73 | none (counts may still move) |
| Releases | 73/73 | none |
| README / CONTRIBUTING | 73/73 | none (the report page still shows them) |
| Timeline (who closed a PR, same-repo commit references) | 72/73 | material-components-android: Long shot → Not worth |
| Comments beyond the first 5 per PR | 70/73 | git, golang/go, kubernetes |
| Comment bodies | 70/73 | git, golang/go, openssl (landing detection reads "landed in …") |
| File lists | 65/73 | all 8 catalogues (catalogue detection reads which folders a merge touched) |
| Only the newest 150 PRs | 49/73 | busy repos turn "too new to judge" |
| Only 150 PRs from before the settle window | 68/73 | posthog, bubbletea, kubernetes, vscode, tldr |

What this means:

- **Every connection except labels is doing work.** Dropping the timeline
  would allow 37 PRs a page but flips a verdict, so it isn't free.
- **Labels are the one candidate for a later trim.** Dropping them allows 37
  PRs a page, so 200 PRs take 6 queries. They never flipped a golden verdict,
  but they feed the spam exclusion and the "labelled as landed" rule, so
  counts would move. Only do it with the golden diff approved and the
  backtest re-scored.
- **Sample depth matters more than anything else.** Any read shallower than
  today's changes a lot of answers (next section).

## 2. A cheap screen in front of full reports

### What a screen can cost

A query can ask for many repositories at once, as aliases. With no connection
nested inside `pullRequests`, each repository adds 1 request, so 100 repos
would still round to 1 point. GitHub's time limits cap the batch well
before that. Measured (real queries, not dry runs):

| Batched query | Repos per query | Points | Time |
|---|---|---|---|
| Facts + newest 100 PRs, plain fields only | 10 | 1 | 8 s |
| Facts + newest 50 PRs, plain fields only | 20 | 1 | 8.5 s |
| Same, with `totalCommentsCount` and `changedFiles` | 5 | — | timed out (502) |
| Facts + PR counts + last 30 PRs by update time (the seed scan) | 40 | 1 | 6 s |
| Newest PR's update time only | 50 | 1 | 6 s |
| Newest PR's update time only | 100 | 1 | every repo failed: "Resource limits for this query exceeded" |
| Newest 100 PRs + first 5 comments and reviews each (no bodies) | 1 | 2 | — |

The limit is GitHub's 10-second timeout and resource limit, not points.
Computed fields like `totalCommentsCount` are slow. GitHub also warns that
after a timeout "additional points will be deducted from your primary rate
limit for the next hour", so batch sizes need a margin.

### How honest a screen is

Measured offline on the 73 golden recordings. For each recording I kept only
what a screen would receive, then ran the same rules:

| Screen | Cost | Agrees with the full verdict |
|---|---|---|
| A: newest 100 PRs, plain fields only, every PR treated as answered | ~0.1 points/repo (10 per query) | 27/73 |
| A, but 100 PRs from before the settle window | ~0.1 | 44/73 |
| A, with no replies at all (counts silence as ignored) | ~0.1 | 26/73 |
| B: newest 100 PRs + first 5 comments/reviews, no bodies, files, labels or timeline | 2 points/repo | 31/73 |
| B, 100 PRs from before the settle window | 2 | 47/73 |
| B, 200 PRs | 4 | 43/73 |
| Before the settle window, with files and timeline, no labels or bodies | ~4 | 59/73 |

The flips aren't harmless. Posthog goes from Not worth to Worth. Catalogues
become Worth or Not worth. Golang/go and react-native, which land work outside
the merge button, become Not worth.

A screen can't see four things the verdict turns on:

- who counts as the project's team (reviews and merges);
- whether a maintainer replied (comments, reviews);
- what a merge touched (file lists);
- how a PR landed (timeline and comment text).

**Holt shouldn't show a screen's answer as a verdict,** not even labelled
"provisional". A beginner can't weigh "provisional", and "Worth your time"
from a screen would be wrong about a third of the time.

What a screen *is* good for:

- **Exact answers from the repository facts alone.** Archived repos, and PRs
  switched off or limited to collaborators, are the first rules in
  `verdict.py`, and they read only the facts. A screen reaches the same
  verdict for the same reason.
- **Triage and ordering:** which repos are dormant, which are busy, which
  have changed. Section 3 uses this.

### The seed list, screened (measured)

One scan of all 1,558 repos in PR #189's seed list cost **39 points**, in 39
batches of 40 with no failures. It read the repository facts, the PR totals,
and the update times of the last 30 PRs.

- **Missing or private:** 0. **Renamed:** 1 (`furkanczay/better-payment` is
  now `czaydev/better-payment`). **Archived:** 0.
- **PRs closed to outsiders, by GitHub's setting:** 16.
  - 15 are collaborators-only and 1 has PRs switched off.
  - The list: tldraw, syncthing, persona-3-dual, just, ckb-next,
    CodenameOne, httpx, giselle, haproxy, Valetudo, streamlit, yarn,
    botpress, habitica, osu, eslint-plugin-unicorn.
  - Engine 6 answers these "Not worth your time" without reading a PR.
  - Some are surprising (streamlit, osu), so the setting is worth a look.
- **Dormant (no push and no PR touched in 90 days):** 65. These are likely
  "Not worth: inactive" or "Personal project".
- **PR activity by period:**

  | Period | No PR touched | 1–5 | 6–29 | 30 or more |
  |---|---|---|---|---|
  | Last day | 37% | 26% | 24% | 13% |
  | Last 7 days | **18%** | 20% | 28% | **34%** |
  | Last 30 days | 9% | 12% | 21% | 58% |

- **PRs per repo:** median 2,279 (quartiles 719 and 6,021). The list is
  mostly large, busy projects.

## 3. Refresh only what changed

### A "has anything changed?" check

Two ways to check, both measured:

- **GraphQL, batched.** Each repo's `pushedAt` and its most recently updated
  PR (`pullRequests(first:1, orderBy:{field:UPDATED_AT, direction:DESC})`).
  50 repos cost 1 point; 100 in one query hit the resource limit. **About
  30 points per sweep of 1,558 repos.** No per-repo state is needed beyond
  the two timestamps from last time.
- **REST, conditional.** GitHub:

  > "Making a conditional request does not count against your primary rate
  > limit if a 304 response is returned and the request was made while
  > correctly authorized with an Authorization header."
  > ([REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api))

  Tested on `pallets/flask`, with
  `GET /repos/pallets/flask/pulls?state=all&sort=updated&direction=desc&per_page=1`:

  - The first call returned 200, with `x-ratelimit-used` at 43.
  - Three calls with `If-None-Match` returned **304**, and `used` stayed at
    **43**.
  - `GET /repos/pallets/flask` behaved the same way.

  So an unchanged repo costs nothing, and a changed one costs 1 request
  from the REST budget, never a GraphQL point. It needs a stored ETag per
  repo.

**Recommendation: use the GraphQL batch.** It is cheap enough (about 30
points a sweep), needs no ETag store, and reads the same timestamps the
refresh uses. Keep REST conditional requests in mind if the index grows to
tens of thousands of repos.

One thing the docs don't say: that a PR's `updatedAt` moves when someone
comments or reviews. The schema says only "the date and time when the object
was last updated". The gate's ticket should check this live on one PR before
it relies on it. The `pushedAt` half of the check doesn't depend on it.

**What the check saves on the seed list:** in a given week, 18% of repos have
no PR touched, and in a given month 9% (scan above). Those get re-derived
from their snapshot at 0 points. A re-derive keeps the report's read date:
the report says when GitHub was read, so it stays honest.

### Change-only reads (TICKET B1)

Read only the PRs updated since the last snapshot and merge them into it:
`repo:o/r is:pr updated:>=<last read> created:>=<oldest PR in the sample>`.
The second qualifier stops old PRs outside the sample from costing pages.
Replace the updated PRs in the stored sample, add the new ones, and let the
engine pick the sample exactly as today.

Estimated cost per repo per week on the seed list:

- 18% of repos changed nothing: 0 points.
- 48% touched 1–29 PRs: 1 point (with facts and docs in the same query).
- 34% touched 30 or more, where the change-only read is no cheaper than a
  full one: about 7 points.

**Mean about 2.9 points, against about 8.5 for a reshaped full read.** On the
golden set, which is busier (median 40 PRs touched in 7 days), the mean is
3.5 points a week.

Where it can drift from a full read: GitHub reports some fields as of the
moment it's read.

- A PR that wasn't touched keeps last week's association (CONTRIBUTOR,
  MEMBER…), labels and draft state.
- An author who joins the team shows up on their new PRs, but not on their
  old untouched ones.

Hence the monthly full re-read. It also covers the settle-window read
reaching further back than the snapshot holds: when that happens, do a full
read.

**Proof it needs:** the golden set has no history, so build it.

- Record ~20 repos twice, a week apart (about 170 points each time).
- Derive week 2 from week 1 plus a change-only read.
- Compare it with the direct week-2 read: the same verdict and counts
  everywhere, and any difference explained by the drift above.
- Then run it side by side with full reads on staging for a week.

## 4. Free outside data

| Source | What it has | Fresh? | Can Holt use it? |
|---|---|---|---|
| [issues.ecosyste.ms](https://issues.ecosyste.ms) | Per repo: PR and merged counts, past-year counts, time to close, authors, bot counts, association totals, maintainers. Per PR (`…/issues?pull_request=true`): `author_association`, `merged_at`, `comments_count`, `closed_at`. No reviews, reply times or `merged_by`. | Fed from GH Archive hourly; a lookup re-syncs if the last sync is more than a day old. Flask was synced 2026-09-30 02:33. | **No, not for verdicts.** Its importer notes that GitHub's PR event "only includes: id, number, url, base, head" since October 2025, so association and merge fields go missing on recent PRs. Flask shows 12 merged in the past year against 193 closed, 718 PRs in total, and one foreign PR in its list. |
| [repos.ecosyste.ms](https://repos.ecosyste.ms) | Archived, fork, stars, `pushed_at`, previous names, scorecard | Re-synced about weekly | Only for discovering repos. Holt reads these facts itself for about 0.025 points each (the seed scan). |
| GH Archive / BigQuery | Every public event since 2011 | Hourly | Covered by the other worker's note (`docs/research/GH-ARCHIVE.md`). The October 2025 payload trimming ([GitHub changelog](https://github.blog/changelog/2025-08-08-upcoming-changes-to-github-events-api-payloads/): "The `author_association` field will be removed") takes away the field Holt's outsider count starts from. |
| [OSS Insight API](https://ossinsight.io/docs/api) | Per-repo PR *creators* (first PR opened and merged). No merge rates or reply times. | GH Archive + Events API; says PR events "since mid-2025 were badly under-captured", fixed 1 Sep 2026 | No: 600 requests/hour per IP, beta, no data licence found |

**Licence:**

- ecosyste.ms data is CC BY-SA 4.0 and needs attribution.
- Its [terms](https://ecosyste.ms/terms) exclude the right to "commercially
  use our Platform or ecosyste.ms Content". Holt has paid plans.
- The [pricing page](https://ecosyste.ms/pricing) says the free tier is 300
  requests/hour, which contradicts the 5,000/hour in its READMEs, and offers
  "less restrictive licences on request".

Using it for Pro would need their written OK first.

**Honesty:** Holt's report says what it counted from GitHub and links each PR.
Numbers from a third party, lagging and missing fields, would break that
promise. Even for discovery (finding repos with many outside PRs), treat
ecosyste.ms as a list of candidates that Holt then reads itself. That use
needs no licence question answered, because nothing of theirs is shown.

## 5. Index what people look up

Prod data is off limits for this note, so this comes from the code:

- **`usage_events`** records one row per person per day per analysis, with
  `repo_key`. This is the best demand signal Holt has, for signed-in and
  signed-out people alike.
- **`repo_views`** only covers people who connected GitHub, so it is small.
  **`saved_repos`** is explicit interest.
- **The extension chip** calls `/api/public/report/{owner}/{repo}`. A 404
  there ("nothing cached") is someone on GitHub looking at a repo Holt
  hasn't read. As far as I can see, it isn't logged per repo.

For the owner to run: how much of the seed list is ever looked up.

```sql
-- seeds that anyone analysed in the last 30 days, and non-seeds people asked for
SELECT count(DISTINCT repo_key) FROM usage_events
 WHERE kind = 'analysis' AND day >= to_char(now() - interval '30 days', 'YYYY-MM-DD');
```

Join that with the seed list. If it turns out, as usual for catalogues, that
most seeds are rarely opened:

- The "monthly" tier of A3 can stretch to 60 days for seeds nobody opened.
- Their verdict still gets re-derived at 0 points on engine bumps.
- The weekly tier should add repos whose extension chip 404ed. It needs a
  counter, not a log of who.

## 6. More headroom, legitimately

- **The App's own limit:** 5,000 points an hour per installation. That grows
  by 50 for each repo past 20, and each org member past 20, up to 12,500
  (GraphQL rate limits page). `holt-oss` is far below 20 of either. Creating
  repos to grow it would be gaming the rule.
- **Installations on other accounts are separate budgets.** Using their
  tokens to read unrelated repos is the pooling ADR 0001 rules out. The terms
  say "you may not share API tokens to exceed GitHub's rate limitations".
- **Asking GitHub:** "Rate limit increases can be granted both at the GitHub
  Apps level (affecting all installations) and at the individual
  installation level"
  ([GitHub Apps vs OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)).
  No page describes how to ask, so it would go through GitHub Support. Worth
  doing once Holt has launch traffic to point to. The steps above come first,
  because GitHub will ask what the app already does to use less.
- **Enterprise Cloud** doubles GraphQL to 10,000 an hour and needs a paid
  org. It isn't worth it at this size.
- **Signed-in users' tokens.**
  - A user token draws on *that user's* 5,000 an hour: "This includes
    requests made … by a GitHub App or OAuth app on behalf of a user".
  - That's fair for the user's own things: their PR watch, their My
    Contributions.
  - It isn't fair for indexing repos other people read, which is pooling in
    all but name.
  - Today the privacy page promises "we don't keep the access tokens GitHub
    or Google hand back at sign-in". Using them would mean changing that
    promise, storing tokens securely, and asking for consent.
  - Keep this for Pro's per-user watch features, not for the index.

## Tickets, in order

Each is one small PR. None changes a verdict rule.

1. **A1: keep evidence, re-derive on engine bumps** (already written, in
   TICKET-index-history).
   - **Add:** `warm --stale-only` re-derives at the snapshot's read time,
     whatever its age within the tier, and reads GitHub only when no
     snapshot exists or the bump needs new evidence.
   - **Proof:** a re-derived report is identical to the live one on a
     fixture; a dry run on prod lists the points a bump would have cost
     (should be ~0).
2. **Existence check over REST** (server only).
   - `GitHubLookup.repo` uses `GET /repos/{o}/{r}` instead of a GraphQL
     query.
   - **Proof:** tests; GraphQL points per uncached request drop by 1 on
     staging.
3. **Reshaped read** (evidence reader: `github_graphql.py`).
   - Facts, docs (at `HEAD`, live reads only) and the first 28 PRs in one
     query; later pages of 29.
   - Keep the sample boundaries identical: 200 newest, and the settle-window
     read counted in the same 25-PR steps.
   - **Proof:** `golden diff` shows no changes; record 10 repos both ways at
     the same moment and the evidence records are identical; points per
     report shown before and after (10 → 7 on a normal repo).
   - No `ENGINE_VERSION` bump needed if the evidence is identical.
4. **Change check before refresh** (server, warm).
   - Batched `pushedAt` + newest-updated-PR query, 40 repos a query. Store the
     two timestamps per repo.
   - Unchanged repos get a re-derive, or are left alone; changed ones get a
     read.
   - Every repo gets a full read at least every 30 days.
   - First, one live check that `updatedAt` moves on a new comment.
   - **Proof:** a dry run over the seeds prints how many would be skipped and
     the points used.
5. **Seed hygiene from the scan** (seed list; could fold into PR #189).
   - Skip or flag the 16 PR-closed and 65 dormant seeds when warming; fix the
     1 rename.
   - Saves about 1,000 points and 1 hour of runner time per sweep.
6. **Demand counter.**
   - Count extension 404s per repo, a number per day with no people in it.
   - Feed it and `usage_events` into A3's weekly tier.
   - **Proof:** tests; the privacy page needs no change, because nothing is
     kept about the person.
7. **Later, B1: change-only reads,** after 1 and 4.
   - **Proof:** as in section 3: two recordings a week apart, derived vs
     direct compared, then a week side by side on staging.

Not recommended: screen verdicts; outside data as verdict input; users' tokens
for the index; dropping the timeline. Dropping labels only with a full golden
and backtest review.

## How this was measured

- **Live GitHub use for this note: 52 points** as GitHub reported them, on
  the owner's account.
  - The seed scan was 39 of those; the batched-query tests, probes and
    screens were the rest.
  - Five test queries timed out (502). GitHub may have charged extra for
    those; the amount isn't reported.
  - Cost comparisons used `rateLimit(dryRun: true)`, which the schema
    describes as "calculate the cost for the query without evaluating it".
  - Three REST calls returned 200 (1 request each); four returned 304 (free,
    as shown).
- **Offline:** the golden recordings (73 in `golden/expected.json`), replayed
  through `analyze_without_model` with parts of the evidence removed. The full
  recordings reproduce `expected.json` on all 73. The throwaway scripts aren't
  committed; each variant is described in the tables above.
- **Estimates, not measurements:**
  - 8.5 points for a reshaped report: 12 × 6.7 / 9.6 from the seed scan's PR
    counts.
  - 2 engine bumps a month.
  - 45 seconds per warm report, from REVIEW-2026-09-30.
  - The weekly change-only cost, from 30-PR-capped update counts.
