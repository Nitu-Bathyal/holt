# Holt HTTP API (contract between `server/` and `web/`)

Version: v0 (pre-launch). The server is FastAPI in `server/`. The browser
never calls it directly. `web/` calls it from Next.js server code (route
handlers, server components) — a BFF. So:

- Every request carries `X-Holt-Internal-Key: <shared secret>` (env
  `HOLT_INTERNAL_KEY` on both sides). Requests without it get 401.
- Requests made for a signed-in user also carry `X-Holt-User: <user id>`.
  The server trusts it because of the internal key. Anonymous requests omit it.
- Anonymous requests carry `X-Holt-Client-Ip` for rate limiting. An anonymous
  request that needs rate limiting (new analyses, find, starter issues) without
  it gets 400 `invalid_request`; the server never falls back to the BFF's own
  address.
- Base URL for web: env `HOLT_API_URL` (e.g. `http://127.0.0.1:$PORT`).

Users, sessions and OAuth (GitHub + Google) live in `web/` (Auth.js). The
server keeps its own `users` table keyed by the same id, created on first
sight, holding plan and free AI credits. The website doesn't take users' own
API keys (the CLI does); every AI report runs on the server's key.

Response shapes are pydantic models in
`server/holt_server/schema.py`; the web's TypeScript types are generated from
them (`server/scripts/api_types.sh` writes `web/src/lib/api-schema.ts`, and CI
fails when it is stale). This file describes the fields; the models are exact.
Change a model, this file and the generated types in the same PR.

