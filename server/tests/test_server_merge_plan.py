"""The merge plan (holt_server/merge_plan.py) and its entitlement, against a
fake paid-features service.

The service is an httpx.MockTransport: nothing touches the network.
"""

from __future__ import annotations

import asyncio
import copy
import json
import threading
import time

from datetime import timedelta

import httpx
import pytest
from conftest import ROOT, canned_report
from holt_server import budget, engine, entitlements, merge_plan, pro
from holt_server.db import (
    ENGINE_VERSION,
    AiBudget,
    AiRun,
    CreditEvent,
    Job,
    MergePlan,
    PlanUsage,
    Report,
    StarterCache,
    User,
    now,
)
from sqlalchemy import select

from holt.agent import pipeline
from holt.evidence.fixtures import FixtureProvider
from holt.model import ReplayModel
from holt.types import T_CUTOFF, Window

KEY = "pro-secret-key-value"
URL = "http://pro:8000"
SRC = {"fact_id": "tests-8", "statement": "3 of 5 pull requests from outside contributors "
       "that touched tests/ were merged.", "seen": 3, "of": 5,
       "links": ["https://github.com/pallets/flask/pull/3876"]}

PRO_PLAN = {
    "repo": "pallets/flask",
    "version": 1,
    "cached": False,
    "recorded_on": "2026-09-27T20:04:55+00:00",
    "generated_at": "2026-09-30T12:00:00+00:00",
    "window": {"days": 365, "since": "2025-09-27"},
    "sample": {"merged": 50, "closed": 25, "merged_outside": 5, "closed_outside": 25},
    "note": "Only 5 merged pull requests from people outside the project turned up.",
    "archived": False,
    "verdict": {"verdict": "viable", "headline": "Worth your time", "tone": "good",
                "line": "Outside contributors get real replies here.",
                "numbers": [{"value": "5 of 8", "label": "outside PRs merged"}]},
    "call": {"text": "Pick a small change in `tests/` and write it yourself.",
             "sources": [SRC]},
    "steps": [
        {"title": "Pick #3696", "detail": "It is open and labelled docs.",
         "link": {"label": "#3696 on GitHub",
                  "url": "https://github.com/pallets/flask/issues/3696"},
         "copy": None, "sources": [SRC]},
        {"title": "Ask on the issue before you start", "detail": None, "link": None,
         "copy": {"label": "Comment to post", "text": "Hi! Is this still free?"},
         "sources": [SRC]},
    ],
    "merged": [{"value": "72", "unit": "lines", "label": "typical merged pull request",
                "seen": 38, "of": 50, "sources": [SRC]}],
    "closed": [{"reason": "Written with AI tools", "seen": 8, "of": 25,
                "quote": {"text": "See our policy.", "who": "davidism",
                          "url": "https://github.com/pallets/flask/pull/3874", "number": 3874},
                "examples": [{"number": 3874,
                              "url": "https://github.com/pallets/flask/pull/3874"}]}],
    "reviewers": {"people": [{"login": "davidism", "reviewed": 27, "of": 50,
                              "areas": ["tests/", "src/"]}], "sources": [SRC]},
    "ai": {"model": "openai/gpt-5-mini", "read_on": "2026-08-31T01:06:53Z", "threads": 12,
           "signals": [{"kind": "outsider_posture", "value": "welcoming",
                        "headline": "Welcoming", "text": "Most contributions get merged.",
                        "tone": "good", "url": "https://github.com/pallets/flask/pull/3637"}],
           "outcomes": [{"value": "merged_after_review", "count": 9}],
           "quotes": [{"text": "Open a PR from a branch.",
                       "url": "https://github.com/pallets/flask/pull/3701", "number": 3701,
                       "outcome": "closed_with_guidance"}]},
    "usage": {"prompt_tokens": 7400, "completion_tokens": 1900, "cost_usd": 0.0057, "ms": 30000},
}

ISSUES = [
    {"number": 3696, "title": "Improve the docs", "url": "https://github.com/pallets/flask/issues/3696",
     "labels": ["docs"], "why": ["Labelled docs"], "people": 1, "open_prs": 0},
    {"number": 7, "title": "Not this repo's", "url": "https://github.com/octo/one/issues/7",
     "labels": [], "why": [], "people": 0, "open_prs": 0},
]


