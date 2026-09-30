"""The environment's hard cap on AI spend (holt_server/budget.py).

Every run holds its most expensive possible cost from the budget when it is
queued, so racing requests can't take the total past the cap; a run that
doesn't fit is refused before any credit moves. No network: the engine and
the paid-features service are fakes.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import httpx
import pytest
from holt.model import Usage
from holt_server import budget, credits, pro
from holt_server.db import AiBudget, AiRun, Job
from holt_server.errors import ApiError
from sqlalchemy import select

from conftest import canned_report, make_settings
from test_server_playbook import KEY, PRO_PLAYBOOK, URL, FakePro

ADMIN = "admin-1"
REPOS = ["octo/one", "octo/two", "octo/three", "octo/four", "pallets/flask", "NixOS/nixpkgs"]


def budgeted(make_harness, usd: float = 0.25, **kw):
    """A harness with AI on: a model key, a budget, $0.10 a report."""
    values = {"OPENROUTER_API_KEY": "sk-test", "OPENROUTER_MODEL": "openai/gpt-5-mini",
              "HOLT_AI_BUDGET_USD": usd, "HOLT_AI_BUDGET_OWNER_OK": False,
              "HOLT_ENV": "staging", "HOLT_AI_RUN_MAX_USD": 0.10,
              "HOLT_AI_PRO_RUN_MAX_USD": 0.05, "HOLT_ADMIN_USERS": ADMIN}
    return make_harness(**{**values, **kw})


def call(h, fn, *args, **kw):
    async def go():
        return await fn(*args, **kw)

    return h.client.portal.call(go)


def committed(h) -> float:
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(AiBudget.committed_micros))).scalar()

    return h.client.portal.call(q) / budget.MICROS


def runs(h) -> list[AiRun]:
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(AiRun).order_by(AiRun.id))).scalars().all()

    return h.client.portal.call(q)


def gift(h, user: str, n: int = 3) -> None:
    call(h, credits.grant, h.svc, user, n, pool="purchased", reason="test", actor="test")


def balance(h, user: str) -> int:
    return h.get("/v1/me/credits", user=user).json()["balance"]


def ai(h, repo: str, user: str, days: int = 7):
    return h.post("/v1/analyses", {"repo": repo, "mode": "ai", "days": days}, user=user)


def costing(usd: float):
    """An engine whose AI reports cost `usd`."""
    def run(*, repo, mode, days, provider, model, emit, as_of):
        report = canned_report(repo, mode, days)
        report["cost"] = {"model": "gpt-5-mini", "input_tokens": 1, "output_tokens": 1,
                          "usd": usd}
        return report
    return run


# --- on and off ------------------------------------------------------------------------


def test_no_budget_means_ai_is_off_and_costs_nothing(make_harness):
    h = budgeted(make_harness, usd=0)
    before = balance(h, "u1")
    r = ai(h, "octo/one", "u1")
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"
    assert "reason" not in r.json()["error"]  # off, not used up
    assert balance(h, "u1") == before
    assert h.get("/v1/me/credits", user="u1").json()["ai_available"] is False


def test_production_ignores_a_budget_without_the_owner_say_so(make_harness, caplog):
    with caplog.at_level(logging.ERROR, logger="holt_server.budget"):
        h = budgeted(make_harness, HOLT_ENV="production")
    assert ai(h, "octo/one", "u1").json()["error"]["code"] == "ai_unavailable"
    assert "without HOLT_AI_BUDGET_OWNER_OK=1" in caplog.text
    on = budgeted(make_harness, HOLT_ENV="production", HOLT_AI_BUDGET_OWNER_OK=True)
    assert on.svc.server_model_available()


def test_a_model_without_a_price_cant_be_capped_so_ai_stays_off(tmp_path):
    settings = make_settings(tmp_path, HOLT_AI_BUDGET_USD=1, HOLT_ENV="staging",
                             OPENROUTER_API_KEY="k", OPENROUTER_MODEL="some/model")
    level, line = budget.startup_line(settings)
    assert level == logging.ERROR and "no known price" in line


# --- the cap ---------------------------------------------------------------------------


def test_runs_past_the_budget_are_refused_before_any_credit_moves(make_harness):
    h = budgeted(make_harness, usd=0.25)  # two $0.10 holds fit, a third doesn't
    h.engine.gate.clear()  # hold the runs, so they hold the budget
    for user in ("u1", "u2", "u3"):
        gift(h, user)
    first, second = ai(h, "octo/one", "u1"), ai(h, "octo/two", "u2")
    assert first.status_code == second.status_code == 202
    before = balance(h, "u3")
    third = ai(h, "octo/three", "u3")
    assert third.status_code == 503
    body = third.json()["error"]
    assert body["code"] == "ai_unavailable" and "budget" in body["message"]
    assert "Nothing was charged" in body["message"]
    assert body["reason"] == "ai_budget_used_up"  # the web's "AI is paused" heading
    assert balance(h, "u3") == before
    assert committed(h) == pytest.approx(0.20)
    h.engine.gate.set()
    for r in (first, second):
        assert h.wait(r.json()["job_id"])["status"] == "done"


def test_a_finished_run_gives_back_what_it_didnt_spend(make_harness):
    h = budgeted(make_harness, usd=0.25)
    h.svc.analysis_fn = costing(0.0213)
    gift(h, "u1", 5)
    for repo in REPOS[:5]:  # five reports: more holds than fit at once, one at a time
        r = ai(h, repo, "u1")
        assert r.status_code == 202, r.text
        assert h.wait(r.json()["job_id"])["status"] == "done"
    assert committed(h) == pytest.approx(5 * 0.0213)
    done = runs(h)
    assert [(r.kind, r.cost_micros, r.estimated, r.model) for r in done] == [
        ("analysis", 21300, False, "openai/gpt-5-mini")] * 5
    spend = h.get("/v1/admin/ai-spend", user=ADMIN).json()
    assert spend["line"] == "AI spend: $0.11 of $0.25"
    assert (spend["runs"], spend["running"], spend["held_usd"]) == (5, 0, 0)


def test_a_failed_run_is_refunded_and_counts_what_its_model_spent(make_harness):
    h = budgeted(make_harness)
    h.engine.error = ApiError("upstream", "The AI model didn't answer.")
    gift(h, "u1")
    before = balance(h, "u1")
    r = ai(h, "octo/one", "u1")
    assert h.wait(r.json()["job_id"])["status"] == "error"
    assert balance(h, "u1") == before
    assert committed(h) == 0  # the fake model spent nothing
    assert runs(h)[0].settled_at is not None


def test_a_run_that_times_out_keeps_its_whole_hold(make_harness):
    h = budgeted(make_harness, HOLT_JOB_TIMEOUT_AI=0.2)
    h.engine.gate.clear()
    gift(h, "u1")
    r = ai(h, "octo/one", "u1")
    assert h.wait(r.json()["job_id"])["status"] == "error"
    h.engine.gate.set()
    assert committed(h) == pytest.approx(0.10)
    (run,) = runs(h)
    assert run.estimated and run.cost_micros == 100_000


def test_racing_requests_never_pass_the_budget(make_harness):
    h = budgeted(make_harness, usd=0.35)  # room for three $0.10 holds
    h.engine.gate.clear()
    users = [f"racer{i}" for i in range(12)]
    for user in users:
        gift(h, user)
    pairs = [(REPOS[i % 6], users[i], 7 if i < 6 else 14) for i in range(12)]
    with ThreadPoolExecutor(12) as pool:
        answers = list(pool.map(lambda p: ai(h, *p), pairs))
    accepted = [r for r in answers if r.status_code == 202]
    assert len(accepted) == 3
    assert {r.json()["error"]["code"] for r in answers if r.status_code != 202} == {
        "ai_unavailable"}
    assert committed(h) == pytest.approx(0.30)
    h.engine.gate.set()
    for r in accepted:
        h.wait(r.json()["job_id"])


def test_holds_taken_at_once_never_overshoot(make_harness):
    """The guarded UPDATE itself, 40 holds at once on the database (SQLite
    here; Postgres in CI, where it is a row lock)."""
    h = budgeted(make_harness, usd=1.00)
    settings = h.svc.settings

    async def one(i: int) -> bool:
        async with h.svc.db.session() as s:
            try:
                await budget.reserve(s, settings, f"job{i}", budget.PLAYBOOK)
            except ApiError:
                await s.rollback()
                return False
            await s.commit()
            return True

    async def race():
        return await asyncio.gather(*(one(i) for i in range(40)))

    won = h.client.portal.call(race)
    assert sum(won) == 20  # $1.00 / $0.05
    assert committed(h) == pytest.approx(1.00)
    assert len(runs(h)) == 20


def test_a_job_run_again_needs_a_new_hold(make_harness):
    h = budgeted(make_harness, usd=0.15)
    job = Job(id="j1", kind="analysis", mode="ai", repo="octo/one", repo_key="octo/one",
              days=7, params={})

    async def queue():
        async with h.svc.db.session() as s:
            await budget.reserve(s, h.svc.settings, "j1", budget.ANALYSIS)
            await s.commit()

    call(h, queue)
    call(h, budget.start, h.svc, job)  # claims the hold it was queued with
    assert committed(h) == pytest.approx(0.10)
    with pytest.raises(ApiError) as err:  # its process died; the rerun doesn't fit
        call(h, budget.start, h.svc, job)
    assert "budget" in err.value.message
    assert committed(h) == pytest.approx(0.10)


# --- the paid-features service ---------------------------------------------------------


@pytest.fixture
def hp(make_harness):
    fake = FakePro()
    h = budgeted(make_harness, usd=0.12, HOLT_PRO_URL=URL, HOLT_PRO_KEY=KEY)
    asyncio.run(h.svc.pro.aclose())
    h.svc.pro = pro.ProClient(URL, KEY, transport=httpx.MockTransport(fake), retry_delay=0)
    return h, fake


def test_a_playbook_holds_the_budget_and_settles_on_what_the_service_said(hp):
    h, fake = hp
    fake.answer = httpx.Response(200, json={
        **PRO_PLAYBOOK, "usage": {"model": "gpt-5-mini", "prompt_tokens": 20_000,
                                  "completion_tokens": 3_000, "cost_usd": None}})
    gift(h, "u1")
    r = h.post("/v1/me/playbook/pallets/flask", user="u1")
    assert r.status_code == 202, r.text
    assert h.wait(r.json()["job_id"], kind="playbook-jobs")["status"] == "done"
    # 20k in at $0.25/M and 3k out at $2/M
    assert committed(h) == pytest.approx(0.011)
    assert runs(h)[0].model == "gpt-5-mini"


def test_a_playbook_the_budget_cant_cover_is_refused_and_not_charged(hp):
    h, fake = hp
    fake.answer = httpx.Response(200, json=PRO_PLAYBOOK)  # says nothing about cost
    fake.gate.clear()
    gift(h, "u1")
    gift(h, "u2")
    first = h.post("/v1/me/playbook/pallets/flask", user="u1")
    second = h.post("/v1/me/playbook/octo/one", user="u2")
    assert first.status_code == second.status_code == 202
    before = balance(h, "u3")
    third = h.post("/v1/me/playbook/octo/two", user="u3")
    assert third.status_code == 503 and "budget" in third.json()["error"]["message"]
    assert balance(h, "u3") == before
    fake.gate.set()
    for r in (first, second):
        h.wait(r.json()["job_id"], kind="playbook-jobs")
    # Not known: each keeps its whole hold.
    assert committed(h) == pytest.approx(0.10)


def test_pro_cost_reads_what_the_service_says():
    assert budget.pro_cost({"cached": True}) == 0
    assert budget.pro_cost({"summary": {"model": None, "sentences": []}}) == 0
    assert budget.pro_cost({"usage": {"cost_usd": 0.004}}) == 0.004
    assert budget.pro_cost({"model": "gpt-5-mini",
                            "usage": {"prompt_tokens": 4_000, "completion_tokens": 1_000}}
                           ) == pytest.approx(0.003)
    assert budget.pro_cost({"usage": {"model": "some/model", "prompt_tokens": 1}}) is None
    assert budget.pro_cost({"cached": False}) is None


def test_pro_model_reads_which_model_the_service_used():
    assert budget.pro_model({"model": "openai/gpt-5-mini",
                             "usage": {"model": "gpt-5-mini-2025-08-07"}}) == "gpt-5-mini-2025-08-07"
    assert budget.pro_model({"model": "openai/gpt-5-mini"}) == "openai/gpt-5-mini"
    assert budget.pro_model({"summary": {"model": "gpt-5-mini", "sentences": []}}) == "gpt-5-mini"
    assert budget.pro_model({"summary": {"model": None, "sentences": []}}) is None
    assert budget.pro_model({"cached": True}) is None


# --- one report's model calls ----------------------------------------------------------


@dataclass
class FakeModel:
    """Each call costs what `cost` says, at gpt-5-mini's rates."""

    out_tokens: int = 1_000
    usage: Usage = field(default_factory=Usage)
    gate: threading.Event = field(default_factory=threading.Event)
    calls: int = 0

    def complete(self, *, label, system, prompt, schema):
        self.calls += 1
        self.gate.wait(5)
        self.usage.add("gpt-5-mini", 1_000, self.out_tokens, label=label)
        return {}


