"""Does the database connection pool hold under load? A prod-sized database,
slow GitHub, jobs running and a crowd of page requests, all in this process.

    docker compose -f server/compose.yml up -d
    uv run python server/scripts/pool_load.py --seed \\
        --database-url postgresql+asyncpg://holt:holt@127.0.0.1:20131/holt

No network: the API is called in-process (ASGI) and the engine is a fake
whose "GitHub" takes --github-seconds per job. While --jobs analyses run
(as many as production's workers), --requests page requests arrive
--concurrency at a time (Discover boards with changing filters, report pages)
and /health is polled as a container health check would.

It prints how many requests failed, the most pool connections in use at
once, how long connections were held, and what /health answered. Exit status
1 if a request failed or /health was slow or down.

--seed empties and refills the tables it uses (reports, repo_meta,
usage_events, jobs), so it only runs against a database on this machine.
"""

from __future__ import annotations

import argparse
import asyncio
import random
import statistics
import sys
import time
from collections import Counter
from typing import Any

import httpx
from holt_server.db import Job, RepoMeta, Report, Usage, now
from holt_server.main import create_app
from holt_server.services import Services
from holt_server.settings import Settings
from sqlalchemy import delete, event
from sqlalchemy.engine import make_url

KEY = "pool-load"
HEADERS = {"X-Holt-Internal-Key": KEY, "X-Holt-Client-Ip": "10.0.0.1"}
LANGUAGES = ["Python", "TypeScript", "Go", "Rust", "Java", "C++", "Ruby", "PHP", "Swift", "Kotlin"]
TOPICS = 400
STATS = {"outsider_attempts": 20, "outsider_merged": 8, "distinct_outsiders": 15,
         "first_time_merged_authors": 6, "no_reply": 2, "median_first_response_hours": 3.0,
         "bot_share": 0.1}
WORDS = ("merge review reply maintainer contributor issue label release build test docs "
         "pipeline branch commit thread approve request change stale bot").split()
# /health slower than this fails a container health check (compose: timeout 3s).
HEALTH_LIMIT_S = 2.0


