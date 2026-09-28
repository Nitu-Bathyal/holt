"""Reports (and finds) made by an older engine are never served as an answer.

Every lookup path: the report page's read, POST /v1/analyses, the badge,
find screening and the find cache, Discover, recommendations, My
Contributions, and the warm pass (`--stale-only`)."""

from __future__ import annotations

from datetime import timedelta

import pytest
from conftest import STATS, canned_report
from holt_server import api, discover, jobs, recommendations, warm
from holt_server.contributions import verdicts
from holt_server.db import (
    ENGINE_VERSION,
    FindCache,
    Job,
    RepoMeta,
    Report,
    find_key,
    now,
)
from sqlalchemy import select, update

OLD = ENGINE_VERSION - 1


@pytest.fixture(autouse=True)
def quick_polling(monkeypatch):
    monkeypatch.setattr(warm, "POLL_S", 0.02)


def add(h, *items):
    async def go():
        async with h.svc.db.session() as s:
            s.add_all(items)
            await s.commit()
            # A report from before the column: NULL, which the model's default
            # would otherwise fill in on insert.
            unrecorded = [i.id for i in items if getattr(i, "unrecorded", False)]
            if unrecorded:
                await s.execute(update(Report).where(Report.id.in_(unrecorded))
                                .values(engine_version=None))
                await s.commit()
    h.client.portal.call(go)


def report(repo, version=OLD, days=7, mode="rules", verdict="viable", hours=1, **body):
    data = {**canned_report(repo, mode, days, verdict), **body}
    row = Report(repo=repo, repo_key=repo.lower(), mode=mode, days=days, report=data,
                 created_at=now() - timedelta(hours=hours), engine_version=version)
    row.unrecorded = version is None
    return row


def all_rows(h, model):
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(model))).scalars().all()
    return h.client.portal.call(q)


# --- stamping -------------------------------------------------------------------------


def test_a_finished_analysis_is_stamped_with_the_engine_version(h):
    h.wait(h.post("/v1/analyses", {"repo": "octo/one"}).json()["job_id"])
    [stored] = all_rows(h, Report)
    assert stored.engine_version == ENGINE_VERSION and not stored.outdated


@pytest.mark.parametrize("version", [None, OLD])
def test_older_and_unrecorded_versions_are_outdated(version):
    assert report("octo/one", version).outdated
    assert not report("octo/one", ENGINE_VERSION).outdated


# --- the report page and POST /v1/analyses ------------------------------------------------


@pytest.mark.parametrize("version", [None, OLD])
def test_a_young_outdated_report_is_run_again(h, version):
    add(h, report("octo/one", version, verdict="not_viable"))
    r = h.post("/v1/analyses", {"repo": "octo/one"})
    assert r.status_code == 202  # not the cached old verdict
    done = h.wait(r.json()["job_id"])
    assert done["report"]["verdict"] == "viable"
    # Now the fresh one is the cache.
    again = h.post("/v1/analyses", {"repo": "octo/one"})
    assert again.status_code == 200 and again.json()["report"]["verdict"] == "viable"


def test_the_read_says_outdated_and_still_returns_the_old_report(h):
    add(h, report("octo/one", OLD, verdict="not_viable"))
    body = h.get("/v1/reports/octo/one").json()
    assert body["outdated"] is True and body["verdict"] == "not_viable"
    h.wait(h.post("/v1/analyses", {"repo": "octo/one"}).json()["job_id"])
    body = h.get("/v1/reports/octo/one").json()
    assert body["outdated"] is False and body["verdict"] == "viable"


def test_an_outdated_report_for_another_budget_is_not_retimed(h):
    # A current one for another budget answers; an outdated one does not.
    add(h, report("octo/one", OLD, days=14, budget_independent=True),
        report("octo/two", ENGINE_VERSION, days=14, budget_independent=True))
    assert h.get("/v1/reports/octo/one").status_code == 404
    assert h.post("/v1/analyses", {"repo": "octo/one"}).status_code == 202
    r = h.post("/v1/analyses", {"repo": "octo/two"})
    assert r.status_code == 200 and r.json()["report"]["days"] == 7


# --- the badge ----------------------------------------------------------------------------


def test_badge_says_updating_not_the_old_verdict_and_queues_a_refresh(h):
    add(h, report("octo/one", OLD, verdict="viable"))
    r = h.client.get("/badge/octo/one.svg")
    assert "Holt: updating" in r.text and "merges" not in r.text
    assert r.headers["cache-control"] == api.BADGE_UPDATING_CACHE
    [job] = all_rows(h, Job)
    h.wait(job.id)
    r = h.client.get("/badge/octo/one.svg")
    assert "merges outsiders" in r.text
    assert r.headers["cache-control"] == api.BADGE_CACHE


# --- find: screening and the cache ------------------------------------------------------


def test_find_screening_skips_outdated_reports(h):
    add(h, report("octo/one", OLD))
    got = h.client.portal.call(lambda: jobs.fresh_rules_report(h.svc, "octo/one", 7))
    assert got is None
    add(h, report("octo/one", ENGINE_VERSION, hours=0))
    got = h.client.portal.call(lambda: jobs.fresh_rules_report(h.svc, "octo/one", 7))
    assert got is not None