class FakePro:
    """The service's POST /v1/merge-plan: answers with `answer`, records
    requests, and holds each request while `gate` is cleared."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.answer: httpx.Response = httpx.Response(200, json=PRO_PLAN)
        self.gate = threading.Event()
        self.gate.set()

    def bodies(self) -> list[dict]:
        return [json.loads(r.content) for r in self.requests]

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        while not self.gate.is_set():
            await asyncio.sleep(0.01)
        return self.answer


@pytest.fixture
def fake() -> FakePro:
    return FakePro()


def with_pro(h, fake: FakePro):
    asyncio.run(h.svc.pro.aclose())
    h.svc.pro = pro.ProClient(URL, KEY, transport=httpx.MockTransport(fake), retry_delay=0)
    return h


@pytest.fixture
def hp(make_harness, fake):
    h = with_pro(make_harness(HOLT_PRO_URL=URL, HOLT_PRO_KEY=KEY), fake)
    seed(h)
    return h


def call(h, fn, *args, **kw):
    async def go():
        return await fn(*args, **kw)

    return h.client.portal.call(go)


def rows(h, model, *where):
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(model).where(*where))).scalars().all()

    return h.client.portal.call(q)


def seed(h, repo: str = "pallets/flask", mode: str = "rules", issues=ISSUES) -> None:
    """A report the report page would show, and its starter issues."""
    async def go():
        async with h.svc.db.session() as s:
            report = canned_report(repo, mode)
            report["evidence"] = [{"id": "e1", "kind": "outsider_posture", "value": "welcoming",
                                   "text": "x" * 3000, "quote": None,
                                   "url": "https://github.com/pallets/flask/pull/1"}]
            s.add(Report(repo=repo, repo_key=repo.lower(), mode=mode, days=7, report=report,
                         engine_version=ENGINE_VERSION))
            if issues is not None and await s.get(StarterCache, repo.lower()) is None:
                s.add(StarterCache(repo_key=repo.lower(), repo=repo, issues=issues))
            await s.commit()

    call(h, go)


def state(h, repo: str = "pallets/flask", user: str | None = "u") -> dict:
    r = h.get(f"/v1/merge-plan/{repo}", user=user)
    assert r.status_code == 200, r.text
    return r.json()


def ask(h, user: str = "u", repo: str = "pallets/flask"):
    return h.post(f"/v1/me/merge-plan/{repo}", user=user)


def wait(h, job_id: str) -> dict:
    return h.wait(job_id, kind="merge-plan-jobs")


def made(h, user: str = "u") -> dict:
    r = ask(h, user)
    assert r.status_code == 202, r.text
    body = wait(h, r.json()["job_id"])
    assert body["status"] == "done", body
    return body


def free_left(h, user: str = "u") -> int | None:
    return state(h, user=user)["access"]["left"]


def plan_rows(h) -> list:
    return rows(h, PlanUsage, PlanUsage.feature == "merge_plan")


# --- off ---------------------------------------------------------------------------------


def test_without_the_service_merge_plans_are_off(h):
    assert state(h) == {"repo": "pallets/flask", "available": False, "access": None,
                        "plan": None, "job": None}
    r = ask(h)
    assert r.status_code == 501 and r.json()["error"]["code"] == "not_implemented"


def test_with_ai_off_nothing_is_charged_or_asked(make_harness, fake):
    # Production today: the service may be configured, but the AI budget is 0.
    h = with_pro(make_harness(HOLT_PRO_URL=URL, HOLT_PRO_KEY=KEY, HOLT_AI_BUDGET_USD=0), fake)
    seed(h)
    assert state(h)["available"] is False and state(h)["access"] is None
    r = ask(h)
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"
    assert rows(h, Job) == [] and plan_rows(h) == [] and fake.requests == []


def test_a_production_budget_without_the_owners_ok_stays_off(make_harness, fake):
    h = with_pro(make_harness(HOLT_PRO_URL=URL, HOLT_PRO_KEY=KEY, HOLT_ENV="production",
                              HOLT_AI_BUDGET_USD=5, HOLT_AI_BUDGET_OWNER_OK=False), fake)
    seed(h)
    assert state(h)["available"] is False
    assert ask(h).status_code == 503 and fake.requests == []


def test_signed_out_can_read_the_state_but_not_ask(hp):
    assert state(hp, user=None) == {"repo": "pallets/flask", "available": True,
                                    "access": None, "plan": None, "job": None}
    assert hp.post("/v1/me/merge-plan/pallets/flask").status_code == 401


# --- the free taste and Pro ---------------------------------------------------------------


def test_a_new_account_gets_three_free_merge_plans_and_no_ai_credits(make_harness, fake):
    # The shipped settings: no welcome AI credits, so nothing to claim either.
    h = with_pro(make_harness(HOLT_PRO_URL=URL, HOLT_PRO_KEY=KEY, HOLT_SIGNUP_AI_CREDITS=0),
                 fake)
    access = state(h, user="new")["access"]
    assert (access["allowed"], access["via"], access["cost"], access["left"]) == (
        True, "plan", 0, 3)
    assert access["left_this_month"] is None
    got = h.get("/v1/me/credits", user="new").json()
    assert (got["balance"], got["can_claim"], got["next_claim_at"]) == (0, False, None)
    r = h.post("/v1/me/credits/claim", user="new")
    assert r.status_code == 409 and r.json()["error"]["code"] == "claim_not_ready"


def test_existing_users_keep_their_ai_credits_and_get_the_free_plans(hp):
    # Same database, settings changed in place: a second harness would reset
    # the tables on Postgres.
    hp.get("/v1/me", user="old")  # welcomed under the old rules: 3 AI credits
    hp.svc.settings.signup_ai_credits = 0  # the new release
    got = hp.get("/v1/me/credits", user="old").json()
    assert (got["balance"], got["next_claim_at"] is not None) == (3, True)
    assert state(hp, user="old")["access"]["left"] == 3
    assert hp.get("/v1/me/credits", user="new").json()["balance"] == 0


def test_the_three_free_plans_run_out(hp, fake):
    seed(hp, "octo/one")
    seed(hp, "octo/two")
    for n, repo in ((2, "pallets/flask"), (1, "octo/one"), (0, "octo/two")):
        r = ask(hp, repo=repo)
        assert r.status_code == 202, r.text
        assert wait(hp, r.json()["job_id"])["status"] == "done"
        assert free_left(hp) == n
    r = ask(hp)
    assert r.status_code == 402 and r.json()["error"]["code"] == "quota_exceeded"
    assert r.json()["error"]["message"] == "You've used your free merge plans."
    access = state(hp)["access"]
    assert (access["allowed"], access["left"]) == (False, 0)
    assert len(fake.requests) == 3


def test_pro_gives_thirty_a_month_and_leaves_the_free_ones(hp, fake):
    call(hp, entitlements.set_plan, hp.svc, "u", "pro", expires_at=None, reason="t", actor="t")
    access = state(hp)["access"]
    assert (access["via"], access["left"], access["left_this_month"]) == ("plan", 30, 30)
    body = made(hp)
    assert body["plan"]["repo"] == "pallets/flask"
    access = state(hp)["access"]
    assert (access["left"], access["left_this_month"]) == (29, 29)
    usage = {r.period: r.used for r in plan_rows(hp)}
    assert usage == {entitlements.period(now()): 1}
    # The pass lapses: back to the free plan's three, untouched by Pro's use.
    call(hp, entitlements.set_plan, hp.svc, "u", "free", expires_at=None, reason="t",
         actor="t")
    assert free_left(hp) == 3


def test_pro_monthly_allowance_is_enforced(hp):
    call(hp, entitlements.set_plan, hp.svc, "u", "pro", expires_at=None, reason="t", actor="t")

    async def use_up():
        async with hp.svc.db.session() as s:
            s.add(PlanUsage(user_id="u", feature="merge_plan",
                            period=entitlements.period(now()), used=30))
            await s.commit()

    call(hp, use_up)
    r = ask(hp)
    assert r.status_code == 402
    assert "month" in r.json()["error"]["message"]
    assert rows(hp, Job) == []


# --- making one --------------------------------------------------------------------------


def test_a_plan_is_made_from_the_report_and_issues_and_kept(hp, fake):
    body = made(hp)
    plan = body["plan"]
    for gone in ("version", "cached", "archived", "usage"):
        assert gone not in plan
    assert "model" not in plan["ai"]
    assert "fact_id" not in plan["call"]["sources"][0]
    assert plan["steps"][1]["copy"] == {"label": "Comment to post",
                                        "text": "Hi! Is this still free?"}
    assert plan["verdict"]["headline"] == "Worth your time"

    sent = fake.bodies()[0]
    assert fake.requests[0].url.path == "/v1/merge-plan"
    assert fake.requests[0].headers["X-Holt-Pro-Key"] == KEY
    assert fake.requests[0].headers["X-Holt-User"] == "u"
    assert (sent["repo"], sent["days"], sent["refresh"]) == ("pallets/flask", 365, False)
    assert sent["report"]["repo"] == "pallets/flask" and sent["report"]["mode"] == "rules"
    assert len(sent["report"]["evidence"][0]["text"]) == 2000  # trimmed to what it accepts
    # Only this repository's issues, as the API serves them (with `on_it`).
    assert [i["number"] for i in sent["issues"]] == [3696]
    assert sent["issues"][0]["on_it"]

    # Kept for the user, and served back without the service.
    got = state(hp)
    assert got["plan"] == plan and got["job"] is None
    assert state(hp, user="someone-else")["plan"] is None
    assert len(fake.requests) == 1


def test_an_ai_report_is_sent_when_there_is_one(hp, fake):
    seed(hp, mode="ai")
    made(hp)
    assert fake.bodies()[0]["report"]["mode"] == "ai"


def test_no_report_costs_nothing(hp, fake):
    r = ask(hp, repo="octo/two")
    assert r.status_code == 404 and "no report" in r.json()["error"]["message"]
    assert rows(hp, Job) == [] and plan_rows(hp) == [] and fake.requests == []


def test_an_unknown_repository_costs_nothing(hp, fake):
    r = ask(hp, repo="nobody/nothing")
    assert r.status_code == 404
    assert plan_rows(hp) == [] and fake.requests == []


def test_a_second_click_waits_on_the_first_and_pays_once(hp, fake):
    fake.gate.clear()
    first = ask(hp)
    second = ask(hp)
    assert first.json()["job_id"] == second.json()["job_id"]
    assert state(hp)["job"]["job_id"] == first.json()["job_id"]
    fake.gate.set()
    assert wait(hp, first.json()["job_id"])["status"] == "done"
    assert free_left(hp) == 2


def test_the_job_streams_its_end(hp):
    r = ask(hp)
    job_id = r.json()["job_id"]
    wait(hp, job_id)
    events = hp.get(f"/v1/merge-plan-jobs/{job_id}/events").text
    assert "event: done" in events and '"plan"' in events and "gpt" not in events
    assert hp.get("/v1/merge-plan-jobs/nope").status_code == 404
    assert hp.get(f"/v1/analyses/{job_id}").status_code == 404


def test_the_ai_budget_counts_the_plans_cost(hp):
    made(hp)
    spent = rows(hp, AiBudget)[0].committed_micros
    assert spent == 5700


# --- refunds -----------------------------------------------------------------------------


@pytest.mark.parametrize("status,code,phrase", [
    (400, "invalid_request", "went wrong"),
    (401, "unauthorized", "unavailable"),
    (404, "not_found", ""),
    (500, "internal", "unavailable"),
    (502, "upstream", "didn't answer"),
    (503, "unavailable", "unavailable"),
])
def test_every_service_error_is_refunded(hp, fake, status, code, phrase):
    fake.answer = httpx.Response(status, json={"error": {"code": code, "message": "m"}})
    r = ask(hp)
    body = wait(hp, r.json()["job_id"])
    assert body["status"] == "error"
    assert phrase in body["error"]["message"]
    assert free_left(hp) == 3
    assert rows(hp, MergePlan) == []


def test_a_timeout_or_bad_answer_is_refunded(hp, fake):
    fake.answer = httpx.Response(200, json={"repo": "pallets/flask"})  # not a plan
    body = wait(hp, ask(hp).json()["job_id"])
    assert body["status"] == "error" and "count against" in body["error"]["message"]
    assert free_left(hp) == 3

    async def boom(request):
        raise httpx.ReadTimeout("slow", request=request)

    hp.svc.pro = pro.ProClient(URL, KEY, transport=httpx.MockTransport(boom), retry_delay=0)
    body = wait(hp, ask(hp).json()["job_id"])
    assert body["status"] == "error"
    assert free_left(hp) == 3


def test_a_pro_allowance_use_is_refunded_too(hp, fake):
    call(hp, entitlements.set_plan, hp.svc, "u", "pro", expires_at=None, reason="t", actor="t")
    fake.answer = httpx.Response(502, json={"error": {"code": "upstream", "message": "m"}})
    wait(hp, ask(hp).json()["job_id"])
    assert state(hp)["access"]["left_this_month"] == 30


def test_the_merge_plan_timeout_is_300_seconds(fake):
    seen = {}

    async def spy(request):
        seen["timeout"] = request.extensions["timeout"]
        return httpx.Response(200, json=PRO_PLAN)

    client = pro.ProClient(URL, KEY, transport=httpx.MockTransport(spy))
    asyncio.run(client.merge_plan("pallets/flask", {"repo": "pallets/flask"}, []))
    assert seen["timeout"]["read"] == 300.0 and seen["timeout"]["connect"] == 2.0


# --- the cached-plan rule ----------------------------------------------------------------


def test_asking_again_for_an_unchanged_plan_is_free(hp, fake):
    made(hp)
    assert free_left(hp) == 2
    # The service's cache: the very plan this user already has.
    fake.answer = httpx.Response(200, json={**PRO_PLAN, "cached": True, "usage": None})
    made(hp)
    assert free_left(hp) == 2
    assert len(rows(hp, MergePlan)) == 1


def test_a_plan_cached_from_someone_elses_request_still_costs_a_use(hp, fake):
    made(hp, user="first")
    fake.answer = httpx.Response(200, json={**PRO_PLAN, "cached": True, "usage": None})
    made(hp, user="second")
    assert free_left(hp, "second") == 2
    # And cost the budget nothing more.
    assert rows(hp, AiBudget)[0].committed_micros == 5700


def test_a_new_plan_replaces_the_old_one_and_costs_a_use(hp, fake):
    made(hp)
    newer = copy.deepcopy(PRO_PLAN)
    newer["generated_at"] = "2026-10-02T00:00:00+00:00"
    newer["call"]["text"] = "Something new."
    fake.answer = httpx.Response(200, json=newer)
    made(hp)
    assert free_left(hp) == 1
    assert state(hp)["plan"]["call"]["text"] == "Something new."
    assert len(rows(hp, MergePlan)) == 1


def test_a_kept_plan_still_shows_when_ai_is_switched_off(hp):
    made(hp)
    hp.svc.settings.ai_budget_usd = 0
    got = state(hp)
    assert got["available"] is False and got["plan"]["repo"] == "pallets/flask"


# --- inputs ------------------------------------------------------------------------------


def test_issues_for_pro_keeps_this_repos_best_twenty():
    many = [{"number": n, "title": "t", "url": f"https://github.com/Pallets/Flask/issues/{n}"}
            for n in range(1, 30)]
    got = merge_plan.issues_for_pro("pallets/flask", [{"bad": True}, *many])
    assert [i["number"] for i in got] == list(range(1, 21))


def test_a_welcome_of_zero_starts_no_claim_clock_and_writes_no_ledger_row(make_harness):
    h = make_harness(HOLT_SIGNUP_AI_CREDITS=0)
    h.get("/v1/me", user="n")
    user = rows(h, User, User.id == "n")[0]
    assert user.credits_granted_at is not None and user.last_claim_at is None
    assert user.ai_credits == 0
    assert rows(h, CreditEvent, CreditEvent.user_id == "n") == []


def test_waiting_jobs_show_in_the_state(hp, fake):
    fake.gate.clear()
    job_id = ask(hp).json()["job_id"]
    deadline = time.monotonic() + 5
    while state(hp)["job"] is None and time.monotonic() < deadline:
        time.sleep(0.02)
    assert state(hp)["job"]["job_id"] == job_id
    fake.gate.set()
    wait(hp, job_id)
    assert state(hp)["job"] is None


def test_an_allowance_is_monthly_in_all_or_unlimited_never_two():
    from holt_server import pricing
    from pydantic import ValidationError

    assert pricing.PlanFeature(total=3).limit == 3
    assert pricing.PlanFeature(per_month=30).limit == 30
    assert pricing.PlanFeature(unlimited=True).limit is None
    for bad in ({"total": 3, "per_month": 3}, {"total": 3, "unlimited": True}, {}):
        with pytest.raises(ValidationError):
            pricing.PlanFeature(**bad)
    shipped = pricing.load()
    assert shipped.plans["free"].features["merge_plan"].total == 3
    assert shipped.plans["pro"].features["merge_plan"].per_month == 30


# --- the AI budget's hold on a failure ---------------------------------------------------

# HOLT_AI_RUN_MAX_USD's default for the AI stages, and HOLT_AI_PRO_RUN_MAX_USD's
# for the service, in micro-dollars.
HOLD = 150_000


def committed(h) -> int:
    return rows(h, AiBudget)[0].committed_micros


@pytest.mark.parametrize("status,code,held", [
    (400, "invalid_request", 0),
    (401, "unauthorized", 0),
    (404, "not_found", 0),
    (503, "unavailable", 0),   # no model key, no GitHub token: before any model call
    (500, "internal", HOLD),   # it may have called the model
    (502, "upstream", HOLD),
])
def test_an_error_before_any_model_call_gives_the_hold_back(hp, fake, status, code, held):
    fake.answer = httpx.Response(status, json={"error": {"code": code, "message": "m"}})
    assert wait(hp, ask(hp).json()["job_id"])["status"] == "error"
    assert committed(hp) == held


def test_a_timeout_keeps_the_hold(hp):
    async def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    hp.svc.pro = pro.ProClient(URL, KEY, transport=httpx.MockTransport(slow), retry_delay=0)
    assert wait(hp, ask(hp).json()["job_id"])["status"] == "error"
    assert committed(hp) == HOLD


# --- what the AI found: the AI stages inside the job -------------------------------------

NIX = "NixOS/nixpkgs"
NIX_PLAN = {**PRO_PLAN, "repo": NIX}
TRAJECTORY = ROOT / "fixtures" / "trajectories" / "NixOS__nixpkgs.jsonl"


def replay(make_harness, fake: FakePro, **overrides):
    """A harness whose AI stages are the real engine over the committed
    fixtures, with the model's recorded answers: no network."""
    h = with_pro(make_harness(HOLT_PRO_URL=URL, HOLT_PRO_KEY=KEY,
                              OPENROUTER_API_KEY="sk-unused", **overrides), fake)
    h.svc.analysis_fn = engine.analyze
    h.svc.provider_factory = lambda repo, as_of: FixtureProvider(Window.PRE_T,
                                                                 root=ROOT / "fixtures")
    h.svc.model_factory = lambda spec: ReplayModel(TRAJECTORY)
    fake.answer = httpx.Response(200, json=NIX_PLAN)
    seed(h, NIX, issues=[])
    return h


