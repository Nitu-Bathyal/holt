"""Free AI credits: the welcome grant, the weekly claim, spending and refunds."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from holt_server.db import CreditEvent, Job, User, now, utc
from holt_server.errors import ApiError
from sqlalchemy import select, update

AI = {"mode": "ai"}


def rows(h, model):
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(model))).scalars().all()
    return h.client.portal.call(q)


def ledger(h, user: str) -> list[tuple[str, int]]:
    return [(e.kind, e.amount) for e in sorted(rows(h, CreditEvent), key=lambda e: e.id)
            if e.user_id == user]


def set_user(h, user: str, **values) -> None:
    async def go():
        async with h.svc.db.session() as s:
            await s.execute(update(User).where(User.id == user).values(**values))
            await s.commit()
    h.client.portal.call(go)


def credits(h, user: str) -> dict:
    r = h.get("/v1/me/credits", user=user)
    assert r.status_code == 200, r.text
    return r.json()


def ai(h, repo: str, user: str):
    return h.post("/v1/analyses", {"repo": repo, **AI}, user=user)


def ago(days: float) -> datetime:
    return now() - timedelta(days=days)


# --- grant ------------------------------------------------------------------------


def test_new_user_gets_three_credits_once(h):
    c = credits(h, "new")
    assert c["balance"] == 3 and c["can_claim"] is False
    assert c["claim_every_days"] == 7 and c["ai_available"] is False
    # The welcome grant starts the claim clock.
    next_at = datetime.fromisoformat(c["next_claim_at"].replace("Z", "+00:00"))
    assert timedelta(days=6.99) < next_at - now() <= timedelta(days=7)
    for _ in range(3):
        assert credits(h, "new")["balance"] == 3
    assert h.get("/v1/me", user="new").json()["credits"]["balance"] == 3
    assert ledger(h, "new") == [("grant", 3)]


def test_user_from_before_credits_gets_them_on_next_visit(h):
    async def old_user():
        async with h.svc.db.session() as s:
            s.add(User(id="old", plan="free", ai_used=2, ai_period="2026-09"))
            await s.commit()
    h.client.portal.call(old_user)
    assert rows(h, User)[0].ai_credits == 0
    assert credits(h, "old")["balance"] == 3
    assert credits(h, "old")["balance"] == 3
    assert ledger(h, "old") == [("grant", 3)]


def test_concurrent_first_visits_grant_once(h):
    with ThreadPoolExecutor(6) as pool:
        bodies = list(pool.map(lambda _: h.get("/v1/me", user="twin"), range(6)))
    assert {b.status_code for b in bodies} == {200}
    assert credits(h, "twin")["balance"] == 3
    assert ledger(h, "twin") == [("grant", 3)]


def test_credits_need_a_signed_in_user_and_the_internal_key(h):
    assert h.get("/v1/me/credits").status_code == 401
    assert h.post("/v1/me/credits/claim").status_code == 401
    r = h.client.post("/v1/me/credits/claim", headers={"X-Holt-User": "u1"})
    assert r.status_code == 401


# --- claim ------------------------------------------------------------------------


def test_claim_before_seven_days_is_refused(h):
    credits(h, "c1")
    set_user(h, "c1", last_claim_at=ago(6.9))
    r = h.post("/v1/me/credits/claim", user="c1")
    assert r.status_code == 409 and r.json()["error"]["code"] == "claim_not_ready"
    assert "claimed on" in r.json()["error"]["message"]
    assert credits(h, "c1")["balance"] == 3
    assert ledger(h, "c1") == [("grant", 3)]


def test_claim_after_seven_days_gives_one_and_restarts_the_clock(h):
    credits(h, "c2")
    set_user(h, "c2", last_claim_at=ago(7.01))
    assert credits(h, "c2")["can_claim"] is True
    r = h.post("/v1/me/credits/claim", user="c2")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["balance"] == 4 and body["can_claim"] is False
    assert h.post("/v1/me/credits/claim", user="c2").status_code == 409
    assert ledger(h, "c2") == [("grant", 3), ("claim", 1)]


def test_claims_do_not_pile_up_while_away(h):
    credits(h, "away")
    set_user(h, "away", last_claim_at=ago(70))  # ten weeks away
    assert h.post("/v1/me/credits/claim", user="away").json()["balance"] == 4
    for _ in range(3):
        assert h.post("/v1/me/credits/claim", user="away").status_code == 409
    assert credits(h, "away")["balance"] == 4


def test_concurrent_claims_give_one_credit(h):
    credits(h, "race")
    set_user(h, "race", last_claim_at=ago(8))
    with ThreadPoolExecutor(6) as pool:
        codes = sorted(pool.map(
            lambda _: h.post("/v1/me/credits/claim", user="race").status_code, range(6)))
    assert codes == [200] + [409] * 5
    assert credits(h, "race")["balance"] == 4
    assert ledger(h, "race") == [("grant", 3), ("claim", 1)]


# --- spend and refund ---------------------------------------------------------------


def test_ai_reports_spend_credits_until_none_are_left(make_harness):
    h = make_harness(OPENROUTER_API_KEY="sk-or-server")
    for repo in ("octo/one", "octo/two", "octo/three"):
        r = ai(h, repo, "s1")
        assert r.status_code == 202
        assert h.wait(r.json()["job_id"])["status"] == "done"
    assert credits(h, "s1")["balance"] == 0
    r = ai(h, "octo/four", "s1")
    assert r.status_code == 402 and r.json()["error"]["code"] == "quota_exceeded"
    assert "claim" in r.json()["error"]["message"]
    assert credits(h, "s1")["balance"] == 0
    assert ledger(h, "s1") == [("grant", 3)] + [("spend", -1)] * 3
    # Each spend names its job; the refused request queued nothing.
    spent = {e.job_id for e in rows(h, CreditEvent) if e.kind == "spend"}
    assert spent == {j.id for j in rows(h, Job) if j.user_id == "s1"}
    assert len(spent) == 3
    # Quick reports never need a credit.
    assert h.post("/v1/analyses", {"repo": "octo/four"}, user="s1").status_code == 202


def test_last_credit_cannot_be_spent_twice(make_harness):
    h = make_harness(OPENROUTER_API_KEY="sk-or-server")
    credits(h, "last")
    set_user(h, "last", ai_credits=1)
    h.engine.gate.clear()
    try:
        repos = ["octo/one", "octo/two", "octo/three", "octo/four"]
        with ThreadPoolExecutor(4) as pool:
            codes = sorted(pool.map(lambda repo: ai(h, repo, "last").status_code, repos))
        assert codes == [202, 402, 402, 402]
        assert credits(h, "last")["balance"] == 0
    finally:
        h.engine.gate.set()


def test_failed_ai_report_gives_the_credit_back(make_harness):
    h = make_harness(OPENROUTER_API_KEY="sk-or-server")
    h.engine.error = ApiError("upstream", "model down")
    job = ai(h, "octo/one", "f1").json()["job_id"]
    assert h.wait(job)["status"] == "error"
    assert credits(h, "f1")["balance"] == 3
    assert ledger(h, "f1") == [("grant", 3), ("spend", -1), ("refund", 1)]


def test_jobs_from_the_old_monthly_quota_are_not_refunded_as_credits(make_harness):
    h = make_harness(run_jobs=False, OPENROUTER_API_KEY="sk-or-server")
    ai(h, "octo/one", "m1")
    job = h.client.portal.call(h.svc.runner._claim)
    job.params = {"ai_period": "2026-09"}  # queued by the release before credits
    h.client.portal.call(h.svc.runner._fail, job, ApiError("upstream", "x"))
    assert credits(h, "m1")["balance"] == 2


# --- AI switched off ------------------------------------------------------------------


def test_ai_without_a_server_key_says_so_and_spends_nothing(h):
    r = ai(h, "octo/one", "off")
    assert r.status_code == 503
    err = r.json()["error"]
    assert err["code"] == "ai_unavailable" and "switched on yet" in err["message"]
    assert credits(h, "off")["balance"] == 3
    assert credits(h, "off")["ai_available"] is False
    assert rows(h, Job) == []


def test_key_removed_while_queued_fails_cleanly_and_refunds(make_harness):
    h = make_harness(run_jobs=False, OPENROUTER_API_KEY="sk-or-server")
    ai(h, "octo/one", "gone")
    assert credits(h, "gone")["balance"] == 2
    h.svc.settings.openrouter_api_key = ""
    job = h.client.portal.call(h.svc.runner._claim)
    h.client.portal.call(h.svc.runner._run, job)
    body = h.get(f"/v1/analyses/{job.id}").json()
    assert body["status"] == "error" and body["error"]["code"] == "ai_unavailable"
    assert credits(h, "gone")["balance"] == 3


def test_claim_timestamps_are_utc(h):
    credits(h, "tz")
    user = [u for u in rows(h, User) if u.id == "tz"][0]
    assert utc(user.last_claim_at) == utc(user.credits_granted_at)
