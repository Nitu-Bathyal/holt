"""The jobs runner under load: time limits, lanes, queue position, token health.

No network: GitHub replies come from an `httpx.MockTransport`.
"""

from __future__ import annotations

import base64
import json
import logging
import threading
import time

import httpx
import pytest
from conftest import canned_report
from holt_server.db import Job, Report
from holt_server.errors import ApiError
from holt_server.github import LOW_POINTS, JobStopped, TokenPool, job_stop
from holt_server.jobs import waiting_stage
from sqlalchemy import select

from holt.evidence.errors import AuthError, RateLimited


def db_rows(h, model):
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(model))).scalars().all()
    return h.client.portal.call(q)


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        lines = [x for x in block.splitlines() if not x.startswith(":")]
        if lines:
            event = next(x[7:] for x in lines if x.startswith("event: "))
            events.append((event, json.loads(next(x[6:] for x in lines
                                                  if x.startswith("data: ")))))
    return events


# --- per-job time limits -----------------------------------------------------------


def test_a_job_past_its_time_limit_fails_plainly(make_harness):
    h = make_harness(HOLT_JOB_TIMEOUT_RULES=0.3)
    h.engine.gate.clear()  # the engine hangs mid-run
    job = h.post("/v1/analyses", {"repo": "pallets/flask"}).json()["job_id"]
    body = h.wait(job, timeout=10)
    assert body["status"] == "error"
    assert body["error"]["code"] == "upstream"
    assert "took too long" in body["error"]["message"]
    # The worker is free again at once, while the stuck thread is still stuck.
    h.engine.gate.set()
    assert h.wait(h.post("/v1/analyses", {"repo": "octo/one"}).json()["job_id"])["status"] \
        == "done"
    # The late result of the timed-out run is dropped, not stored.
    time.sleep(0.2)
    assert {j.id: j.status for j in db_rows(h, Job)}[job] == "error"
    assert [r.repo for r in db_rows(h, Report)] == ["octo/one"]


def test_a_stuck_timed_out_thread_does_not_block_the_next_job(make_harness):
    """One worker, no background lane: the timed-out run's thread is still
    blocked (no GitHub call to notice its stop flag), yet the next job runs,
    on the runner's own executor, not the loop's default one."""
    h = make_harness(HOLT_JOB_CONCURRENCY=1, HOLT_BADGE_CONCURRENCY=0,
                     HOLT_JOB_TIMEOUT_RULES=0.3)
    release = threading.Event()
    threads: dict[str, str] = {}

    def engine(*, repo, mode, days, provider, model, emit, as_of):
        threads[repo] = threading.current_thread().name
        if repo == "octo/one":
            release.wait(10)  # stuck, and never checks in
        return canned_report(repo, mode, days)

    h.svc.analysis_fn = engine
    assert h.svc.runner.executor_size == 2
    try:
        stuck = h.post("/v1/analyses", {"repo": "octo/one"}).json()["job_id"]
        assert h.wait(stuck, timeout=10)["status"] == "error"
        nxt = h.post("/v1/analyses", {"repo": "octo/two"}).json()["job_id"]
        assert h.wait(nxt, timeout=5)["status"] == "done"
        assert not release.is_set()  # the stuck thread was still stuck throughout
        assert all(name.startswith("holt-job-thread") for name in threads.values())
    finally:
        release.set()


def test_timed_out_ai_report_is_refunded(make_harness):
    h = make_harness(OPENROUTER_API_KEY="sk-or-server", HOLT_JOB_TIMEOUT_AI=0.3)
    h.engine.gate.clear()
    job = h.post("/v1/analyses", {"repo": "octo/one", "mode": "ai"}, user="u1").json()["job_id"]
    assert "took too long" in h.wait(job, timeout=10)["error"]["message"]
    h.engine.gate.set()
    assert h.get("/v1/me", user="u1").json()["credits"]["balance"] == 3


def test_time_limit_depends_on_the_kind_of_job(make_harness):
    h = make_harness(run_jobs=False, HOLT_JOB_TIMEOUT_RULES=1, HOLT_JOB_TIMEOUT_AI=2,
                     HOLT_JOB_TIMEOUT_FIND=3)
    runner = h.svc.runner
    assert runner.timeout_for(Job(kind="analysis", mode="rules")) == 1
    assert runner.timeout_for(Job(kind="analysis", mode="ai")) == 2
    assert runner.timeout_for(Job(kind="find", mode="rules")) == 3


