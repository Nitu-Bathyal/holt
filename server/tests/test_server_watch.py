"""PR watch end to end: turning alerts on, the checker (watch.py), the bell,
muting, the unsubscribe link and what a disconnect deletes. GitHub is faked."""

from __future__ import annotations

from datetime import timedelta

import httpx
import pytest
from holt.evidence.github_graphql import GitHubGraphQL
from holt_server import alerts, contributions, warm, watch
from holt_server.db import (
    Alert,
    AlertEmail,
    AlertSettings,
    Contribution,
    ContributionSync,
    Report,
    User,
    WatchMute,
    now,
)
from sqlalchemy import select, update

from conftest import canned_report
from test_server_contributions import FakeGitHub, call, connect, mine, pr, refresh, state

ONE = "PR_octo/one#1"


def with_github(h, monkeypatch):
    monkeypatch.setattr(GitHubGraphQL, "_backoff", lambda self, attempt: None)
    h.fake = FakeGitHub()
    h.svc.http.close()
    h.svc.http = httpx.Client(transport=httpx.MockTransport(h.fake))
    h.points = 5000

    async def remaining():
        return h.points
    h.svc.lookup.remaining = remaining
    contributions._refresh_limiter._hits.clear()
    return h


@pytest.fixture
def w(make_harness, monkeypatch):
    return with_github(make_harness(HOLT_PR_WATCH=True), monkeypatch)


def turn_on(h, user="u1", **body):
    r = h.put("/v1/me/alerts/settings", {"enabled": True, **body}, user=user)
    assert r.status_code == 200, r.text
    return r.json()


def check(h, at=None):
    async def go():
        return await watch.check(h.svc, at)
    return h.client.portal.call(go)


