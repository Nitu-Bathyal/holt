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
signing in), `ai_unavailable` (AI reports are switched off: the server has no
model key), `claim_not_ready` (a weekly claim before it is due),
`upstream` (GitHub/model failure), `internal`.

HTTP statuses: `unauthorized` 401, `not_found` 404, `invalid_repo` and
`invalid_request` (malformed body or query) 400, `rate_limited` 429 (also sent
as a `Retry-After` header), `quota_exceeded` 402, `needs_plan` 402, `needs_key` 403,
`claim_not_ready` 409, `ai_unavailable` 503, `upstream` 502, `internal` 500, `not_implemented` 501 (starter issues and find,
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
`POST /v1/feedback` has a small bucket of its own (see Feedback).

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
  "verdict_line": "string",           // one plain sentence under the headline
  "odds": { "level": "good" | "fair" | "long", "tone": "good" | "warn" | "bad",
            "text": "most outside pull requests get a reply, and plenty get merged" } | null,
  "summary": "string | null",         // ai mode: short plain-English paragraph
  "stats": {
    "outsider_attempts": 100, "outsider_merged": 15, "distinct_outsiders": 72,
    "first_time_merged_authors": 15, "no_reply": 63,
    "median_first_response_hours": 0.8, "bot_share": 0.085
  },
  "decided_by": ["plain-English rule sentence", "..."],
  "rule_codes": ["merges", "rubber_stamp"], // stable code per decided_by line, same order
  "unknowns": ["plain-English sentence", "..."],
  "landing": [ { "path": "pkgs/by-name", "merged": 13, "attempted": 62 } ],
  "never_landed": [ { "path": "pkgs/applications", "attempted": 6 } ],
  "evidence": [
    { "id": "pr:NixOS/nixpkgs#526518:opened", "url": "https://github.com/NixOS/nixpkgs/pull/526518",
      "kind": "onboarding", "value": "substantive", "text": "…", "quote": "string | null" }
  ],
  "evidence_until": "2026-06-01T00:00:00Z", // or null
  "generated_at": "2026-09-25T12:00:00Z",
  "cost": { "model": "…", "input_tokens": 9000, "output_tokens": 6000 } // ai only, else null
}
```

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

`headline`, `tone`, `verdict_line` and `odds` are derived by the server from
`verdict`, `stats` and `decided_by`/`rule_codes`, every time a report is
served (so cached reports pick up wording changes). Every surface (web, OG
images, the extension) shows these fields and never works them out itself, so
they cannot disagree with each other or with the verdict:

- `tone` follows the verdict: `viable` → `good`, `not_viable` → `bad`,
  `insufficient_evidence` → `warn`.
- `verdict_line` never oversells: "Worth your time" with a low merge rate or
  many unanswered pull requests says so. Under "Not worth your time" it states
  the rule that decided it.
- `odds` is non-null only when the verdict is `viable` (and anyone tried): the
  worse of the merge rate (good ≥ 12%, fair ≥ 5%) and the no-reply rate (good
  ≤ 25%, fair ≤ 50%); its `text` names the weak part. The other verdicts are
  the answer on their own.
- `rule_codes` is `[]` on reports cached before it existed. Codes include
  `archived`, `closed_kind`, `non_software_kind`, `awaiting_reply`,
  `no_attempts`, `ignored`, `merges`, `rubber_stamp`, `slow`,
  `too_few_attempts`, `elsewhere` (a mirror or a fork; decides alone, like
  `archived`), `landed_off_button` (says how many merges GitHub shows as
  closed because they landed another way; never decides); new ones may
  appear.

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
- Returns `200 {"status":"done","report":Report}` immediately when a cached
  report exists (same repo/mode/days, younger than 24h) and `refresh` is false.
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
Latest cached report or 404 `not_found`. Public via the BFF: no user needed
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
and `stars` are null when the finder did not supply them; `stats` leaves out
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
  "why": ["Labelled good first issue", "Touches docs/, where 8 of 10 outsider PRs were merged"] }
```

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

When there is no report, or it is over 24h old, it shows what it has and
queues a rules check behind it. Badge-queued checks have their own rate
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
the client:

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
cross-user repo statistics (shown only when 5+ people contribute) unless
`stats_opt_out` is true.

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