def test_a_stopped_job_makes_no_more_github_calls():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"data": {"viewer": {"login": "x"}}})

    pool = TokenPool(["tok1"])
    transport = pool.transport(httpx.Client(transport=httpx.MockTransport(handler)))
    stop = threading.Event()
    token = job_stop.set(stop)
    try:
        transport.query("query { viewer { login } }")
        stop.set()
        with pytest.raises(JobStopped):
            transport.query("query { viewer { login } }")
    finally:
        job_stop.reset(token)
    assert len(calls) == 1


def test_a_stopped_job_reads_no_more_pull_request_pages():
    # Pages after the first are read on other threads; they see the stop too.
    calls = []

    def handler(request):
        calls.append(request)
        cursor = json.loads(request.content)["variables"]["cursor"]
        offset = int(base64.b64decode(cursor).decode().split(":")[1]) if cursor else 0
        end = base64.b64encode(f"cursor:{offset + 25}".encode()).decode()
        return httpx.Response(200, json={"data": {"search": {
            "issueCount": 200, "pageInfo": {"hasNextPage": True, "endCursor": end},
            "nodes": [{"number": offset + i} for i in range(25)]}}})

    pool = TokenPool(["tok1"])
    transport = pool.transport(httpx.Client(transport=httpx.MockTransport(handler)))
    stop = threading.Event()
    token = job_stop.set(stop)
    try:
        pages = transport.search_pull_requests("repo:a/b is:pr", 8)
        next(pages)
        stop.set()
        with pytest.raises(JobStopped):
            list(pages)
    finally:
        job_stop.reset(token)
    assert len(calls) == 1


# --- lanes and concurrency ---------------------------------------------------------


class CountingEngine:
    """Records how many runs overlap; each run holds until `release` is set."""

    def __init__(self) -> None:
        self.release = threading.Event()
        self.lock = threading.Lock()
        self.now = 0
        self.peak = 0

    def __call__(self, *, repo, mode, days, provider, model, emit, as_of):
        with self.lock:
            self.now += 1
            self.peak = max(self.peak, self.now)
        emit("Fetching pull requests", 0.1)
        self.release.wait(10)
        with self.lock:
            self.now -= 1
        return canned_report(repo, mode, days)


def test_ten_jobs_run_several_at_a_time(make_harness):
    """Smoke: ten different analyses at once, four user workers + one background."""
    h = make_harness(HOLT_JOB_CONCURRENCY=4, HOLT_BADGE_CONCURRENCY=1)
    engine = CountingEngine()
    h.svc.analysis_fn = engine

    async def canonical(repo: str) -> str:
        return repo

    h.svc.canonical = canonical
    try:
        jobs = [h.post("/v1/analyses", {"repo": f"octo/repo-{i}"}).json()["job_id"]
                for i in range(10)]
        # The background lane helps while people wait: five at once, no more.
        deadline = time.monotonic() + 10
        while engine.now < 5 and time.monotonic() < deadline:
            time.sleep(0.02)
        time.sleep(0.2)
        assert engine.peak == 5
    finally:
        engine.release.set()
    assert all(h.wait(j)["status"] == "done" for j in jobs)
    assert engine.peak == 5


def test_background_lane_yields_to_waiting_people(make_harness):
    h = make_harness(run_jobs=False, HOLT_BADGE_CONCURRENCY=1)
    h.client.get("/badge/octo/one.svg")
    people = [h.post("/v1/analyses", {"repo": r}).json()["job_id"]
              for r in ("octo/two", "octo/three")]
    runner = h.svc.runner
    claimed = [h.client.portal.call(runner._claim, "background").id for _ in range(2)]
    assert claimed == people
    assert h.client.portal.call(runner._claim, "background").priority == 10


# --- queue position --------------------------------------------------------------


def test_waiting_stage_is_plain_english():
    assert waiting_stage(1) == "In the queue: yours is next"
    assert waiting_stage(2) == "In the queue: 1 check ahead of yours"
    assert waiting_stage(5) == "In the queue: 4 checks ahead of yours"


def test_queue_positions_follow_priority_then_age(make_harness):
    h = make_harness(run_jobs=False)
    h.client.get("/badge/octo/one.svg")  # badge work: behind every person
    a = h.post("/v1/analyses", {"repo": "octo/two"}).json()["job_id"]
    b = h.post("/v1/analyses", {"repo": "octo/three"}).json()["job_id"]
    runner = h.svc.runner
    positions = h.client.portal.call(runner.queue_positions)
    assert positions[a] == 1 and positions[b] == 2 and len(positions) == 3
    h.client.portal.call(runner._claim, "user")
    assert h.client.portal.call(runner.queue_positions, [b]) == {b: 1}


