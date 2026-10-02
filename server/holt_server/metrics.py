"""`GET /metrics`: what this server is doing, in Prometheus's text format, for
the monitoring stack (deploy/monitoring).

Not part of the web app's API (API.md) and never public: the server
publishes no port, the web app proxies no such path, and the edge only talks
to the web app. Prometheus reads it on the stack's own Docker network.

Three kinds of numbers:

* counted as they happen, in this process: requests (rate and time to the
  first byte, by route template, never by URL), jobs (how long each waited
  and ran, by lane), waits for a database connection;
* read from memory at each scrape: the database pool, GitHub points left
  (as GitHub last said, no call is made), the job workers;
* read from the database at each scrape, on a connection of its own
  (`Database.stats`), so they are true across processes and restarts, and
  still answer while every pool connection is busy: the queue, AI spend,
  emails sent, reports by engine version, whether a warm pass is running.
  If that read fails, `holt_metrics_db_ok` is 0 and the rest is still served.

Nothing here names a user, a repository or a token.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Request, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    ProcessCollector,
    generate_latest,
)
from prometheus_client.core import CounterMetricFamily, GaugeMetricFamily
from sqlalchemy import case, func, select, text

from holt_server import __version__, budget
from holt_server.db import (
    ACTIVE,
    BADGE_PRIORITY,
    ENGINE_VERSION,
    AccountEmail,
    AiBudget,
    AiRun,
    AlertEmail,
    Job,
    Report,
    now,
    utc,
)
from holt_server.deps import services
from holt_server.jobs import BACKGROUND_LANE, USER_LANE

if TYPE_CHECKING:
    from holt_server.services import Services

log = logging.getLogger("holt_server.metrics")

LANES = (USER_LANE, BACKGROUND_LANE)

# The database read gives up after this long; a scrape allows 10 s.
DB_TIMEOUT_S = 3.0
# Counting repos by engine version reads every report row: at most this often.
REPORTS_EVERY_S = 60.0
# Requests that aren't traffic: the container's health check and the scrape.
UNCOUNTED = frozenset({"/health", "/metrics"})

# 2 s is an edge because the slow-requests alert asks "over 2 s?" (deploy/monitoring).
HTTP_BUCKETS = (0.025, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20)
POOL_BUCKETS = (0.001, 0.01, 0.1, 0.5, 1, 2.5, 5, 10)
WAIT_BUCKETS = (1, 5, 15, 30, 60, 120, 300, 600)
RUN_BUCKETS = (2.5, 5, 10, 20, 40, 60, 120, 180, 300, 480)


def lane_of(priority: int | None) -> str:
    """The lane a job belongs to: a person's, or background work (badge
    refreshes, warm passes)."""
    return BACKGROUND_LANE if (priority or 0) >= BADGE_PRIORITY else USER_LANE


@dataclass
class DbStats:
    """What one scrape read from the database."""

    # (status, lane) -> jobs; lane -> seconds the oldest queued job has waited.
    jobs: dict[tuple[str, str], int] = field(default_factory=dict)
    oldest_queued_s: dict[str, float] = field(default_factory=dict)
    ai_committed_usd: float = 0.0
    ai_spent_usd: dict[str, float] = field(default_factory=dict)
    # (stream, status) -> emails handed to the provider in the last 24 hours.
    emails: dict[tuple[str, str], int] = field(default_factory=dict)
    # Repos whose newest rules report is from this engine, and from an older one.
    repos_current: int = 0
    repos_older: int = 0
    # None: can't tell here (not Postgres).
    warm_running: bool | None = None


class Metrics:
    """One per `Services`, with a registry of its own (no process-wide state,
    so each test's app counts from zero)."""

    def __init__(self, svc: Services) -> None:
        self.svc = svc
        self.registry = reg = CollectorRegistry()
        self.http_requests = Counter(
            "holt_http_requests", "Requests answered, by route template and status.",
            ("method", "route", "status"), registry=reg)
        self.http_seconds = Histogram(
            "holt_http_request_duration_seconds",
            "Seconds from a request arriving to its response starting.",
            ("method", "route"), buckets=HTTP_BUCKETS, registry=reg)
        self.http_in_flight = Gauge(
            "holt_http_requests_in_flight",
            "Requests being answered now, open event streams included.", registry=reg)
        self.pool_wait = Histogram(
            "holt_db_pool_wait_seconds",
            "Seconds a request or job waited for a database connection.",
            buckets=POOL_BUCKETS, registry=reg)
        self.job_wait = Histogram(
            "holt_job_wait_seconds", "Seconds a job waited in the queue before it started.",
            ("lane",), buckets=WAIT_BUCKETS, registry=reg)
        self.job_seconds = Histogram(
            "holt_job_duration_seconds", "Seconds a job ran.",
            ("kind",), buckets=RUN_BUCKETS, registry=reg)
        self.jobs_finished = Counter(
            "holt_jobs_finished", "Jobs this process ran to an end (done, error or timeout).",
            ("kind", "lane", "outcome"), registry=reg)
        self.workers_busy = Gauge(
            "holt_job_workers_busy", "Job workers running a job now, by the worker's lane.",
            ("lane",), registry=reg)
        for lane in LANES:
            self.workers_busy.labels(lane)
            self.job_wait.labels(lane)
        svc.db.pool_meter.observe = self.pool_wait.observe
        ProcessCollector(registry=reg)
        reg.register(_Live(self))
        self._db: DbStats | None = None
        self._reports: tuple[float, int, int] | None = None  # read at, current, older

    # --- jobs (jobs.py calls these) -----------------------------------------------

    def job_started(self, job: Job, worker_lane: str, waited_s: float) -> None:
        self.workers_busy.labels(worker_lane).inc()
        self.job_wait.labels(lane_of(job.priority)).observe(max(0.0, waited_s))

    def job_finished(self, job: Job, worker_lane: str, outcome: str, seconds: float) -> None:
        self.workers_busy.labels(worker_lane).dec()
        self.job_seconds.labels(job.kind).observe(seconds)
        self.jobs_finished.labels(job.kind, lane_of(job.priority), outcome).inc()

    # --- the scrape -------------------------------------------------------------

    async def render(self) -> bytes:
        self._db = await self._read_db()
        return generate_latest(self.registry)

    async def _read_db(self) -> DbStats | None:
        try:
            async with asyncio.timeout(DB_TIMEOUT_S):
                async with self.svc.db.stats() as conn:
                    return await self._query(conn)
        except Exception as exc:  # noqa: BLE001 -- the other numbers still go out
            log.warning("metrics: reading the database failed: %s", type(exc).__name__)
            return None

    async def _query(self, conn) -> DbStats:
        out = DbStats()
        at = now()
        for status, priority, count, oldest in await conn.execute(
                select(Job.status, Job.priority, func.count(), func.min(Job.created_at))
                .where(Job.status.in_(ACTIVE)).group_by(Job.status, Job.priority)):
            lane = lane_of(priority)
            out.jobs[status, lane] = out.jobs.get((status, lane), 0) + count
            if status == "queued" and oldest is not None:
                waited = (at - utc(oldest)).total_seconds()
                out.oldest_queued_s[lane] = max(out.oldest_queued_s.get(lane, 0.0), waited)

        out.ai_committed_usd = ((await conn.execute(
            select(AiBudget.committed_micros))).scalar() or 0) / budget.MICROS
        for kind, micros in await conn.execute(
                select(AiRun.kind, func.coalesce(func.sum(AiRun.cost_micros), 0))
                .where(AiRun.settled_at.is_not(None)).group_by(AiRun.kind)):
            out.ai_spent_usd[kind] = int(micros) / budget.MICROS

        since = at - timedelta(hours=24)
        for stream, table in (("alerts", AlertEmail), ("account", AccountEmail)):
            for status, count in await conn.execute(
                    select(table.status, func.count()).where(table.sent_at >= since)
                    .group_by(table.status)):
                out.emails[stream, status] = count

        out.repos_current, out.repos_older = await self._repos(conn)
        if conn.dialect.name == "postgresql":
            from holt_server.warm import LOCK_ID

            # The warm pass's advisory lock: a single bigint key is (classid 0, objid).
            out.warm_running = bool((await conn.execute(text(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' "
                "AND classid = 0 AND objid = :id AND granted"), {"id": LOCK_ID})).scalar())
        return out

    async def _repos(self, conn) -> tuple[int, int]:
        if self._reports and time.monotonic() - self._reports[0] < REPORTS_EVERY_S:
            return self._reports[1:]
        newest = (select(func.max(func.coalesce(Report.engine_version, 0)).label("v"))
                  .where(Report.mode == "rules").group_by(Report.repo_key).subquery())
        total, current = (await conn.execute(select(
            func.count(),
            func.coalesce(func.sum(case((newest.c.v >= ENGINE_VERSION, 1), else_=0)), 0),
        ).select_from(newest))).one()
        self._reports = (time.monotonic(), int(current), int(total) - int(current))
        return self._reports[1:]

    def live(self) -> Iterator[Any]:
        """Every number read at scrape time, as metric families."""
        svc, s = self.svc, self.svc.settings

        info = GaugeMetricFamily("holt_build_info", "The server and engine versions.",
                                 labels=("version", "engine_version"))
        info.add_metric((__version__, str(ENGINE_VERSION)), 1)
        yield info

        pool, meter = svc.db.engine.pool, svc.db.pool_meter
        if hasattr(pool, "checkedout"):
            yield GaugeMetricFamily(
                "holt_db_pool_size", "Connections the pool may hold (HOLT_DB_POOL_SIZE "
                "plus HOLT_DB_MAX_OVERFLOW).", value=pool.size() + max(0, pool._max_overflow))
            yield GaugeMetricFamily("holt_db_pool_in_use", "Pool connections out now.",
                                    value=pool.checkedout())
        yield GaugeMetricFamily(
            "holt_db_pool_waiting", "Requests and jobs waiting for a pool connection now.",
            value=meter.waiting)
        yield CounterMetricFamily(
            "holt_db_pool_timeouts", "Waits for a pool connection that gave up "
            "(HOLT_DB_POOL_TIMEOUT).", value=meter.timeouts)

        workers = GaugeMetricFamily(
            "holt_job_workers", "Job workers per lane (HOLT_JOB_CONCURRENCY, "
            "HOLT_BADGE_CONCURRENCY).", labels=("lane",))
        workers.add_metric((USER_LANE,), svc.runner.concurrency)
        workers.add_metric((BACKGROUND_LANE,), svc.runner.badge_concurrency)
        yield workers

        left = GaugeMetricFamily(
            "holt_github_points_left", "GraphQL points left on each GitHub token, as "
            "GitHub last said. Missing while unknown.", labels=("token",))
        reset = GaugeMetricFamily(
            "holt_github_points_reset_timestamp_seconds",
            "When each token's points come back (Unix time).", labels=("token",))
        usable = GaugeMetricFamily(
            "holt_github_token_usable", "1 while a token can be used: not refused, "
            "not rate-limited, not nearly used up.", labels=("token",))
        for i, token in enumerate(svc.pool.states(), start=1):
            if token.remaining is not None:
                left.add_metric((str(i),), token.remaining)
            if token.reset_at is not None:
                reset.add_metric((str(i),), token.reset_at)
            usable.add_metric((str(i),), 1 if token.usable else 0)
        yield left
        yield reset
        yield usable
        yield CounterMetricFamily(
            "holt_github_points_used", "GraphQL points this process has seen spent.",
            value=svc.pool.points_used)

        yield GaugeMetricFamily(
            "holt_ai_budget_usd", "The AI budget in force (0: AI is off).",
            value=budget.limit_usd(s))
        yield GaugeMetricFamily(
            "holt_email_daily_limit", "The email provider's daily sending limit.",
            value=s.alert_email_daily_limit)

        db = self._db
        yield GaugeMetricFamily(
            "holt_metrics_db_ok", "1 when this scrape could read the database.",
            value=0 if db is None else 1)
        if db is None:
            return
        jobs = GaugeMetricFamily(
            "holt_jobs", "Jobs queued and running, in every process, by the job's lane.",
            labels=("status", "lane"))
        oldest = GaugeMetricFamily(
            "holt_jobs_oldest_queued_seconds",
            "How long the longest-waiting queued job has waited (0: none queued).",
            labels=("lane",))
        for lane in LANES:
            for status in ACTIVE:
                jobs.add_metric((status, lane), db.jobs.get((status, lane), 0))
            oldest.add_metric((lane,), db.oldest_queued_s.get(lane, 0.0))
        yield jobs
        yield oldest

        yield GaugeMetricFamily(
            "holt_ai_committed_usd", "AI spend so far plus what running jobs hold.",
            value=db.ai_committed_usd)
        spent = GaugeMetricFamily(
            "holt_ai_spent_usd", "What finished AI runs cost, by kind of run.",
            labels=("kind",))
        for kind in (budget.ANALYSIS, budget.PLAYBOOK, budget.PREFLIGHT, budget.MERGE_PLAN):
            spent.add_metric((kind,), db.ai_spent_usd.get(kind, 0.0))
        yield spent

        emails = GaugeMetricFamily(
            "holt_emails_last_day", "Emails handed to the provider in the last 24 hours.",
            labels=("stream", "status"))
        for stream in ("alerts", "account"):
            for status in ("sent", "failed"):
                emails.add_metric((stream, status), db.emails.get((stream, status), 0))
        yield emails

        repos = GaugeMetricFamily(
            "holt_repos_reported", "Repos by the engine that made their newest quick "
            "report: this one, or an older one (a warm pass redoes those).",
            labels=("engine",))
        repos.add_metric(("current",), db.repos_current)
        repos.add_metric(("older",), db.repos_older)
        yield repos
        if db.warm_running is not None:
            yield GaugeMetricFamily("holt_warm_pass_running", "1 while a warm pass runs.",
                                    value=1 if db.warm_running else 0)


class _Live:
    """The registry's collector for `Metrics.live`."""

    def __init__(self, metrics: Metrics) -> None:
        self.metrics = metrics

    def collect(self) -> Iterator[Any]:
        return self.metrics.live()


class HttpMetrics:
    """Counts and times every request (plain ASGI, so event streams pass
    through untouched). The route label is the matched route's template; a
    request that matched none is `unmatched`."""

    def __init__(self, app, metrics: Metrics) -> None:
        self.app = app
        self.metrics = metrics

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope["path"] in UNCOUNTED:
            await self.app(scope, receive, send)
            return
        m = self.metrics
        started = time.monotonic()
        seen = False

        def record(status: int) -> None:
            nonlocal seen
            seen = True
            route = getattr(scope.get("route"), "path", None) or "unmatched"
            m.http_seconds.labels(scope["method"], route).observe(time.monotonic() - started)
            m.http_requests.labels(scope["method"], route, str(status)).inc()

        async def sending(message) -> None:
            if message["type"] == "http.response.start" and not seen:
                record(message["status"])
            await send(message)

        m.http_in_flight.inc()
        try:
            await self.app(scope, receive, sending)
        except Exception:
            if not seen:
                record(500)
            raise
        finally:
            m.http_in_flight.dec()


router = APIRouter()


@router.get("/metrics", include_in_schema=False)
async def get_metrics(request: Request) -> Response:
    return Response(await services(request).metrics.render(), media_type=CONTENT_TYPE_LATEST)
