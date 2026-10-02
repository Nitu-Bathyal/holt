"""The database connection pool: sized from the environment, never needed by
the health check or a background lock, and never held while a job waits on
GitHub or a board is served again."""

from __future__ import annotations

import os
import time

import pytest
from conftest import STATS, canned_report
from holt_server import discover
from holt_server.db import RepoMeta, Report, Usage, now
from sqlalchemy import event, text

POSTGRES = (os.environ.get("HOLT_TEST_DATABASE_URL") or "").startswith("postgresql")


def add(h, *items):
    async def go():
        async with h.svc.db.session() as s:
            s.add_all(items)
            await s.commit()
    h.client.portal.call(go)


def report(repo, verdict="viable", **stats):
    body = canned_report(repo, "rules", 7, verdict)
    body["stats"] = {**STATS, **stats}
    return Report(repo=repo, repo_key=repo.lower(), mode="rules", days=7, report=body)


def meta(repo, **kw):
    return RepoMeta(repo_key=repo.lower(), repo=repo, topics=[], readme="# Long\n" * 500, **kw)


def until(done, timeout=10.0):
    deadline = time.monotonic() + timeout
    while not done():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.02)


class Statements:
    """Every SQL statement the pool's connections run while it is open."""

    def __init__(self, h) -> None:
        self.engine = h.svc.db.engine.sync_engine
        self.seen: list[str] = []

    def _note(self, conn, cursor, statement, parameters, context, executemany) -> None:
        self.seen.append(statement)

    def __enter__(self) -> Statements:
        event.listen(self.engine, "before_cursor_execute", self._note)
        return self

    def __exit__(self, *exc) -> None:
        event.remove(self.engine, "before_cursor_execute", self._note)

    def reading(self, column: str) -> list[str]:
        return [s for s in self.seen if column in s]


class Held:
    """Every connection of the pool taken, as slow requests would hold them."""

    def __init__(self, h) -> None:
        self.h = h
        self.sessions: list = []

    def __enter__(self) -> Held:
        async def take():
            pool = self.h.svc.db.engine.pool
            while pool.checkedout() < pool.size():
                s = self.h.svc.db.session()
                await s.execute(text("select 1"))
                self.sessions.append(s)
        self.h.client.portal.call(take)
        return self

    def __exit__(self, *exc) -> None:
        async def give_back():
            for s in self.sessions:
                await s.close()
        self.h.client.portal.call(give_back)


def test_the_pool_is_sized_from_the_environment(make_harness):
    h = make_harness(run_jobs=False, HOLT_DB_POOL_SIZE=3, HOLT_DB_MAX_OVERFLOW=2,
                     HOLT_DB_POOL_TIMEOUT=4)
    pool = h.svc.db.engine.pool
    assert (pool.size(), pool._max_overflow, pool.timeout()) == (3, 2, 4)


def test_by_default_the_pool_opens_no_extra_connections_under_load(make_harness):
    # Opening one costs the event loop about 0.15 s (db.py), under the very
    # load it would be opened for.
    pool = make_harness(run_jobs=False).svc.db.engine.pool
    assert (pool.size(), pool._max_overflow, pool.timeout()) == (10, 0, 10)


def test_health_answers_while_every_pool_connection_is_busy(make_harness):
    h = make_harness(run_jobs=False, HOLT_DB_POOL_SIZE=2, HOLT_DB_POOL_TIMEOUT=0.2)
    assert h.client.get("/health").json()["ok"] is True
    with Held(h):
        assert h.svc.db.engine.pool.checkedout() == 2
        started = time.monotonic()
        r = h.client.get("/health")
        assert r.status_code == 200 and r.json()["ok"] is True
        assert time.monotonic() - started < 1.5
    assert h.svc.db.engine.pool.checkedout() == 0


def test_health_says_so_when_the_database_is_down(make_harness, monkeypatch):
    h = make_harness(run_jobs=False)

    class Refused:
        def connect(self):
            raise OSError("connection refused")

    monkeypatch.setattr(h.svc.db, "_health", Refused())
    r = h.client.get("/health")
    assert r.status_code == 503 and r.json() == {
        "ok": False, "version": r.json()["version"], "database": False}


