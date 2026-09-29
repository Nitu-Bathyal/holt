"""Reading report pages must never lock anyone out of starting an analysis.

Starter issues are cached per repository; cache hits touch neither GitHub nor
any rate limit, and misses draw on a separate, generous read bucket.
"""

from __future__ import annotations

import sys
import threading
import time
import types
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from holt.starter import RULES_VERSION
from holt_server.db import StarterCache, now
from sqlalchemy import update


@pytest.fixture
def starter_calls(monkeypatch):
    mod = types.ModuleType("holt.starter")
    calls = []
    lock = threading.Lock()

    def starter_issues(repo, token, limit, as_of=None):
        with lock:
            calls.append(repo)
        time.sleep(0.2)  # slow enough for concurrent misses to overlap
        return [{"number": i, "title": f"Issue {i}", "labels": [], "comments": 0,
                 "why": []} for i in range(1, 31)]

    mod.starter_issues = starter_issues
    mod.RULES_VERSION = RULES_VERSION
    monkeypatch.setitem(sys.modules, "holt.starter", mod)
    return calls


def test_fifty_page_views_leave_the_analysis_quota_intact(make_harness, starter_calls):
    h = make_harness(HOLT_ANON_RATE_PER_HOUR=2, HOLT_ANON_READ_RATE_PER_HOUR=5)
    job = h.post("/v1/analyses", {"repo": "octo/one"}, ip="7.7.7.7").json()["job_id"]
    h.wait(job)
    for _ in range(50):
        assert h.get("/v1/reports/octo/one", ip="7.7.7.7").status_code == 200
        r = h.get("/v1/repos/octo/one/starter-issues", ip="7.7.7.7")
        assert r.status_code == 200 and len(r.json()["issues"]) == 20
    assert starter_calls == ["octo/one"]  # one GitHub fetch for fifty views
    # The work bucket (2/h) still has its second analysis.
    assert h.post("/v1/analyses", {"repo": "octo/two"}, ip="7.7.7.7").status_code == 202


def test_cache_hits_skip_the_rate_limit_entirely(make_harness, starter_calls):
    h = make_harness(HOLT_ANON_READ_RATE_PER_HOUR=1)
    assert h.get("/v1/repos/octo/one/starter-issues").status_code == 200
    for _ in range(10):
        assert h.get("/v1/repos/octo/one/starter-issues").status_code == 200


def test_read_misses_use_their_own_bucket(make_harness, starter_calls):
    h = make_harness(HOLT_ANON_RATE_PER_HOUR=1, HOLT_ANON_READ_RATE_PER_HOUR=2)
    assert h.get("/v1/repos/octo/one/starter-issues").status_code == 200
    assert h.get("/v1/repos/octo/two/starter-issues").status_code == 200
    r = h.get("/v1/repos/octo/three/starter-issues")
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"
    # Exhausting reads did not touch work.
    assert h.post("/v1/analyses", {"repo": "octo/one"}).status_code == 202


def test_limit_is_a_slice_of_one_cached_ranking(h, starter_calls):
    assert len(h.get("/v1/repos/octo/one/starter-issues?limit=5").json()["issues"]) == 5
    assert len(h.get("/v1/repos/octo/one/starter-issues?limit=50").json()["issues"]) == 30
    assert len(starter_calls) == 1


def test_concurrent_misses_share_one_fetch(h, starter_calls):
    with ThreadPoolExecutor(6) as pool:
        codes = list(pool.map(
            lambda _: h.get("/v1/repos/octo/one/starter-issues").status_code, range(6)))
    assert codes == [200] * 6
    assert starter_calls == ["octo/one"]


def test_cache_expires_after_the_ttl(h, starter_calls):
    h.get("/v1/repos/octo/one/starter-issues")

    async def age():
        async with h.svc.db.session() as s:
            await s.execute(update(StarterCache).values(created_at=now() - timedelta(hours=2)))
            await s.commit()

    h.client.portal.call(age)
    h.get("/v1/repos/OCTO/One/starter-issues")
    assert starter_calls == ["octo/one", "octo/one"]


def test_a_row_cached_before_issues_said_who_is_on_them_is_fetched_again(h, starter_calls):
    async def old_row():
        async with h.svc.db.session() as s:
            s.add(StarterCache(repo_key="octo/one", repo="octo/one",
                               issues=[{"number": 1, "title": "Solved long ago"}]))
            await s.commit()

    h.client.portal.call(old_row)
    issues = h.get("/v1/repos/octo/one/starter-issues").json()["issues"]
    assert starter_calls == ["octo/one"] and issues[0]["title"] == "Issue 1"


@pytest.mark.parametrize("rules", [None, RULES_VERSION - 1])
def test_a_list_older_starter_rules_picked_is_fetched_again(h, starter_calls, rules):
    # holt-oss/holt: an empty list cached by the rules that dropped a
    # maintainer's batch outlived the fix by a whole TTL.
    async def old_row():
        async with h.svc.db.session() as s:
            s.add(StarterCache(repo_key="octo/one", repo="octo/one", issues=[]))
            await s.commit()
            # The release before the column writes NULL.
            await s.execute(update(StarterCache).values(rules_version=rules))
            await s.commit()

    h.client.portal.call(old_row)
    assert h.get("/v1/repos/octo/one/starter-issues").json()["issues"]
    h.get("/v1/repos/octo/one/starter-issues")
    assert starter_calls == ["octo/one"]  # the refetched row is stamped and served


def test_missing_repo_is_not_cached(h, starter_calls):
    r = h.get("/v1/repos/nobody/nothing/starter-issues")
    assert r.status_code == 404
    assert starter_calls == []
