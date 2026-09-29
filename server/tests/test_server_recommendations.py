"""Recommendations for you: rules only, "Worth your time" repos with maintainers
still answering, matched to the profile and to merged pull requests, never a
repo the user is already in, with reasons, and a free taste of the list."""

from __future__ import annotations

from datetime import timedelta

from conftest import STATS, canned_report
from holt.starter import RULES_VERSION
from holt_server import entitlements, recommendations
from holt_server.db import (
    ENGINE_VERSION,
    Contribution,
    FindCache,
    GitHubConnection,
    Profile,
    RepoMeta,
    Report,
    StarterCache,
    now,
)

URL = "/v1/me/recommendations"


def add(h, *items):
    async def go():
        async with h.svc.db.session() as s:
            s.add_all(items)
            await s.commit()
    h.client.portal.call(go)


def report(repo, verdict="viable", age_days=0, **stats):
    body = canned_report(repo, "rules", 7, verdict)
    body["stats"] = {**STATS, **stats}
    return Report(repo=repo, repo_key=repo.lower(), mode="rules", days=7, report=body,
                  created_at=now() - timedelta(days=age_days))


def meta(repo, language=None, topics=(), **kw):
    return RepoMeta(repo_key=repo.lower(), repo=repo, language=language, stars=kw.pop("stars", 10),
                    topics=list(topics), **kw)


def profile(user="u1", languages=("python",), topics=(), level="newcomer", contributions=()):
    return Profile(user_id=user, languages=list(languages), topics=list(topics), days=7,
                   level=level, contributions=list(contributions))


def connection(user="u1", login="octocat"):
    return GitHubConnection(user_id=user, github_id=583231, login=login,
                            adult_confirmed_at=now())


def pr(repo, number=1, state="merged", user="u1"):
    return Contribution(user_id=user, repo_key=repo.lower(), number=number, repo=repo,
                        title="t", url=f"https://github.com/{repo}/pull/{number}",
                        state=state, created_at=now())


def issue(number, labels=("good first issue",), title="Fix a thing", people=0):
    return {"number": number, "title": title, "url": f"https://github.com/o/r/issues/{number}",
            "labels": list(labels), "created_at": None, "comments": 0, "why": [],
            "people": people, "open_prs": 0}


def starters(repo, *issues, age_hours=0):
    return StarterCache(repo_key=repo.lower(), repo=repo, issues=list(issues),
                        created_at=now() - timedelta(hours=age_hours))


def pro(h, user="u1"):
    async def go():
        await entitlements.set_plan(h.svc, user, "pro", expires_at=None, reason="test",
                                    actor="test")
    h.client.portal.call(go)