def test_a_background_lock_takes_no_pool_connection(make_harness):
    h = make_harness(run_jobs=False, HOLT_DB_POOL_SIZE=1, HOLT_DB_POOL_TIMEOUT=0.2)

    async def go():
        async with h.svc.db.advisory_lock(424242) as got:
            # The one pool connection is still free for a request.
            async with h.svc.db.session() as s:
                await s.execute(text("select 1"))
            return got, h.svc.db.engine.pool.checkedout()

    assert h.client.portal.call(go) == (True, 0)


@pytest.mark.skipif(not POSTGRES, reason="advisory locks are Postgres's")
def test_a_lock_is_one_holder_at_a_time_and_let_go_after(make_harness):
    h = make_harness(run_jobs=False)

    async def go():
        async with h.svc.db.advisory_lock(424243) as first:
            async with h.svc.db.advisory_lock(424243) as second:
                pass
        async with h.svc.db.advisory_lock(424243) as after:
            pass
        return first, second, after

    assert h.client.portal.call(go) == (True, False, True)


def test_jobs_waiting_on_github_hold_no_connection(make_harness):
    # Three analyses sit in a slow GitHub read with a pool of two: nothing
    # may keep a connection for the length of a job.
    h = make_harness(HOLT_JOB_CONCURRENCY=3, HOLT_DB_POOL_SIZE=2, HOLT_DB_POOL_TIMEOUT=2)
    add(h, report("octo/four"), meta("octo/four", language="Python"))
    h.engine.gate.clear()
    try:
        jobs = [h.post("/v1/analyses", {"repo": r}).json()["job_id"]
                for r in ("octo/one", "octo/two", "octo/three")]
        until(lambda: len(h.engine.calls) == 3)
        until(lambda: h.svc.db.engine.pool.checkedout() == 0)
        for _ in range(5):
            assert h.get("/v1/discover").status_code == 200
            assert h.get("/v1/reports/octo/four").status_code == 200
            assert h.get(f"/v1/analyses/{jobs[0]}").json()["status"] == "running"
    finally:
        h.engine.gate.set()
    assert [h.wait(j)["status"] for j in jobs] == ["done"] * 3


def test_a_board_reads_each_reports_json_once(make_harness):
    # Postgres parsed every latest report's JSON five times for every Discover
    # request, with a pool connection held throughout: what ran production's
    # pool dry. Reports never change, so their fields are read once.
    h = make_harness(run_jobs=False)
    add(h, report("octo/one", outsider_merged=12), report("octo/two", outsider_merged=10),
        meta("octo/one", language="Python", stars=5), meta("octo/two", language="Go", stars=9))
    with Statements(h) as first:
        assert [r["repo"] for r in h.get("/v1/discover").json()["repos"]] == [
            "octo/one", "octo/two"]
    assert first.reading("reports.report")
    with Statements(h) as later:
        assert [r["repo"] for r in h.get("/v1/discover", params={"sort": "stars"}).json()["repos"]
                ] == ["octo/two", "octo/one"]
        assert [r["repo"] for r in h.get(
            "/v1/discover", params={"language": "python"}).json()["repos"]] == ["octo/one"]
        assert h.post("/v1/find", {"languages": ["go"]}).status_code in (200, 202, 501)
    assert later.reading("reports.report") == []
    assert later.reading("repo_meta.description") == []
    # The README and the report page's other long columns are never a card's.
    assert (first.reading("repo_meta.readme"), later.reading("repo_meta.readme")) == ([], [])


def test_a_board_shows_a_new_report_and_new_details_at_once(make_harness):
    h = make_harness(run_jobs=False)
    add(h, report("octo/one", outsider_merged=12), report("octo/two", outsider_merged=10),
        meta("octo/one", stars=5), meta("octo/two", stars=9))
    assert len(h.get("/v1/discover").json()["repos"]) == 2
    # A re-check of octo/two changes its verdict; a third repo is checked.
    add(h, report("octo/two", "not_viable", outsider_merged=0), report("octo/three"))
    with Statements(h) as seen:
        assert [r["repo"] for r in h.get("/v1/discover").json()["repos"]] == [
            "octo/one", "octo/three"]
    assert len(seen.reading("reports.report")) == 1  # the two new reports, in one read

    async def new_details():
        async with h.svc.db.session() as s:
            row = await s.get(RepoMeta, "octo/one")
            row.stars, row.fetched_at = 77, now()
            await s.commit()

    h.client.portal.call(new_details)
    card = h.get("/v1/discover").json()["repos"][0]
    assert (card["repo"], card["stars"]) == ("octo/one", 77)


