"""The real engine behind the API, over the committed replay fixtures."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from holt_server import engine, repos
from holt_server import report as report_mod
from holt_server.errors import ApiError

from holt.agent import pipeline
from holt.evidence.errors import AuthError, RateLimited, RepoNotFound, UpstreamError
from holt.evidence.fixtures import FixtureProvider
from holt.model import ReplayModel
from holt.report import Assessment, Claim, Verdict
from holt.types import T_CUTOFF, Window

ROOT = Path(__file__).resolve().parents[2]
REPO = "NixOS/nixpkgs"
TRAJECTORY = ROOT / "fixtures" / "trajectories" / "NixOS__nixpkgs.jsonl"


def fixture_provider(repo=None, as_of=None):
    return FixtureProvider(Window.PRE_T, root=ROOT / "fixtures")


def replay_harness(make_harness, **overrides):
    h = make_harness(OPENROUTER_API_KEY="sk-unused", **overrides)
    h.svc.analysis_fn = engine.analyze
    h.svc.provider_factory = fixture_provider
    h.svc.model_factory = lambda spec: ReplayModel(TRAJECTORY)
    return h


def check_report_shape(report: dict, mode: str) -> None:
    keys = {"repo", "mode", "days", "verdict", "headline", "bottom_line", "summary", "stats",
            "decided_by", "unknowns", "landing", "never_landed", "evidence",
            "evidence_until", "generated_at", "cost", "rule_codes", "tone",
            "verdict_line", "odds", "sample", "asks", "numbers_line", "first_timer_line",
            "next_step", "stat_line", "counted", "holt_users", "budget_independent",
            "outdated", "about"}
    assert set(report) == keys
    # The committed fixtures are a frozen capture read with the benchmark's
    # rules, where the budget can move the verdict: never served for another
    # budget (live reports are; server/tests/test_budget.py).
    assert report["budget_independent"] is False
    assert report["sample"]["pull_requests"] >= report["stats"]["outsider_attempts"]
    for entry in report["counted"]:
        assert set(entry) == {"topic", "text"}
    assert len(report["rule_codes"]) == len(report["decided_by"])
    assert report["repo"] == REPO and report["mode"] == mode
    assert report["verdict"] in ("viable", "long_shot", "not_viable", "insufficient_evidence", "personal")
    assert set(report["stats"]) == {
        "outsider_attempts", "outsider_merged", "distinct_outsiders",
        "first_time_merged_authors", "no_reply", "median_first_response_hours", "bot_share",
        "still_open", "closed_silently", "closed_by_bot", "withdrawn", "too_old"}
    for item in report["evidence"]:
        assert item["url"].startswith("https://github.com/"), item
        assert set(item) == {"id", "url", "kind", "value", "text", "quote"}
    for area in report["landing"]:
        assert set(area) == {"path", "merged", "attempted", "is_file"}
    for area in report["never_landed"]:
        assert set(area) == {"path", "attempted", "is_file"}
    assert report["evidence_until"] == "2026-06-01T00:00:00Z"
    # What a beginner reads is plain English. (`kind`/`value` are machine keys.)
    prose = " ".join([report["headline"], report["verdict_line"], report["numbers_line"],
                      report["next_step"], report["first_timer_line"] or "",
                      *(c["text"] for c in report["counted"]),
                      (report["odds"] or {}).get("text", ""), report["bottom_line"] or "",
                      report["summary"] or "", *report["decided_by"],
                      *report["unknowns"], *(e["text"] for e in report["evidence"])])
    for jargon in ("not_viable", "long_shot", "MCC", "repo_kind", "insufficient_evidence"):
        assert jargon not in prose


def test_rules_report_end_to_end(make_harness):
    h = replay_harness(make_harness)
    job = h.post("/v1/analyses", {"repo": "nixos/NIXPKGS"}).json()["job_id"]
    body = h.wait(job)
    assert body["status"] == "done", body
    report = body["report"]
    check_report_shape(report, "rules")

    expected, trace = pipeline.analyze_without_model(
        REPO, fixture_provider(), 7, as_of=T_CUTOFF)
    assert report["verdict"] == expected.verdict.value
    assert report["stats"]["outsider_attempts"] == trace.signals.outsider_judgeable
    assert report["summary"] is None and report["cost"] is None
    assert report["bottom_line"] is None  # the verdict block already says it
    assert report["landing"], "nixpkgs has well-known landing areas"
    # Even with no AI, the counts come with pull requests to click through to.
    values = [e["value"] for e in report["evidence"] if e["kind"] == "outsider_pr"]
    assert values.count("merged") == 4 and values.count("no_reply") == 4
    assert all("/pull/" in e["url"] for e in report["evidence"])
    assert report["decided_by"]


def test_ai_report_end_to_end(make_harness):
    h = replay_harness(make_harness)
    job = h.post("/v1/analyses", {"repo": REPO, "mode": "ai"}, user="u1").json()["job_id"]
    body = h.wait(job)
    assert body["status"] == "done", body
    report = body["report"]
    check_report_shape(report, "ai")
    assert report["summary"]
    assert report["evidence"], "replayed run cites evidence"
    assert report["cost"]["input_tokens"] > 0
    assert isinstance(report["cost"]["usd"], float) and report["cost"]["usd"] >= 0
    assert isinstance(report["cost"]["seconds"], float) and report["cost"]["seconds"] >= 0
    assert report["bottom_line"] is None or isinstance(report["bottom_line"], str)
    assert any(e["kind"] == "outcome" for e in report["evidence"])
    assert all(e["url"].startswith("https://github.com/NixOS/nixpkgs")
               for e in report["evidence"])


# --- serializer ---------------------------------------------------------------


def test_evidence_cards_read_plainly():
    records = {}
    item = report_mod.evidence_item(Claim(
        "Merged after review — “thanks, merging”", "pr:o/r#5:opened",
        kind="outcome", value="merged_after_review", quote="thanks, merging"), records)
    assert item == {"id": "pr:o/r#5:opened", "url": "https://github.com/o/r/pull/5",
                    "kind": "outcome", "value": "merged_after_review",
                    "text": "Merged after review", "quote": "thanks, merging"}
    item = report_mod.evidence_item(Claim(
        "Closed with no explanation", "pr:o/r#6:opened",
        kind="outcome", value="closed_dismissive"), records)
    assert item["quote"] is None and item["text"] == "Closed with no explanation"
    item = report_mod.evidence_item(Claim(
        "Contributor guide: generic, with little to follow (AI's reading, not a quote: "
        "CONTRIBUTING only restates the code of conduct)", "repo:o/r:contributing",
        kind="onboarding", value="boilerplate",
        note="CONTRIBUTING only restates the code of conduct"), records)
    assert (item["kind"], item["value"], item["text"]) == (
        "onboarding", "boilerplate",
        "Generic, with little to follow. CONTRIBUTING only restates the code of conduct")
    assert item["url"] == "https://github.com/o/r"
    assert report_mod.evidence_item(Claim("x", None), records) is None
    item = report_mod.evidence_item(
        Claim("Archived: yes", "repo:o/r:meta", kind="is_archived", value="True"), records)
    assert (item["kind"], item["value"], item["text"]) == ("is_archived", "True", "Yes.")
    # A hand-built claim with nothing structured is shown as written.
    item = report_mod.evidence_item(Claim("a note", "repo:o/r:meta"), records)
    assert (item["kind"], item["value"], item["text"]) == ("claim", None, "a note")


def test_ai_all_claims_dropped_is_stated():
    from holt.agent.signals import compute

    a = Assessment(repo="o/r", verdict=Verdict.VIABLE, summary="s", claims=[],
                   dropped_claims=3, limits="Could not tell X.\nCould not tell Y.",
                   as_of=datetime(2026, 6, 1, tzinfo=UTC))
    out = report_mod.build(repo="o/r", mode="ai", assessment=a, signals=compute({}),
                           records=[], cost=None)
    assert out["unknowns"][0] == report_mod.ALL_DROPPED_UNKNOWN
    assert "Could not tell X." in out["unknowns"]
    assert out["headline"] == "Worth your time"


def test_bottom_line_only_in_ai_mode():
    from holt.agent.signals import compute

    a = Assessment(repo="o/r", verdict=Verdict.VIABLE, summary="s",
                   bottom_line="You'd likely get a reply. Start small.")
    ai = report_mod.build(repo="o/r", mode="ai", assessment=a, signals=compute({}), records=[])
    assert ai["bottom_line"] == "You'd likely get a reply. Start small."
    rules = report_mod.build(repo="o/r", mode="rules", assessment=a, signals=compute({}),
                             records=[])
    assert rules["bottom_line"] is None
    empty = Assessment(repo="o/r", verdict=Verdict.VIABLE, summary="s", bottom_line="")
    assert report_mod.build(repo="o/r", mode="ai", assessment=empty, signals=compute({}),
                            records=[])["bottom_line"] is None


def test_reports_cached_before_new_fields_still_validate():
    from holt_server import schema

    old = {"repo": "o/r", "mode": "ai", "days": 7, "verdict": "viable", "summary": "s",
           "stats": {"outsider_attempts": 1, "outsider_merged": 1, "distinct_outsiders": 1,
                     "first_time_merged_authors": 1, "no_reply": 0,
                     "median_first_response_hours": 1.0, "bot_share": 0.0},
           "generated_at": "2026-09-01T00:00:00Z",
           "cost": {"model": "m", "input_tokens": 1, "output_tokens": 1}}
    out = schema.Report.model_validate(old).model_dump(mode="json")
    assert out["bottom_line"] is None
    assert out["cost"]["usd"] is None and out["cost"]["seconds"] is None


def test_ai_cost_records_dollars_seconds_and_logs_one_line(caplog):
    from types import SimpleNamespace

    from holt.model import Usage

    m = SimpleNamespace(usage=Usage())
    m.usage.add("openai/gpt-5-mini", 12000, 3000)
    m.usage.cost_usd = 0.0123456
    timings = {"classify": 1.31, "narrate": 3.5, "total": 9.87}
    with caplog.at_level("INFO", logger="holt_server.engine"):
        cost = engine.ai_cost("o/r", m, timings)
    assert cost == {"model": "openai/gpt-5-mini", "input_tokens": 12000,
                    "output_tokens": 3000, "usd": 0.01235, "seconds": 9.9}
    (line,) = [r.getMessage() for r in caplog.records]
    for part in ("o/r", "openai/gpt-5-mini", "input_tokens=12000", "output_tokens=3000",
                 "usd=0.01235", "total=9.9s", "classify=1.3s", "narrate=3.5s"):
        assert part in line, line
    # Before the engine records timings, the report still has the fields.
    assert engine.ai_cost("o/r", m, {})["seconds"] == 0.0


def test_claim_without_url_is_left_out():
    item = report_mod.evidence_item(Claim("a: b", "weird-id"), {})
    assert item is None
    a = Assessment(repo="o/r", verdict=Verdict.VIABLE, summary="",
                   claims=[Claim("a: b", "weird-id")])
    from holt.agent.signals import compute

    out = report_mod.build(repo="o/r", mode="rules", assessment=a, signals=compute({}),
                           records=[])
    assert out["evidence"] == []


# --- progress ------------------------------------------------------------------


def test_progress_never_goes_backwards_and_holds_done():
    seen = []
    p = engine.Progress(lambda s, v: seen.append((s, v)))
    p("A", 0.5)
    p("B", 0.2)
    p("B", 0.2)
    p("C", 1.5)
    p("Done", 1.0)
    assert seen == [("A", 0.5), ("B", 0.5), ("C", 0.99)]


def test_engine_stages_reach_the_job():
    calls = []
    report = engine.analyze(repo=REPO, mode="rules", days=7, provider=fixture_provider(),
                            model=None, emit=lambda s, v: calls.append((s, v)),
                            as_of=T_CUTOFF)
    stages = [s for s, _ in calls]
    assert stages[0] == "Fetching pull requests"
    assert stages[-1] == engine.FINAL_STAGE and "Done" not in stages
    assert [v for _, v in calls] == sorted(v for _, v in calls)
    assert report["repo"] == REPO


class Failing:
    def __init__(self, exc):
        self.exc = exc

    def fetch(self, repo):
        raise self.exc


@pytest.mark.parametrize("exc, code, retry", [
    (RepoNotFound("o/r"), "not_found", None),
    (RateLimited(42.4), "rate_limited", 42),
    (RateLimited(None), "rate_limited", 600),
    (AuthError("401"), "upstream", None),
    (UpstreamError("HTTP 502"), "upstream", None),
    (ZeroDivisionError(), "internal", None),
])
def test_engine_errors_map_to_api_codes(exc, code, retry):
    with pytest.raises(ApiError) as err:
        engine.analyze(repo="o/r", mode="rules", days=7, provider=Failing(exc), model=None,
                       emit=lambda *a: None, as_of=T_CUTOFF)
    assert (err.value.code, err.value.retry_after) == (code, retry)
    assert "GITHUB_TOKEN" not in err.value.message


# --- small pieces ----------------------------------------------------------------


@pytest.mark.parametrize("raw", [
    "pallets/flask", "https://github.com/pallets/flask", "github.com/pallets/flask.git",
    "https://github.com/pallets/flask/tree/main/src?tab=readme", "http://www.github.com/pallets/flask/",
    "git@github.com:pallets/flask.git", "  pallets/flask  ",
])
def test_repo_normalisation(raw):
    assert repos.normalize(raw) == "pallets/flask"


@pytest.mark.parametrize("raw", ["", "flask", "https://gitlab.com", "a b/c", "-x/y", "o/..",
                                 "https://github.com/pallets"])
def test_repo_rejects(raw):
    with pytest.raises(ApiError) as err:
        repos.normalize(raw)
    assert err.value.code == "invalid_repo"


def test_rate_limiter_window():
    from holt_server.ratelimit import RateLimiter

    t = [0.0]
    rl = RateLimiter(clock=lambda: t[0])
    rl.hit("k", 2)
    rl.hit("k", 2)
    with pytest.raises(ApiError) as err:
        rl.hit("k", 2)
    assert err.value.retry_after == 3600
    t[0] = 3601
    rl.hit("k", 2)


def test_rate_limiter_forgets_idle_keys():
    from holt_server.ratelimit import RateLimiter

    t = [0.0]
    rl = RateLimiter(clock=lambda: t[0])
    for i in range(50):
        rl.hit(f"ip:{i}", 5)
    t[0] = 4000
    rl.hit("ip:new", 5)
    assert len(rl) == 1


def test_model_spec_hides_the_key():
    from holt_server.llm import ModelSpec

    assert "sk-secret" not in repr(ModelSpec("openrouter", "m", "sk-secret"))