def get(h, user="u1", **params):
    r = h.get(URL, user=user, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def names(body):
    return [p["repo"] for p in body["picks"]]


def test_signed_in_only(h):
    assert h.get(URL).status_code == 401
    assert h.client.get(URL, headers={"X-Holt-User": "u1"}).status_code == 401


def test_nothing_to_match_on_gives_an_empty_list_that_says_why(h):
    add(h, report("octo/py"), meta("octo/py", "Python"))
    body = get(h)
    assert body["picks"] == [] and body["locked"] == 0
    assert body["basis"]["has_profile"] is False and body["basis"]["connected"] is False


def test_only_worth_your_time_with_maintainers_answering(h):
    pro(h)
    add(h, profile(),
        report("octo/good"), meta("octo/good", "Python"),
        report("octo/no", "not_viable"), meta("octo/no", "Python"),
        report("octo/unsure", "insufficient_evidence"), meta("octo/unsure", "Python"),
        report("octo/slow", median_first_response_hours=200.0), meta("octo/slow", "Python"),
        report("octo/silent", no_reply=11), meta("octo/silent", "Python"),
        report("octo/mute", median_first_response_hours=None), meta("octo/mute", "Python"),
        report("octo/stale", age_days=20), meta("octo/stale", "Python"),
        report("octo/archived"), meta("octo/archived", "Python", archived=True),
        report("octo/fork"), meta("octo/fork", "Python", fork=True),
        report("octo/go"), meta("octo/go", "Go"))
    body = get(h)
    assert names(body) == ["octo/good"]
    p = body["picks"][0]
    assert p["headline"] == "Worth your time" and p["tone"] == "good"
    assert p["odds"]["level"] == "good"
    assert p["why"][0] == "Written in Python, one of your languages."
    assert "Maintainers usually reply within 3 hours." in p["why"]
    assert "6 people had their first pull request merged here recently." in p["why"]
    assert p["reason"].startswith("Outside contributors get real replies here")
    assert p["numbers_line"].startswith("Of 20 pull requests from outside contributors")


def test_the_newest_report_decides(h):
    pro(h)
    add(h, profile(), report("octo/changed"), meta("octo/changed", "Python"))
    add(h, report("octo/changed", "not_viable"))
    assert names(get(h)) == []


def test_merged_pull_requests_add_languages_and_already_in_repos_are_left_out(h):
    pro(h)
    add(h, profile(languages=()), connection(),
        pr("rust-lang/done"), pr("rust-lang/done", 2), pr("octo/tried", state="closed"),
        meta("rust-lang/done", "Rust"), meta("octo/tried", "Rust"),
        report("rust-lang/done"), report("octo/tried"),
        report("octo/rusty"), meta("octo/rusty", "Rust"),
        report("octocat/mine"), meta("octocat/mine", "Rust"),
        report("octo/py"), meta("octo/py", "Python"))
    body = get(h)
    assert names(body) == ["octo/rusty"]
    assert body["picks"][0]["why"][0] == ("Written in Rust, where you've had pull "
                                          "requests merged before.")
    assert body["basis"]["history_languages"] == ["Rust"]
    assert body["basis"]["already_contributing"] == 2 and body["basis"]["connected"]


def test_rank_is_by_points_then_the_discover_order(h):
    pro(h)
    add(h, profile(languages=("python",), topics=("cli",)), connection(),
        pr("octo/old"), meta("octo/old", "Python"),
        report("octo/both"), meta("octo/both", "Python", topics=["cli"]),
        report("octo/lang"), meta("octo/lang", "Python"),
        report("octo/topic"), meta("octo/topic", "Go", topics=["cli"]),
        report("octo/lang-more", outsider_attempts=40, outsider_merged=20, no_reply=4),
        meta("octo/lang-more", "Python"))
    # both: stated + merged-in + topic; lang-more beats lang on merged share.
    assert names(get(h)) == ["octo/both", "octo/lang-more", "octo/lang", "octo/topic"]
    why = get(h)["picks"][0]["why"]
    assert why[:2] == ["Written in Python, one of your languages, and you've had pull "
                       "requests merged in it.", "About cli, a topic you picked."]


def test_newcomers_see_beginner_issues_and_skip_long_odds(h):
    pro(h)
    add(h, profile(level="newcomer", contributions=("docs",)),
        report("octo/long", outsider_merged=0), meta("octo/long", "Python"),
        report("octo/none"), meta("octo/none", "Python"),
        starters("octo/none", issue(1, labels=["help wanted"])),
        report("octo/issues"), meta("octo/issues", "Python"),
        starters("octo/issues", issue(1), issue(2, labels=["help wanted"]),
                 issue(3, labels=["good first issue", "documentation"]), issue(4), issue(5)),
        report("octo/unknown"), meta("octo/unknown", "Python"))
    body = get(h)
    # long odds and known issues with none for first-timers are dropped;
    # unknown issues keep the repo, known fitting ones rank it higher.
    assert names(body) == ["octo/issues", "octo/unknown"]
    p = body["picks"][0]
    assert [i["number"] for i in p["issues"]] == [3, 1, 4]  # docs first, beginners only
    assert all(i["beginner"] for i in p["issues"])
    assert "Has an open docs issue, the kind of work you want to do." in p["why"]
    assert body["picks"][1]["issues"] == []


def test_experienced_users_see_every_issue_and_long_odds(h):
    pro(h)
    add(h, profile(level="experienced"),
        report("octo/long", outsider_merged=0), meta("octo/long", "Python"),
        report("octo/help"), meta("octo/help", "Python"),
        starters("octo/help", issue(1, labels=["help wanted"])))
    body = get(h)
    assert names(body) == ["octo/help", "octo/long"]
    assert body["picks"][0]["issues"][0]["number"] == 1
    assert not any("first pull request" in w for w in body["picks"][0]["why"])


def test_old_starter_issues_are_not_shown(h):
    pro(h)
    add(h, profile(), report("octo/a"), meta("octo/a", "Python"),
        starters("octo/a", issue(1), age_hours=100))
    assert get(h)["picks"][0]["issues"] == []


def test_issues_nobody_is_on_come_first_then_fitting_ones(h):
    pro(h)
    add(h, profile(level="experienced", contributions=("docs",)),
        report("octo/a"), meta("octo/a", "Python"),
        starters("octo/a", issue(1, title="Fix the docs", people=2), issue(2),
                 issue(3, title="Fix the docs")))
    assert [i["number"] for i in get(h)["picks"][0]["issues"]] == [3, 2, 1]


def test_issues_cached_before_they_said_who_is_on_them_are_not_shown(h):
    pro(h)
    old = {k: v for k, v in issue(1).items() if k not in ("people", "open_prs")}
    add(h, profile(), report("octo/a"), meta("octo/a", "Python"), starters("octo/a", old))
    assert get(h)["picks"][0]["issues"] == []


def test_find_results_fill_in_repos_without_a_report(h):
    pro(h)
    found = {"repo": "octo/found", "verdict": "viable", "language": "Python",
             "description": "d", "stars": 5, "stats": dict(STATS), "issues": [issue(9)]}
    partial = {"repo": "octo/partial", "verdict": "viable", "language": "Python",
               "stats": {"outsider_attempts": 3}, "issues": []}
    add(h, profile(), FindCache(key="k", params={"engine_version": ENGINE_VERSION,
                                                 "starter_rules": RULES_VERSION},
                                results=[found, partial]))
    body = get(h)
    assert names(body) == ["octo/found"]
    assert body["picks"][0]["issues"][0]["number"] == 9


def test_free_users_get_a_taste_and_a_count_of_the_rest(h):
    add(h, profile(), *[x for i in range(5) for x in (report(f"octo/r{i}"),
                                                      meta(f"octo/r{i}", "Python"))])
    body = get(h)
    assert len(body["picks"]) == recommendations.FREE_PICKS == 2
    assert body["locked"] == 3 and body["full"] is False
    pro(h)
    body = get(h)
    assert len(body["picks"]) == 5 and body["locked"] == 0 and body["full"] is True
    assert len(get(h, limit=1)["picks"]) == 1


def test_no_github_call_and_no_charge(h):
    pro(h)
    add(h, profile(), report("octo/a"), meta("octo/a", "Python"))
    calls = len(h.svc.lookup.details.calls)
    get(h)
    get(h)
    assert len(h.svc.lookup.details.calls) == calls
    assert h.engine.calls == []
