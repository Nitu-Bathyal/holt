# Monitoring

An optional stack beside production that answers two questions: **is
something broken right now**, and **is the server still big enough**. Holt
runs the same without it, and nothing in the production stack changes,
restarts or depends on it.

| Piece | What it does |
|---|---|
| Prometheus | Collects the numbers every 30 s, keeps 15 days, evaluates the alerts |
| the API's `/metrics` | Requests, jobs and the queue, the database pool, GitHub points, AI spend, emails (`server/holt_server/metrics.py`) |
| node-exporter | The host: CPU, memory, disks (`/` and `/home`), load |
| cAdvisor | Memory and CPU of each Holt container |
| postgres-exporter | The Holt database: connections, size |
| blackbox-exporter | Is the site up (from outside and from inside), did the last deploy fail |
| Alertmanager | Sends the alerts: email, a webhook, a dead man's ping |
| Grafana | Two dashboards, on `127.0.0.1` only |

Prometheus rather than VictoriaMetrics: at this size (about 4,000 series)
both fit in 100 MB, and Prometheus evaluates the alert rules and tests them
(`promtool`) itself, where VictoriaMetrics needs a second service for that.

## Start it

Production must be deployed first (`deploy/prod/deploy.sh`), on a commit
whose server has `/metrics`.

```sh
deploy/monitoring/up.sh            # start it, or apply changed configs
deploy/monitoring/up.sh --status   # containers, memory, disk, scrape targets, alerts
```

`up.sh` is safe to run again; the top of the script lists every step and
setting. The first run:

- makes `~/.local/share/holt-monitoring/` (on `/home`): `data/`, `config/`
  (rendered from this directory) and `secrets/`;
- makes Grafana's admin password, in `secrets/grafana-admin`;
- adds a database role `holt_monitor` to the production Postgres. It is a
  member of `pg_monitor` only: it reads Postgres's statistics and can't read
  a row of Holt's data. This is the one thing the stack adds to production;
- joins Prometheus, postgres-exporter and blackbox-exporter to production's
  Docker network (`holt-prod_default`), read-only by nature: they only make
  GET requests and one statistics connection.

After a deploy that changes this directory, run `up.sh` again from the new
checkout. A config that fails its check never replaces the one in use.

## Grafana

Only on the server's `127.0.0.1:8320`. From the laptop:

```sh
ssh -N -L 8320:127.0.0.1:8320 aahil-server     # then open http://localhost:8320
```

User `admin`, password in `~/.local/share/holt-monitoring/secrets/grafana-admin`.

- **Holt health** (the home page): is it working now. The top row is the
  alerts as tiles; below, requests, jobs, the database, GitHub, AI, email.
- **Holt capacity: when to migrate**: headroom over days. It opens on a
  table of the signs that the home server is outgrown, and every chart
  carries its limit as a line. Look at a week, not an hour.

The dashboards are built by `grafana/dashboards.py`. Change a panel or a
threshold there, run it, commit both files, run `up.sh`.

## Alerts

| Alert | Fires when | First thing to do |
|---|---|---|
| `HoltSiteDown` | the home page fails for 2 min, from outside (`public`) or at the edge (`internal`) | `public` only: the Cloudflare tunnel (`deploy/prod/TUNNEL.md`). `internal`: `docker ps`, then `docker logs holt-prod-web-…` |
| `HoltApiDown` | no API server answers for 2 min | `docker logs` of the `holt-prod-server-…` container; a deploy in progress shows in `deploy/prod/follow.sh --status` |
| `HoltServerErrors` | over 5% of API requests end in a 5xx for 5 min | the server's log; "Slowest routes" and "Requests per second, by status" on Holt health |
| `HoltSlowRequests` | p95 response time over 2 s for 5 min | Holt health: is the database pool full, is the host out of CPU or memory |
| `HoltDbPoolWaiting` | requests wait for a database connection for 5 min | Holt health, "Database". Something holds connections, or `HOLT_DB_POOL_SIZE` is too small (budget in `deploy/prod/compose.yml`) |
| `HoltDbPoolTimeouts` | a wait for a connection gave up | the same; those requests failed |
| `HoltGithubPointsLow` | under 500 GitHub points left | wait for the hourly reset; `deploy/prod/warm.sh --status` in case a warm pass is spending them |
| `HoltQueueWait` | a person's check has waited over 60 s | "Workers busy": if the user workers are all busy, raise `HOLT_JOB_CONCURRENCY` (memory allowing) |
| `HoltDeployFailed` | `/__build` says the last deploy failed or is held | `deploy/prod/follow.sh --status`; production stays on the previous commit |
| `HostRootDiskLow` | `/` under 10% free | `docker system df`; remove old images and build cache of your own projects |
| `HostMemoryLow` | under 1 GB of memory available for 5 min | `docker stats`; the capacity dashboard says whether this is a one-off |

