"""A repo's details are read before its report is announced, so a repo
checked for the first time shows its README, links, language, stars and topics
on the report as it lands, without a reload or waiting for the warm pass. Best
effort: a failed read never fails the report, and a slow one doesn't hold it
past jobs.META_WAIT_S."""

from __future__ import annotations

import asyncio
from datetime import timedelta

from holt_server.db import RepoMeta, now
from holt_server.errors import ApiError
from holt_server.meta_refresh import MetaRefresher


def details(repo, **kw):
    return {"repo": repo, "description": "A thing", "language": "Python", "stars": 10,
            "topics": ["hacktoberfest"], "pushed_at": "2026-09-20T10:00:00Z",
            "archived": False, "fork": False, **kw}


def check(h, repo, **kw):
    h.svc.runner.meta.delay = 0.01
    r = h.post("/v1/analyses", {"repo": repo, **kw})
    assert r.status_code == 202, r.text
    done = h.wait(r.json()["job_id"])
    assert done["status"] == "done", done
    return done


def drain(h):
    h.client.portal.call(h.svc.runner.meta.drain)


def meta_row(h, key):
    async def go():
        async with h.svc.db.session() as s:
            return await s.get(RepoMeta, key)
    return h.client.portal.call(go)


def add(h, *items):
    async def go():
        async with h.svc.db.session() as s:
            s.add_all(items)
            await s.commit()
    h.client.portal.call(go)


def test_a_new_repo_gets_its_details_with_its_report(h):
    h.svc.lookup.details.known = {"octo/one": details("octo/one", stars=321)}
    done = check(h, "octo/one")
    # The report as announced already carries them: nothing waits for a reload.
    assert done["report"]["about"]["stars"] == 321
    drain(h)
    assert h.svc.lookup.details.calls == [["octo/one"]]
    row = meta_row(h, "octo/one")
    assert row is not None and row.stars == 321 and row.topics == ["hacktoberfest"]
    body = h.get("/v1/discover", params={"sort": "stars"}).json()
    assert body["repos"][0]["language"] == "Python"


def test_a_details_failure_does_not_fail_the_report(h):
    h.svc.lookup.details.error = ApiError("rate_limited", "slow down", retry_after=60)
    done = check(h, "octo/one")
    drain(h)  # doesn't raise
    assert done["report"]["verdict"] == "viable"
    assert h.svc.lookup.details.calls == [["octo/one"]]
    assert meta_row(h, "octo/one") is None
    assert h.get("/v1/reports/octo/one").status_code == 200

    # An unexpected crash is swallowed too, and the next report tries again.
    h.svc.lookup.details.error = RuntimeError("boom")
    check(h, "octo/one", refresh=True)
    drain(h)
    assert len(h.svc.lookup.details.calls) == 2


def test_a_slow_details_read_does_not_hold_the_report(h):
    async def never(repos):
        await asyncio.sleep(3600)

    h.svc.lookup.details = never
    h.svc.runner.meta_wait = 0.05
    done = check(h, "octo/one")  # h.wait would time out if the report waited on it
    assert done["report"]["about"] is None
    h.client.portal.call(h.svc.runner.meta.stop)


def test_details_are_not_read_again_within_a_day(h):
    h.svc.lookup.details.known = {"octo/one": details("octo/one"),
                                  "octo/two": details("octo/two")}
    add(h, RepoMeta(repo_key="octo/one", repo="octo/one", links=[], fetched_at=now() - timedelta(hours=2)),
        RepoMeta(repo_key="octo/two", repo="octo/two", links=[], fetched_at=now() - timedelta(hours=25)))
    check(h, "octo/one")
    check(h, "octo/two")
    drain(h)
    assert h.svc.lookup.details.calls == [["octo/two"]]  # only the day-old one
    assert meta_row(h, "octo/two").stars == 10


def test_reports_finishing_together_share_one_query(h):
    fake = h.svc.lookup.details
    fake.known = {r: details(r) for r in ("octo/one", "octo/two", "octo/three")}
    refresher = MetaRefresher(h.svc, delay=0.05)

    async def go():
        for repo in ("octo/one", "Octo/Two", "octo/three", "octo/one"):
            refresher.note(repo)
        await refresher.drain()

    h.client.portal.call(go)
    assert len(fake.calls) == 1
    assert sorted(fake.calls[0]) == ["Octo/Two", "octo/one", "octo/three"]
    assert refresher.queries == 1


def test_refresher_can_be_stopped_mid_read(h):
    async def never(repos):
        await asyncio.sleep(3600)

    h.svc.lookup.details = never
    refresher = MetaRefresher(h.svc, delay=0)

    async def go():
        refresher.note("octo/one")
        await asyncio.sleep(0.05)
        await refresher.stop()

    h.client.portal.call(go)


def test_the_daily_details_pass_says_how_many_points_it_used(h):
    from holt_server import warm
    from holt_server.db import Report
    from conftest import canned_report

    fake = h.svc.lookup.details

    async def costly(repos):
        h.svc.lookup.points_used += 1
        return await fake(repos)

    async def plenty():
        return 5000

    h.svc.lookup.details, h.svc.lookup.remaining = costly, plenty
    add(h, Report(repo="octo/one", repo_key="octo/one", mode="rules", days=7,
                  report=canned_report("octo/one")))
    result = h.client.portal.call(lambda: warm.warm_once(
        h.svc, seeds=[], reports=False, starter=False, finds=False))
    assert result.meta_points == 1
    assert "repo details 0 read (1 GitHub points)" in result.summary()