def test_view_counts_are_counted_again_after_a_minute_not_on_every_request(make_harness):
    h = make_harness(run_jobs=False)
    day = now().strftime("%Y-%m-%d")

    def views(people, start=0):
        return [Usage(day=day, kind="analysis", who=f"p{i}", repo_key="octo/one")
                for i in range(start, start + people)]

    add(h, report("octo/one"), *views(discover.TRENDING_MIN))

    def trending():
        return [(r["repo"], r["checked_this_week"])
                for r in h.get("/v1/discover", params={"sort": "trending"}).json()["repos"]]

    assert trending() == [("octo/one", discover.TRENDING_MIN)]
    add(h, *views(3, start=discover.TRENDING_MIN))
    with Statements(h) as seen:
        assert trending() == [("octo/one", discover.TRENDING_MIN)]
    assert seen.reading("usage_events") == []
    discover._kept_for(h.svc).views = None  # a minute later
    assert trending() == [("octo/one", discover.TRENDING_MIN + 3)]
    # The count belongs to the board's copy of the card, not to the card
    # other pages share.
    cards = h.client.portal.call(lambda: discover.cards(h.svc, ["octo/one"]))
    assert cards["octo/one"].checked_this_week is None


def test_a_slower_request_cannot_drop_what_a_newer_one_read(make_harness):
    # One request reads what is current and is slow to go on; a report is
    # stored; a second request must not read past the first, or the first
    # would let go of the new report's fields as "replaced" and the second
    # would keep a board without that repo.
    h = make_harness(run_jobs=False)
    add(h, report("octo/one"), meta("octo/one"))
    real = h.svc.db.session

    async def go():
        import asyncio

        assert [r[0] for r in await discover._latest(h.svc)] == ["octo/one"]
        async with real() as s:  # moves the mark, not the board
            s.add(Report(repo="octo/one", repo_key="octo/one", mode="ai", days=7,
                         report=canned_report("octo/one", "ai")))
            await s.commit()
        reads, paused, go_on = 0, asyncio.Event(), asyncio.Event()

        class SlowAfterSecondRead:
            def __init__(self) -> None:
                self.inner = real()

            async def __aenter__(self):
                return await self.inner.__aenter__()

            async def __aexit__(self, *exc):
                nonlocal reads
                out = await self.inner.__aexit__(*exc)
                reads += 1
                if reads == 2 and asyncio.current_task().get_name() == "slow":
                    paused.set()
                    await go_on.wait()
                return out

        h.svc.db.session = SlowAfterSecondRead
        slow = asyncio.create_task(discover._latest(h.svc), name="slow")
        await paused.wait()  # it has read the mark, then what is current
        async with real() as s:
            s.add_all([report("octo/two"), meta("octo/two")])
            await s.commit()
        newer = asyncio.create_task(discover._latest(h.svc), name="newer")
        await asyncio.sleep(0.2)
        waited = not newer.done()
        go_on.set()
        return (waited, sorted(r[0] for r in await slow),
                sorted((r[0], r[-1] is not None) for r in await newer),
                sorted(r[0] for r in await discover._latest(h.svc)))

    try:
        assert h.client.portal.call(go) == (
            True, ["octo/one"], [("octo/one", True), ("octo/two", True)],
            ["octo/one", "octo/two"])
    finally:
        h.svc.db.session = real


def test_the_board_is_read_again_after_a_minute_whatever_the_mark_says(make_harness):
    # Details committed with an older `fetched_at` than another writer's leave
    # the mark where it was; they must not stay unseen for long.
    h = make_harness(run_jobs=False)
    add(h, report("octo/one"), meta("octo/one", stars=1), meta("octo/other"))

    async def older_stamp():
        async with h.svc.db.session() as s:
            row = await s.get(RepoMeta, "octo/one")
            newest = (await s.get(RepoMeta, "octo/other")).fetched_at
            row.stars, row.fetched_at = 50, newest.replace(microsecond=0)
            await s.commit()

    def stars():
        return h.get("/v1/discover", params={"sort": "stars"}).json()["repos"][0]["stars"]

    assert stars() == 1
    h.client.portal.call(older_stamp)
    kept = discover._kept_for(h.svc)
    mark, _, rows = kept.board
    kept.board = (mark, 0.0, rows)  # a minute later
    assert stars() == 50
