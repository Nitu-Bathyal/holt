# Load tests

How much traffic a Holt deployment takes, and what gives first. [k6](https://k6.io)
scripts for three kinds of load, a watcher that records what the server was
doing meanwhile, and a short report per run.

**Staging only.** The scripts refuse `githolt.com`, and refuse any target
whose `/__build` doesn't say it is the staging site. Never point them at
production.

## Run

On the server that hosts staging (the watcher reads Docker there):

```sh
loadtest/run.sh readers            # scenario 1, on staging's local edge
loadtest/run.sh fresh              # scenario 2 (spends GitHub points)
loadtest/run.sh mixed              # scenario 3 (spends GitHub points)
loadtest/run.sh readers --public   # the same, through https://staging.githolt.com
```

It needs `k6` (one binary: <https://github.com/grafana/k6/releases>) on
`PATH`, at `~/.cache/holt-loadtest/k6`, or named by `K6=`; `python3`; and
`docker` for the server-side numbers.

Each run writes `loadtest/results/<time>-<scenario>/` (gitignored) and prints
its `report.md`:

| File | What |
|---|---|
| `report.md` | The tables below, ready to paste |
| `summary.json` | k6's numbers per window |
| `samples.jsonl` | The watcher's samples, one every 5 seconds |
| `jobs.tsv` | Jobs started during the run: queue wait and run time |
| `points.txt` | GitHub points left on staging's tokens, before and after |
| `k6.log`, `watch.log` | What each said |

## Two ways in

| | Target | Measures |
|---|---|---|
| default | `http://127.0.0.1:9110`, staging's edge on the host | The stack itself: nginx, the web app, the API server, Postgres |
| `--public` | `https://staging.githolt.com` | What a visitor gets: the same, behind Cloudflare's tunnel and Access |

On the local edge the scripts send the headers the tunnel would add
(`Host`, `X-Forwarded-For`, `X-Forwarded-Proto`). With `--public`, `run.sh`
reads the Cloudflare Access service token the smoke tests use
(`STAGING_CF_ACCESS_CLIENT_ID` and `STAGING_CF_ACCESS_CLIENT_SECRET` in
`~/.config/holt/secrets.env`), trades it once for Access's cookie, and never
prints it. Say which way a number came from when you quote it: k6 runs on the
same box, so the public path's numbers include a trip out to Cloudflare and
back.

## The scenarios

**1. Readers** (`readers.js`). Signed-out visitors opening pages Holt
already has, stepping up through 10, 50, 100 and 200 virtual users. Each
virtual user opens a page, pauses 0.5 to 1.5 seconds, and opens another, so
200 of them ask for up to 200 pages a second. The mix:

| Page | Share |
|---|---:|
| A cached report, as a signed-out teaser (`repos/cached.txt`) | 40% |
| The landing page | 20% |
| Discover (the board, by stars, two language boards) | 15% |
| A cached example report, in full (`FULL_REPOS`) | 10% |
| Find, with its default search | 10% |
| Examples | 5% |

**2. Fresh checks** (`fresh.js`). A burst of repos staging has never
checked (`repos/fresh.txt`), all at once, each started the way a signed-out
visitor's browser starts one: open the report page, take its ticket, start
the check, follow its events to the report.

**3. Mixed** (`mixed.js`). A steady crowd of readers, with a burst of fresh
checks landing in the middle: what readers get before the burst, and while
the checks run.

Only the page's HTML is requested: no scripts, styles, fonts or images, which
a browser caches and Cloudflare serves. Nobody is signed in.

## Settings

Environment variables, all optional:

| Variable | Default | |
|---|---|---|
| `STEPS` | `10,50,100,200` | Readers: virtual users at each step |
| `STEP_SECONDS` | `45` | Readers: how long each step is held |
| `RAMP_SECONDS` | `10` | Readers: time to reach a step (left out of its numbers) |
| `THINK_MIN`, `THINK_MAX` | `0.5`, `1.5` | A reader's pause between pages, seconds |
| `FULL_REPOS` | `pallets/flask,home-assistant/core` | Example reports opened in full |
| `ONLY` | | Readers: load only these pages, e.g. `discover,find` (names as in a report's page table) |
| `ENCODING` | `gzip, br` | The `Accept-Encoding` sent; `identity` asks for uncompressed pages |
| `FRESH_MAX` | `6` (mixed: `4`) | Checks in the burst, 15 at most |
| `FRESH_SKIP` | `0` | Start this far down `repos/fresh.txt` |
| `FRESH_REPOS` | | Repos to check instead of the file's, comma-separated |
| `MIXED_VUS` | `50` | Mixed: readers |
| `BEFORE_SECONDS`, `DURING_SECONDS` | `45`, `120` | Mixed: readers alone, then with the checks |
| `MAX_LOAD` | `20` | Stop when the host's 1-minute load passes this |
| `MIN_AVAILABLE_MB` | `2048` | Stop when the host's available memory drops under this |
| `STACK` | `stage-holt-new` | The Compose project the watcher reads |
| `LOCAL_EDGE` | `http://127.0.0.1:9110` | Staging's edge on the host |

## What it costs

Readers cost no GitHub points, with one exception: an example report opened
in full loads its starter issues, and when staging's copy of those is over a
day old, the first view reads them from GitHub (about 5 points per repo).
Every page is opened once, one at a time, before the load starts, so that
happens once and not 200 times.

A fresh check reads GitHub with staging's tokens: about 10 points, up to
about 20 for a very busy repository. `FRESH_MAX` is capped at 15 so a burst
stays under 300. The API also limits signed-out checks to 10 an hour per
address; past that they are refused and counted as `refused`.

A repo GitHub has renamed is checked under its new name, as the site
redirects to it.

A repo is fresh once. After a run staging has its report, and the next run
counts it as `cached` and checks nothing. Move down the list with
`FRESH_SKIP`, or replace its lines. This lists which of them staging still
hasn't seen:

```sh
grep -v '^#' loadtest/repos/fresh.txt | while read -r repo; do
  seen=$(docker exec stage-holt-new-db-1 psql -U holt -d holt -At \
    -c "select count(*) from reports where repo_key = lower('$repo')")
  [ "$seen" = 0 ] && echo "$repo"
done
```

## Being a good neighbour

The staging server also runs production and other live services.

- `run.sh` won't start when the host's load is already over half of
  `MAX_LOAD`, when available memory is within 512 MB of `MIN_AVAILABLE_MB`,
  or when staging isn't `live` (it is building, or running its smoke tests).
- While a run is going, `watch.py` checks the same three things every 5
  seconds and interrupts k6 when one fails. k6 then stops cleanly and the
  report says why.
- k6 itself gives up when more than half of all requests are failing.
- Steps are short. A whole readers run takes under four minutes.

The watcher only reads: `docker stats`, and `SELECT`s through `psql` in
staging's database container.

## Reading a report

- **pages/s** is what the site actually served in that window. When it stops
  growing while virtual users keep growing, the site is saturated: the extra
  users are only waiting.
- **p50 / p95 / p99** are for the whole page (the last byte), **first byte**
  for the first. **failed** is any answer that wasn't a 2xx or 3xx; **bad**
  also counts a 200 that shows the error panel instead of the page.
- **CPU** is percent of one core. The web app and the API server are each one
  process, so either one near 100% is at its limit however idle the rest of
  the box is.
- **DB open (active)** is connections open and, of those, running a query at
  the moment of a sample.
- **k6 CPU** is the load generator's own share of the box.