def report_body(repo: str, verdict: str, kb: int, rng: random.Random) -> dict[str, Any]:
    """A report the API serves, padded to about `kb` KB with text that
    compresses the way real evidence does."""
    filler = " ".join(rng.choice(WORDS) for _ in range(kb * 1024 // 7))
    return {"repo": repo, "mode": "rules", "days": 7, "verdict": verdict, "summary": None,
            "stats": STATS, "decided_by": ["Outsiders get merged here."],
            "rule_codes": ["merges"], "unknowns": [], "landing": [], "never_landed": [],
            "evidence": [], "evidence_until": None, "generated_at": "2026-09-25T00:00:00Z",
            "cost": None, "padding": filler}


async def seed(svc: Services, repos: int, kb: int) -> None:
    rng = random.Random(1)
    async with svc.db.session() as s:
        for table in (Report, RepoMeta, Usage, Job):
            await s.execute(delete(table))
        await s.commit()
    for start in range(0, repos, 100):
        async with svc.db.session() as s:
            for i in range(start, min(start + 100, repos)):
                repo = f"owner{i}/repo{i}"
                verdict = rng.choice(["viable"] * 5 + ["long_shot", "not_viable",
                                                        "insufficient_evidence"])
                # An older report and the current one, as a re-checked repo has.
                for _ in range(2):
                    s.add(Report(repo=repo, repo_key=repo, mode="rules", days=7,
                                 report=report_body(repo, verdict, kb, rng)))
                s.add(RepoMeta(
                    repo_key=repo, repo=repo, description="A project. " * 8,
                    language=rng.choice(LANGUAGES), languages=["Python", "C"],
                    stars=rng.randrange(50000),
                    topics=[f"topic{rng.randrange(TOPICS)}" for _ in range(8)],
                    pushed_at=now(), forks=10, open_issues=20, pull_requests=300,
                    open_pull_requests=12, contributors=40, license="MIT",
                    readme="# Project\n\n" + "What it does and how to build it. " * 180,
                    links=[{"kind": "contributing", "url": "https://example.com/c"}],
                    top_contributors=[{"login": f"u{n}", "url": f"https://github.com/u{n}",
                                       "contributions": 9} for n in range(15)]))
                s.add_all(Usage(day=now().strftime("%Y-%m-%d"), kind="analysis", who=f"p{p}",
                                repo_key=repo) for p in range(rng.randrange(8)))
            await s.commit()
    print(f"seeded {repos} repos, {2 * repos} reports of about {kb} KB")


class PoolWatch:
    """The most connections out of the pool at once, and how long each was out."""

    def __init__(self, engine) -> None:
        self.out: dict[int, float] = {}
        self.peak = 0
        self.held: list[float] = []
        event.listen(engine.sync_engine, "checkout", self._checkout)
        event.listen(engine.sync_engine, "checkin", self._checkin)

    def _checkout(self, dbapi, record, proxy) -> None:
        self.out[id(record)] = time.perf_counter()
        self.peak = max(self.peak, len(self.out))

    def _checkin(self, dbapi, record) -> None:
        if (since := self.out.pop(id(record), None)) is not None:
            self.held.append(time.perf_counter() - since)


def centile(values: list[float], pct: int) -> float:
    return statistics.quantiles(values, n=100)[pct - 1] if len(values) > 1 else max(values)


async def run(args: argparse.Namespace) -> int:
    svc = Services(Settings(
        _env_file=None, DATABASE_URL=args.database_url, HOLT_INTERNAL_KEY=KEY,
        HOLT_SECRET_KEY="pool-load", GITHUB_TOKENS="none", HOLT_ANON_RATE_PER_HOUR=10**6,
        HOLT_JOB_CONCURRENCY=6, HOLT_BADGE_CONCURRENCY=3, HOLT_CONTRIBUTIONS_REFRESH_HOURS=0,
        HOLT_DB_POOL_SIZE=args.pool_size, HOLT_DB_MAX_OVERFLOW=args.max_overflow,
        HOLT_DB_POOL_TIMEOUT=args.pool_timeout))

    def slow_github(*, repo, mode, days, provider, model, emit, as_of):
        for step in range(1, 6):
            emit(f"Reading pull requests ({step}/5)", step / 6)
            time.sleep(args.github_seconds / 5)
        return report_body(repo, "viable", 8, random.Random(repo))

    async def canonical(repo: str) -> str:
        return repo

    svc.analysis_fn = slow_github
    svc.canonical = canonical
    svc.provider_factory = lambda repo, as_of: None
    svc.lookup.details = lambda repos: asyncio.sleep(args.github_seconds, {r: None for r in repos})
    app = create_app(services=svc)
    watch = PoolWatch(svc.db.engine)
    rng = random.Random(2)
    statuses: Counter = Counter()
    took: list[float] = []
    health: list[tuple[int, float]] = []

    async with app.router.lifespan_context(app):
        if args.seed:
            await seed(svc, args.repos, args.report_kb)
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://holt",
                                     headers=HEADERS, timeout=120) as client:
            fresh = f"run{int(time.time())}"  # repos no earlier run has reported
            for n in range(args.jobs):
                r = await client.post("/v1/analyses", json={"repo": f"{fresh}/repo{n}"})
                assert r.status_code == 202, r.text
            gate = asyncio.Semaphore(args.concurrency)

            async def page() -> None:
                if rng.random() < 0.7:
                    params = {"sort": rng.choice(["welcoming", "welcoming", "stars", "trending"]),
                              "limit": 30, "language": rng.choice(LANGUAGES),
                              "topic": f"topic{rng.randrange(TOPICS)}"}
                    path = "/v1/discover"
                else:
                    n = rng.randrange(args.repos)
                    path, params = f"/v1/reports/owner{n}/repo{n}", {}
                async with gate:
                    started = time.perf_counter()
                    r = await client.get(path, params=params)
                    took.append(time.perf_counter() - started)
                    statuses[r.status_code] += 1

            async def poll_health() -> None:
                while True:
                    started = time.perf_counter()
                    r = await client.get("/health")
                    health.append((r.status_code, time.perf_counter() - started))
                    await asyncio.sleep(0.2)

            poller = asyncio.create_task(poll_health())
            started = time.perf_counter()
            await asyncio.gather(*(page() for _ in range(args.requests)))
            wall = time.perf_counter() - started
            poller.cancel()

    failed = sum(n for code, n in statuses.items() if code >= 400)
    slow = [h for h in health if h[0] != 200 or h[1] > HEALTH_LIMIT_S]
    pool = f"{args.pool_size}+{args.max_overflow}, wait {args.pool_timeout:g}s"
    print(f"{args.requests} requests, {args.concurrency} at a time, {args.jobs} jobs on a "
          f"{args.github_seconds:g}s GitHub, pool {pool}: {wall:.1f}s")
    print(f"  responses: {dict(sorted(statuses.items()))}  ({failed} failed)")
    print(f"  request time: p50 {centile(took, 50):.2f}s  p95 {centile(took, 95):.2f}s  "
          f"max {max(took):.2f}s")
    print(f"  pool connections in use at once: at most {watch.peak}")
    print(f"  connection held: p50 {centile(watch.held, 50) * 1000:.0f} ms  "
          f"p95 {centile(watch.held, 95) * 1000:.0f} ms  max {max(watch.held) * 1000:.0f} ms  "
          f"({len(watch.held)} checkouts)")
    print(f"  /health: {len(health)} checks, {len(slow)} down or slower than "
          f"{HEALTH_LIMIT_S:g}s, slowest {max(h[1] for h in health):.2f}s")
    return 1 if failed or slow else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--seed", action="store_true",
                        help="empty and refill reports, repo_meta, usage_events and jobs first")
    parser.add_argument("--repos", type=int, default=1600)
    parser.add_argument("--report-kb", type=int, default=8)
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=40)
    parser.add_argument("--jobs", type=int, default=9)
    parser.add_argument("--github-seconds", type=float, default=5.0)
    parser.add_argument("--pool-size", type=int, default=Settings.model_fields["db_pool_size"].default)
    parser.add_argument("--max-overflow", type=int,
                        default=Settings.model_fields["db_max_overflow"].default)
    parser.add_argument("--pool-timeout", type=float,
                        default=Settings.model_fields["db_pool_timeout"].default)
    args = parser.parse_args()
    if args.seed and make_url(args.database_url).host not in ("127.0.0.1", "localhost", "::1"):
        parser.error("--seed deletes rows: only against a database on this machine")
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
