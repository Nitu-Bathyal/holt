"""`GET /metrics`: what the monitoring stack reads (holt_server/metrics.py)."""

from __future__ import annotations

import asyncio
import os
import time
from datetime import timedelta

from conftest import canned_report
from holt_server import api, warm
from holt_server.db import (
    ENGINE_VERSION,
    AccountEmail,
    AiBudget,
    AiRun,
    AlertEmail,
    Job,
    Report,
    now,
)
from prometheus_client.parser import text_string_to_metric_families
from sqlalchemy import text, update

POSTGRES = (os.environ.get("HOLT_TEST_DATABASE_URL") or "").startswith("postgresql")


def scrape(h) -> dict[tuple[str, tuple], float]:
    """Every sample, by name and sorted label pairs. No internal key is sent."""
    response = h.client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    return {(s.name, tuple(sorted(s.labels.items()))): s.value
            for family in text_string_to_metric_families(response.text)
            for s in family.samples}


def value(samples, name, **labels):
    return samples.get((name, tuple(sorted(labels.items()))))


def add(h, *items):
    async def go():
        async with h.svc.db.session() as s:
            s.add_all(items)
            await s.commit()
    h.client.portal.call(go)


def busy(h) -> float:
    """Workers running a job now. A background worker takes a person's job
    when it is free first, so either lane may hold it."""
    m = scrape(h)
    return sum(value(m, "holt_job_workers_busy", lane=lane) for lane in ("user", "background"))


def until(done, timeout=10.0):
    deadline = time.monotonic() + timeout
    while not done():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.02)


def test_metrics_answer_without_the_internal_key_and_say_which_build(make_harness):
    h = make_harness()
    m = scrape(h)
    assert value(m, "holt_metrics_db_ok") == 1
    assert any(name == "holt_build_info" and dict(labels)["engine_version"] == str(ENGINE_VERSION)
               for name, labels in m)
    assert value(m, "holt_job_workers", lane="user") == h.svc.settings.job_concurrency
    assert value(m, "holt_job_workers", lane="background") == h.svc.settings.badge_concurrency


def test_requests_are_counted_by_route_template_never_by_url(make_harness):
    h = make_harness()
    add(h, Report(repo="octo/one", repo_key="octo/one", mode="rules", days=7,
                  report=canned_report("octo/one")))
    assert h.get("/v1/reports/octo/one").status_code == 200
    assert h.get("/v1/reports/octo/one").status_code == 200
    assert h.get("/v1/reports/octo/missing").status_code == 404
    assert h.client.get("/v1/reports/octo/one").status_code == 401  # no key
    assert h.get("/nothing/here").status_code == 404
    h.client.get("/health")

    route = "/v1/reports/{owner}/{repo}"
    m = scrape(h)
    assert value(m, "holt_http_requests_total", method="GET", route=route, status="200") == 2
    assert value(m, "holt_http_requests_total", method="GET", route=route, status="404") == 1
    assert value(m, "holt_http_requests_total", method="GET", route=route, status="401") == 1
    assert value(m, "holt_http_requests_total", method="GET", route="unmatched",
                 status="404") == 1
    assert value(m, "holt_http_request_duration_seconds_count", method="GET", route=route) == 4
    # The health check and the scrape itself aren't traffic.
    assert not any(dict(labels).get("route") in ("/health", "/metrics") for _, labels in m)
    assert "octo" not in h.client.get("/metrics").text


def test_a_request_that_crashes_counts_as_a_500(make_harness, monkeypatch):
    h = make_harness()

    async def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(api, "latest_report", boom)
    client = type(h.client)(h.client.app, raise_server_exceptions=False)
    assert client.get("/v1/reports/octo/one", headers=h.headers()).status_code == 500
    m = scrape(h)
    assert value(m, "holt_http_requests_total", method="GET",
                 route="/v1/reports/{owner}/{repo}", status="500") == 1
    assert value(m, "holt_http_requests_in_flight") == 0


def test_the_queue_is_read_from_the_table_by_lane(make_harness):
    h = make_harness(run_jobs=False)
    old = now() - timedelta(seconds=90)
    add(h, Job(repo="octo/one", repo_key="octo/one", created_at=old, dedupe_key="a"),
        Job(repo="octo/two", repo_key="octo/two", dedupe_key="b"),
        Job(repo="octo/three", repo_key="octo/three", priority=10, dedupe_key="c"),
        Job(repo="octo/four", repo_key="octo/four", status="running", dedupe_key="d"))
    m = scrape(h)
    assert value(m, "holt_jobs", status="queued", lane="user") == 2
    assert value(m, "holt_jobs", status="queued", lane="background") == 1
    assert value(m, "holt_jobs", status="running", lane="user") == 1
    assert value(m, "holt_jobs", status="running", lane="background") == 0
    assert 90 <= value(m, "holt_jobs_oldest_queued_seconds", lane="user") < 120
    assert value(m, "holt_jobs_oldest_queued_seconds", lane="background") < 30


