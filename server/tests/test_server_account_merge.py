"""Merging two Holt accounts: `POST /v1/me/merge` (API.md, "Merging accounts").

`old` is the account the GitHub sign-in belonged to (it goes away); `kept` is
the one the person is signed in to."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from holt_server import account_mail, alerts, credits
from holt_server.db import (
    AccountEmail,
    AccountMail,
    Alert,
    AlertEmail,
    AlertSettings,
    Contribution,
    ContributionChoice,
    ContributionSync,
    CreditEvent,
    CreditLot,
    Feedback,
    GitHubConnection,
    Job,
    MergePlan,
    Order,
    PlanEvent,
    PlanUsage,
    PlaybookUnlock,
    Preflight,
    Profile,
    RepoView,
    Subscription,
    User,
    WatchMute,
    iso,
    utc,
)
from sqlalchemy import select, update

GITHUB_ID = 583231


def merge(h, into="kept", source="old", github_id=GITHUB_ID):
    return h.post("/v1/me/merge", {"from_user": source, "github_id": github_id}, user=into)


def saved(h, user):
    r = h.get("/v1/me/saved", user=user)
    assert r.status_code == 200, r.text
    return [s["repo"] for s in r.json()["saved"]]


def test_saved_repos_from_both_accounts_end_up_in_the_kept_one(h):
    assert h.put("/v1/me/saved/pallets/flask", user="old").status_code == 200
    assert h.put("/v1/me/saved/octo/one", user="old").status_code == 200
    assert h.put("/v1/me/saved/octo/one", user="kept").status_code == 200
    assert h.put("/v1/me/saved/octo/two", user="kept").status_code == 200

    r = merge(h)

    assert r.status_code == 204, r.text
    assert sorted(saved(h, "kept")) == ["octo/one", "octo/two", "pallets/flask"]
    assert saved(h, "old") == []


# --- helpers ----------------------------------------------------------------------------


def add(h, *items):
    async def go():
        async with h.svc.db.session() as s:
            s.add_all(items)
            await s.commit()
    h.client.portal.call(go)


def rows(h, model, user=None):
    async def q():
        async with h.svc.db.session() as s:
            got = (await s.execute(select(model).order_by(*model.__table__.primary_key)
                                   )).scalars().all()
            return [r for r in got if user is None or r.user_id == user]
    return h.client.portal.call(q)


def account(h, user) -> User | None:
    return next((u for u in rows(h, User) if u.id == user), None)


def set_user(h, user, **values):
    """The account's own row, made if the server hasn't seen the user yet."""
    async def go():
        await credits.ensure_user(h.svc, user)
        if not values:
            return
        async with h.svc.db.session() as s:
            await s.execute(update(User).where(User.id == user).values(**values))
            await s.commit()
    h.client.portal.call(go)


def entitlement(h, user, feature):
    r = h.get("/v1/me/entitlements", user=user)
    assert r.status_code == 200, r.text
    return next(f for f in r.json()["features"] if f["feature"] == feature)


def days(n: int) -> datetime:
    return datetime(2026, 10, 1, tzinfo=UTC) + timedelta(days=n)


SOON, LATER = datetime.now(UTC) + timedelta(days=5), datetime.now(UTC) + timedelta(days=40)


# --- the plan, orders and credits -------------------------------------------------------


@pytest.mark.parametrize(("old", "kept", "expected"), [
    (LATER, SOON, LATER),    # the removed account's pass runs longer: it comes along
    (SOON, LATER, LATER),    # the kept account's does: nothing changes
    (LATER, None, LATER),    # only the removed account had one
])
def test_the_later_pro_expiry_is_kept(h, old, kept, expected):
    set_user(h, "old", plan="pro", plan_expires_at=old)
    set_user(h, "kept", **({"plan": "pro", "plan_expires_at": kept} if kept else {}))

    assert merge(h).status_code == 204

    me = h.get("/v1/me", user="kept").json()
    assert me["plan"] == "pro"
    assert me["plan_expires_at"] == iso(expected)


def test_a_lapsed_pass_never_replaces_a_running_one(h):
    set_user(h, "old", plan="pro", plan_expires_at=datetime.now(UTC) - timedelta(days=2))
    set_user(h, "kept", plan="pro", plan_expires_at=SOON)

    assert merge(h).status_code == 204

    assert h.get("/v1/me", user="kept").json()["plan_expires_at"] == iso(SOON)


def test_a_pass_that_comes_along_is_in_the_plan_history(h):
    set_user(h, "old", plan="pro", plan_expires_at=LATER)
    add(h, PlanEvent(user_id="old", plan="pro", expires_at=LATER, reason="pass bought",
                     actor="payments", created_at=days(0)))

    assert merge(h).status_code == 204

    assert [(e.plan, e.reason) for e in rows(h, PlanEvent, "kept")] == [
        ("pro", "pass bought"), ("pro", "accounts merged")]
    assert rows(h, PlanEvent, "old") == []


def test_every_order_and_its_receipt_record_moves(h):
    add(h,
        Order(id="o-old", user_id="old", pack_id="pro-30", credits=0, expires_days=30,
              amount=19900, currency="INR", provider="razorpay", provider_order_id="order_1",
              provider_payment_id="pay_1", status="paid", created_at=days(0)),
        Order(id="o-kept", user_id="kept", pack_id="pro-30", credits=0, expires_days=30,
              amount=19900, currency="INR", provider="razorpay", provider_order_id="order_2",
              provider_payment_id="pay_2", status="paid", created_at=days(1)),
        AccountEmail(user_id="old", kind="receipt", key="receipt:o-old", status="sent"),
        AccountEmail(user_id="old", kind="welcome", key="welcome", status="sent"),
        AccountEmail(user_id="kept", kind="welcome", key="welcome", status="sent"))

    assert merge(h).status_code == 204

    assert sorted(o.id for o in rows(h, Order, "kept")) == ["o-kept", "o-old"]
    # The receipt already went out: it is never sent again. One welcome is enough.
    assert sorted(e.key for e in rows(h, AccountEmail, "kept")) == ["receipt:o-old", "welcome"]
    assert rows(h, Order, "old") == rows(h, AccountEmail, "old") == []


def test_credits_add_up_and_the_ledger_still_balances(h):
    for user in ("old", "kept"):  # the first visit gives the welcome credits (3 here)
        assert h.get("/v1/me", user=user).status_code == 200

    async def gift():
        await credits.grant(h.svc, "old", 5, pool="purchased", reason="test", actor="test")
    h.client.portal.call(gift)

    assert merge(h).status_code == 204

    got = h.get("/v1/me/credits", user="kept").json()
    assert (got["free"], got["purchased"]) == (6, 5)
    events = rows(h, CreditEvent, "kept")
    assert sum(e.amount for e in events if e.source == "free") == 6
    assert sum(e.amount for e in events if e.source == "purchased") == 5
    assert [lot.remaining for lot in rows(h, CreditLot, "kept")] == [5]
    assert rows(h, CreditEvent, "old") == rows(h, CreditLot, "old") == []


def test_the_weekly_claim_cant_be_had_sooner_by_merging(h):
    set_user(h, "old", credits_granted_at=days(-30), last_claim_at=days(-1))
    set_user(h, "kept", credits_granted_at=days(-20), last_claim_at=days(-6))

    assert merge(h).status_code == 204

    kept = account(h, "kept")
    assert utc(kept.last_claim_at) == days(-1)
    assert utc(kept.credits_granted_at) == days(-30)


# --- free allowances --------------------------------------------------------------------


def test_free_merge_plans_used_take_the_more_used_count(h):
    add(h, PlanUsage(user_id="old", feature="merge_plan", period="total", used=3),
        PlanUsage(user_id="kept", feature="merge_plan", period="total", used=1),
        PlanUsage(user_id="old", feature="merge_plan", period="2026-09", used=4))

    assert merge(h).status_code == 204

    assert entitlement(h, "kept", "merge_plan")["left"] == 0
    assert {(u.feature, u.period): u.used for u in rows(h, PlanUsage, "kept")} == {
        ("merge_plan", "total"): 3, ("merge_plan", "2026-09"): 4}
    assert rows(h, PlanUsage, "old") == []


@pytest.mark.parametrize(("old", "kept", "expected"), [
    (days(3), days(10), days(3)),   # both started it: the one further along counts
    (days(10), days(3), days(3)),
    (days(-5), None, days(-5)),     # used up on the removed account: not to be had again
    (None, days(4), days(4)),
])
def test_the_alert_trial_takes_the_one_further_along(h, old, kept, expected):
    set_user(h, "old", alerts_trial_ends_at=old)
    set_user(h, "kept", alerts_trial_ends_at=kept)

    assert merge(h).status_code == 204

    assert utc(account(h, "kept").alerts_trial_ends_at) == expected


def test_the_emptied_account_is_deleted(h):
    set_user(h, "old", ai_credits=2)

    assert merge(h).status_code == 204

    assert account(h, "old") is None
    assert account(h, "kept") is not None


# --- GitHub, pull requests and alerts ---------------------------------------------------


def connection(user="old", github_id=GITHUB_ID, login="octocat", **kw):
    return GitHubConnection(user_id=user, github_id=github_id, login=login,
                            connected_at=days(-9), adult_confirmed_at=days(-9), **kw)


def pull(user, repo, number, **kw):
    values = {"title": "Fix it", "url": f"https://github.com/{repo}/pull/{number}",
              "state": "open", "created_at": days(-3), **kw}
    return Contribution(user_id=user, repo_key=repo.lower(), repo=repo, number=number, **values)


def test_the_github_connection_and_what_it_gathered_come_along(h):
    add(h, connection(),
        pull("old", "pallets/flask", 5432), pull("old", "octo/one", 7, state="merged"),
        ContributionSync(user_id="old", login="octocat", fetched_at=days(-1)),
        ContributionChoice(user_id="old", repo_key="octo/one", repo="octo/one", counted=False),
        RepoView(user_id="old", repo_key="pallets/flask", repo="pallets/flask", views=4),
        WatchMute(user_id="old", repo_key="octo/one", number=7))

    assert merge(h).status_code == 204

    got = h.get("/v1/me/github", user="kept").json()
    assert (got["account"]["id"], got["account"]["login"]) == (GITHUB_ID, "octocat")
    assert got["account"]["connected_at"] == iso(days(-9))
    assert h.get("/v1/me/github", user="old").json() == {"connected": False, "account": None}
    assert [(p.repo, p.number) for p in rows(h, Contribution, "kept")] == [
        ("octo/one", 7), ("pallets/flask", 5432)]
    for table in (ContributionSync, ContributionChoice, RepoView, WatchMute):
        assert len(rows(h, table, "kept")) == 1, table.__name__
        assert rows(h, table, "old") == [], table.__name__


def alert(user, kind, number=5432, at=None, **kw):
    pr = SimpleNamespace(repo_key="pallets/flask", number=number)
    return Alert(user_id=user, repo="pallets/flask", repo_key="pallets/flask", number=number,
                 pr_url=f"https://github.com/pallets/flask/pull/{number}", pr_title="Fix it",
                 kind=kind, facts={}, created_at=days(-1),
                 dedupe_key=alerts.dedupe_key(user, pr, alerts.Found(kind, {}, at)), **kw)


def test_alerts_come_along_and_a_wait_already_told_isnt_told_again(h):
    add(h, connection(), pull("old", "pallets/flask", 5432, last_activity_at=days(-8)),
        alert("old", "late_reply"), alert("old", "stale_soon", at=days(-8)),
        alert("old", "reply", at=days(-2), read_at=days(-1)),
        AlertEmail(user_id="old", kind="now", alert_ids=[1]))

    assert merge(h).status_code == 204

    got = {a.kind: a for a in rows(h, Alert, "kept")}
    assert sorted(got) == ["late_reply", "reply", "stale_soon"]
    assert rows(h, Alert, "old") == []
    assert len(rows(h, AlertEmail, "kept")) == 1

    # The next read of the same pull request finds the same waits: no new alert.
    pr = SimpleNamespace(repo="pallets/flask", repo_key="pallets/flask", number=5432,
                         url="https://github.com/pallets/flask/pull/5432", title="Fix it")

    async def again():
        async with h.svc.db.session() as s:
            made = await alerts.record(s, "kept", pr, [
                alerts.Found("late_reply"), alerts.Found("stale_soon", {}, days(-8))])
            await s.commit()
            return made
    assert h.client.portal.call(again) == 0


def test_alert_settings_come_along_with_a_working_unsubscribe_link(h):
    async def seed():
        async with h.svc.db.session() as s:
            row = alerts.new_settings(h.svc, "old")
            row.enabled, row.email, row.email_mode = True, "octo@example.com", "daily"
            s.add(row)
            await s.commit()
    h.client.portal.call(seed)

    assert merge(h).status_code == 204

    [row] = rows(h, AlertSettings)
    assert (row.user_id, row.enabled, row.email_mode) == ("kept", True, "daily")
    token = alerts.unsubscribe_token(h.svc.settings.secret_key, "kept", row.unsubscribe_nonce)
    assert row.unsubscribe_hash == alerts.token_hash(token)


# --- settings: the kept account's win ---------------------------------------------------


def mail(h, user, email, product_on):
    async def seed():
        async with h.svc.db.session() as s:
            row = await account_mail.prefs(s, h.svc, user)
            row.email, row.product_on = email, product_on
            await s.commit()
    h.client.portal.call(seed)


def test_the_kept_accounts_email_settings_and_profile_win(h):
    mail(h, "old", "octo@example.com", True)
    mail(h, "kept", "me@example.com", False)
    add(h, Profile(user_id="old", languages=["Rust"], level="experienced"),
        Profile(user_id="kept", languages=["Python"], level="newcomer"))

    assert merge(h).status_code == 204

    assert h.get("/v1/me/emails", user="kept").json() == {
        "email": "me@example.com", "product_emails": False}
    assert h.get("/v1/me/profile", user="kept").json()["profile"]["languages"] == ["Python"]
    assert rows(h, AccountMail, "old") == rows(h, Profile, "old") == []


def test_a_profile_and_email_settings_only_the_removed_account_had_come_along(h):
    mail(h, "old", "octo@example.com", False)
    add(h, Profile(user_id="old", languages=["Rust"], level="experienced"))

    assert merge(h).status_code == 204

    assert h.get("/v1/me/profile", user="kept").json()["profile"]["languages"] == ["Rust"]
    [row] = rows(h, AccountMail)
    assert (row.user_id, row.email, row.product_on) == ("kept", "octo@example.com", False)
    token = account_mail.unsubscribe_token(h.svc.settings.secret_key, "kept",
                                           row.unsubscribe_nonce)
    assert row.unsubscribe_hash == alerts.token_hash(token)


# --- lists: both accounts', each thing once ---------------------------------------------


def test_recent_checks_from_both_accounts_are_in_the_history(h):
    add(h, Job(id="j-old", kind="analysis", repo="pallets/flask", repo_key="pallets/flask",
               user_id="old", status="done", created_at=days(-2)),
        Job(id="j-kept", kind="analysis", repo="octo/one", repo_key="octo/one",
            user_id="kept", status="done", created_at=days(-1)))

    assert merge(h).status_code == 204

    items = h.get("/v1/me/history", user="kept").json()["items"]
    assert [i["job_id"] for i in items] == ["j-kept", "j-old"]
    assert h.get("/v1/me/history", user="old").json()["items"] == []


def test_paid_results_come_along_and_the_kept_accounts_copy_wins(h):
    add(h, MergePlan(user_id="old", repo_key="pallets/flask", repo="pallets/flask",
                     plan={"from": "old"}),
        MergePlan(user_id="old", repo_key="octo/one", repo="octo/one", plan={"from": "old"}),
        MergePlan(user_id="kept", repo_key="octo/one", repo="octo/one", plan={"from": "kept"}),
        PlaybookUnlock(user_id="old", repo_key="pallets/flask", paid={"via": "plan"}),
        PlaybookUnlock(user_id="kept", repo_key="pallets/flask", paid={"via": "credits"}),
        Preflight(user_id="old", repo_key="octo/one", repo="octo/one", target="pr:7",
                  head_sha="abc", result={}))

    assert merge(h).status_code == 204

    assert {p.repo_key: p.plan["from"] for p in rows(h, MergePlan, "kept")} == {
        "octo/one": "kept", "pallets/flask": "old"}
    assert [u.paid for u in rows(h, PlaybookUnlock, "kept")] == [{"via": "credits"}]
    assert [p.target for p in rows(h, Preflight, "kept")] == ["pr:7"]
    for table in (MergePlan, PlaybookUnlock, Preflight):
        assert rows(h, table, "old") == [], table.__name__


def vote(user, report_id, value):
    return Feedback(report_id=report_id, repo="octo/one", repo_key="octo/one", mode="rules",
                    days=7, generated_at="2026-10-01T00:00:00Z", verdict="viable", vote=value,
                    voter=f"user:{user}", user_id=user)


def test_feedback_comes_along_one_answer_per_report(h):
    add(h, vote("old", 1, "up"), vote("old", 2, "down"), vote("kept", 2, "up"))

    assert merge(h).status_code == 204

    got = rows(h, Feedback)
    assert sorted((f.report_id, f.vote, f.voter, f.user_id) for f in got) == [
        (1, "up", "user:kept", "kept"), (2, "up", "user:kept", "kept")]


# --- who may merge what -----------------------------------------------------------------


def test_signed_in_only(h):
    r = h.post("/v1/me/merge", {"from_user": "old", "github_id": GITHUB_ID})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_an_account_isnt_merged_into_itself(h):
    assert h.put("/v1/me/saved/octo/one", user="kept").status_code == 200

    r = merge(h, source="kept")

    assert r.status_code == 400
    assert saved(h, "kept") == ["octo/one"]


def refused(h, r):
    """Nothing moved: both accounts are as they were."""
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "invalid_request"
    assert saved(h, "old") == ["pallets/flask"]
    assert saved(h, "kept") == []
    assert account(h, "old") is not None


def test_a_github_account_connected_to_a_third_person_is_refused(h):
    set_user(h, "old")
    assert h.put("/v1/me/saved/pallets/flask", user="old").status_code == 200
    add(h, connection(user="someone-else"))

    refused(h, merge(h))
    assert h.get("/v1/me/github", user="someone-else").json()["connected"] is True


def test_an_account_connected_to_another_github_account_is_refused(h):
    """GitHub confirmed one account; `old` is connected to a different one."""
    set_user(h, "old")
    assert h.put("/v1/me/saved/pallets/flask", user="old").status_code == 200
    add(h, connection(github_id=42, login="someone"))

    refused(h, merge(h))


def test_the_kept_account_connected_to_another_github_account_is_refused(h):
    set_user(h, "old")
    assert h.put("/v1/me/saved/pallets/flask", user="old").status_code == 200
    add(h, connection(user="kept", github_id=42, login="someone"))

    refused(h, merge(h))


# --- twice, and half-way ----------------------------------------------------------------


def test_a_repeated_request_changes_nothing(h):
    set_user(h, "old", plan="pro", plan_expires_at=LATER, ai_credits=2)
    add(h, connection(), pull("old", "pallets/flask", 5432))
    assert h.put("/v1/me/saved/pallets/flask", user="old").status_code == 200
    assert merge(h).status_code == 204
    before = (h.get("/v1/me", user="kept").json(), h.get("/v1/me/github", user="kept").json(),
              saved(h, "kept"), len(rows(h, PlanEvent, "kept")))

    assert merge(h).status_code == 204

    after = (h.get("/v1/me", user="kept").json(), h.get("/v1/me/github", user="kept").json(),
             saved(h, "kept"), len(rows(h, PlanEvent, "kept")))
    assert after == before
    assert account(h, "old") is None


def live_subscription(user, n):
    return Subscription(user_id=user, plan_id="pro", provider="razorpay",
                        provider_subscription_id=f"sub_{n}", provider_plan_id="plan_1",
                        amount=19900, currency="INR", status="active")


def test_a_merge_that_cant_finish_leaves_both_accounts_as_they_were(h):
    """Two running monthly plans can't belong to one account: the last step
    fails, and everything before it is undone."""
    set_user(h, "old", ai_credits=4)
    assert h.put("/v1/me/saved/pallets/flask", user="old").status_code == 200
    add(h, live_subscription("old", 1), live_subscription("kept", 2), connection())

    refused(h, merge(h))

    assert account(h, "old").ai_credits == 4
    assert h.get("/v1/me/github", user="old").json()["connected"] is True
    assert len(rows(h, Subscription, "old")) == 1