def ask_nix(h, user: str = "u") -> dict:
    r = ask(h, user, repo=NIX)
    assert r.status_code == 202, r.text
    return wait(h, r.json()["job_id"])


def stages_heard(h) -> list[str]:
    heard: list[str] = []
    publish = h.svc.runner.hub.publish

    def spy(job_id, event, data):
        if event == "stage":
            heard.append(data["stage"])
        publish(job_id, event, data)

    h.svc.runner.hub.publish = spy
    return heard


def ai_reports(h, repo: str = NIX) -> list[Report]:
    return rows(h, Report, Report.repo_key == repo.lower(), Report.mode == "ai")


def test_with_no_ai_report_the_job_runs_the_ai_stages(make_harness, fake):
    h = replay(make_harness, fake)
    heard = stages_heard(h)
    body = ask_nix(h)
    assert body["status"] == "done", body

    # The service was sent a fresh AI report, with the model's verified findings.
    sent = fake.bodies()[0]["report"]
    assert sent["mode"] == "ai"
    kinds = {e["kind"] for e in sent["evidence"]}
    assert "outcome" in kinds
    # The verdict is the rules' own.
    rules, _ = pipeline.analyze_without_model(
        NIX, FixtureProvider(Window.PRE_T, root=ROOT / "fixtures"), 7, as_of=T_CUTOFF)
    assert sent["verdict"] == rules.verdict.value
    assert body["plan"]["ai"]["signals"]

    # Kept for anyone's next plan (and the report page).
    [kept] = ai_reports(h)
    assert kept.days == 7 and kept.engine_version == ENGINE_VERSION

    # Plain-English progress, the stages before the service.
    assert "Reading the pull request threads" in heard, heard
    assert heard.index("Reading the pull request threads") < heard.index(merge_plan.WRITING), heard
    assert not any("_" in stage for stage in heard)

    # One merge plan charged, and nothing else.
    assert state(h, NIX)["access"]["left"] == 2
    assert {u.feature for u in plan_rows(h)} == {"merge_plan"}
    assert rows(h, PlanUsage, PlanUsage.feature != "merge_plan") == []

    # Both costs count; the model is recorded internally and never sent.
    [run] = rows(h, AiRun)
    stages_usd = kept.report["cost"]["usd"]
    assert run.kind == "merge_plan" and run.reserved_micros == HOLD
    assert stages_usd > 0
    assert run.cost_micros == pytest.approx(budget.to_micros(stages_usd + 0.0057), abs=10)
    assert run.model and "gpt" in run.model
    events = h.get(f"/v1/merge-plan-jobs/{r_id(h)}/events").text
    assert "gpt" not in events and "gpt" not in json.dumps(state(h, NIX))