All bodies are JSON. Errors: `{"error": {"code": "<code>", "message": "<plain English for a beginner>"}}`
with codes: `unauthorized`, `not_found` (repo missing or private),
`invalid_repo`, `rate_limited` (ours or GitHub's; include `retry_after` seconds),
`quota_exceeded` (not enough credits, or a plan's monthly allowance is used up),
`needs_plan` (the feature comes only with a paid plan), `needs_key` (AI report requested without
signing in), `ai_unavailable` (AI is switched off: the server has no
model key or no AI budget, or the environment's AI budget is used up, which
also sends `"reason": "ai_budget_used_up"`; nothing is charged), `claim_not_ready` (a weekly claim before it is due),
`payments_off` (credit packs or plans aren't on sale), `payment_unconfirmed` (a
payment's signature didn't check out; nothing was credited),
`already_subscribed` (the user already has a paid plan),
`upstream` (GitHub/model failure), `internal`.

HTTP statuses: `unauthorized` 401, `not_found` 404, `invalid_repo` and
`invalid_request` (malformed body or query) 400, `rate_limited` 429 (also sent
as a `Retry-After` header), `quota_exceeded` 402, `needs_plan` 402, `needs_key` 403,
`claim_not_ready` 409, `already_subscribed` 409, `payments_off` 403, `payment_unconfirmed` 400, `ai_unavailable` 503, `upstream` 502, `internal` 500, `not_implemented` 501 (starter issues and find,
until the engine side ships).

## Rate limits

Two separate hourly buckets, per IP for anonymous callers and per user when
signed in:

- **work** — new analyses (`POST /v1/analyses` that queues a job) and
  `POST /v1/find` searches that are not cached or already running. Small
  (anonymous: 10/h). Cached answers, and joining a running job, are free.
- **read** — cache misses on reads (`/starter-issues`). Generous (anonymous:
  120/h). Viewing, reloading and sharing report pages can never use up work.

`GET /v1/reports/…` reads only the cache and is not rate limited.
`POST /v1/feedback` has a small bucket of its own (see Feedback), and so do
saving and unsaving repos (see Saved repos).

## Repo identifiers

`{owner}/{repo}`, case-insensitive, normalised to GitHub's canonical casing in
responses. The server also accepts and normalises full URLs
(`https://github.com/o/r`, `github.com/o/r.git`, `…/tree/main`, `?tab=…`).

## Report object

```jsonc
{
  "repo": "pallets/flask",
  "mode": "rules" | "ai",            // rules = no model; ai = model-written report
  "days": 7,                          // contributor time budget used
  "verdict": "viable" | "not_viable" | "insufficient_evidence",
  "headline": "Worth your time" | "Not worth your time" | "Not enough evidence",
  "tone": "good" | "bad" | "warn",    // the verdict's colour
  "verdict_line": "string",           // line 1: the reason for the verdict, one sentence
  "numbers_line": "string",           // line 2: what happened to outside contributors, with dates
  "first_timer_line": "string | null", // "9 people got their first pull request merged here."
  "next_step": "string",              // line 3: what to do next
  "stat_line": "string | null",       // short count for the extension chip: "22 of 120 outside PRs merged"
  "counted": [ { "topic": "What we read", "text": "The newest 200 pull requests on GitHub, opened 3 Jun – 26 Sep 2026." } ],
  "odds": { "level": "good" | "fair" | "long", "tone": "good" | "warn" | "bad",
            "text": "most outside pull requests get a reply, and plenty get merged" } | null,
  "bottom_line": "string | null",     // ai mode: at most two model-written sentences, the lead of the AI explanation
  "summary": "string | null",         // ai mode: short plain-English paragraph
  "stats": {
    "outsider_attempts": 100, "outsider_merged": 15, "distinct_outsiders": 72,
    "first_time_merged_authors": 15, "no_reply": 63,
    "median_first_response_hours": 0.8, "bot_share": 0.085,
    "still_open": 12, "closed_silently": 20
  },
  "decided_by": ["plain-English rule sentence", "..."],
  "rule_codes": ["merges", "rubber_stamp"], // stable code per decided_by line, same order
  "unknowns": ["plain-English sentence", "..."],
  "landing": [ { "path": "pkgs/by-name", "merged": 13, "attempted": 62, "is_file": false } ],
  "never_landed": [ { "path": "pkgs/applications", "attempted": 6, "is_file": false } ],
                                    // is_file: the path is one file, not a folder (default false)
  "evidence": [
    { "id": "pr:NixOS/nixpkgs#526518:opened", "url": "https://github.com/NixOS/nixpkgs/pull/526518",
      "kind": "onboarding", "value": "substantive", "text": "…", "quote": "string | null" }
  ],
  "evidence_until": "2026-06-01T00:00:00Z", // or null
  "generated_at": "2026-09-25T12:00:00Z",
  "sample": { "pull_requests": 200, "first_opened": "2026-06-03T10:00:00Z",
              "last_opened": "2026-09-26T09:00:00Z", "team_pull_requests": 40,
              "team_people": 9, "bot_pull_requests": 12 } | null,
  "asks": [ { "code": "cla" | "dco" | "issue_first", "url": "https://github.com/…" } ],
  "budget_independent": true,         // the verdict is the same for any `days` (see below)
  "cost": { "model": "…", "input_tokens": 9000, "output_tokens": 6000,
            "usd": 0.0123, "seconds": 48.2 }, // ai only, else null
  "holt_users": { "people": 9, "pull_requests": 12, "merged": 7, "closed": 2,
                  "waiting": 3, "window_days": 365, "computed_at": "…" } | null
}
```

`bottom_line` and `summary` are null in rules mode (the headline and
`verdict_line` already are the rules report's bottom line). In AI mode they are
the model's words, checked by the engine before they are stored; either can be
null on a report where the model wrote nothing usable, and `bottom_line` is
null on AI reports cached before it existed. Show them as AI-written.

`cost` is for operators, not the product: `usd` is what the model calls cost
(from the engine's price table), `seconds` the whole run's wall time. Both are
null on reports cached before they were recorded. Per-stage timings go to the
server log, not the report.

`holt_users` is what connected Holt users' public pull requests to this
repository came to (from My Contributions, the last `window_days`): counts only,
never who. It is filled only by `GET /v1/reports/{owner}/{repo}` (null on the
analysis endpoints and never stored with the report), and only when at least 5
different people make up the numbers: one person with many pull requests
counts once. Users who turned on `stats_opt_out` are never counted. The numbers
are recounted by the daily contributions refresh (and
`python -m holt_server.contributions stats`); opting out or disconnecting
recounts that user's repositories at once. Surfaces show them as they come and
never rank or name anyone.

### Engine version and `outdated`

Every stored report records the engine version that made it
(`ENGINE_VERSION` in `src/holt/engine_version.py`, bumped whenever the verdict
rules or the report's shape change; reports from before it was recorded count
as older). A report from an older version is never a cache hit: `POST
/v1/analyses` runs a fresh check, finds screen again, and Discover,
recommendations and My Contributions leave it out until it is redone. The
same goes for cached `/v1/find` results.

`outdated` (boolean) is filled only by `GET /v1/reports/{owner}/{repo}`, like
`holt_users`, and is never stored: `true` when an older engine made the report
returned. That endpoint still returns it (never a 404), so a client can fall
back to it; the web report page runs a fresh check instead and shows the old
report only if that check fails. The public extension proxy passes it on
(see below).

Every evidence item MUST have a clickable `url`.

In `stats`, an outsider is anyone not on the project's team. The team is the
repository's OWNER, MEMBER and COLLABORATOR accounts on GitHub, plus anyone the
sample shows merging or closing someone else's pull request, approving or
requesting changes on 3 or more other people's, or (in a project that labels
outside work, like PyTorch's "open source") never getting that label.
Returning outsiders count.
`first_time_merged_authors` is the number of those who were new to this repo
(nothing of theirs merged here before) and got a pull request merged. Reports
cached from evidence without GitHub's association use the earlier rule: an
outsider had nothing merged earlier in the sample.

`stats` counts are over **decided** newcomer pull requests: ones opened more
than 14 days (the settle window) before the report, whatever happened to them.
`outsider_attempts` is that decided total, so `outsider_merged /
outsider_attempts` and `no_reply / outsider_attempts` are the rates the verdict
was computed from. `no_reply` is still open, with no reply.
`still_open` (opened within the window, merged or not; in no rate; reports
cached before 30 Sep 2026 counted only the open ones) and `closed_silently` (closed with
no reply, usually maintainers clearing out spam; not in `no_reply`) are shown
beside them; both are 0 on reports cached before they existed. Drafts and pull
requests labelled as spam or invalid are in no count.
`landing` and `never_landed` count the same decided pull requests, so every
number on a report is over one set.

`sample` is what the counts were read from: every pull request read, when the
oldest and newest were opened, and how many came from the team or from bots
(left out of every count). Null on reports cached before it existed. `asks` is
what the project asks of a contributor, where Holt could read it: `cla` (a CLA
bot commented on outside pull requests), `dco` or `issue_first` (CONTRIBUTING
says so in as many words). `url` is where it was read. An empty list means
nothing was found, not that nothing is asked. Neither affects the verdict.

`headline`, `tone`, `verdict_line`, `numbers_line`, `first_timer_line`,
`next_step`, `stat_line`, `counted` and `odds` are derived by the server from
`verdict`, `stats`, `sample`, `landing`, `asks` and
`decided_by`/`rule_codes`, every time a report is
served (so cached reports pick up wording changes). Every surface (web, OG
images, the extension) shows these fields and never works them out itself, so
they cannot disagree with each other or with the verdict:

- `tone` follows the verdict: `viable` → `good`, `not_viable` → `bad`,
  `insufficient_evidence` → `warn`.
- `verdict_line` never oversells: "Worth your time" with a low merge rate or
  many unanswered pull requests says so. Under "Not worth your time" it states
  the rule that decided it.
- The top of a report is three lines, in order: `headline` + `verdict_line`
  (the verdict and one reason, without the counts), `numbers_line` (the
  counts with the dates they cover, e.g. "Of 120 pull requests from outside
  contributors (3 Jun – 26 Sep 2026), 22 were merged (18%). When a maintainer
  replied, it was typically within 6 hours. 25% got no reply at all."), and
  `next_step` (where outside work lands, what the project asks, or where to go
  instead). `first_timer_line` is null when nobody outside tried.
- The rule that decided the verdict is the last `decided_by` line whose code
  is not informational (`awaiting_reply`, `landed_off_button`,
  `package_updates`, `kind_contested`, `kind_uncited`, `sample_period`,
  `dormant`, `excluded`, `still_open`, `closed_silently`).
- `counted` is "How this was counted": the sample and its dates, the team and
  how it was worked out, bots, each informational `decided_by` line, the
  rules that decided, and the fixed rule itself. Topics are plain English and
  may change; render them as given.
- `stat_line` is null when nobody outside tried. The extension chip shows it.
- `odds` is non-null only when the verdict is `viable` (and anyone tried): the
  worse of the merge rate (good ≥ 12%, fair ≥ 5%) and the no-reply rate (good
  ≤ 25%, fair ≤ 50%); its `text` names the weak part. The other verdicts are
  the answer on their own.
- `rule_codes` is `[]` on reports cached before it existed. Codes include
  `archived`, `closed_kind`, `non_software_kind`, `no_attempts`, `ignored`,
  `merges`, `rubber_stamp`, `long_odds` (under 5% of outside pull requests
  merged), `inactive` (nothing merged or pushed in 90 days; decides alone),
  `slow`, `too_few_attempts`, `few_merges`, `few_people`,
  `elsewhere` (a mirror or a fork; decides alone, like `archived`),
  `landed_off_button` (says how many merges GitHub shows as closed because
  they landed another way; never decides); new ones may appear. These never
  decide and come before the deciding rule: `sample_period` (the dates the
  sample's pull requests were opened; first on every live report), `dormant`
  (nothing merged in 90 days), `excluded` (drafts and spam left out),
  `still_open`, `closed_silently`, `slow_note` (under "Worth your time": the
  typical first reply takes longer than `days`; `verdict_line` ends with
  it; comes after the merge count). `awaiting_reply` appears only on reports
  cached before `still_open` replaced it.

`days` is the reader's time budget (1–90, the web offers 7, 14 and 30). Since
30 Sep 2026 a rules report's verdict doesn't depend on it: replies slower
than the budget add the `slow_note` line under "Worth your time", or a `slow`
line beside the reason under "Not enough evidence". Such reports carry
`budget_independent: true`, and the server answers another budget from them.
AI reports and older cached ones carry `false` and are only served for the
`days` they were made for.

New fields are added with a default, so older cached reports stay valid.

`kind` is a machine key: in AI mode the engine field the claim is about
(`onboarding`, `outsider_posture`, `repo_kind`, …) or `outcome` for what
happened on one pull request (`value` e.g. `merged_after_review`, with the
maintainer's words in `quote`). Rules mode has no model claims; it lists the
newest first-timer pull requests behind the counts instead, as
`kind: "outsider_pr"`, `value: "merged" | "no_reply"`.

## Endpoints

### `GET /health` → `{"ok": true, "version": "…"}` (no internal key needed)

### `POST /v1/analyses`
Body: `{"repo": "owner/repo", "mode": "rules"|"ai", "days": 7, "refresh": false}`
- Model choice is server configuration (`OPENROUTER_MODEL`); a `model` field in
  the request is ignored. It is accepted (not a 400) for older clients, and it
  never reaches the engine, the job or the cache key.
- Returns `200 {"status":"done","report":Report}` immediately when a cached
  report exists (same repo/mode/days, younger than 24h, made by the current
  engine version) and `refresh` is false.
  For `mode:"rules"`, a report younger than 24h for **another** `days` counts
  too when it is `budget_independent`: it is served for the asked `days` with
  its reply-time note redone, and nothing is read from GitHub.
- Otherwise `202 {"status":"queued","job_id":"…"}`.
- `mode:"rules"` is free and allowed anonymously (rate-limited per IP).
- `mode:"ai"` requires `X-Holt-User` (else `needs_key`) and a server model key
  (else `ai_unavailable`, checked first, so nothing is spent or queued). A new
  job is charged for the `ai_report` feature (see Credits and plans below; else
  `quota_exceeded`); a cached report or joining a running job costs nothing. A
  job that fails gives back what it was charged, to the pool it came from.

### `GET /v1/analyses/{job_id}` → `{"status":"queued"|"running"|"done"|"error", "stage": "Reading pull requests", "progress": 0.4, "report": Report|null, "error": Error|null}`

### `GET /v1/analyses/{job_id}/events` — Server-Sent Events
Events: `stage` `{"stage": "…", "progress": 0.0–1.0}`, then exactly one of
`done` `{"report": Report}` or `error` `{"error": Error}`. `stage` strings are
plain English ("Fetching pull requests", "Reading threads", "Checking evidence",
"Writing the report"). While the job waits to start, `stage` events also carry
`"queue_position": n` (1 = next to start) with a matching stage such as
"In the queue: 3 checks ahead of yours", sent again each time the queue moves.
The same applies to `/v1/find/{job_id}/events`. A job that runs past its time
limit ends with `error` code `upstream` and a "took too long" message.

### `GET /v1/reports?limit=500` (internal key, like other reads)
The latest 7-day rules report per repository, newest first, for sitemaps:
`{"reports": [{"repo": "owner/repo", "mode": "rules", "generated_at": "…",
"verdict": "viable"}]}`. `limit` 1–5000, default 500.

### `GET /v1/reports/{owner}/{repo}?mode=rules|ai&days=7`
Latest cached report or 404 `not_found`. With `mode=rules` and no fresh
report for this `days`, a fresh `budget_independent` one made for another
`days` is served for this one (as for `POST /v1/analyses`). `outdated: true`
when an older engine version made it (see "Engine version and `outdated`"). Public via the BFF: no user needed
(used for shareable pages and OG images), but it still requires the internal
key like every `/v1` route.

### `GET /v1/repos/{owner}/{repo}/starter-issues?limit=20`
Open, unassigned issues in this repo that suit a newcomer, best first:
`{"repo": "…", "issues": [StarterIssue]}`. Cached per repository for 1 hour;
a cache hit costs no GitHub call and no rate limit. A miss counts against the
**read** limit, never the work limit (see Rate limits).

### `POST /v1/find`
Body: `{"languages": ["python"], "topics": [], "days": 7, "hacktoberfest": true, "limit": 20}`
Returns `{"results": [ { "repo": "owner/repo", "headline": "…", "tone": "good", "verdict": "…",
"description": "string | null", "language": "string | null", "stars": 123 | null,
"stats": {…subset}, "issues": [StarterIssue] } ]}` (`description`, `language`
and `stars` come from `repo_meta`, the same details Discover shows, read when
the search finishes and again each time a cached search is served; no GitHub
call. They are null for a repo the warm pass hasn't read yet, and the warm
pass reads every repo in a search from the last day. `stats` leaves out
counts it doesn't have rather than sending null), only repos whose rules
verdict is `viable`, ordered by starter-issue quality.

- **Cached** (same search, finished within 6 hours): `200
  {"status": "done", "results": [...]}` at once, with no rate limit. "Same
  search" means the same languages and topics (order, case and duplicates
  ignored), `hacktoberfest` and `days`; `limit` is a slice of one cached
  answer (searches are computed for at least 20).
- **Already running** for someone else: `202` with that search's `job_id`, also
  free.
- Otherwise `202 {"status": "queued", "job_id": "…"}`, which costs one unit of
  the work bucket; poll or stream under `/v1/find/{job_id}` like analyses.
  Polling a find job returns `results` instead of `report`; the SSE `done`
  event carries `{"results": [...]}`.

StarterIssue:
```jsonc
{ "number": 123, "title": "…", "url": "https://github.com/o/r/issues/123",
  "labels": ["good first issue"], "created_at": "…", "comments": 2,
  "why": ["Labelled good first issue", "Touches docs/, where 8 of 10 outsider PRs were merged"],
  "beginner": true,          // labelled for first-timers ("good first issue" and its spellings)
  "areas": ["docs"] }        // which of code/docs/tests/design/translations it looks like
```
`beginner` and `areas` are worked out from the labels and title every time an
issue is sent, so cached issues have them too. The web uses them with a
profile (see Profile); they never change a verdict or which repos are listed.

### `GET /v1/discover?sort=welcoming|stars|trending&language=python&topic=cli&hacktoberfest=true&limit=24`
Browse the repositories Holt has checked, built only from each repo's latest
7-day **rules** report (never the model) and ranking repositories, never
people. Reads only the database: no GitHub call and no rate limit.

- `sort=welcoming` (default; the "Most welcoming <language> repos" boards):
  only repos whose verdict is `viable`, best odds first (good, fair, long),
  then the share of outside pull requests merged (a small sample is pulled
  toward a typical share, so 6 of 8 doesn't outrank 60 of 105), the median
  reply time and how many outsiders tried.
- `sort=stars`: GitHub stars, every verdict.
- `sort=trending`: people who asked for the repo's report on Holt in the last
  7 days (each person counted once per UTC day), only repos with at least
  `trending_min` (5).
- `language` and `topic` filter case-insensitively (`c++`, `Python`). `limit`
  1–100, default 24.
- `hacktoberfest=true` keeps only repos tagged with the `hacktoberfest` GitHub
  topic (how a project takes part; a Hacktoberfest find searches the same
  topic) that aren't archived, under any sort and alongside the other filters.
  `languages` then counts those repos only. For a "Hacktoberfest" row use
  `?hacktoberfest=true&limit=20`: "Worth your time" repos, best first; add
  `sort=stars` to include every verdict. Reads only the database, like the rest
  of Discover, so it is as fast as the boards.

```jsonc
{ "sort": "welcoming", "language": "Python", "topic": null, "hacktoberfest": false,
  "trending_min": 5,
  "repos": [ { "repo": "owner/repo", "verdict": "viable", "headline": "Worth your time",
    "tone": "good", "reason": "…the report's verdict_line…", "stats": Stats,
    "description": "…"|null, "language": "Python"|null, "stars": 123|null,
    "topics": ["cli"], "pushed_at": "…"|null,
    "checked_this_week": 12|null,     // null below trending_min
    "generated_at": "…" } ],
  "languages": [ { "name": "Python", "repos": 40 } ] }  // filter chips, most repos first
```

`description`, `language`, `stars`, `topics` (all of them, up to GitHub's 20)
and `pushed_at` come from `repo_meta`, read from GitHub right after a
repository's report is stored (when it has none, or they are more than a day
old) and again once a day for every reported repository. The read after a
report is best effort and happens a few seconds after the report is done, so
they can be null or empty for a moment (a repo checked for the first time
joins the Hacktoberfest filter a few seconds after its report), or until the
next report or daily read if GitHub didn't answer.

### `GET /badge/{owner}/{repo}.svg` (no internal key; public; `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`)
Shields-style SVG badge. Maintainers embed it in READMEs; it links back to the
report page at `{HOLT_WEB_URL}/{owner}/{repo}`. Uses the latest 7-day rules
report:
- `viable`: a positive, factual line in green from `stats`, e.g.
  "Holt | merges outsiders · replies in ~6h" ("merges outsiders" when
  `outsider_merged` > 0; the reply time when the median first reply is within
  72h; "worth your time" if neither).
- any other verdict: neutral grey "Holt | see report", never a red verdict.
- no report yet: neutral grey "Holt | not checked yet".
- the report is from an older engine version: neutral grey "Holt | updating",
  never its old verdict, sent with `Cache-Control: public, max-age=300` so
  the new verdict shows soon.

When there is no report, or it is over 24h old or outdated, it shows what it
has and queues a rules check behind it. Badge-queued checks have their own rate
limits (per client IP and in total, separate from user limits), run at most
one at a time, and wait behind every user request.

### Account
- `GET /v1/me` → `{"plan": "free"|"…", "plan_expires_at": "…"|null, "credits": Credits}`.
  `plan` is the plan in force: `free` once a paid plan has lapsed.
- `GET /v1/me/credits` → `Credits`:
  `{"balance": 3, "free": 3, "purchased": 0, "can_claim": false, "next_claim_at": "…", "claim_every_days": 7, "ai_available": true}`.
  `balance` is every credit the user can spend (`free` + `purchased`); `free` is
  welcome, weekly and gifted credits, `purchased` credits from packs (0 until
  payments are switched on). `next_claim_at` is when the weekly claim
  opens (`can_claim` is true once it has passed). `ai_available` is false while
  the server has no model key.
- `GET /v1/me/entitlements` → `{"plan": "free", "plan_expires_at": null, "features": [Access]}`,
  one `Access` per paid feature in the pricing catalogue:
  `{"feature": "playbook", "name": "Contribution playbook", "allowed": false, "via": null, "cost": 1, "left_this_month": null, "code": "quota_exceeded", "message": "…"}`.
  `via` is how a use would be paid for now (`plan` or `credits`), `cost` the
  credits one use takes (0 when the plan covers it), `left_this_month` the
  plan's monthly allowance left (null when unlimited or none). When
  `allowed` is false, `code`/`message` are the error the paid request would get
  (`quota_exceeded` or `needs_plan`). Informational: the paid route decides
  again, atomically, when it charges.
- `POST /v1/me/credits/claim` → `Credits` with one more credit, or 409
  `claim_not_ready` (the message says the date).
- `GET /v1/me/history?limit=50` → recent analyses by this user:
  `{"items": [{"job_id", "repo", "mode", "days", "status", "verdict", "headline", "tone", "created_at"}]}`
  (`verdict`/`headline`/`tone` are null until the job is done).

`/v1/me*` without `X-Holt-User` → 401 `unauthorized`. Free AI credits: every
signed-in user gets `HOLT_SIGNUP_AI_CREDITS` (3) once, the first time the server
sees them (users from before credits get them on their next request), then can
claim one more whenever `HOLT_CLAIM_EVERY_DAYS` (7) have passed since the last
claim; the welcome grant starts that clock. Claims don't accumulate: at most one
is ever due. Spending, claiming and refunds are atomic on the server.

#### Credits and plans

Payments are off: nothing is on sale and every price is still to be decided.
What exists is the model they plug into, all on the server, never taken from
the client, and a checkout for credit packs that stays switched off (below):

- **Features** (`ai_report`, `playbook`, `preflight`, `guidance`,
  `recommendations`) and what one use costs in credits, **plans** (`free`,
  `pro`: what each covers, unlimited or N uses per UTC month, and for how long)
  and **credit packs** are defined in a JSON catalogue
  (`server/holt_server/pricing.json`, or `HOLT_PRICING_FILE`), with prices in
  INR and USD.
- A use is paid for by the plan when it covers the feature (free), else with
  the feature's credits: free credits first when the feature accepts them,
  then purchased credits, soonest-expiring first. A feature with no credit
  price needs a plan (`needs_plan`).
- Two credit pools, one ledger: free credits (welcome, weekly claim, gifts)
  and purchased credits (packs; they never expire, or expire when the pack
  says). Every change is a ledger row saying which pool.
- Admins change credits and plans with a CLI (`python -m holt_server.credits`,
  server/README.md), not over HTTP.

#### Credit packs (checkout)

Razorpay, INR, one-time payments. **Switched off** unless the server has
`HOLT_PAYMENTS_ENABLED=1` and its Razorpay keys, and a pack in the catalogue
has `on_sale: true` and an INR price. While off, `GET /v1/packs` offers
nothing and `POST /v1/me/orders` answers 403 `payments_off`. The price,
the credits and the expiry always come from the server's catalogue.

- `GET /v1/packs` (internal key; no user needed) → `{"on_sale": false, "packs": [Pack]}`,
  `Pack`: `{"id": "credits_10", "name": "10 credits", "credits": 10, "expires_days": null, "amount": 49900, "currency": "INR"}`
  (`amount` in paise). `on_sale` is false and `packs` empty while payments are off.
- `POST /v1/me/orders {"pack": "credits_10"}` → `Checkout`:
  `{"order_id", "provider": "razorpay", "key_id", "provider_order_id", "amount", "currency", "name", "description", "pack", "credits"}`,
  everything Razorpay Checkout needs (`key_id` is the public key id). Any other
  field in the body is ignored. 400 `invalid_request` for a pack not on sale,
  403 `payments_off`, 502 `upstream` when Razorpay fails. Counts against the
  user's hourly work limit.
- `POST /v1/me/orders/confirm {"razorpay_order_id", "razorpay_payment_id", "razorpay_signature"}`
  (exactly what Checkout's success handler receives) → `{"order": Order, "credits": Credits}`.
  The server checks the signature, then asks Razorpay for the payment, and
  credits the pack only when the payment is captured (it captures an
  authorized one) for the order's exact amount and currency. `order.status`
  is `paid`, or still `created` while Razorpay is processing (the webhook
  finishes it; poll `GET /v1/me/orders`), or `held` when the amount didn't
  match (nothing credited; a person checks it). 400 `payment_unconfirmed` for
  a bad signature, 404 for an order that isn't this user's. Safe to repeat.
- `GET /v1/me/orders?limit=50` → `{"orders": [Order]}`, newest first, the
  purchase history. `Order`: `{"id", "pack", "name", "credits", "amount", "currency", "status", "created_at", "paid_at"}`,
  `status` one of `paid`, `failed` (the payment was declined), `held`.
  Checkouts that were opened and never paid are left out.
- `POST /v1/payments/razorpay/webhook` (internal key; no user). `web/` serves
  Razorpay's webhook URL (`/api/payments/razorpay/webhook`) and forwards the
  request body byte for byte with its `X-Razorpay-Signature` header. The
  server verifies that signature (`RAZORPAY_WEBHOOK_SECRET`) before reading the
  body: 400 `payment_unconfirmed` if it doesn't match. Signed events answer 200
  `{"ok": true, "result": "paid"|"already_paid"|"held"|"failed"|"pending"|"unknown_order"|"ignored"}`
  (the result is for logs). Handled: `payment.authorized` (captured),
  `payment.captured` and `order.paid` (credited), `payment.failed`.

A pack is credited once per order, whichever of the confirm call and the
webhooks arrives first, however often they repeat: marking the order paid and
adding its credits happen in one transaction, and a payment id can pay only
one order. With payments switched off, orders that already exist are still
confirmed, so someone who paid just before the switch gets their credits.

#### Plans (subscriptions)

A monthly plan through Razorpay subscriptions, INR. **Switched off** by its
own flag, separate from credit packs: plans are offered only when the server
has `HOLT_SUBSCRIPTIONS_ENABLED=1` and its Razorpay keys, and a plan in the
catalogue has `on_sale: true`, an INR price and a `razorpay_plan_id` (a plan
made in the Razorpay dashboard; the server checks it charges the catalogue's
price before anyone pays). While off, `GET /v1/plans` offers nothing and
`POST /v1/me/subscription` answers 403 `payments_off`.

- `GET /v1/plans` (internal key; no user needed) → `{"on_sale": false, "plans": [PlanOffer]}`,
  `PlanOffer`: `{"id": "pro", "name": "Pro", "amount": 19900, "currency": "INR", "features": [{"id": "playbook", "name": "…", "per_month": 10, "unlimited": false}]}`
  (`amount` in paise, per month).
- `POST /v1/me/subscription {"plan": "pro"}` → `SubscriptionCheckout`:
  `{"subscription_id", "provider": "razorpay", "key_id", "provider_subscription_id", "plan", "name", "description", "amount", "currency"}`.
  Checkout opens with `subscription_id: provider_subscription_id`. A second
  call while the first is still unpaid returns the same subscription. 400
  `invalid_request` for a plan not on sale, 403 `payments_off`, 409
  `already_subscribed` when the user already has a plan that is paid for (or
  being paid), 502 `upstream` when Razorpay fails or its plan's price doesn't
  match. Counts against the user's hourly work limit.
- `POST /v1/me/subscription/confirm {"razorpay_payment_id", "razorpay_subscription_id", "razorpay_signature"}`
  (what Checkout's success handler receives) → `SubscriptionConfirmed`:
  `{"subscription": Subscription | null, "plan": "pro", "plan_expires_at": "…" | null}`.
  The server checks the signature (HMAC of `payment_id|subscription_id`), then
  asks Razorpay for the subscription and the payment. The plan starts when
  Razorpay says the subscription is active; otherwise the webhook starts it.
  400 `payment_unconfirmed` for a bad signature, 404 for a subscription that
  isn't this user's. Safe to repeat.
- `GET /v1/me/subscription?limit=50` → `{"subscription": Subscription | null, "charges": [Charge]}`:
  the latest subscription (unpaid checkouts left out) and every payment,
  newest first. `Subscription`: `{"id", "plan", "name", "status", "amount", "currency", "paid_until", "next_charge_at", "cancel_at_period_end", "created_at", "ended_at"}`,
  `status` one of `created`, `authenticated`, `active`, `pending` (a renewal
  failed; Razorpay is retrying), `halted` (the retries failed), `paused`,
  `cancelled`, `completed`, `expired`. `next_charge_at` is null once it won't
  renew. `Charge`: `{"id" (Razorpay's payment id), "amount", "currency", "period_start", "period_end", "status": "paid"|"held", "paid_at"}`.
- `POST /v1/me/subscription/cancel` → `SubscriptionConfirmed`. An active plan
  stops renewing and runs to the end of the period paid for
  (`cancel_at_period_end: true`); an unpaid one, or one whose renewal is
  failing, is cancelled now. 404 when there is nothing to cancel. Works with
  the switch off.
- Webhooks arrive on `POST /v1/payments/razorpay/webhook` (above). Handled:
  `subscription.authenticated`, `.activated`, `.charged`, `.pending`,
  `.halted`, `.paused`, `.resumed`, `.cancelled`, `.completed`, `.expired`;
  results `activated`, `charged`, `already_charged`, `held`, `stale`, `ended`,
  `unknown_subscription`, ….

What the plan does (`Me.plan`, `Me.plan_expires_at`): each payment gives the
plan to the end of the period Razorpay says was paid for, plus a grace period
(`HOLT_SUBSCRIPTION_GRACE_DAYS`, 7) so a failed renewal that Razorpay retries
doesn't cut anyone off. Halted or paused ends it now. Cancelled or completed
ends it with the paid period (no grace). Each payment is recorded once, events
about an older period than the server holds change nothing, and a cancelled
subscription never comes back. Only the subscription that gave the plan can
end it, so a plan an admin gave is never taken away by a webhook. With the
switch off, existing subscriptions still renew, lapse and can be cancelled.

### Admin (read-only)

Internal key plus an `X-Holt-User` listed in `HOLT_ADMIN_USERS`; anyone else
gets 404 `not_found`. There is no admin UI.

- `GET /v1/admin/users?limit=100&plan=pro` → `{"users": [AdminUserSummary]}`,
  newest first: `{"id", "plan", "effective_plan", "plan_expires_at", "free", "purchased", "created_at"}`.
- `GET /v1/admin/users/{user_id}?ledger_limit=200` → `AdminUser`: the summary
  plus `lots` (purchased credits), `ledger` (newest first: kind, source,
  amount, lot, feature, job, reason, actor), `plan_history`, `plan_usage`
  (uses per feature and month) and `access` (an `Access` per feature). 404
  for an unknown user.
- `GET /v1/admin/pricing` → the catalogue this server loaded.
- `GET /v1/admin/ai-spend` → `AdminAiSpend`: `{"budget_usd", "spent_usd",
  "held_usd", "runs", "running", "line"}`, this environment's AI spend against
  `HOLT_AI_BUDGET_USD` (0 = AI off); `line` is `"AI spend: $0.23 of $1.00"`.

### Connect GitHub

Free and optional. `web/` sends the numeric GitHub account id from the user's
own Auth.js GitHub account (signed in with GitHub, or linked from the Connect
screen), never from user input. The server looks up the login with its own
token pool (`GET https://api.github.com/user/{id}`, public data); it never gets
the user's GitHub token. Stored in `github_connections` and `repo_views`.

`GitHubConnection` = `{"connected": true, "account": {"id": 583231, "login": "octocat",
"connected_at": "…", "adult_confirmed_at": "…", "stats_opt_out": false}}`, or
`{"connected": false, "account": null}`.

- `GET /v1/me/github` → `GitHubConnection`.
- `POST /v1/me/github` body `{"github_id": 583231, "adult_confirmed": true, "stats_opt_out": false}`
  → `GitHubConnection`. Connects, or updates the connection (the login is looked
  up again; `connected_at` is kept unless the GitHub account changes).
  `adult_confirmed` must be true (the user ticked "I'm 18 or older"; its time is
  stored), else 400 `invalid_request`. A GitHub id connected to another user →
  409 `invalid_request`. An id GitHub doesn't know → 400 `invalid_request`.
  GitHub trouble → `rate_limited` / `upstream`.
- `PATCH /v1/me/github` body `{"stats_opt_out": true}` → `GitHubConnection`. The
  "Don't include me in statistics" switch. 404 `not_found` when not connected.
- `DELETE /v1/me/github` → `{"connected": false, "account": null}`. Deletes the
  connection, every `repo_views` row and every fetched pull request (My
  Contributions) for the user.
- `POST /v1/me/activity` body `{"repo": "owner/name"}` → 204. `web/` sends it when
  a signed-in user opens a report page. Recorded (repo, first and last viewed,
  count) only while the user is connected; otherwise ignored. Bad repo → 400
  `invalid_repo`.

A connected user's public contributions may be counted, anonymously, in
cross-user repo statistics (the report's `holt_users`, shown only when 5+
people contribute) unless `stats_opt_out` is true. Turning it on (PATCH, or a
POST that changes it) or disconnecting takes them out of every repository's
numbers in the same request.

### My Contributions

A connected user's public pull requests, each with Holt's verdict for its
repository. Read with the server's token pool from GitHub's public search
(`is:pr is:public author:<login> -user:<login>`, the last 365 days, at most
200, newest first; the user's own repositories and anything private are left
out). Fetched when GitHub is connected, again once a day in the background
(`HOLT_CONTRIBUTIONS_REFRESH_HOURS`, 24; 0 = off), and on refresh. Stored in
`contributions` and `contribution_syncs`; each fetch replaces the user's rows.
Nothing here starts an analysis.

`Contributions` =
```jsonc
{
  "login": "octocat",
  "fetched_at": "…",            // when GitHub was last read
  "next_refresh_at": "…" | null, // refresh works again from then; null = now
  "window_days": 365, "truncated": false, // true: GitHub had more than 200
  "summary": { "opened": 12, "merged": 6, "waiting": 3, "closed": 3,
               "landed_share": 0.5,  // merged / (merged + closed); null if none decided
               "found_via_holt": 2 },
  "pull_requests": [
    { "repo": "pallets/flask", "number": 5432, "title": "…",
      "url": "https://github.com/pallets/flask/pull/5432",
      "state": "open" | "merged" | "closed", "draft": false,
      "created_at": "…", "closed_at": "…" | null, "merged_at": "…" | null,
      "verdict": { "verdict": "viable", "headline": "Worth your time", "tone": "good",
                   "checked_at": "…" } | null,   // latest cached 7-day rules report
      "found_via_holt": true }
  ]
}
```

- `GET /v1/me/contributions` → `Contributions`. Reads GitHub only when the
  user has never been fetched (or their login changed); otherwise the stored
  list. Not connected → 404 `not_found`. GitHub trouble on that first read →
  `rate_limited` / `upstream`.
- `POST /v1/me/contributions/refresh` → `Contributions`. Reads GitHub again,
  unless the last read is under 15 minutes old: then the stored list comes back
  unchanged (200) with `next_refresh_at`. Reads that reach GitHub are also
  limited to 6 per user per hour (429 `rate_limited`), which only matters when
  GitHub keeps failing.
- `found_via_holt`: the user opened the pull request within 30 days after
  opening that repository's report page on Holt while connected (`repo_views`
  keeps the first and the last view of each repository; a pull request within
  30 days after either counts). Only verifiable data; never self-reported.
- `GET /v1/metrics/contributions?since=YYYY-MM-DD` (internal key, no user) →
  `{"since": "" | "YYYY-MM-DD", "window_days": 30, "connected_users",
  "users_with_pull_requests", "users_with_pr_after_holt", "prs_after_holt",
  "prs_after_holt_merged"}`: counts only, over connected users who did not turn
  on `stats_opt_out`, of pull requests opened on or after `since` (default:
  all stored). Also `python -m holt_server.contributions metric [--since DATE]
  [--json]`.

### Profile

What a signed-in user tells Holt once, so `/find` and `/hacktoberfest` start
from it. Stated, never inferred. Stored in `profiles`.

`ProfileOut` = `{"profile": ProfilePrefs | null, "adult_confirmed": true}`, where
`ProfilePrefs` = `{"languages": ["python"], "topics": ["cli"], "days": 7,
"contributions": ["docs", "tests"], "level": "newcomer", "updated_at": "…"}`.
`adult_confirmed` is true once the user has confirmed they're 18 or older,
here or by connecting GitHub.

- `GET /v1/me/profile` → `ProfileOut` (`profile` is null until saved).
- `PUT /v1/me/profile` body `{"languages", "topics", "days", "contributions",
  "level", "adult_confirmed"}` (all optional) → `ProfileOut`. Replaces the whole
  profile. Languages and topics are lower-cased and deduplicated, at most 10
  each; topics are GitHub topics (letters, numbers, dashes; spaces become
  dashes). `days` 1–90. `contributions` from `code`, `docs`, `tests`,
  `design`, `translations`. `level` is `newcomer` or `experienced`. The first
  save needs `adult_confirmed: true` unless GitHub is connected, else 400
  `invalid_request`; its time is stored.
- `DELETE /v1/me/profile` → `ProfileOut` with `profile: null`.

What each answer changes: languages, topics and days go into the find search
(days is the time budget the verdict uses). `level: newcomer` shows only
issues with `beginner: true`, and drops repos left with none; `experienced`
also shows issues asking for help and small unlabelled fixes. Issues whose
`areas` match `contributions` come first. The web applies `level` and
`contributions` to find results itself, so they don't change the find search
or its cache.

### Saved repos

Repositories a signed-in user saved to come back to later. Stored in
`saved_repos`: the user, the repository and when it was saved, nothing else.
Every route needs a signed-in user (401 `unauthorized` otherwise). Nothing
here calls GitHub.

`SavedState` = `{"repo": "owner/repo", "saved": true, "saved_at": "…"|null}`.
`SavedList` = `{"saved": [SavedItem], "max_saved": 500}`, newest first, where
`SavedItem` = `{"repo": "owner/repo", "saved_at": "…", "card": DiscoverRepo | null}`.
`card` is what `/v1/discover` shows for the repo (verdict, reason, stats,
description, language, stars, topics), read fresh from its latest 7-day rules
report and `repo_meta`; null while Holt has no current report for it.

- `GET /v1/me/saved` → `SavedList`. Not rate limited.
- `GET /v1/me/saved/{owner}/{repo}` → `SavedState` (is this one saved?).
- `PUT /v1/me/saved/{owner}/{repo}` (no body) → `SavedState`. Idempotent:
  saving again keeps the first `saved_at`. The name is stored with GitHub's
  casing when Holt already knows the repo. Bad name → 400 `invalid_repo`; a
  new save past `max_saved` → 400 `invalid_request`.
- `DELETE /v1/me/saved/{owner}/{repo}` → `SavedState` with `saved: false`,
  also when it wasn't saved.
- `DELETE /v1/me/saved` → `SavedList` with `saved: []`: removes every saved
  repo (part of deleting a user's data).

Writes (`PUT` and both `DELETE`s) have a bucket of their own, 300 an hour per
user, apart from work and read; over it → 429 `rate_limited`.

### Playbook: "How to get merged here" (paid)

For one repository: what its merged pull requests have in common, how big
they are, who reviews, why outside pull requests were closed (with quotes from
the project, linked), and a checklist. It is written by a model from counted
facts about the last 365 days of pull requests, and every claim is checked
against those facts before it is kept. It has no verdict and never changes the
report's. It exists only when the server runs with its paid features
(`HOLT_PRO_URL`); without them the GET says `available: false` and the POST is
501 `not_implemented`.

- `GET /v1/playbook/{owner}/{repo}` (anonymous or signed in; reads only the
  database) → `PlaybookState`:
  `{"repo", "available": true, "teaser": PlaybookTeaser|null, "playbook": Playbook|null, "unlocked": false, "access": Access|null, "on_sale": false, "job": PlaybookJob|null}`.
  - `teaser` is for everyone, once anyone has had this repository's playbook
    written: `{"sections": [{"key": "must_do", "count": 3}, …], "first": PlaybookItem|null, "generated_at"}`,
    the sections that have items (in display order) and the first must-do.
  - `playbook` is the whole playbook, only for a signed-in user who unlocked
    this repository (`unlocked: true`). Unlocks don't expire.
  - `access` (signed in only) is the `playbook` feature's `Access` (see
    Account): whether unlocking now is allowed and what it costs. `on_sale`
    says whether any plan or credit pack that pays for it is on sale; while
    it is false, a user who isn't allowed can't do anything about it yet.
  - `job` is the job writing this user's playbook for this repository while it
    runs (`{"job_id", "status", "stage", "progress"}`), so a reloaded page can
    follow it again.
- `POST /v1/me/playbook/{owner}/{repo}` (signed in; no body) unlocks it:
  - A playbook written in the last `HOLT_PLAYBOOK_CACHE_HOURS` (168) →
    `200 {"status": "done", "playbook": Playbook}`, charged once per user and
    repository (free when already unlocked).
  - Otherwise `202 {"status": "queued", "job_id"}`: a job writes it (usually
    1–3 minutes, stopped after `HOLT_JOB_TIMEOUT_AI`). People unlocking the same
    repository at once share one job; each is charged once. Someone who
    already unlocked it gets the newer one free.
  - Charged for the `playbook` feature before anything runs (402
    `quota_exceeded` or `needs_plan` otherwise, and nothing is queued). A job
    that fails gives back what everyone waiting on it was charged, and their
    unlock with it; its error message says so. An unknown or private
    repository is 404 `not_found` before any charge.
- `GET /v1/playbook-jobs/{job_id}` → `{"status", "stage", "progress", "playbook": Playbook|null, "error": Error|null}`,
  and `GET /v1/playbook-jobs/{job_id}/events` (SSE, as for analyses; `done`
  carries `{"playbook": Playbook}`).

`Playbook`: `{"repo", "generated_at", "model", "note", "window_days", "archived", "sections"}`.
`note` is plain English to show once near the top when present (e.g. the counts
cover everyone's pull requests because too few outside ones were merged).
`sections` always has five lists, in display order; show nothing for an empty
one:
- `must_do`, `size_and_scope`, `reviewers`, `checklist`: `PlaybookItem`s,
  `{"text", "sources": [{"statement", "seen", "of", "links": ["https://github.com/…"]}]}`.
  `text` is plain English and may contain Markdown code spans (check names,
  paths), never HTML. Each source is a counted fact: "seen in `seen` of `of`"
  pull requests, with example links; `seen`/`of` are null for a fact from a
  document (the contributing guide, CODEOWNERS).
- `closing_reasons`: `{"reason", "explanation", "seen", "of", "examples": [{"number", "url", "title", "who", "quote"}]}`,
  most common first: `seen` of the `of` closed outside pull requests read
  showed it, each example a closed pull request with the exact words `who`
  (someone in the project) wrote on it.

### Recommendations for you

`GET /v1/me/recommendations?limit=10` → `Recommendations`: a short, ranked list
of repositories (with starter issues) picked for the signed-in user. Reads
only the database: no GitHub call, no model, no rate limit, never charged.

- **Which repos**: only ones whose latest 7-day rules report (checked in the
  last 14 days) says `viable`, plus `viable` find results from the last 7 days
  that Holt has no report for, where maintainers are still answering (median
  first reply within 7 days, at most half of outside pull requests with no
  reply). Archived repos, forks, the user's own repos and every repo they
  already sent a pull request to (My Contributions) are left out.
- **Matching**: a pick must share a language with the profile, a language
  the user's pull requests were merged in (connected users), or a profile
  topic. Newcomers never get "long odds" repos, see only issues labelled for
  first-timers, and a repo whose known issues have none is dropped.
- **Ranking** is fixed points, never a model: stated language 4, merged-in
  language 3 (both: 8), 2 per shared topic (up to 2), odds good 3 / fair 1,
  first-timers merged recently 2 (newcomers), fitting starter issues 2, one of
  the user's contribution types 1. Ties: merged share, reply time, sample.
- **Paid**: the `recommendations` feature. A plan that covers it gets every
  pick (`full: true`); everyone else gets the first 2 and `locked`, the number
  held back.

```jsonc
{ "picks": [ { "repo": "owner/repo", "verdict": "viable", "headline": "Worth your time",
    "tone": "good", "odds": Odds | null, "reason": "…the report's verdict_line…",
    "numbers_line": "Of 42 pull requests from outside contributors, 19 were merged (45%). …",
    "why": ["Written in Python, one of your languages.",
            "Maintainers usually reply within 3 hours.",
            "6 people had their first pull request merged here recently."],
    "stats": Stats, "description": "…"|null, "language": "Python"|null,
    "stars": 123|null, "topics": ["cli"],
    "issues": [StarterIssue],     // up to 3, fitted to level and contribution types; [] when none known
    "checked_at": "…"|null } ],
  "locked": 3, "full": false,
  "basis": { "languages": ["python"], "topics": ["cli"], "level": "newcomer",
             "contributions": ["docs"], "history_languages": ["Rust"],
             "already_contributing": 4, "has_profile": true, "connected": true },
  "computed_at": "…" }
```

Empty `picks` with `has_profile: false` and `connected: false` means there is
nothing to match on yet. Starter issues older than 72 hours aren't shown.

### Feedback: "Was this verdict right?"
- `POST /v1/feedback` body `{"repo": "owner/repo", "mode": "rules"|"ai", "days": 7,
  "generated_at": "<the report's generated_at>", "vote": "up"|"down", "reason": "…"|null}`
  → `200 {"repo", "generated_at", "verdict", "vote", "reason"}`.
- Anonymous or signed in. The person is `X-Holt-User` when present, else
  `X-Holt-Client-Ip` (required then; 400 `invalid_request` without it). The
  server stores a salted hash of the IP, never the IP itself.
- `generated_at` (with repo, mode and days) names the exact report version on
  screen; `404 not_found` if the server has no such report. The stored verdict
  is that report's, not anything the browser sends.
- One answer per person per report version: answering again replaces the
  vote and reason (a missing or blank `reason` clears it). Reasons are trimmed
  to 500 characters.
- Its own hourly limit, separate from work and read: 30 answers per IP
  anonymously, 120 per user; over it, 429 `rate_limited`.
- For the engine's golden set, `python -m holt_server.feedback export
  [--format csv|json] [--out FILE] [--since YYYY-MM-DD]` writes every answer
  with the report's key numbers and a pseudonymous voter id (no user ids or IP
  hashes). There is no HTTP export.

### PR pre-flight (paid)

For one public pull request, or a branch not opened as one yet: how it
compares with what gets merged in its repository. Each check says **looks
fine**, **worth fixing** or **can't tell yet**, computed by rules, with the
evidence behind it (example merged pull requests, the contributing guide's own
line), plus the merged pull request most like it. There is no overall verdict,
and it never changes the report's. Guidance only: Holt never posts to GitHub
and never writes code. It exists only when the server runs with its paid
features (`HOLT_PRO_URL`); without them the GET says `available: false` and the
POST is 501 `not_implemented`.

A target is either a pull request (`pr`: a link like
`https://github.com/o/r/pull/12`, anything after the number ignored, or
`o/r#12`) or a repository and a branch (`repo` + `branch`, `owner:branch` for
one in that person's fork, with an optional `base` to compare with; the default
branch otherwise). A link that isn't a pull request, a bad branch name, or both
kinds at once is 400 `invalid_request` with a plain message.

- `GET /v1/preflight?pr=…` or `?repo=…&branch=…&base=…` (anonymous or signed
  in; the target is optional; reads only the database) → `PreflightState`:
  `{"available": true, "on_sale": false, "access": Access|null, "target": {"repo", "number", "branch", "base"}|null, "result": Preflight|null, "job": PreflightJob|null}`.
  - `access` (signed in only) is the `preflight` feature's `Access` (see
    Account). `on_sale` says whether any plan or credit pack that pays for it
    is on sale.
  - `result` (signed in only) is this user's latest check of `target`;
    results are kept per user, target and head commit.
  - `job` is a check of `target` still running for this user
    (`{"job_id", "status", "stage", "progress"}`), so a reloaded page can
    follow it again.
- `POST /v1/me/preflight` (signed in) body
  `{"pr_url": "https://github.com/o/r/pull/12"}` or
  `{"repo": "o/r", "branch": "me:fix", "base": "main"}`, plus optional
  `"summary": true` (also a short written summary, same price). Unknown fields
  are 400. → `202 {"status": "queued", "job_id"}`. Every check reads GitHub
  again, so there is no instant answer.
  - Charged for the `preflight` feature before anything runs (402
    `quota_exceeded` or `needs_plan` otherwise, and nothing is queued). An
    unknown or private repository is 404 `not_found` before any charge.
  - A second request for the same target while one runs joins it, uncharged.
  - A check of a commit this user already had checked is free: the charge is
    given back when it finishes, and the result says `free_recheck: true`.
  - A job that fails gives the charge back; its error message says so. A pull
    request or branch GitHub doesn't have (or a branch with no new commits) is
    `not_found`; GitHub trouble is `upstream`. Usually a few seconds, up to a
    few minutes when the repository's history must be read first; stopped
    after `HOLT_JOB_TIMEOUT_AI`.
- `GET /v1/preflight-jobs/{job_id}` → `{"status", "stage", "progress", "preflight": Preflight|null, "error": Error|null}`,
  and `GET /v1/preflight-jobs/{job_id}/events` (SSE, as for analyses; `done`
  carries `{"preflight": Preflight}`).

`Preflight`: `{"repo", "checked_at", "window_days", "archived", "note", "target", "checks", "counts", "similar", "summary", "free_recheck"}`.
- `target`: `{"kind": "pull_request"|"branch", "number", "url", "title", "author", "outside", "state", "draft", "head", "base", "head_sha", "additions", "deletions", "lines", "files"}`.
  For a branch, `number`, `state` and `outside` are null and `url` is GitHub's
  compare page. `outside` is whether GitHub gives the author no role in the
  repository.
- `checks`, in display order: `{"id", "title", "verdict": "ok"|"worth_fixing"|"unknown", "statement", "links", "quote": {"text", "path", "url"}|null}`.
  Show `title` and the verdict in words ("looks fine", "worth fixing", "can't
  tell yet"), never the values. `statement` is plain English and may contain
  Markdown code spans; `links` are example merged pull requests (up to 8).
  A check that doesn't apply to the repository is left out; ids today are
  `ci`, `tests`, `size`, `template`, `issue`, `cla`, `signoff`, `changelog`.
- `counts`: `{"ok", "worth_fixing", "unknown"}`, counted from `checks`.
- `similar`: the merged pull request that changed the most of the same files,
  then folders (one from someone outside the project when any shares
  something), `{"number", "url", "title", "author", "outside", "lines", "files", "touched_tests", "why"}`,
  or null. `why` is plain English and may contain code spans.
- `note`: plain English to show once near the top when present (the
  comparison covers everyone's pull requests because too few outside ones were
  merged).
- `summary` (when asked for): `{"model", "sentences": [{"text", "checks": ["issue"]}]}`,
  at most 3 sentences, each checked against the checks it cites; it never says
  whether the pull request will be merged.

## Public proxy for the browser extension (implemented by `web/`)

The browser extension (`extension/`) cannot hold `HOLT_INTERNAL_KEY`, so
`web/` exposes two read-only, anonymous proxy routes on the public host
(default `githolt.com`). They only read the cache; they never start an
analysis or call GitHub.

### `GET /api/public/report/{owner}/{repo}`
Proxies `GET /v1/reports/{owner}/{repo}?mode=rules&days=7`.
- `200` → the Report object (above), `mode: "rules"`. The extension reads only
  `headline`, `tone` and `stats.outsider_attempts` / `stats.outsider_merged`,
  so the proxy may strip `evidence` to keep responses small.
- `outdated: true` on a `200` means an older engine version made the report.
  The proxy never starts a check for it; it sends `max-age=300` instead of
  900, and the extension shows "Holt: updating" (not the old verdict) and
  links to the report page, which re-runs it.
- `404` → `{"error": {"code": "not_found", ...}}` when nothing is cached yet
  (or the repo is missing/private). The extension then shows "Check with Holt"
  and links to `/{owner}/{repo}`, whose page starts the analysis.
- `429` `rate_limited` / `5xx` → shown as "Check with Holt" too.

### `GET /api/public/starter-issues/{owner}/{repo}`
Proxies `GET /v1/repos/{owner}/{repo}/starter-issues?limit=20` →
`{"repo": "…", "issues": [StarterIssue]}`. The extension reads `number` and
`why`. `404` when nothing is known.

Both routes:
- Accept `GET` and `OPTIONS` only, no cookies or auth. Forward the caller's
  IP as `X-Holt-Client-Ip` like any anonymous request. A `501` from the
  server (starter issues not shipped yet) may pass through; the extension
  just shows no marks.
- Send `Cache-Control: public, max-age=900` (15 min) on `200` and
  `max-age=300` on `404`, so a new analysis shows up soon.
- Send `Access-Control-Allow-Origin: *`. The extension fetches from its
  background worker (which its host permission covers), but open CORS keeps
  other read-only clients simple; the data is public.
- Normalise `{owner}/{repo}` as in "Repo identifiers"; reject anything else
  with `400 invalid_repo`.
