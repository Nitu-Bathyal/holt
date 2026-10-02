"""Answers kept for readers (cache.py): hit, miss and expiry, what a write
invalidates, and that nothing per person is ever kept."""

from __future__ import annotations

import asyncio

import pytest
from conftest import STATS, canned_report
from holt.starter import RULES_VERSION
from holt_server import api, cache, discover, find as find_mod
from holt_server.db import RepoMeta, Report, RepoUserStats, StarterCache, Usage, now
from sqlalchemy import delete, event, select


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


# --- the store ------------------------------------------------------------------


def test_a_kept_answer_is_served_until_it_expires():
    clock = Clock()
    kept = cache.Kept(ttl_s=60, max_entries=10, clock=clock)
    assert kept.get("a") is None
    kept.put("a", "one")
    clock.t = 59.9
    assert kept.get("a") == "one"
    clock.t = 60
    assert kept.get("a") is None and len(kept) == 0


def test_a_kept_answer_is_served_only_for_its_stamp():
    kept = cache.Kept(ttl_s=60, max_entries=10)
    kept.put("a", "one", stamp=(1,))
    assert kept.get("a", (1,)) == "one"
    assert kept.get("a", (2,)) is None
    assert kept.get("a", (1,)) is None, "an answer from before the write is gone for good"


def test_the_least_recently_used_goes_first():
    kept = cache.Kept(ttl_s=60, max_entries=2)
    kept.put("a", 1)
    kept.put("b", 2)
    assert kept.get("a") == 1  # read: "b" is now the oldest
    kept.put("c", 3)
    assert (kept.get("a"), kept.get("b"), kept.get("c")) == (1, None, 3)


def test_the_store_is_bounded_by_weight_too():
    kept = cache.Kept(ttl_s=60, max_entries=10, max_weight=100)
    kept.put("a", "x", weight=60)
    kept.put("b", "y", weight=60)
    assert kept.get("a") is None and kept.get("b") == "y" and kept.weight == 60
    kept.put("huge", "z", weight=101)
    assert kept.get("huge") is None and kept.get("b") == "y"
    kept.put("b", "y2", weight=10)
    assert kept.weight == 10


def test_load_builds_once_for_readers_who_ask_together():
    async def go():
        kept = cache.Kept(ttl_s=60, max_entries=10)
        built = []
        gate = asyncio.Event()

        async def build():
            built.append(1)
            await gate.wait()
            return "answer"

        readers = [asyncio.ensure_future(kept.load("k", 1, build)) for _ in range(5)]
        await asyncio.sleep(0)
        gate.set()
        assert await asyncio.gather(*readers) == ["answer"] * 5
        assert await kept.load("k", 1, build) == "answer"
        return built, kept.hits, kept.misses

    assert asyncio.run(go()) == ([1], 5, 1)


def test_a_build_that_fails_keeps_nothing():
    async def go():
        kept = cache.Kept(ttl_s=60, max_entries=10)

        async def broken():
            raise ValueError("no")

        async def fine():
            return "answer"

        with pytest.raises(ValueError):
            await kept.load("k", 1, broken)
        assert len(kept) == 0
        return await kept.load("k", 1, fine)

    assert asyncio.run(go()) == "answer"


# --- what a write invalidates -----------------------------------------------------


def add(h, *items):
    async def go():
        async with h.svc.db.session() as s:
            s.add_all(items)
            await s.commit()
    h.client.portal.call(go)


def report(repo, verdict="viable", days=7, **stats):
    body = canned_report(repo, "rules", days, verdict)
    body["stats"] = {**STATS, **stats}
    return Report(repo=repo, repo_key=repo.lower(), mode="rules", days=days, report=body)


def meta(repo, language="Python", **kw):
    return RepoMeta(repo_key=repo.lower(), repo=repo, language=language, languages=[language],
                    stars=kw.pop("stars", 10), topics=list(kw.pop("topics", ())), **kw)


def issues(repo, *numbers):
    return StarterCache(repo_key=repo.lower(), repo=repo, rules_version=RULES_VERSION, issues=[
        {"number": n, "title": "Fix a thing", "url": f"https://github.com/{repo}/issues/{n}",
         "labels": ["good first issue"], "created_at": None, "comments": 0, "why": [],
         "people": 0, "open_prs": 0} for n in numbers])


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