def test_an_empty_queue_reads_zero(make_harness):
    m = scrape(make_harness(run_jobs=False))
    assert value(m, "holt_jobs", status="queued", lane="user") == 0
    assert value(m, "holt_jobs_oldest_queued_seconds", lane="user") == 0


def test_a_job_is_counted_while_it_runs_and_when_it_ends(make_harness):
    h = make_harness()
    h.engine.gate.clear()  # the engine hangs mid-run
    job = h.post("/v1/analyses", json={"repo": "octo/one"}).json()["job_id"]
    until(lambda: busy(h) == 1)
    m = scrape(h)
    assert value(m, "holt_jobs", status="running", lane="user") == 1
    assert value(m, "holt_job_wait_seconds_count", lane="user") == 1
    h.engine.gate.set()
    assert h.wait(job)["status"] == "done"
    until(lambda: busy(h) == 0)
    m = scrape(h)
    assert value(m, "holt_jobs_finished_total", kind="analysis", lane="user",
                 outcome="done") == 1
    assert value(m, "holt_job_duration_seconds_count", kind="analysis") == 1
    assert value(m, "holt_jobs", status="running", lane="user") == 0


def test_a_failed_job_is_counted_as_an_error(make_harness):
    h = make_harness()
    h.engine.error = RuntimeError("boom")
    job = h.post("/v1/analyses", json={"repo": "octo/one"}).json()["job_id"]
    assert h.wait(job)["status"] == "error"
    until(lambda: value(scrape(h), "holt_jobs_finished_total", kind="analysis", lane="user",
                        outcome="error") == 1)


def test_a_job_past_its_time_limit_is_counted_as_a_timeout(make_harness):
    h = make_harness(HOLT_JOB_TIMEOUT_RULES=0.2)
    h.engine.gate.clear()
    job = h.post("/v1/analyses", json={"repo": "octo/one"}).json()["job_id"]
    assert h.wait(job)["status"] == "error"
    h.engine.gate.set()
    until(lambda: value(scrape(h), "holt_jobs_finished_total", kind="analysis", lane="user",
                        outcome="timeout") == 1)


def test_the_pool_and_the_queue_are_still_reported_while_the_pool_is_full(make_harness):
    """The scrape reads on a connection of its own, so the numbers that explain
    a full pool arrive while it is full."""
    h = make_harness(run_jobs=False, HOLT_DB_POOL_SIZE=2, HOLT_DB_POOL_TIMEOUT=5)
    add(h, Job(repo="octo/one", repo_key="octo/one", dedupe_key="a"))
    held, waiter = [], []

    async def take():
        pool = h.svc.db.engine.pool
        while pool.checkedout() < pool.size():
            s = h.svc.db.session()
            await s.execute(text("select 1"))
            held.append(s)

        async def wait_for_one():
            async with h.svc.db.session() as s:
                await s.execute(text("select 1"))

        waiter.append(asyncio.ensure_future(wait_for_one()))

    h.client.portal.call(take)
    until(lambda: h.svc.db.pool_meter.waiting == 1)
    m = scrape(h)
    assert value(m, "holt_db_pool_size") == 2
    assert value(m, "holt_db_pool_in_use") == 2
    assert value(m, "holt_db_pool_waiting") == 1
    assert value(m, "holt_metrics_db_ok") == 1
    assert value(m, "holt_jobs", status="queued", lane="user") == 1

    async def give_back():
        for s in held:
            await s.close()
        await waiter[0]

    h.client.portal.call(give_back)
    m = scrape(h)
    assert value(m, "holt_db_pool_waiting") == 0
    assert value(m, "holt_db_pool_in_use") == 0
    # Every checkout was timed: the two held, the one that waited, and `add`'s.
    assert value(m, "holt_db_pool_wait_seconds_count") >= 3
    assert value(m, "holt_db_pool_timeouts_total") == 0


def test_a_wait_for_a_connection_that_gives_up_is_counted(make_harness):
    h = make_harness(run_jobs=False, HOLT_DB_POOL_SIZE=1, HOLT_DB_POOL_TIMEOUT=0.2)

    async def starve():
        held = h.svc.db.session()
        await held.execute(text("select 1"))
        try:
            async with h.svc.db.session() as s:
                await s.execute(text("select 1"))
        except Exception as exc:  # noqa: BLE001
            return type(exc).__name__
        finally:
            await held.close()

    assert h.client.portal.call(starve) == "TimeoutError"
    m = scrape(h)
    assert value(m, "holt_db_pool_timeouts_total") == 1
    assert value(m, "holt_db_pool_waiting") == 0


def test_the_rest_is_served_when_the_database_cannot_be_read(make_harness, monkeypatch):
    h = make_harness(run_jobs=False)

    def down():
        raise OSError("database is down")

    monkeypatch.setattr(h.svc.db, "stats", down)
    m = scrape(h)
    assert value(m, "holt_metrics_db_ok") == 0
    assert value(m, "holt_jobs", status="queued", lane="user") is None
    assert value(m, "holt_db_pool_waiting") == 0


