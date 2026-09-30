# GH Archive as a backfill for PR history

Can [GH Archive](https://www.gharchive.org/) (hourly dumps of GitHub's public
events feed since 2011) give Holt years of PR history without spending GitHub
API points? Checked 30 Sep 2026 against real hourly files and GitHub's own
counts. Part A4 of the "index more repos and keep their history" ticket.

## Answer

- **Before 25 May 2025: usable.** Payloads are complete (PR author, author
  association, merged / merged by, timestamps, reviews, comments), and about
  nine in ten PRs are in the archive.
- **25 May 2025 to 7 Oct 2025: patchy.** Payloads are still complete, but
  GH Archive's crawler reads one page of GitHub's feed out of three, so a
  large share is missing: about half the PRs in a July 2025 sample.
- **Since 7 Oct 2025: not usable.** GitHub stripped PR events down to a stub
  (no author field, no merged flag, no author association anywhere), and the
  crawler bug stayed. We found 2–16% of PRs in the archive for busy repos, and
  some 2026 hours hold almost no PR events at all.
- **From 6 Sep 2026, a second source is complete but thin.** OpenDigger runs
  a GH Archive-compatible mirror that reads all three pages: it had 187 of the
  189 PRs GitHub counts for the same 2026 hour. Its payloads are the same
  trimmed stubs, so it can say *which* PRs moved and who acted, not whether the
  author is an outsider.
- **Cost of a backfill of 1,000 repos, mid-2023 to May 2025 (two years):**
  about 2.4 TB to download and roughly a day or two of one server core per
  year, with a few GB kept on disk; or about $100 of BigQuery. Zero GitHub
  points either way.

**Recommendation:** backfill only the two years before May 2025, as a one-off
BigQuery pass for the backtest, keep reading GitHub for anything later, and
look at the OpenDigger mirror as a free "which PRs changed" feed for part B's
change-only reads.

## 1. What GitHub changed (and what else broke)