def test_committed_writes_are_counted_per_table_and_repo(h):
    writes = cache.writes(h.svc)
    before = writes.table("reports"), writes.repo("octo/one", "reports")
    add(h, report("octo/one"))
    assert writes.table("reports") != before[0]
    assert writes.repo("octo/one", "reports") != before[1]
    assert writes.repo("octo/two", "reports") == (0, 0), "another repo's rows weren't written"

    async def rolled_back():
        async with h.svc.db.session() as s:
            s.add(report("octo/two"))
            await s.flush()
            await s.rollback()
    h.client.portal.call(rolled_back)
    assert writes.repo("octo/two", "reports") == (0, 0), "nothing was committed"

    async def delete_all():
        async with h.svc.db.session() as s:
            await s.execute(delete(Report))
            await s.commit()
    h.client.portal.call(delete_all)
    assert writes.repo("octo/two", "reports") == (0, 1), "a DELETE may have hit any repo"


def test_discover_builds_an_answer_once_and_reads_nothing_for_the_next_reader(h):
    add(h, report("octo/one"), meta("octo/one"))
    first = h.get("/v1/discover")
    with Statements(h) as seen:
        second = h.get("/v1/discover")
    assert second.content == first.content and seen.seen == []
    assert second.headers["etag"] == first.headers["etag"]
    kept = discover.answers(h.svc)
    assert (kept.hits, kept.misses) == (1, 1)
    # Another question is another answer.
    assert h.get("/v1/discover", params={"sort": "stars"}).json()["sort"] == "stars"
    assert kept.misses == 2


def test_discover_shows_a_new_report_details_and_issues_at_once(h):
    add(h, report("octo/one"), meta("octo/one"))
    assert [r["repo"] for r in h.get("/v1/discover").json()["repos"]] == ["octo/one"]
    add(h, report("octo/two", outsider_merged=12), meta("octo/two", "Go"))
    body = h.get("/v1/discover").json()
    assert [r["repo"] for r in body["repos"]] == ["octo/two", "octo/one"]
    assert body["repos"][0]["issues"] == []
    add(h, issues("octo/two", 4))
    assert [i["number"] for i in h.get("/v1/discover").json()["repos"][0]["issues"]] == [4]


def test_a_discover_answer_expires(h):
    add(h, report("octo/one"), meta("octo/one"))
    kept = discover.answers(h.svc)
    kept.clock = clock = Clock()
    h.get("/v1/discover")
    clock.t = discover.ANSWER_KEPT_S - 1
    h.get("/v1/discover")
    assert (kept.hits, kept.misses) == (1, 1)
    clock.t = discover.ANSWER_KEPT_S
    h.get("/v1/discover")
    assert (kept.hits, kept.misses) == (1, 2)


def test_a_kept_answer_answers_if_none_match_with_304(h):
    add(h, report("octo/one"), meta("octo/one"))
    etag = h.get("/v1/discover").headers["etag"]
    same = h.client.get("/v1/discover", headers={**h.headers(), "If-None-Match": etag})
    assert same.status_code == 304 and same.content == b"" and same.headers["etag"] == etag
    other = h.client.get("/v1/discover", headers={**h.headers(), "If-None-Match": '"old"'})
    assert other.status_code == 200 and other.json()["repos"]
    assert h.client.get("/v1/reports/octo/one", headers={
        **h.headers(), "If-None-Match": h.get("/v1/reports/octo/one").headers["etag"],
    }).status_code == 304


def test_a_report_is_kept_and_reads_nothing_for_the_next_reader(h):
    add(h, report("octo/one"))
    first = h.get("/v1/reports/octo/one")
    assert first.status_code == 200
    with Statements(h) as seen:
        second = h.get("/v1/reports/OCTO/One")  # one repo, however it is spelled
    assert second.content == first.content and seen.seen == []
    kept = api.kept_reports(h.svc)
    assert (kept.hits, kept.misses) == (1, 1)


def test_a_report_rewritten_is_served_at_once(h):
    add(h, report("octo/one", "viable"))
    assert h.get("/v1/reports/octo/one").json()["verdict"] == "viable"
    assert h.get("/v1/reports/octo/one").json()["about"] is None
    add(h, report("octo/one", "long_shot"))
    assert h.get("/v1/reports/octo/one").json()["verdict"] == "long_shot"
    # Its details, read just after the report is stored, show too.
    add(h, meta("octo/one", description="A thing", links=[], fetched_at=now()))
    assert h.get("/v1/reports/octo/one").json()["about"]["description"] == "A thing"