def test_github_points_are_what_github_last_said(make_harness):
    h = make_harness(run_jobs=False)
    m = scrape(h)
    assert value(m, "holt_github_points_left", token="1") is None  # unknown yet
    assert value(m, "holt_github_token_usable", token="1") == 1

    reset_at = now() + timedelta(minutes=30)
    reset = reset_at.isoformat()
    h.svc.pool.note_points(0, 4000, reset)
    h.svc.pool.note_points(0, 3988, reset)
    h.svc.pool.note_points(1, 100, reset)  # nearly used up: skipped
    m = scrape(h)
    assert value(m, "holt_github_points_left", token="1") == 3988
    assert value(m, "holt_github_points_reset_timestamp_seconds",
                 token="1") == reset_at.timestamp()
    assert value(m, "holt_github_points_used_total") == 12
    assert value(m, "holt_github_token_usable", token="1") == 1
    assert value(m, "holt_github_points_left", token="2") == 100
    assert value(m, "holt_github_token_usable", token="2") == 0

    # After the reset the count is out of date: unknown, and usable again.
    h.svc.pool.note_points(1, 100, (now() - timedelta(seconds=1)).isoformat())
    m = scrape(h)
    assert value(m, "holt_github_points_left", token="2") is None
    assert value(m, "holt_github_token_usable", token="2") == 1
    # A refill is not spend.
    h.svc.pool.note_points(0, 5000, (reset_at + timedelta(hours=1)).isoformat())
    assert value(scrape(h), "holt_github_points_used_total") == 12


def test_ai_spend_is_reported_against_the_budget(make_harness):
    h = make_harness(run_jobs=False, HOLT_AI_BUDGET_USD=5)
    at = now()
    add(h, AiRun(job_id="a", kind="merge_plan", reserved_micros=150_000, cost_micros=40_000,
                 started_at=at, settled_at=at),
        AiRun(job_id="b", kind="merge_plan", reserved_micros=150_000, cost_micros=60_000,
              started_at=at, settled_at=at),
        AiRun(job_id="c", kind="analysis", reserved_micros=100_000, started_at=at))

    async def commit():
        async with h.svc.db.session() as s:
            done = await s.execute(update(AiBudget).where(AiBudget.id == 1)
                                   .values(committed_micros=200_000))
            if done.rowcount == 0:
                s.add(AiBudget(id=1, committed_micros=200_000))
            await s.commit()

    h.client.portal.call(commit)
    m = scrape(h)
    assert value(m, "holt_ai_budget_usd") == 5
    assert value(m, "holt_ai_committed_usd") == 0.2
    assert value(m, "holt_ai_spent_usd", kind="merge_plan") == 0.1
    assert value(m, "holt_ai_spent_usd", kind="analysis") == 0


def test_emails_of_the_last_day_are_counted_by_outcome(make_harness):
    h = make_harness(run_jobs=False)
    at = now()
    add(h, AlertEmail(user_id="u", kind="now", status="sent", sent_at=at),
        AlertEmail(user_id="u", kind="daily", status="failed", sent_at=at),
        AlertEmail(user_id="u", kind="now", status="sent", sent_at=at - timedelta(hours=30)),
        AccountEmail(user_id="u", kind="welcome", key="welcome", status="sent", sent_at=at))
    m = scrape(h)
    assert value(m, "holt_emails_last_day", stream="alerts", status="sent") == 1
    assert value(m, "holt_emails_last_day", stream="alerts", status="failed") == 1
    assert value(m, "holt_emails_last_day", stream="account", status="sent") == 1
    assert value(m, "holt_emails_last_day", stream="account", status="failed") == 0
    assert value(m, "holt_email_daily_limit") == h.svc.settings.alert_email_daily_limit


def test_repos_are_counted_by_the_engine_of_their_newest_report(make_harness):
    h = make_harness(run_jobs=False)

    def report(repo, version):
        return Report(repo=repo, repo_key=repo, mode="rules", days=7,
                      report=canned_report(repo), engine_version=version)

    add(h, report("octo/one", ENGINE_VERSION - 1), report("octo/one", ENGINE_VERSION),
        report("octo/two", ENGINE_VERSION - 1), report("octo/three", ENGINE_VERSION - 2))
    m = scrape(h)
    assert value(m, "holt_repos_reported", engine="current") == 1
    assert value(m, "holt_repos_reported", engine="older") == 2


def test_a_warm_pass_shows_while_it_holds_its_lock(make_harness):
    h = make_harness(run_jobs=False)
    if not POSTGRES:
        # Only Postgres has the lock: elsewhere the number is left out.
        assert value(scrape(h), "holt_warm_pass_running") is None
        return
    assert value(scrape(h), "holt_warm_pass_running") == 0
    release = []

    async def hold():
        lock = h.svc.db.advisory_lock(warm.LOCK_ID)
        assert await lock.__aenter__()
        release.append(lock)

    h.client.portal.call(hold)
    try:
        assert value(scrape(h), "holt_warm_pass_running") == 1
    finally:
        h.client.portal.call(release[0].__aexit__, None, None, None)
    assert value(scrape(h), "holt_warm_pass_running") == 0