def r_id(h) -> str:
    return rows(h, Job, Job.kind == "merge_plan")[-1].id


def test_a_fresh_ai_report_made_by_anyone_is_reused(make_harness, fake):
    h = replay(make_harness, fake)
    seed(h, NIX, mode="ai", issues=None)
    calls = []
    h.svc.model_factory = lambda spec: calls.append(spec)
    assert ask_nix(h)["status"] == "done"
    assert calls == [] and len(ai_reports(h)) == 1
    assert fake.bodies()[0]["report"]["mode"] == "ai"
    # Only the service's cost was spent.
    assert rows(h, AiRun)[0].cost_micros == 5700


@pytest.mark.parametrize("age_hours,engine_version", [(30, ENGINE_VERSION),
                                                       (1, ENGINE_VERSION - 1)])
def test_an_old_ai_report_is_made_again(make_harness, fake, age_hours, engine_version):
    h = replay(make_harness, fake)

    async def old():
        async with h.svc.db.session() as s:
            s.add(Report(repo=NIX, repo_key=NIX.lower(), mode="ai", days=7,
                         report=canned_report(NIX, "ai"), engine_version=engine_version,
                         created_at=now() - timedelta(hours=age_hours)))
            await s.commit()

    call(h, old)
    assert ask_nix(h)["status"] == "done"
    assert len(ai_reports(h)) == 2
    assert fake.bodies()[0]["report"]["summary"] != "ok"  # the new one, not the canned one