def test_events_carry_the_queue_position(make_harness):
    h = make_harness(HOLT_JOB_CONCURRENCY=1, HOLT_BADGE_CONCURRENCY=0)
    h.engine.gate.clear()
    ids = [h.post("/v1/analyses", {"repo": r}).json()["job_id"]
           for r in ("octo/one", "octo/two", "octo/three")]
    # Let the first job start, and release the engine once the stream is open.
    deadline = time.monotonic() + 5
    while db_rows(h, Job)[0].status != "running" and time.monotonic() < deadline:
        time.sleep(0.02)
    threading.Timer(0.5, h.engine.gate.set).start()
    with h.client.stream("GET", f"/v1/analyses/{ids[2]}/events", headers=h.headers()) as r:
        events = parse_sse(r.read().decode())
    waiting = [d for e, d in events if e == "stage" and "queue_position" in d]
    assert [d["queue_position"] for d in waiting] == [2, 1]
    assert waiting[0]["stage"] == "In the queue: 1 check ahead of yours"
    assert waiting[1]["stage"] == "In the queue: yours is next"
    assert events[-1][0] == "done"


# --- the token pool ---------------------------------------------------------------


class Clock:
    def __init__(self) -> None:
        self.t = 1_000_000.0

    def __call__(self) -> float:
        return self.t


def test_pool_round_robins_healthy_tokens():
    pool = TokenPool(["a", "b", "c"])
    assert [pool.next() for _ in range(4)] == ["a", "b", "c", "a"]


def test_pool_skips_a_refused_token_then_retries_it_later(caplog):
    clock = Clock()
    pool = TokenPool(["secret-a", "secret-b"], clock=clock)
    with caplog.at_level(logging.WARNING, logger="holt_server.github"):
        pool.note_refused(0, "401 Unauthorized")
    assert [pool.next() for _ in range(3)] == ["secret-b"] * 3
    clock.t += 601
    assert "secret-a" in {pool.next() for _ in range(2)}
    assert "token #1" in caplog.text and "secret" not in caplog.text


def test_pool_skips_a_used_up_token_until_its_reset():
    clock = Clock()
    pool = TokenPool(["a", "b"], clock=clock)
    reset = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(clock.t + 900))
    pool.note_points(0, LOW_POINTS - 1, reset)
    assert {pool.next() for _ in range(3)} == {"b"}
    pool.note_points(1, 4000, reset)
    clock.t += 901
    assert {pool.next() for _ in range(2)} == {"a", "b"}


def test_pool_out_of_tokens_says_when_to_come_back():
    clock = Clock()
    pool = TokenPool(["a", "b"], clock=clock)
    pool.note_rate_limited(0, 120)
    pool.note_rate_limited(1, 600)
    with pytest.raises(ApiError) as err:
        pool.next()
    assert err.value.code == "rate_limited" and err.value.retry_after == 120

    refused = TokenPool(["a"], clock=clock)
    refused.note_refused(0, "401")
    with pytest.raises(ApiError) as err:
        refused.next()
    assert err.value.code == "upstream"


def test_transport_reports_token_health_to_the_pool(caplog):
    replies = {
        "bad": httpx.Response(401, json={"message": "Bad credentials"}),
        "low": httpx.Response(200, json={"data": {"rateLimit": {
            "remaining": 3, "resetAt": "2999-01-01T00:00:00Z"}}}),
        "limited": httpx.Response(200, json={"errors": [{"type": "RATE_LIMITED"}]}),
    }

    def handler(request):
        return replies[request.headers["Authorization"].split()[-1]]

    http = httpx.Client(transport=httpx.MockTransport(handler))
    pool = TokenPool(["bad", "low", "limited", "good"])
    with caplog.at_level(logging.WARNING, logger="holt_server.github"):
        with pytest.raises(AuthError):
            pool.transport(http, index=0).query("query { x }")
        pool.transport(http, index=1).query("query { rateLimit { remaining resetAt } }")
        with pytest.raises(RateLimited):
            pool.transport(http, index=2).query("query { x }")
    assert {pool.next() for _ in range(4)} == {"good"}
    for token in ("bad", "low", "limited"):
        assert f"Bearer {token}" not in caplog.text and f"bearer {token}" not in caplog.text
    assert "token #1" in caplog.text and "token #2" in caplog.text and "token #3" in caplog.text


def test_points_check_leaves_out_refused_tokens():
    from holt_server.github import GitHubLookup

    def handler(request):
        if request.headers["Authorization"].endswith("bad"):
            return httpx.Response(401, json={})
        return httpx.Response(200, json={"data": {"rateLimit": {
            "remaining": 4200, "resetAt": "2999-01-01T00:00:00Z"}}})

    pool = TokenPool(["bad", "good"])
    lookup = GitHubLookup(pool, httpx.Client(transport=httpx.MockTransport(handler)))
    assert lookup._remaining() == 4200
    assert pool.next() == "good"