def ask(model, label: str = "classify"):
    return model.complete(label=label, system="s", prompt="p" * 3000, schema={})


def test_capped_refuses_a_call_that_could_pass_the_run_limit():
    inner = FakeModel()
    inner.gate.set()
    # classify may write 6,000 tokens: $0.012, plus ~$0.0003 of prompt.
    model = budget.Capped(inner, "gpt-5-mini", limit=0.03)
    ask(model)
    ask(model)  # ~$0.0022 each spent, well inside
    for _ in range(8):
        try:
            ask(model)
        except ApiError as err:
            assert err.code == "upstream" and "weren't charged" in err.message
            break
    assert inner.usage.cost_usd <= 0.03
    with pytest.raises(ApiError):
        ask(model, "outcomes")  # 12,000 tokens could cost $0.024 alone


def test_capped_waits_for_calls_still_out():
    """Stages run at once: a call still waiting on the model counts at its
    worst, and a call that fits only once it is done waits for it."""
    inner = FakeModel()  # held at the gate
    model = budget.Capped(inner, "gpt-5-mini", limit=0.02)
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(ask, model)
        while inner.calls < 1:
            threading.Event().wait(0.01)
        second = pool.submit(ask, model)  # ~$0.0123 out, and it could cost as much
        threading.Event().wait(0.2)
        assert inner.calls == 1 and not second.done()
        inner.gate.set()
        first.result(timeout=5)
        second.result(timeout=5)  # the first cost ~$0.0023: room again
    assert inner.calls == 2
    assert model._out == 0


def test_capped_refuses_a_model_without_a_price():
    with pytest.raises(ApiError):
        budget.Capped(FakeModel(), "some/model", limit=1)