def bell(h, user="u1", **params):
    r = h.get("/v1/me/alerts", user=user, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def texts(h, user="u1"):
    return [i["text"] for i in bell(h, user)["items"]]


def stored(h, model):
    async def go(s):
        return (await s.execute(select(model))).scalars().all()
    return call(h, go)


def set_user(h, user="u1", **values):
    async def go(s):
        await s.execute(update(User).where(User.id == user).values(**values))
    call(h, go)


def watching_one(h, opened=None, **state_kw):
    """u1, connected, with one open pull request Holt has read, alerts on."""
    opened = opened or now() - timedelta(days=2)
    h.fake.prs["octocat"] = [pr("octo/one", 1, created=opened, title="Fix the parser")]
    h.fake.states = {ONE: state("octo/one", 1, pushed=opened, **state_kw)}
    connect(h)
    turn_on(h)
    return opened


def add_timing(h, repo, **timing):
    report = canned_report(repo)
    report["stats"] = {**report["stats"], "timing": timing}

    async def go(s):
        s.add(Report(repo=repo, repo_key=repo.lower(), mode="rules", days=7, report=report,
                     created_at=now()))
    call(h, go)


# --- turning alerts on, and access --------------------------------------------------------


def test_turning_alerts_on_starts_14_days_once(w):
    connect(w)
    before = w.get("/v1/me/alerts/settings", user="u1").json()
    assert before["enabled"] is False and before["access"] == {"state": "off", "until": None}
    got = turn_on(w, email="you@example.com", tz="Asia/Kolkata")
    assert got["enabled"] is True and got["access"]["state"] == "trial"
    assert got["email"] == "you@example.com" and got["email_mode"] == "turn"
    assert got["email_on"] is True and got["tz"] == "Asia/Kolkata"
    assert got["email_available"] is False  # no provider key in the tests
    [user] = stored(w, User)
    left = user.alerts_trial_ends_at.replace(tzinfo=None) - now().replace(tzinfo=None)
    assert timedelta(days=13, hours=23) < left <= timedelta(days=14)
    until = got["access"]["until"]
    # Off and on again: the same 14 days, not a new 14.
    w.put("/v1/me/alerts/settings", {"enabled": False}, user="u1")
    assert turn_on(w)["access"]["until"] == until


def test_the_taste_starts_at_turn_on_not_at_signup(w):
    connect(w)
    assert w.get("/v1/me", user="u1").status_code == 200  # the account exists
    assert stored(w, User)[0].alerts_trial_ends_at is None
    listed = bell(w)
    assert listed["access"]["state"] == "off" and listed["enabled"] is False


def test_alerts_need_github_connected_and_a_signed_in_user(w):
    assert w.get("/v1/me/alerts").status_code == 401
    assert w.put("/v1/me/alerts/settings", {"enabled": True}).status_code == 401
    r = w.put("/v1/me/alerts/settings", {"enabled": True}, user="u1")
    assert r.status_code == 404
    assert stored(w, User)[0].alerts_trial_ends_at is None  # nothing started


def test_after_the_14_days_alerts_end_and_cant_be_restarted(w):
    watching_one(w)
    set_user(w, alerts_trial_ends_at=now() - timedelta(hours=1))
    assert bell(w)["access"]["state"] == "ended"
    assert w.get("/v1/me/alerts/settings", user="u1").json()["watching"] == 0
    r = w.put("/v1/me/alerts/settings", {"enabled": True}, user="u1")
    assert r.status_code == 402 and r.json()["error"]["code"] == "needs_plan"
    # Other settings can still be saved (turning email off, say).
    assert w.put("/v1/me/alerts/settings", {"email_on": False}, user="u1").status_code == 200
    assert check(w).users == 0  # the checker skips them


def test_a_pass_gives_alerts_without_using_the_taste(w):
    connect(w)
    w.get("/v1/me", user="u1")
    until = now() + timedelta(days=30)
    set_user(w, plan="pro", plan_expires_at=until)
    got = turn_on(w)
    assert got["access"]["state"] == "pro" and got["access"]["until"].startswith(
        until.date().isoformat())
    assert stored(w, User)[0].alerts_trial_ends_at is None
    # The pass runs out: alerts stop, and the taste is still theirs to start.
    set_user(w, plan_expires_at=now() - timedelta(minutes=1))
    assert bell(w)["access"]["state"] == "off"
    assert check(w).users == 0
    assert turn_on(w)["access"]["state"] == "trial"


def test_switched_off_nothing_runs_and_alerts_cant_be_turned_on(make_harness, monkeypatch):
    h = with_github(make_harness(), monkeypatch)  # HOLT_PR_WATCH not set
    connect(h)
    assert bell(h)["access"]["state"] == "unavailable"
    r = h.put("/v1/me/alerts/settings", {"enabled": True}, user="u1")
    assert r.status_code == 501
    assert stored(h, User)[0].alerts_trial_ends_at is None
    assert check(h).stopped == "off"


def test_settings_are_checked(w):
    connect(w)
    bad = lambda body: w.put("/v1/me/alerts/settings", body, user="u1")  # noqa: E731
    assert bad({"tz": "Mars/Olympus"}).status_code == 400
    # The old name browsers still report for India.
    assert bad({"tz": "Asia/Calcutta"}).json()["tz"] == "Asia/Calcutta"
    assert bad({"email": "not an address"}).status_code == 400
    assert bad({"email_mode": "hourly"}).status_code == 400
    got = bad({"email_mode": "daily", "email": "a@b.co", "email_on": False}).json()
    assert (got["email_mode"], got["email"], got["email_on"]) == ("daily", "a@b.co", False)
    assert got["enabled"] is False and got["access"]["state"] == "off"  # saving isn't turning on
    assert bad({"email": None}).json()["email"] is None


# --- the checker --------------------------------------------------------------------------


def test_a_maintainer_reply_becomes_an_alert_on_the_bell(w):
    opened = watching_one(w)
    assert check(w).alerts == 0  # nothing has changed yet
    w.fake.states[ONE] = state("octo/one", 1, pushed=opened,
                               replied=now() - timedelta(minutes=20))
    got = check(w)
    assert (got.users, got.read, got.alerts, got.stopped) == (1, 1, 1, None)
    listed = bell(w)
    assert listed["unread"] == 1 and listed["watching"] == 1 and listed["enabled"] is True
    [item] = listed["items"]
    assert item["text"] == "Your turn: @lead replied on one #1."
    assert (item["kind"], item["repo"], item["number"]) == ("reply", "octo/one", 1)
    assert item["pr_url"] == "https://github.com/octo/one/pull/1"
    assert item["report_path"] == "/octo/one" and item["title"] == "Fix the parser"
    assert item["read_at"] is None
    assert w.get("/v1/me/alerts/count", user="u1").json() == {"unread": 1}
    # My PRs shows the same state, and who replied.
    [row] = mine(w).json()["pull_requests"]
    assert (row["watch"], row["unread_alert"], row["turn"]) == ("on", True, "yours")
    assert (row["reply_by"], row["reply_kind"]) == ("lead", "reply")
    # The next pass sees the same thing and says nothing new.
    assert check(w).alerts == 0 and len(texts(w)) == 1


def test_marking_alerts_read(w):
    opened = watching_one(w)
    w.fake.states[ONE] = state("octo/one", 1, pushed=opened, replied=now())
    check(w)
    [item] = bell(w)["items"]
    assert w.post("/v1/me/alerts/read", {}, user="u1").status_code == 400
    assert w.post("/v1/me/alerts/read", {"ids": [2**40]}, user="u1").status_code == 400
    assert w.get("/v1/me/alerts", user="u1", params={"before": 2**40}).status_code == 400
    assert w.post("/v1/me/alerts/read", {"ids": [item["id"]]}, user="u2").status_code == 204
    assert bell(w)["unread"] == 1  # someone else's ids change nothing
    assert w.post("/v1/me/alerts/read", {"ids": [item["id"]]}, user="u1").status_code == 204
    after = bell(w)
    assert after["unread"] == 0 and after["items"][0]["read_at"] is not None
    assert mine(w).json()["pull_requests"][0]["unread_alert"] is False


def test_mark_all_read_and_paging(w):
    watching_one(w)

    async def many(s):
        p = alerts.Pr(repo="octo/one", repo_key="octo/one", number=1, title="t", state="open",
                      url="https://github.com/octo/one/pull/1", created_at=now())
        for i in range(5):
            at = now() - timedelta(hours=5 - i)
            await alerts.record(s, "u1", p, [alerts.Found("reply", {"who": "lead"}, at)], at)
    call(w, many)
    first = bell(w, limit=2)
    assert first["unread"] == 5 and len(first["items"]) == 2
    rest = bell(w, limit=10, before=first["next_before"])
    assert len(rest["items"]) == 3 and rest["next_before"] is None
    ids = [i["id"] for i in first["items"] + rest["items"]]
    assert ids == sorted(ids, reverse=True)  # newest first
    assert w.post("/v1/me/alerts/read", {"all": True}, user="u1").status_code == 204
    assert bell(w)["unread"] == 0


def test_a_merge_seen_by_the_checker(w):
    opened = watching_one(w)
    w.fake.states[ONE] = {**state("octo/one", 1, pushed=opened), "state": "MERGED",
                          "mergedAt": now().isoformat(), "closedAt": now().isoformat()}
    assert check(w).alerts == 1
    assert texts(w) == ["Merged: one #1."]
    [row] = stored(w, Contribution)
    assert row.state == "merged" and row.merged_at is not None
    assert bell(w)["watching"] == 0  # watching ends with the pull request
    assert check(w).alerts == 0


def test_a_close_seen_by_a_refresh_alerts_once(w):
    watching_one(w)
    w.fake.prs["octocat"] = [pr("octo/one", 1, "CLOSED", closed=now(), title="Fix the parser")]

    async def old(s):
        await s.execute(update(ContributionSync).values(
            fetched_at=now() - timedelta(minutes=20)))
    call(w, old)
    assert refresh(w).status_code == 200  # the person pressed refresh on My PRs
    assert texts(w) == ["Closed without merging: one #1."]
    assert check(w).alerts == 0 and len(texts(w)) == 1  # the checker adds no second one


def test_changes_requested_and_then_approved(w):
    opened = watching_one(w)
    asked = now() - timedelta(hours=3)
    review = lambda who, at, st: {  # noqa: E731
        "author": {"__typename": "User", "login": who}, "authorAssociation": "MEMBER",
        "state": st, "submittedAt": at.isoformat()}
    node = state("octo/one", 1, pushed=opened, decision="CHANGES_REQUESTED")
    node["reviews"] = node["firstReviews"] = {"nodes": [review("lead", asked,
                                                               "CHANGES_REQUESTED")]}
    w.fake.states[ONE] = node
    check(w)
    assert texts(w) == ["Your turn: @lead asked for changes on one #1."]
    approved = now() - timedelta(hours=1)
    node = state("octo/one", 1, pushed=asked + timedelta(hours=1), decision="APPROVED")
    node["reviews"] = node["firstReviews"] = {"nodes": [
        review("lead", asked, "CHANGES_REQUESTED"), review("lead", approved, "APPROVED")]}
    w.fake.states[ONE] = node
    check(w)
    assert texts(w)[0] == "Approved: @lead approved one #1."


def test_past_the_slow_mark_alerts_once_and_the_typical_mark_never(w):
    watching_one(w, opened=now() - timedelta(days=5, hours=3))
    add_timing(w, "octo/one", first_reply_half_hours=5.0)  # only the typical wait is known
    assert check(w).alerts == 0
    add_timing(w, "octo/one", first_reply_half_hours=5.0, first_reply_slow_hours=70.0)
    assert check(w).alerts == 1
    assert texts(w) == ["Day 6, no reply on one #1. Most get one within 3 days here."]
    assert check(w).alerts == 0 and len(texts(w)) == 1


def test_no_wait_alert_for_a_repo_without_a_report(w):
    watching_one(w, opened=now() - timedelta(days=90))
    assert check(w).alerts == 0


def test_a_stale_bot_warning(w):
    opened = now() - timedelta(days=27)
    watching_one(w, opened=opened)
    add_timing(w, "octo/one", stale_bot=True, stale_close_days=30)
    assert check(w).alerts == 1
    assert texts(w) == ["Quiet for 27 days on one #1. The bot here closes at 30."]


def test_a_muted_pull_request_gets_no_alerts(w):
    opened = watching_one(w)
    assert w.put("/v1/me/contributions/octo/one/1/mute", user="u1").status_code == 204
    assert w.put("/v1/me/contributions/octo/one/1/mute", user="u1").status_code == 204
    assert w.put("/v1/me/contributions/octo/one/99/mute", user="u1").status_code == 404
    assert w.put(f"/v1/me/contributions/octo/one/{2**40}/mute", user="u1").status_code == 400
    assert mine(w).json()["pull_requests"][0]["watch"] == "muted"
    assert bell(w)["watching"] == 0
    w.fake.states[ONE] = state("octo/one", 1, pushed=opened, replied=now())
    reads = len(w.fake.state_reads)
    got = check(w)
    assert (got.alerts, got.read) == (0, 0) and len(w.fake.state_reads) == reads
    assert w.delete("/v1/me/contributions/octo/one/1/mute", user="u1").status_code == 204
    assert mine(w).json()["pull_requests"][0]["watch"] == "on"
    assert check(w).alerts == 1


def test_a_repo_left_out_of_the_numbers_isnt_watched(w):
    opened = watching_one(w)
    assert w.put("/v1/me/contributions/repos/octo/one", {"counted": False},
                 user="u1").status_code == 200
    assert mine(w).json()["pull_requests"][0]["watch"] is None
    w.fake.states[ONE] = state("octo/one", 1, pushed=opened, replied=now())
    assert check(w).alerts == 0


def test_no_alerts_and_no_watch_state_without_access(w):
    opened = now() - timedelta(days=2)
    w.fake.prs["octocat"] = [pr("octo/one", 1, created=opened)]
    w.fake.states = {ONE: state("octo/one", 1, pushed=opened)}
    connect(w)  # alerts never turned on
    assert mine(w).json()["pull_requests"][0]["watch"] is None
    w.fake.states[ONE] = state("octo/one", 1, pushed=opened, replied=now())
    assert check(w).users == 0
    assert stored(w, Alert) == []


def test_low_github_points_stop_the_reads_but_not_the_waits(w):
    opened = watching_one(w, opened=now() - timedelta(days=5, hours=3))
    add_timing(w, "octo/one", first_reply_slow_hours=70.0)
    w.fake.states[ONE] = state("octo/one", 1, pushed=opened, replied=now())
    w.points = 100  # under HOLT_WARM_MIN_POINTS
    reads = len(w.fake.state_reads)
    got = check(w)
    assert got.stopped == "low_points" and got.read == 0
    assert len(w.fake.state_reads) == reads  # GitHub wasn't asked
    assert texts(w) == ["Day 6, no reply on one #1. Most get one within 3 days here."]
    w.points = 5000
    assert check(w).alerts == 1  # the reply, next time


def test_a_failed_read_is_left_for_the_next_pass(w):
    opened = watching_one(w)
    w.fake.states[ONE] = state("octo/one", 1, pushed=opened, replied=now())
    w.fake.fail_state = httpx.Response(502)
    got = check(w)
    assert (got.stopped, got.alerts) == ("github", 0)
    w.fake.fail_state = None
    assert check(w).alerts == 1


def test_a_stale_list_is_searched_again_to_find_new_pull_requests(w):
    opened = watching_one(w)
    assert len(w.fake.searches) == 1
    check(w)
    assert len(w.fake.searches) == 1  # fetched a moment ago: read by node ID only

    async def old(s):
        await s.execute(update(ContributionSync).values(fetched_at=now() - timedelta(hours=7)))
    call(w, old)
    w.fake.prs["octocat"].append(pr("octo/two", 2, created=now() - timedelta(hours=1)))
    w.fake.states["PR_octo/two#2"] = state("octo/two", 2, pushed=now() - timedelta(hours=1))
    w.fake.states[ONE] = state("octo/one", 1, pushed=opened, replied=now())
    got = check(w)
    assert (got.searched, got.read) == (1, 0) and len(w.fake.searches) == 2
    assert {c.number for c in stored(w, Contribution)} == {1, 2}
    assert texts(w) == ["Your turn: @lead replied on one #1."]  # found by that search
    assert bell(w)["watching"] == 2


def test_only_one_users_pull_requests_are_theirs(w):
    opened = watching_one(w)
    w.fake.prs["someone"] = [pr("octo/two", 2, created=opened)]
    w.fake.states["PR_octo/two#2"] = state("octo/two", 2, pushed=opened)
    connect(w, user="u2", github_id=42)
    turn_on(w, user="u2")
    w.fake.states[ONE] = state("octo/one", 1, pushed=opened, replied=now())
    got = check(w)
    assert (got.users, got.read, got.alerts) == (2, 2, 1)
    assert len(texts(w, "u1")) == 1 and texts(w, "u2") == []
    assert w.get("/v1/me/alerts/count", user="u2").json() == {"unread": 0}


def test_old_alerts_are_deleted_after_90_days(w):
    watching_one(w)

    async def add(s):
        p = alerts.Pr(repo="octo/one", repo_key="octo/one", number=1, title="t", state="open",
                      url="https://github.com/octo/one/pull/1", created_at=now())
        old = now() - timedelta(days=91)
        await alerts.record(s, "u1", p, [alerts.Found("merged", at=old)], old)
        await alerts.record(s, "u1", p, [alerts.Found("closed", at=now())], now())
    call(w, add)
    check(w)
    assert [a.kind for a in stored(w, Alert)] == ["closed"]


def test_watched_repos_join_the_weekly_refresh(w):
    watching_one(w)

    async def go():
        return await warm.tier_repos(w.svc, "weekly", ["pallets/flask"])
    assert w.client.portal.call(go) == ["octo/one"]


# --- the unsubscribe link, and disconnecting -----------------------------------------------


def token_of(h, user="u1"):
    [row] = [r for r in stored(h, AlertSettings) if r.user_id == user]
    return alerts.unsubscribe_token(h.svc.settings.secret_key, user, row.unsubscribe_nonce)


def test_one_click_unsubscribe_turns_email_off_and_keeps_the_bell(w):
    watching_one(w)
    turn_on(w, email="you@example.com")
    token = token_of(w)
    body = {"token": token}
    r = w.post("/v1/alerts/unsubscribe", body)  # no user: whoever holds the link
    assert r.status_code == 200 and r.json() == {"email_on": False, "emails": "alerts"}
    got = w.get("/v1/me/alerts/settings", user="u1").json()
    assert got["email_on"] is False and got["enabled"] is True
    assert w.post("/v1/alerts/unsubscribe", body).status_code == 200  # twice is fine
    assert w.post("/v1/alerts/resubscribe", body).json() == {
        "email_on": True, "emails": "alerts"}  # undo
    assert w.post("/v1/alerts/unsubscribe", {"token": "0" * 64}).status_code == 404
    assert w.post("/v1/alerts/unsubscribe", {}).status_code == 400
    assert w.client.post("/v1/alerts/unsubscribe", json=body).status_code == 401  # no key


def test_a_new_address_gets_a_new_unsubscribe_link(w):
    watching_one(w)
    turn_on(w, email="old@example.com")
    old = token_of(w)
    turn_on(w, email="old@example.com")
    assert token_of(w) == old  # the same address: links in sent emails keep working
    turn_on(w, email="new@example.com")
    assert token_of(w) != old
    assert w.post("/v1/alerts/unsubscribe", {"token": old}).status_code == 404
    assert w.get("/v1/me/alerts/settings", user="u1").json()["email_on"] is True


def test_disconnecting_deletes_alerts_settings_and_mutes_but_not_the_used_taste(w):
    opened = watching_one(w)
    turn_on(w, email="you@example.com")
    w.put("/v1/me/contributions/octo/one/1/mute", user="u1")
    w.delete("/v1/me/contributions/octo/one/1/mute", user="u1")
    w.fake.states[ONE] = state("octo/one", 1, pushed=opened, replied=now())
    check(w)
    w.put("/v1/me/contributions/octo/one/1/mute", user="u1")

    async def sent(s):
        s.add(AlertEmail(user_id="u1", kind="now", alert_ids=[1], provider_id="x"))
    call(w, sent)
    until = stored(w, User)[0].alerts_trial_ends_at
    assert w.delete("/v1/me/github", user="u1").status_code == 200
    for model in (Alert, AlertSettings, WatchMute, AlertEmail):
        assert stored(w, model) == [], model.__name__
    assert stored(w, User)[0].alerts_trial_ends_at == until
    connect(w)
    assert turn_on(w)["access"]["state"] == "trial"
    assert stored(w, User)[0].alerts_trial_ends_at == until  # not a second 14 days
