"""Refresh tiers: repos people saved or viewed lately are refreshed weekly,
the rest of the seed list monthly (warm.py --tier)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from holt_server import warm
from holt_server.db import RepoView, SavedRepo


@pytest.fixture
def th(h, monkeypatch):
    monkeypatch.setattr(warm, "POLL_S", 0.02)

    async def remaining():
        return 5000
    h.svc.lookup.remaining = remaining
    return h


def add(h, *rows):
    async def go():
        async with h.svc.db.session() as s:
            s.add_all(rows)
            await s.commit()
    h.client.portal.call(go)


def viewed(repo, days_ago, user="u1"):
    at = datetime.now(UTC) - timedelta(days=days_ago)
    return RepoView(user_id=user, repo_key=repo.lower(), repo=repo, first_viewed_at=at,
                    last_viewed_at=at, views=1)


def saved(repo, user="u1"):
    return SavedRepo(user_id=user, repo_key=repo.lower(), repo=repo)


SEEDS = ["octo/one", "octo/two", "octo/three", "pallets/flask"]


def tiers(h, seeds=SEEDS):
    return {t: h.client.portal.call(lambda t=t: warm.tier_repos(h.svc, t, seeds))
            for t in warm.TIERS}


def test_saved_or_recently_viewed_repos_are_weekly_the_rest_monthly(th):
    add(th, saved("octo/One"), saved("octo/four"),                 # octo/four: not a seed
        viewed("octo/two", days_ago=10), viewed("octo/two", 40, user="u2"),
        viewed("octo/three", days_ago=40))                          # too long ago
    got = tiers(th)
    assert sorted(got["weekly"]) == ["octo/One", "octo/four", "octo/two"]
    assert sorted(got["monthly"]) == ["octo/three", "pallets/flask"]


def test_nobody_saved_or_viewed_anything(th):
    assert tiers(th) == {"weekly": [], "monthly": SEEDS}


def test_a_tier_pass_runs_only_that_tiers_reports(th):
    add(th, saved("octo/one"))
    result = th.client.portal.call(lambda: warm.warm_once(th.svc, seeds=SEEDS, tier="weekly"))
    assert [c["repo"] for c in th.engine.calls] == ["octo/one"]
    assert (result.reports_run, result.starter_run, result.finds_run, result.meta_run) == (
        1, 0, 0, 0)


def test_a_tier_pass_takes_the_oldest_report_first(th):
    # Never reported first (in seed order), then the oldest report: when the
    # GitHub budget runs out, what's left is what was refreshed most recently.
    th.wait(th.post("/v1/analyses", {"repo": "octo/three"}).json()["job_id"])
    th.wait(th.post("/v1/analyses", {"repo": "octo/one"}).json()["job_id"])
    th.svc.settings.warm_max_age_hours = 0  # everything is due
    th.engine.calls.clear()
    th.client.portal.call(lambda: warm.warm_once(th.svc, seeds=SEEDS, tier="monthly",
                                                 parallel=1))
    assert [c["repo"] for c in th.engine.calls] == [
        "octo/two", "pallets/flask", "octo/three", "octo/one"]
