"""Repository statistics from Holt users: the 5-person minimum, opt-outs,
disconnects, and the field on the served report. GitHub is faked."""

from __future__ import annotations

from datetime import timedelta

import pytest
from holt_server import contributions, repo_stats
from holt_server.db import Contribution, GitHubConnection, RepoUserStats, Report, now
from sqlalchemy import select

from conftest import canned_report
from test_server_contributions import FakeGitHub, call, pr, wait_for_background

REPO = "pallets/flask"


@pytest.fixture
def gh(h):
    import httpx

    fake = FakeGitHub()
    h.svc.http.close()
    h.svc.http = httpx.Client(transport=httpx.MockTransport(fake))
    h.fake = fake
    return h


def person(h, n, prs, opted_out=False):
    """Connected user `u{n}` with `prs` = [(repo, state), ...] stored."""
    async def go(s):
        s.add(GitHubConnection(user_id=f"u{n}", github_id=1000 + n, login=f"user{n}",
                               adult_confirmed_at=now(), stats_opt_out=opted_out))
        for i, (repo, state) in enumerate(prs, 1):
            s.add(Contribution(user_id=f"u{n}", repo_key=repo.lower(), repo=repo,
                               number=n * 100 + i, title="Fix", url="https://x",
                               state=state, created_at=now() - timedelta(days=3)))
    call(h, go)


def rebuild(h, keys=None):
    return call(h, lambda s: repo_stats.rebuild(s, keys))


def stored(h):
    rows = call(h, lambda s: _all(s))
    return {r.repo_key: (r.people, r.pull_requests, r.merged, r.closed, r.waiting)
            for r in rows}


async def _all(s):
    return (await s.execute(select(RepoUserStats))).scalars().all()


def served(h, repo=REPO):
    async def go(s):
        s.add(Report(repo=repo, repo_key=repo.lower(), mode="rules", days=7,
                     report=canned_report(repo), created_at=now()))
    call(h, go)
    r = h.get(f"/v1/reports/{repo}")
    assert r.status_code == 200, r.text
    return r.json()["holt_users"]


def test_five_people_make_numbers_four_do_not(h):
    for n in range(1, 5):
        person(h, n, [(REPO, "merged")])
    assert rebuild(h) == 0
    assert stored(h) == {}
    person(h, 5, [(REPO, "closed"), (REPO, "open")])
    assert rebuild(h) == 1
    assert stored(h) == {"pallets/flask": (5, 6, 4, 1, 1)}


def test_one_person_with_many_prs_is_still_one_person(h):
    person(h, 1, [(REPO, "merged")] * 40)
    for n in range(2, 5):
        person(h, n, [(REPO, "merged")])
    rebuild(h)
    assert stored(h) == {}


def test_opted_out_users_are_left_out_of_counts_and_people(h):
    for n in range(1, 6):
        person(h, n, [(REPO, "merged")])
    person(h, 6, [(REPO, "closed")] * 10, opted_out=True)
    rebuild(h)
    assert stored(h) == {"pallets/flask": (5, 5, 5, 0, 0)}
    # Five people only because the opted-out user isn't one of them.
    call(h, lambda s: _opt(s, "u1"))
    rebuild(h)
    assert stored(h) == {}


async def _opt(s, user_id):
    (await s.get(GitHubConnection, user_id)).stats_opt_out = True


def test_rebuilding_some_repos_leaves_the_others(h):
    for n in range(1, 6):
        person(h, n, [(REPO, "merged"), ("octo/one", "open")])
    rebuild(h)
    assert set(stored(h)) == {"pallets/flask", "octo/one"}
    call(h, lambda s: _opt(s, "u1"))
    rebuild(h, {"octo/one"})
    assert set(stored(h)) == {"pallets/flask"}
    assert rebuild(h, set()) == 0
    assert set(stored(h)) == {"pallets/flask"}


def test_report_page_gets_the_numbers_only_over_the_threshold(h):
    for n in range(1, 5):
        person(h, n, [(REPO, "merged"), (REPO, "closed")])
    rebuild(h)
    assert served(h) is None
    person(h, 5, [(REPO, "open")])
    rebuild(h)
    got = h.get(f"/v1/reports/{REPO}").json()["holt_users"]
    assert {k: v for k, v in got.items() if k != "computed_at"} == {
        "people": 5, "pull_requests": 9, "merged": 4, "closed": 4, "waiting": 1,
        "window_days": 365}
    assert got["computed_at"].endswith("Z")
    # Nothing that could name anyone.
    assert not any("user" in k or "login" in k for k in got)


def test_a_report_never_stores_the_numbers(h):
    for n in range(1, 6):
        person(h, n, [(REPO, "merged")])
    rebuild(h)
    assert served(h)["people"] == 5
    stored_report = call(h, lambda s: _report(s))
    assert stored_report.get("holt_users") is None


async def _report(s):
    return (await s.execute(select(Report.report))).scalar_one()


def test_opting_out_drops_them_at_once(gh):
    for n in range(1, 6):
        person(gh, n, [(REPO, "merged")])
    rebuild(gh)
    assert served(gh)["people"] == 5
    r = gh.client.patch("/v1/me/github", json={"stats_opt_out": True},
                        headers=gh.headers("u3"))
    assert r.status_code == 200
    assert stored(gh) == {}
    assert gh.get(f"/v1/reports/{REPO}").json()["holt_users"] is None
    # And back in when they turn it off again.
    gh.client.patch("/v1/me/github", json={"stats_opt_out": False}, headers=gh.headers("u3"))
    assert stored(gh) == {"pallets/flask": (5, 5, 5, 0, 0)}


def test_disconnecting_drops_them_at_once(gh):
    for n in range(1, 7):
        person(gh, n, [(REPO, "merged")])
    rebuild(gh)
    assert stored(gh)["pallets/flask"][0] == 6
    assert gh.delete("/v1/me/github", user="u6").status_code == 200
    assert stored(gh)["pallets/flask"][0] == 5
    assert gh.delete("/v1/me/github", user="u5").status_code == 200
    assert stored(gh) == {}


def test_reconnecting_with_opt_out_drops_them(gh):
    gh.fake.users[1003] = "user3"
    for n in range(1, 6):
        person(gh, n, [(REPO, "merged")])
    rebuild(gh)
    r = gh.post("/v1/me/github", {"github_id": 1003, "adult_confirmed": True,
                                  "stats_opt_out": True}, user="u3")
    assert r.status_code == 200, r.text
    assert stored(gh) == {}
    wait_for_background(gh)


def test_the_daily_refresh_recounts(gh):
    for n in range(1, 6):
        gh.fake.users[1000 + n] = f"user{n}"
        gh.fake.prs[f"user{n}"] = [pr(REPO, n, "MERGED", merged=now())]
        person(gh, n, [])

    async def remaining():
        return 5000
    gh.svc.lookup.remaining = remaining

    async def run():
        return await contributions.refresh_once(gh.svc, timedelta(hours=20))
    assert gh.client.portal.call(run) == 5
    assert stored(gh) == {"pallets/flask": (5, 5, 5, 0, 0)}


def test_cli_recounts(gh, monkeypatch, capsys):
    async def fake(svc):
        return 3
    monkeypatch.setattr(repo_stats, "rebuild_all", fake)
    monkeypatch.setattr(contributions, "Services", lambda settings: _Svc())
    assert contributions.main(["stats"]) == 0
    assert "repositories with statistics: 3" in capsys.readouterr().out


class _Svc:
    class http:
        @staticmethod
        def close():
            pass

    class db:
        @staticmethod
        async def dispose():
            pass