def test_when_the_stages_fail_the_plan_is_made_without_ai(make_harness, fake):
    h = replay(make_harness, fake)

    def broken(spec):
        raise RuntimeError("the model is down")

    h.svc.model_factory = broken
    fake.answer = httpx.Response(200, json={**NIX_PLAN, "ai": None,
                                            "note": "Only 2 merged pull requests."})
    body = ask_nix(h)
    assert body["status"] == "done"
    assert fake.bodies()[0]["report"]["mode"] == "rules"
    assert body["plan"]["ai"] is None
    assert body["plan"]["note"] == f"Only 2 merged pull requests. {merge_plan.NO_AI}"
    assert ai_reports(h) == []
    # A plan was made, so it was charged; the stages spent nothing.
    assert state(h, NIX)["access"]["left"] == 2
    assert rows(h, AiRun)[0].cost_micros == 5700


def test_a_stage_failure_mid_run_counts_what_they_spent(make_harness, fake):
    h = replay(make_harness, fake)

    class Tired:
        """The recorded model, failing after its first answer."""

        def __init__(self) -> None:
            self.inner = ReplayModel(TRAJECTORY)
            self.usage = self.inner.usage

        def complete(self, **kw):
            if self.usage.calls:
                raise RuntimeError("the model went away")
            return self.inner.complete(**kw)

        def __getattr__(self, name):
            return getattr(self.inner, name)

    models: list[Tired] = []
    h.svc.model_factory = lambda spec: models.append(Tired()) or models[-1]
    fake.answer = httpx.Response(200, json={**NIX_PLAN, "ai": None, "note": None})
    body = ask_nix(h)
    assert body["status"] == "done" and body["plan"]["note"] == merge_plan.NO_AI
    assert ai_reports(h) == []
    spent = models[0].usage.cost_usd
    assert spent > 0
    assert rows(h, AiRun)[0].cost_micros == budget.to_micros(spent + 0.0057)


