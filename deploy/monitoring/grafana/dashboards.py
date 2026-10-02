"""Builds the two Grafana dashboards in dashboards/ (Grafana reads the JSON).

    python3 deploy/monitoring/grafana/dashboards.py           # write the JSON
    python3 deploy/monitoring/grafana/dashboards.py --check   # is it up to date?

This file is the source: change a panel, a query or a threshold here, run it,
commit both, then run up.sh. `up.sh --check` fails when the JSON is behind.
To try something first, edit in Grafana and "Save as" a copy; the two
provisioned dashboards can't be saved over from there.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

DS = {"type": "prometheus", "uid": "prometheus"}
GREEN, YELLOW, RED = "green", "#EAB839", "red"
_id = 0


def nid():
    global _id
    _id += 1
    return _id


def steps(pairs):
    """[(None, color), (value, color), ...] -> Grafana threshold steps."""
    return {"mode": "absolute", "steps": [{"color": c, "value": v} for v, c in pairs]}


def target(expr, legend="", instant=False, ref=None):
    t = {"datasource": DS, "expr": expr, "legendFormat": legend or "__auto",
         "refId": ref or "A", "editorMode": "code", "range": not instant, "instant": instant}
    return t


def refs(targets):
    for i, t in enumerate(targets):
        t["refId"] = chr(ord("A") + i)
    return targets


def stat(title, expr, pos, unit="none", thresholds=None, mappings=None, calc="lastNotNull",
         desc="", decimals=None, text_mode="auto", instant=True):
    defaults = {"unit": unit, "thresholds": steps(thresholds or [(None, GREEN)]),
                "mappings": mappings or [], "color": {"mode": "thresholds"}, "noValue": "–"}
    if decimals is not None:
        defaults["decimals"] = decimals
    return {"id": nid(), "type": "stat", "title": title, "description": desc, "datasource": DS,
            "gridPos": dict(zip("xywh", pos)), "targets": refs([target(expr, instant=instant)]),
            "fieldConfig": {"defaults": defaults, "overrides": []},
            "options": {"reduceOptions": {"calcs": [calc], "fields": "", "values": False},
                        "colorMode": "background", "graphMode": "none", "textMode": text_mode,
                        "justifyMode": "center", "orientation": "auto"}}


def named(zero_color, zero, one_color, one):
    """Show a 0/1 value as a word."""
    return [{"type": "value", "options": {"0": {"text": zero, "color": zero_color, "index": 0},
                                          "1": {"text": one, "color": one_color, "index": 1}}}]


def ts(title, targets, pos, unit="short", thresholds=None, desc="", min_=0, max_=None,
       stack=False, fill=10, overrides=None, decimals=None):
    custom = {"drawStyle": "line", "lineWidth": 1, "fillOpacity": fill, "showPoints": "never",
              "spanNulls": False, "stacking": {"mode": "normal" if stack else "none"},
              "thresholdsStyle": {"mode": "line" if thresholds else "off"}}
    defaults = {"unit": unit, "custom": custom, "color": {"mode": "palette-classic"},
                "thresholds": steps(thresholds or [(None, GREEN)])}
    if min_ is not None:
        defaults["min"] = min_
    if max_ is not None:
        defaults["max"] = max_
    if decimals is not None:
        defaults["decimals"] = decimals
    return {"id": nid(), "type": "timeseries", "title": title, "description": desc,
            "datasource": DS, "gridPos": dict(zip("xywh", pos)), "targets": refs(targets),
            "fieldConfig": {"defaults": defaults, "overrides": overrides or []},
            "options": {"legend": {"displayMode": "list", "placement": "bottom",
                                   "showLegend": True},
                        "tooltip": {"mode": "multi", "sort": "desc"}}}


def dashed(name, color=RED):
    """A series drawn as a limit: a dashed line, no fill."""
    return {"matcher": {"id": "byName", "options": name}, "properties": [
        {"id": "custom.lineStyle", "value": {"fill": "dash", "dash": [8, 6]}},
        {"id": "custom.fillOpacity", "value": 0},
        {"id": "custom.lineWidth", "value": 2},
        {"id": "color", "value": {"mode": "fixed", "fixedColor": color}}]}


def row(title, y):
    return {"id": nid(), "type": "row", "title": title, "collapsed": False,
            "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "panels": []}


def text(content, pos):
    return {"id": nid(), "type": "text", "title": "", "gridPos": dict(zip("xywh", pos)),
            "options": {"mode": "markdown", "content": content}, "transparent": True}


def alerts_table(pos):
    return {"id": nid(), "type": "table", "title": "Alerts firing now", "datasource": DS,
            "description": "Empty is good. What to do about each: deploy/monitoring/README.md.",
            "gridPos": dict(zip("xywh", pos)),
            "targets": refs([{**target('ALERTS{alertstate="firing", alertname!="Watchdog"}',
                                       instant=True), "format": "table"}]),
            "fieldConfig": {"defaults": {"noValue": "None"}, "overrides": []},
            "options": {"showHeader": True},
            "transformations": [{"id": "organize", "options": {
                "excludeByName": {"Time": True, "Value": True, "__name__": True,
                                  "alertstate": True, "job": True},
                "renameByName": {"alertname": "Alert", "severity": "Severity",
                                 "instance": "Where", "path": "Check"}}}]}


def dashboard(uid, title, panels, time_from, description, templating=None, links=None):
    return {"uid": uid, "title": title, "description": description, "tags": ["holt"],
            "schemaVersion": 39, "version": 1, "editable": True, "graphTooltip": 1,
            "timezone": "browser", "refresh": "1m",
            "time": {"from": time_from, "to": "now"},
            "templating": {"list": templating or []}, "annotations": {"list": []},
            "links": links or [], "panels": panels}


def link(title, uid):
    return {"type": "link", "title": title, "url": f"/d/{uid}", "icon": "dashboard",
            "targetBlank": False}


P95 = ('histogram_quantile({q}, sum by (le) '
       '(rate(holt_http_request_duration_seconds_bucket[$__rate_interval])))')
ERR = ('sum(rate(holt_http_requests_total{status=~"5.."}[5m])) '
       '/ sum(rate(holt_http_requests_total[5m]))')
POINTS = 'sum(min by (token) (holt_github_points_left))'


def health():
    p = []
    w = 3
    p += [
        stat("Site", 'min(probe_success{job="holt-site", path="public"})', (0, 0, w, 4),
             thresholds=[(None, RED), (1, GREEN)], mappings=named(RED, "Down", GREEN, "Up"),
             desc="githolt.com from outside: Cloudflare, the tunnel, the edge, the web app."),
        stat("API servers", 'count(up{job="holt-server"} == 1) or vector(0)', (3, 0, w, 4),
             thresholds=[(None, RED), (1, GREEN)],
             desc="Server containers answering /metrics. 2 for a moment during a deploy."),
        stat("Requests failing", f"({ERR}) or vector(0)", (6, 0, w, 4), unit="percentunit",
             thresholds=[(None, GREEN), (0.01, YELLOW), (0.05, RED)], decimals=1,
             desc="Share of API requests ending in a 5xx, last 5 minutes. Alert: over 5%."),
        stat("p95 response", '(histogram_quantile(0.95, sum by (le) '
             '(rate(holt_http_request_duration_seconds_bucket[5m]))) >= 0) or vector(0)',
             (9, 0, w, 4), unit="s",
             thresholds=[(None, GREEN), (1, YELLOW), (2, RED)], decimals=2,
             desc="19 in 20 API requests start answering within this (0 with no traffic). "
                  "Alert: over 2 s."),
        stat("Longest wait in queue", 'max(holt_jobs_oldest_queued_seconds{lane="user"})',
             (12, 0, w, 4), unit="s", thresholds=[(None, GREEN), (30, YELLOW), (60, RED)],
             desc="How long the longest-waiting person's check has been queued. Alert: over 60 s."),
        stat("Waiting for a DB connection", "max(holt_db_pool_waiting)", (15, 0, w, 4),
             thresholds=[(None, GREEN), (1, RED)],
             desc="Requests and jobs waiting for a pool connection now. Alert: above 0 for 5 minutes."),
        stat("GitHub points left", POINTS, (18, 0, w, 4),
             thresholds=[(None, RED), (500, YELLOW), (1500, GREEN)],
             desc="GraphQL points until the hourly reset. Warm passes stop under 1500; alert under 500. "
                  "Blank until the server has made a GitHub call since the last reset."),
        stat("Last deploy", 'max(probe_failed_due_to_regex{job="holt-deploy"})', (21, 0, w, 4),
             thresholds=[(None, GREEN), (1, RED)], mappings=named(GREEN, "OK", RED, "Failed"),
             desc="From /__build: whether the last production deploy failed or is held back."),
        alerts_table((0, 4, 24, 5)),
    ]
    y = 9
    p += [
        row("Requests", y),
        ts("Requests per second, by status", [target(
            'sum by (status) (rate(holt_http_requests_total[$__rate_interval]))', "{{status}}")],
            (0, y + 1, 12, 8), unit="reqps", stack=True, fill=30),
        ts("Response time", [target(P95.format(q=0.5), "p50"), target(P95.format(q=0.95), "p95"),
                             target(P95.format(q=0.99), "p99")], (12, y + 1, 12, 8), unit="s",
           thresholds=[(None, "transparent"), (2, RED)], fill=0,
           desc="Time to the first byte of the answer. The line is the alert: p95 over 2 s."),
        ts("Slowest routes (p95)", [target(
            'topk(5, histogram_quantile(0.95, sum by (le, route) '
            '(rate(holt_http_request_duration_seconds_bucket[5m]))))', "{{route}}")],
            (0, y + 9, 12, 8), unit="s", fill=0),
        ts("Page load, probed", [target('probe_duration_seconds{job="holt-site"}', "{{path}}")],
           (12, y + 9, 12, 8), unit="s", fill=0,
           desc="Seconds to fetch the home page every 30 s: from outside (public) and straight "
                "at the edge (internal). The gap is Cloudflare and the tunnel."),
    ]
    y += 17
    p += [
        row("Jobs", y),
        ts("Jobs queued and running", [target('max by (status, lane) (holt_jobs)',
                                              "{{status}} · {{lane}}")], (0, y + 1, 8, 8),
           desc="From the jobs table, so every process's jobs are counted."),
        ts("Workers busy", [
            target('sum by (lane) (holt_job_workers_busy)', "busy · {{lane}}"),
            target('max(holt_job_workers{lane="user"})', "user workers (HOLT_JOB_CONCURRENCY)"),
        ], (8, y + 1, 8, 8), overrides=[dashed("user workers (HOLT_JOB_CONCURRENCY)")],
           desc="Busy user workers at the dashed line means people's checks are queueing."),
        ts("Wait in the queue", [
            target('max by (lane) (holt_jobs_oldest_queued_seconds)', "longest now · {{lane}}"),
            target('histogram_quantile(0.95, sum by (le, lane) '
                   '(rate(holt_job_wait_seconds_bucket[15m])))', "p95 of started · {{lane}}"),
        ], (16, y + 1, 8, 8), unit="s", thresholds=[(None, "transparent"), (60, RED)], fill=0,
           desc="The line is the alert for the user lane: over 60 s. Background work is meant to wait."),
        ts("Jobs finished per hour", [target(
            'sum by (kind, outcome) (increase(holt_jobs_finished_total[1h]))',
            "{{kind}} · {{outcome}}")], (0, y + 9, 12, 8), fill=0),
        ts("How long jobs run (p95)", [target(
            'histogram_quantile(0.95, sum by (le, kind) '
            '(rate(holt_job_duration_seconds_bucket[15m])))', "{{kind}}")],
            (12, y + 9, 12, 8), unit="s", fill=0),
    ]
    y += 17
    p += [
        row("Database", y),
        ts("Connection pool", [
            target("max(holt_db_pool_in_use)", "in use"),
            target("max(holt_db_pool_waiting)", "waiting"),
            target("max(holt_db_pool_size)", "pool size"),
        ], (0, y + 1, 8, 8), overrides=[dashed("pool size"), {
            "matcher": {"id": "byName", "options": "waiting"},
            "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": RED}}]}],
           desc="In use at the dashed line with anything waiting is a full pool."),
        ts("Wait for a connection", [
            target('histogram_quantile(0.95, sum by (le) '
                   '(rate(holt_db_pool_wait_seconds_bucket[$__rate_interval])))', "p95 wait"),
            target('sum(increase(holt_db_pool_timeouts_total[5m]))', "gave up (per 5 min)"),
        ], (8, y + 1, 8, 8), unit="s", fill=0, overrides=[{
            "matcher": {"id": "byName", "options": "gave up (per 5 min)"},
            "properties": [{"id": "unit", "value": "short"},
                           {"id": "custom.axisPlacement", "value": "right"},
                           {"id": "color", "value": {"mode": "fixed", "fixedColor": RED}}]}]),
        ts("Postgres connections", [
            target('sum by (datname) (pg_stat_activity_count{datname!~"template.*|postgres"})',
                   "{{datname}}"),
            target("max(pg_settings_max_connections)", "max_connections"),
        ], (16, y + 1, 8, 8), stack=False, overrides=[dashed("max_connections")],
           desc="Open connections per database against Postgres's limit "
                "(the budget is in deploy/prod/compose.yml)."),
    ]
    y += 9
    p += [
        row("GitHub, AI, email, warm passes", y),
        ts("GitHub points left", [target('min by (token) (holt_github_points_left)',
                                         "token {{token}}")], (0, y + 1, 8, 8),
           thresholds=[(None, RED), (500, YELLOW), (1500, "transparent")], fill=0,
           desc="Refills every hour. Under 1500 warm passes stop; under 500 is the alert."),
        ts("GitHub points used per hour", [target(
            'sum(increase(holt_github_points_used_total[1h]))', "used")], (8, y + 1, 8, 8)),
        ts("AI spend against the budget", [
            target('max by (kind) (holt_ai_spent_usd)', "spent · {{kind}}"),
            target("max(holt_ai_committed_usd)", "spent + held by running jobs"),
            target("max(holt_ai_budget_usd)", "budget"),
        ], (16, y + 1, 8, 8), unit="currencyUSD", fill=0, overrides=[dashed("budget")],
           desc="The budget is HOLT_AI_BUDGET_USD: 0 means AI is off. merge_plan is the merge plan."),
        ts("Emails in the last 24 hours", [
            target('max by (stream, status) (holt_emails_last_day)', "{{stream}} · {{status}}"),
            target("max(holt_email_daily_limit)", "provider's daily limit"),
        ], (0, y + 9, 12, 8), fill=0, overrides=[dashed("provider's daily limit")]),
        ts("Warm pass", [
            target('max(holt_repos_reported{engine="older"})', "repos still on an older engine"),
            target('max(holt_jobs{lane="background", status="queued"})', "background jobs queued"),
            target('max(holt_warm_pass_running)', "a pass is running (1)"),
        ], (12, y + 9, 12, 8), fill=0,
           desc="After an engine change a warm pass redoes old reports: the first line falls to 0."),
    ]
    return dashboard("holt-health", "Holt health", p, "now-6h",
                     "Is Holt working right now: errors, speed, the queue, the database "
                     "pool, GitHub points.", links=[link("Capacity", "holt-capacity")])


GUIDE = """\
### When is it time to move off this server?