An alert goes out a minute after it starts (a blip that clears says
nothing), again when it clears, and once a day while it lasts.

Where they go is set in `~/.config/holt/secrets.env` or
`~/.local/share/holt-monitoring/monitoring.env` (then run `up.sh`):

```sh
HOLT_ALERT_EMAIL_TO=you@example.com     # email, through Resend with the RESEND_API_KEY already in secrets.env
HOLT_ALERT_WEBHOOK_URL=https://…        # optional: every alert as Alertmanager's JSON (n8n, ntfy, …)
HOLT_WATCHDOG_URL=https://hc-ping.com/… # optional: a ping every 5 minutes while monitoring works
```

```sh
deploy/monitoring/up.sh --test-alert    # a harmless alert through every channel, in about a minute
```

Email shares Resend's daily allowance with the emails Holt sends its users;
alerts normally come to a handful a day. Another SMTP server:
`HOLT_ALERT_SMTP_HOST`, `_USER`, `_PASSWORD`. Without any channel, alerts
only show on the Holt health dashboard.

## With the tools already on the server

Nothing here replaces or reconfigures them. Three are worth pointing at Holt
by hand:

- **healthchecks** hears when monitoring itself dies. Add a check with a
  period of 5 minutes and a grace of 10, and put its ping URL, exactly as
  healthchecks shows it, in `HOLT_WATCHDOG_URL`. Alertmanager then pings it
  every 5 minutes for as long as Prometheus and Alertmanager both work; when
  the pings stop, healthchecks tells you. The instance on this server covers
  "the monitoring stack died". Only a check hosted elsewhere (healthchecks.io
  is free) also covers "the whole server died". (From its container,
  Alertmanager reaches this machine as `host.docker.internal`, but a service
  that checks the host name it is called by, as healthchecks does, answers
  only to its own.)
- **uptime-kuma** as a second opinion that doesn't depend on this stack: an
  HTTP monitor on `https://githolt.com/` every 60 s. To hear about alerts
  there too, make a "Push" monitor and put its URL in
  `HOLT_ALERT_WEBHOOK_URL`.
- **glances**, **dozzle**, **portainer**: the live view and the logs, when
  an alert sends you looking. Nothing to set up.

## What it costs

Measured on the home server with every piece running:

| | Memory in use | Limit |
|---|---|---|
| Grafana | 150–190 MB | 320 MB |
| Prometheus | 90–100 MB | 256 MB |
| cAdvisor | 50 MB | 128 MB |
| Alertmanager | 36 MB | 64 MB |
| the three exporters | 25 MB | 120 MB |
| **Together** | **about 400 MB** | 888 MB |

CPU: about 2% of one core, all seven containers together.

Disk on `/home`: Prometheus keeps 15 days, about 250 MB at this size (worked
out from the number of series, not yet seen over 15 days), and never more
than 2 GB (`--storage.tsdb.retention.size`); Grafana and
Alertmanager a few MB.

Disk on `/` (Docker images): about 950 MB. The server already had the four
big ones (Grafana, Prometheus, Alertmanager, cAdvisor) at these exact
versions, so starting this stack added 67 MB.

Database: one connection, `holt_monitor`'s.

## Changing it

```sh
deploy/monitoring/up.sh --check    # every config and every alert rule; starts and changes nothing
```

- An alert: `prometheus/rules/holt.yml`, with its cases in
  `prometheus/rules.test.yml` (`--check` runs them).
- What is scraped: `prometheus/prometheus.yml.tmpl`.
- Who is told: `alertmanager/alertmanager.yml.tmpl`.
- A dashboard: `grafana/dashboards.py`.

### Trying a change

A second copy under another name, watching whatever stack you point it at,
never touches the real one:

```sh
HOLT_MON_PROJECT=holt-monitoring-try HOLT_MON_HOME=~/.local/share/holt-monitoring-try \
HOLT_GRAFANA_PORT=8329 HOLT_MON_TARGET=<compose project to watch> deploy/monitoring/up.sh
```

The watched project needs a `db` service (Postgres, user `holt`) and a
`server` service answering `/metrics` on port 8000 on its default network.

## Stopping and removing

```sh
deploy/monitoring/up.sh --down     # stops it; the data stays
```

To remove it for good: `--down`, delete `~/.local/share/holt-monitoring`,
and drop the role (`DROP ROLE holt_monitor` in the production database).