def test_when_the_service_fails_after_the_stages_the_plan_is_refunded(make_harness, fake):
    h = replay(make_harness, fake)
    fake.answer = httpx.Response(502, json={"error": {"code": "upstream", "message": "m"}})
    body = ask_nix(h)
    assert body["status"] == "error" and "count against" in body["error"]["message"]
    assert state(h, NIX)["access"]["left"] == 3
    # The AI report the stages made is kept: asking again reuses it.
    assert len(ai_reports(h)) == 1
    fake.answer = httpx.Response(200, json=NIX_PLAN)
    h.svc.model_factory = lambda spec: pytest.fail("the stages ran again")
    assert ask_nix(h)["status"] == "done"


def test_the_hold_covers_the_stages_and_the_service(make_harness, fake):
    h = replay(make_harness, fake)
    fake.gate.clear()
    job_id = ask(h, repo=NIX).json()["job_id"]
    assert committed(h) == HOLD
    fake.gate.set()
    wait(h, job_id)
    assert committed(h) == rows(h, AiRun)[0].cost_micros < HOLD
    assert budget.run_max_usd(h.svc.settings, budget.MERGE_PLAN) == pytest.approx(0.15)


def test_a_budget_too_small_for_both_refuses_the_plan(make_harness, fake):
    h = replay(make_harness, fake, HOLT_AI_BUDGET_USD=0.12)
    r = ask(h, repo=NIX)
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"
    assert state(h, NIX)["access"]["left"] == 3 and fake.requests == []


def test_the_time_limit_covers_the_stages_and_the_service(make_harness, fake):
    h = replay(make_harness, fake)
    assert merge_plan.time_limit(h.svc.settings) == 480 + 300 + 30
    job = Job(kind="merge_plan", repo=NIX, repo_key=NIX.lower(), mode="ai", days=365)
    assert h.svc.runner.timeout_for(job) == 810


def test_stages_past_their_limit_give_a_plan_without_ai(make_harness, fake):
    h = replay(make_harness, fake, HOLT_JOB_TIMEOUT_AI=0.5)
    h.svc.analysis_fn = h.engine  # the fake engine, held at its gate
    h.engine.gate.clear()
    fake.answer = httpx.Response(200, json={**NIX_PLAN, "ai": None, "note": None})
    try:
        body = ask_nix(h)
    finally:
        h.engine.gate.set()
    assert body["status"] == "done" and body["plan"]["note"] == merge_plan.NO_AI
    assert fake.bodies()[0]["report"]["mode"] == "rules"
    # The stages may still be running: all they may spend is counted.
    assert rows(h, AiRun)[0].cost_micros == 100_000 + 5700
    assert state(h, NIX)["access"]["left"] == 2