def test_an_outdated_find_is_not_served(h):
    key = find_key(["python"], [], False, 7)
    results = [{"repo": "octo/one", "verdict": "viable", "stats": {}, "issues": []}]
    add(h, FindCache(key=key, params={"limit": 20, "days": 7}, results=results))
    assert h.client.portal.call(lambda: api.cached_find(h.svc, key, 20)) is None

    async def restamp():
        async with h.svc.db.session() as s:
            row = await s.get(FindCache, key)
            row.params = {"limit": 20, "days": 7, "engine_version": ENGINE_VERSION}
            await s.commit()
    h.client.portal.call(restamp)
    assert h.client.portal.call(lambda: api.cached_find(h.svc, key, 20)) == results


def test_a_stored_find_is_stamped(h):
    async def store():
        async with h.svc.db.session() as s:
            await jobs.store_find(s, {"languages": ["go"]}, 7, {"results": []})
            await s.commit()
    h.client.portal.call(store)
    [row] = all_rows(h, FindCache)
    assert row.params["engine_version"] == ENGINE_VERSION and not row.outdated


# --- Discover, recommendations, My Contributions -----------------------------------------


def test_discover_leaves_out_outdated_reports(h):
    add(h, report("octo/old", OLD, hours=0), report("octo/new", ENGINE_VERSION))
    body = h.get("/v1/discover").json()
    assert [r["repo"] for r in body["repos"]] == ["octo/new"]


def test_discover_falls_back_to_an_older_current_report(h):
    # The newest row is outdated; the newest one from this engine is shown.
    add(h, report("octo/one", ENGINE_VERSION, hours=5, verdict="not_viable"),
        report("octo/one", OLD, hours=1, verdict="viable"))
    rows = h.client.portal.call(lambda: discover._latest(h.svc))
    assert [(r[0], r[3]) for r in rows] == [("octo/one", "not_viable")]


def test_recommendations_skip_outdated_reports_and_finds(h):
    body = {"stats": {**STATS, "outsider_merged": 10, "no_reply": 1}}
    add(h, report("octo/old", OLD, **body), report("octo/new", ENGINE_VERSION, **body),
        RepoMeta(repo_key="octo/new", repo="octo/new", stars=10, topics=[]),
        FindCache(key="k-old", params={"days": 7}, results=[
            {"repo": "octo/found-old", "verdict": "viable", "stats": STATS}]),
        FindCache(key="k-new", params={"days": 7, "engine_version": ENGINE_VERSION},
                  results=[{"repo": "octo/found-new", "verdict": "viable", "stats": STATS}]))
    got = h.client.portal.call(lambda: recommendations.candidates(h.svc))
    assert "octo/new" in got and "octo/found-new" in got
    assert "octo/old" not in got and "octo/found-old" not in got


def test_my_contributions_show_no_outdated_verdict(h):
    add(h, report("octo/old", OLD), report("octo/new", ENGINE_VERSION))

    async def q():
        async with h.svc.db.session() as s:
            return await verdicts(s, {"octo/old", "octo/new"})
    assert set(h.client.portal.call(q)) == {"octo/new"}


# --- the warm pass -------------------------------------------------------------------------


def run_warm(h, seeds, **kw):
    async def budget():
        return 5000
    h.svc.lookup.remaining = budget
    return h.client.portal.call(lambda: warm.warm_once(
        h.svc, seeds=seeds, starter=False, meta=False, finds=False, **kw))


def test_the_normal_pass_redoes_young_outdated_reports(h):
    add(h, report("octo/one", OLD, hours=0), report("octo/two", ENGINE_VERSION, hours=0))
    result = run_warm(h, ["octo/one", "octo/two"])
    assert (result.reports_run, result.reports_fresh) == (1, 1)


def test_stale_only_redoes_only_outdated_seeds(h):
    add(h,
        report("octo/one", OLD, hours=0),                # outdated, young: redone
        report("octo/two", ENGINE_VERSION, hours=200),   # current but old: left alone
        report("pallets/flask", None, hours=0))          # before versions: redone
    # octo/three has no report at all: left alone too.
    result = run_warm(h, ["octo/one", "octo/two", "pallets/flask", "octo/three"],
                      stale_only=True)
    assert (result.reports_run, result.reports_fresh, result.reports_failed) == (2, 2, 0)
    ran = sorted(j.repo_key for j in all_rows(h, Job))
    assert ran == ["octo/one", "pallets/flask"]
    again = run_warm(h, ["octo/one", "octo/two", "pallets/flask"], stale_only=True)
    assert again.reports_run == 0


def test_stale_only_skips_the_other_passes(h):
    add(h, report("octo/one", OLD))
    result = h.client.portal.call(lambda: warm.Warmer(h.svc, dry_run=True).run(
        ["octo/one"], stale_only=True))
    assert result.reports_run == 1 and result.finds_run == 0 and result.meta_run == 0


def test_stale_only_flag_reaches_the_pass(monkeypatch, tmp_path):
    seen = {}

    async def fake_warm_once(svc, **kw):
        seen.update(kw)
        return warm.Result()

    class FakeServices:
        def __init__(self, settings):
            self.settings = settings
            self.db = type("DB", (), {"migrate": _noop, "dispose": _noop})()
            self.http = type("HTTP", (), {"close": lambda self: None})()

    monkeypatch.setattr(warm, "warm_once", fake_warm_once)
    monkeypatch.setattr("holt_server.services.Services", FakeServices)
    seeds = tmp_path / "seeds.txt"
    seeds.write_text("octo/one\n", encoding="utf-8")
    assert warm.main(["--dry-run", "--stale-only", "--seeds", str(seeds)]) == 0
    assert seen["stale_only"] is True and seen["dry_run"] is True


async def _noop(*_a, **_k):
    return None