def test_holt_users_numbers_leave_a_kept_report_when_they_are_taken_away(h):
    add(h, report("octo/one"),
        RepoUserStats(repo_key="octo/one", people=6, pull_requests=9, merged=4, closed=2,
                      waiting=3, computed_at=now()))
    assert h.get("/v1/reports/octo/one").json()["holt_users"]["people"] == 6

    async def opt_out():
        async with h.svc.db.session() as s:
            await s.execute(delete(RepoUserStats).where(RepoUserStats.repo_key == "octo/one"))
            await s.commit()
    h.client.portal.call(opt_out)
    assert h.get("/v1/reports/octo/one").json()["holt_users"] is None


def test_a_missing_report_is_never_kept(h):
    assert h.get("/v1/reports/octo/one").status_code == 404
    assert len(api.kept_reports(h.svc)) == 0
    add(h, report("octo/one"))
    assert h.get("/v1/reports/octo/one").status_code == 200


def test_a_kept_report_expires(h):
    add(h, report("octo/one"))
    kept = api.kept_reports(h.svc)
    kept.clock = clock = Clock()
    h.get("/v1/reports/octo/one")
    clock.t = api.REPORT_KEPT_S
    h.get("/v1/reports/octo/one")
    assert (kept.hits, kept.misses) == (0, 2)


def test_each_budget_is_kept_apart(h):
    add(h, report("octo/one", days=7), report("octo/one", days=30))
    assert h.get("/v1/reports/octo/one", params={"days": 7}).json()["days"] == 7
    assert h.get("/v1/reports/octo/one", params={"days": 30}).json()["days"] == 30
    assert len(api.kept_reports(h.svc)) == 2


# --- nothing per person ------------------------------------------------------------


def test_ai_reports_are_not_kept(h):
    body = canned_report("octo/one", "ai", 7)
    add(h, Report(repo="octo/one", repo_key="octo/one", mode="ai", days=7, report=body))
    for _ in range(2):
        assert h.get("/v1/reports/octo/one", params={"mode": "ai"}).json()["mode"] == "ai"
    assert len(api.kept_reports(h.svc)) == 0


def test_only_answers_that_are_the_same_for_everyone_are_kept(h):
    """Signed-in reads and anything that counts against a person go to the
    database every time: the stores hold Discover, free reports and Find's
    index, keyed by the question alone."""
    add(h, report("octo/one"), meta("octo/one"), issues("octo/one", 1))
    for user in ("u1", "u2"):
        assert h.get("/v1/me", user=user).status_code == 200
        assert h.get("/v1/me/history", user=user).status_code == 200
        assert h.get("/v1/me/entitlements", user=user).status_code == 200
        assert h.get("/v1/discover", user=user).status_code == 200
        assert h.get("/v1/reports/octo/one", user=user).status_code == 200
    stores = cache._stores[h.svc]
    assert set(stores) == {"discover", "reports"}
    for name, kept in stores.items():
        for key in kept._entries:
            assert "u1" not in map(str, key) and "u2" not in map(str, key), name
    with Statements(h) as seen:
        assert h.get("/v1/me", user="u1").status_code == 200
    assert seen.seen, "an account read is never answered from a store"


def test_finds_index_is_kept_but_each_caller_is_still_counted(h, monkeypatch):
    add(h, report("octo/one"), meta("octo/one", topics=["hacktoberfest"]), issues("octo/one", 1))
    h.client.portal.call(lambda: find_mod.index_results(h.svc, {"languages": ["python"]}))
    again = h.client.portal.call(lambda: find_mod.index_results(h.svc, {"languages": ["python"]}))
    kept = find_mod.indexes(h.svc)
    assert [r["repo"] for r in again] == ["octo/one"] and (kept.hits, kept.misses) == (1, 1)
    # Other filters are another answer, and new starter issues a new one.
    assert h.client.portal.call(lambda: find_mod.index_results(h.svc, {"languages": ["go"]})) == []
    add(h, report("octo/two", outsider_merged=12), meta("octo/two"), issues("octo/two", 2))
    fresh = h.client.portal.call(lambda: find_mod.index_results(h.svc, {"languages": ["python"]}))
    assert [r["repo"] for r in fresh] == ["octo/two", "octo/one"]

    # The endpoint: who asked is recorded for each caller, whatever is kept.
    monkeypatch.setattr(api.starter, "function", lambda name: None)
    for user in ("u1", "u2"):
        h.post("/v1/find", json={"languages": ["python"]}, user=user)

    async def finds():
        async with h.svc.db.session() as s:
            return (await s.execute(select(Usage.who).where(Usage.kind == "find"))).scalars().all()
    assert len(set(h.client.portal.call(finds))) == 2