**GitHub trimmed the Events API.** Changelog, 8 Aug 2025, ["Upcoming changes
to GitHub Events API payloads"](https://github.blog/changelog/2025-08-08-upcoming-changes-to-github-events-api-payloads/):

> Pull request events: Removing fields that are slow to generate and require
> costly database calls

> The author_association field will be removed from multiple event types (Pull
> Request, Pull Request Review, Pull Request Review Comment, Issue, Issue
> Comment, Commit Comment, and Discussion)

> On September 8, 2025, we'll perform an initial brownout test. On October 7,
> 2025, we'll officially implement the above changes.

The post lists no individual fields; the samples below show which went.
[GitHub event types](https://docs.github.com/en/rest/using-the-rest-api/github-event-types)
now lists `merged` as its own `PullRequestEvent` action.

**GH Archive's crawler has its own gap, since May 2025.** Commit
[f1f4200](https://github.com/igrigorik/gharchive.org/commit/f1f4200e4a14da266081697adda7f1119cc54c03)
(25 May 2025) polls `/events?per_page=500`, but the
[Events API](https://docs.github.com/en/rest/activity/events) caps `per_page`
at 100 and serves up to 300 events, so each poll reads only the first page.
The fix, [PR #317](https://github.com/igrigorik/gharchive.org/pull/317), is
unmerged; issues [#310](https://github.com/igrigorik/gharchive.org/issues/310),
[#312](https://github.com/igrigorik/gharchive.org/issues/312) and
[#320](https://github.com/igrigorik/gharchive.org/issues/320) document the drop,
with no reply from the maintainer. A GitHub
Community thread ([#178788](https://github.com/orgs/community/discussions/178788))
reports about 99.5% of events lost on 8–14 Oct 2025, permanently.

**OSS Insight's claim, confirmed.** The [ossinsight.io](https://ossinsight.io/)
banner says "star, pull request and issue events since mid-2025 were badly
under-captured … History before May 2025 … unaffected." Our counts agree,
though the cause is GH Archive's crawler plus GitHub's trim, not (as the
banner says) a change in GitHub's pagination.

## 2. What the payloads carry

Keys of `payload.pull_request`, from real hourly files:

| Event | 2024-09-17 15:00 UTC | 2026-09-15 15:00 UTC |
|---|---|---|
| `PullRequestEvent` | full PR object (49 keys): `user`, `author_association`, `state`, `created_at`, `closed_at`, `merged_at`, `merged`, `merged_by`, `draft`, `labels`, `additions`, `deletions`, `changed_files`, `comments`, `review_comments` … | `url`, `id`, `number`, `head`, `base` only |
| `PullRequestReviewEvent` | full PR object; `review` has `user`, `state`, `submitted_at`, `author_association` | PR stub; `review` has `user`, `state`, `submitted_at`, **no** `author_association` |
| `PullRequestReviewCommentEvent` | full PR object; `comment` has `user`, `created_at`, `author_association` | PR stub; `comment` has `user`, `created_at`, **no** `author_association` |
| `IssueCommentEvent` (on a PR) | `issue` and `comment` with `user`, `created_at`, `author_association` | same, **no** `author_association` anywhere |

In 2026 what survives is the event's `actor` and time: the actor of `opened`
is the author, the actor of `merged` is who merged it, the actor of `closed`
(now meaning closed without merging) is who closed it.

## 3. How much of GitHub's activity is in the archive

For the busiest repos in each sampled hour, we counted the PRs the archive saw
opened and merged in that hour, and asked GitHub's search for the true
numbers (`repo:X is:pr created:<hour>` and `merged:<hour>`).

| Hour (UTC) | Repos checked | PRs opened: archive / GitHub | PRs merged: archive / GitHub |
|---|---|---|---|
| 2024-09-17 15:00 | llvm, kibana, cockroach, nixpkgs, winget-pkgs, ydb | 46 / 54 (85%) | 59 / 65 (91%) |
| 2025-07-16 15:00 | llvm, kibana, nixpkgs, winget-pkgs, cockroach, posthog, metamask-mobile | 24 / 57 (42%) | 32 / 62 (52%) |
| 2026-03-10 15:00 | openclaw, tldraw, nixpkgs, llvm, kibana, winget-pkgs | 5 / 141 (4%) | 1 / 45 (2%) |
| 2026-09-15 15:00 | openclaw, posthog, kibana, llvm, winget-pkgs, nixpkgs, metamask-mobile, hermes-agent | 30 / 189 (16%) | 15 / 96 (16%) |

Every PR the archive had was a real one (the overlap was total); it just
misses most of them. Whole-feed counts for one hour (15:00 UTC on the 16th)
each month show the collapse and how erratic it is:

| Month | All events | PR events | Review events | File size |
|---|---|---|---|---|
| 2024-09 | 257k | 20.4k | 7.9k | 150 MB |
| 2025-01 | 256k | 18.6k | 7.4k | 135 MB |
| 2025-05 | 253k | 17.5k | 6.8k | 129 MB |
| 2025-06 | 164k | 14.0k | 5.2k | 99 MB |
| 2025-09 | 169k | 13.4k | 5.2k | 98 MB |
| 2025-10 | 147k | 8.2k | 3.2k | 36 MB |
| 2026-01 | 152k | 9.4k | 2.8k | 36 MB |
| 2026-03 | 152k | 2.0k | 0.5k | 23 MB |
| 2026-06 | 157k | 0.6k | 0.1k | 21 MB |
| 2026-08 | 168k | 0.08k | 0.02k | 20 MB |
| 2026-09 | 63k | 6.6k | 1.9k | 27 MB |

(Days of the week differ; the 2026 rows are 80–97% push events.)

**The OpenDigger mirror.** Since 6 Sep 2026 OpenDigger has published hourly
files in GH Archive's format at `https://gharchive.open-digger.cn/YYYY-MM-DD-H.json.gz`,
polling all three pages ([GH Archive issue #323](https://github.com/igrigorik/gharchive.org/issues/323)).
For 2026-09-15 15:00 UTC it held 476k events (102k PR events) against GH
Archive's 81k, and for the same eight repos it had 187 of 189 PRs opened and
103 merge events against GitHub's 96. It files events by crawl time rather
than event time, so a few from the neighbouring hour land in each file.
Same trimmed payloads (`pull_request` is `url`, `id`, `number`, `head`,
`base`). A third party with no stated guarantees, and hourly files only, no
BigQuery. One hour was 334 MB and took 4.5 minutes to download from here,
which puts a day near 8 GB.

## 4. What it could and couldn't give the engine

What Holt reads today is the GraphQL PR search in
`src/holt/evidence/github_graphql.py` (`PR_SEARCH`), turned into threads in
`src/holt/agent/signals.py`.

| Engine input | Before May 2025 | Since Oct 2025 |
|---|---|---|
| PR author, opened time | yes | author only if the `opened` event was captured |
| Author association (who is an outsider) | yes, and as it was *at the time*, which is better for the backtest than today's value | no; only the fallback `people.maintainers()` guess from who merges and closes |
| Merged, merged by, merge time | yes | from the `merged` event's actor and time, if captured |
| Closed without merging, who closed | yes (actor of `closed`) | yes (actor of `closed`), if captured |
| Reviews: who, state, when | yes | yes, minus association |
| Comments: who, when (reply timing) | yes | yes, minus association |
| Labels, draft | yes | labels only from `labeled` events |
| Changed-files count, additions, deletions | yes, on the `closed` event | no |
| File paths (where merged work lands) | no | no |
| "Closed by a commit" (the timeline's `closer`) | no; at most a `closes #n` in push-event commit messages | no (push events lost their commits) |
| Bots | yes (`user.type`) | login suffix only |

A PR whose `opened` event was missed can still be rebuilt, before May 2025,
from its `closed` event, which carries the full PR object. What it cannot
supply is a PR's whole comment thread when some comment events were dropped:
the reply-timing signal would be biased late.

## 5. Two ways to read it, and what each costs

A backfill has to read the whole feed however few repos it wants: GH Archive
has no per-repo files and BigQuery's tables are split by day, not by repo.

**Raw hourly files** (`https://data.gharchive.org/YYYY-MM-DD-H.json.gz`):
- Size: 130–150 MB an hour in 2024–early 2025 (about 1 GB uncompressed),
  so about 3.3 GB a day and **about 1.2 TB a year** to download.
- Speed here: one hour downloaded in 25–85 s (2–5 MB/s per stream) and took
  14 s of one core to decompress and filter. A year is about 34 core-hours of
  filtering and 3–6 days of single-stream download, less with a few streams in
  parallel. Stream, filter, discard: nothing big touches disk.
- Kept: in one busy 2024 hour the 300 seed repos had 911 PR, review and comment
  events. Scaled to 1,000 repos and a year, and trimmed to the fields in §4,
  that is on the order of 10 million events and a few GB.
- Money: none. Fine to run on the server at night; it doesn't touch `/`.

**BigQuery** (`githubarchive.day.YYYYMMDD`, `.month.YYYYMM`, `.year.YYYY`):
- On-demand price is $6.25 per TiB scanned, first 1 TiB a month free, billed
  on every column selected even with `LIMIT`
  ([pricing](https://cloud.google.com/bigquery/pricing)). `payload` is one JSON
  string column, so any query that reads PR fields pays for every event's
  payload that day.
- Estimate, not measured in BigQuery: a 2024 day is about 25 GB of payload
  (from the 1 GB/hour above), so one pass over a year is about 9 TB, **about
  $55 a year of history**. Do it as one
  query per year that writes the 1,000 repos' events to a small table, then
  download that; never one query per repo.
- Needs a Google Cloud account with billing on.

## Sources

- GitHub changelog, 8 Aug 2025: https://github.blog/changelog/2025-08-08-upcoming-changes-to-github-events-api-payloads/
- GitHub event types: https://docs.github.com/en/rest/using-the-rest-api/github-event-types
- Events API limits: https://docs.github.com/en/rest/activity/events
- GH Archive: https://www.gharchive.org/ and its crawler, https://github.com/igrigorik/gharchive.org/blob/master/crawler/crawler.rb
- BigQuery pricing: https://cloud.google.com/bigquery/pricing
- OSS Insight banner (the claim checked): https://ossinsight.io/
- Samples: the hourly files named above, read 30 Sep 2026; GitHub search counts
  from the REST search API (no GraphQL points). All downloads were deleted
  after the counts.