Look at **a week or more** (top right). One bad hour is an incident, not a reason to move.
It is time when, **on ordinary days**, any of these holds:

| Sign | Move when | Why |
|---|---|---|
| CPU busy at the daily peak | over **70%** most days | deploys build on this machine too; above that every build slows the site |
| Memory available at its lowest | under **2 GB** most days | a deploy's build may take up to 3 GB; under 1 GB the alert fires |
| CPU or memory pressure | over **10%** for an hour | work is stalling for lack of CPU or memory, whatever the averages say |
| `/` disk free | under **15%** after cleaning up | under 10% the alert fires; a build can fill the rest |
| User workers busy | all of them, for **over an hour a day** | people queue; more workers need more memory (about 50 MB each) |
| Checks per hour | over **60%** of GitHub's ceiling | that limit is GitHub's, not the server's: a bigger server won't help, more tokens will |

Red dashed lines on the charts are those limits. Raising `HOLT_JOB_CONCURRENCY` or the pool is the first step; moving is for when the machine itself is the limit.
"""

CPU = '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))'
ROOT = ('node_filesystem_avail_bytes{{mountpoint="{m}"}} '
        '/ node_filesystem_size_bytes{{mountpoint="{m}"}}')
CHECKS = ('(sum(increase(holt_jobs_finished_total{kind="analysis", outcome="done"}[1h])) '
          'or vector(0))')
CEILING = '$points_per_hour * count(max by (token) (holt_github_token_usable)) / $points_per_check'


def capacity():
    p = [text(GUIDE, (0, 0, 24, 10))]
    y = 10
    w = 4
    p += [
        stat("CPU busy, peak", CPU, (0, y, w, 4), unit="percentunit", calc="max", instant=False,
             thresholds=[(None, GREEN), (0.5, YELLOW), (0.7, RED)], decimals=0,
             desc="The highest 5-minute average over the time range, across all cores."),
        stat("Memory available, lowest", "node_memory_MemAvailable_bytes", (4, y, w, 4),
             unit="bytes", calc="min", instant=False,
             thresholds=[(None, RED), (1e9, YELLOW), (2e9, GREEN)], decimals=1,
             desc="The lowest it got over the time range."),
        stat("/ disk free", ROOT.format(m="/"), (8, y, w, 4), unit="percentunit",
             thresholds=[(None, RED), (0.10, YELLOW), (0.15, GREEN)], decimals=0,
             desc="/ holds Docker's images and build cache. Alert: under 10%."),
        stat("/home disk free", ROOT.format(m="/home"), (12, y, w, 4), unit="percentunit",
             thresholds=[(None, RED), (0.10, YELLOW), (0.20, GREEN)], decimals=0,
             desc="/home holds the database backups, evidence snapshots and this stack's data."),
        stat("User workers busy, peak", 'sum(holt_job_workers_busy{lane="user"}) '
             '/ max(holt_job_workers{lane="user"})', (16, y, w, 4), unit="percentunit",
             calc="max", instant=False, decimals=0,
             thresholds=[(None, GREEN), (0.7, YELLOW), (1, RED)],
             desc="The most user workers busy at once, as a share of HOLT_JOB_CONCURRENCY."),
        stat("Checks per hour, peak vs GitHub", f"({CHECKS}) / ({CEILING})", (20, y, w, 4),
             unit="percentunit", calc="max", instant=False, decimals=0,
             thresholds=[(None, GREEN), (0.4, YELLOW), (0.6, RED)],
             desc="The busiest hour's finished checks as a share of what GitHub's points allow."),
    ]
    y += 4
    p += [
        row("The machine", y),
        ts("CPU busy", [target(CPU, "all cores")], (0, y + 1, 12, 8), unit="percentunit",
           max_=1, thresholds=[(None, "transparent"), (0.7, RED)],
           desc="Share of all cores in use. The line is the migrate threshold: 70% at the daily peak."),
        ts("Load against cores", [
            target("node_load1", "1 min"), target("node_load15", "15 min"),
            target('count(node_cpu_seconds_total{mode="idle"})', "cores"),
        ], (12, y + 1, 12, 8), fill=0, overrides=[dashed("cores")],
           desc="Load above the number of cores means work is waiting for a CPU."),
        ts("Memory available", [target("node_memory_MemAvailable_bytes", "available"),
                                target("node_memory_MemTotal_bytes", "installed")],
           (0, y + 9, 12, 8), unit="bytes",
           thresholds=[(None, RED), (1e9, YELLOW), (2e9, "transparent")],
           overrides=[dashed("installed", "gray")],
           desc="What programs can still take without swapping. Lines: 2 GB (migrate), 1 GB (alert)."),
        ts("Pressure: time stalled waiting", [
            target('rate(node_pressure_cpu_waiting_seconds_total[5m])', "CPU"),
            target('rate(node_pressure_memory_waiting_seconds_total[5m])', "memory"),
            target('rate(node_pressure_io_waiting_seconds_total[5m])', "disk"),
        ], (12, y + 9, 12, 8), unit="percentunit", fill=0,
           thresholds=[(None, "transparent"), (0.10, RED)],
           desc="Share of time some work was stalled for lack of CPU, memory or disk. "
                "The clearest sign of an outgrown machine: over 10% for an hour."),
        ts("Disk free", [target(ROOT.format(m="/"), "/"), target(ROOT.format(m="/home"), "/home")],
           (0, y + 17, 12, 8), unit="percentunit", max_=1, fill=0,
           thresholds=[(None, RED), (0.10, YELLOW), (0.15, "transparent")]),
        ts("/ disk: free space in two weeks at this rate", [target(
            'predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[3d], 14 * 86400)',
            "predicted free")], (12, y + 17, 12, 8), unit="bytes", min_=None,
           thresholds=[(None, RED), (0, "transparent")],
           desc="A straight line through the last 3 days. Below zero: / fills within two weeks."),
    ]
    y += 25
    p += [
        row("Holt on the machine", y),
        ts("Memory by container", [target(
            'sum by (service) (container_memory_working_set_bytes{stack="holt"})', "{{service}}")],
            (0, y + 1, 12, 8), unit="bytes", stack=True, fill=30),
        ts("Memory against each container's limit", [target(
            'max by (service) (container_memory_working_set_bytes{stack="holt"} '
            '/ (container_spec_memory_limit_bytes{stack="holt"} > 0))', "{{service}}")],
            (12, y + 1, 12, 8), unit="percentunit", fill=0,
            thresholds=[(None, "transparent"), (0.9, RED)],
            desc="At 100% Docker kills the container. Over 90% often: raise its mem_limit "
                 "(deploy/prod/compose.yml)."),
        ts("CPU by container", [target(
            'sum by (service) (rate(container_cpu_usage_seconds_total{stack="holt"}[5m]))',
            "{{service}}")], (0, y + 9, 12, 8), unit="short", stack=True, fill=30,
            desc="In cores: 1 is one core fully busy."),
        ts("Postgres connections against its limit", [
            target('sum(pg_stat_activity_count)', "open"),
            target("max(pg_settings_max_connections)", "max_connections"),
        ], (12, y + 9, 12, 8), overrides=[dashed("max_connections")]),
    ]
    y += 17
    p += [
        row("Traffic against the limits", y),
        ts("User workers busy", [
            target('sum(holt_job_workers_busy{lane="user"})', "busy"),
            target('max(holt_job_workers{lane="user"})', "workers (HOLT_JOB_CONCURRENCY)"),
        ], (0, y + 1, 12, 8), overrides=[dashed("workers (HOLT_JOB_CONCURRENCY)")],
           desc="Peak concurrency. Busy touching the line for long means people queue."),
        ts("Requests in flight", [target("sum(holt_http_requests_in_flight)", "in flight"),
                                  target('sum(rate(holt_http_requests_total[5m]))', "per second")],
           (12, y + 1, 12, 8), fill=0,
           desc="Requests being answered at once (open progress streams included), and the rate."),
        ts("Checks per hour against GitHub's ceiling", [
            target(CHECKS, "checks finished"),
            target(CEILING, "ceiling"),
        ], (0, y + 9, 12, 8), overrides=[dashed("ceiling")],
           desc="The ceiling is what GitHub's hourly points allow: points per hour per token "
                "÷ points one check uses (the two boxes at the top of the page)."),
        ts("GitHub points used per hour", [
            target('sum(increase(holt_github_points_used_total[1h]))', "used"),
            target('$points_per_hour * count(max by (token) (holt_github_token_usable))',
                   "GitHub's hourly allowance"),
        ], (12, y + 9, 12, 8), overrides=[dashed("GitHub's hourly allowance")],
           desc="Warm passes and people's checks together."),
    ]
    y += 17
    p += [
        row("What monitoring itself costs", y),
        ts("Memory", [target(
            'sum by (service) (container_memory_working_set_bytes{stack="monitoring"})',
            "{{service}}")], (0, y + 1, 12, 7), unit="bytes", stack=True, fill=30),
        ts("Prometheus on disk", [target("prometheus_tsdb_storage_blocks_bytes "
                                         "+ prometheus_tsdb_wal_storage_size_bytes "
                                         "+ prometheus_tsdb_head_chunks_storage_size_bytes", "bytes on /home")],
           (12, y + 1, 6, 7), unit="bytes"),
        ts("Series kept", [target("prometheus_tsdb_head_series", "series")], (18, y + 1, 6, 7)),
    ]
    variables = [
        {"name": "points_per_hour", "label": "GitHub points per hour, per token",
         "type": "textbox", "query": "5000", "current": {"text": "5000", "value": "5000"},
         "options": [{"selected": True, "text": "5000", "value": "5000"}], "hide": 0},
        {"name": "points_per_check", "label": "Points one check uses", "type": "textbox",
         "query": "12", "current": {"text": "12", "value": "12"},
         "options": [{"selected": True, "text": "12", "value": "12"}], "hide": 0},
    ]
    return dashboard("holt-capacity", "Holt capacity: when to migrate", p, "now-7d",
                     "Is the home server still big enough: headroom over days, peaks "
                     "against the limits.", templating=variables,
                     links=[link("Health", "holt-health")])


def main(argv: list[str]) -> int:
    global _id
    out = Path(__file__).with_name("dashboards")
    stale = []
    for name, build in (("holt-health", health), ("holt-capacity", capacity)):
        _id = 0
        body = json.dumps(build(), indent=2) + "\n"
        path = out / f"{name}.json"
        if "--check" in argv:
            if not path.exists() or path.read_text(encoding="utf-8") != body:
                stale.append(path.name)
        else:
            path.write_text(body, encoding="utf-8")
            print(f"wrote {path}")
    if stale:
        print(f"out of date: {', '.join(stale)} (run {Path(__file__).name})", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
