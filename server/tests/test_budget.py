"""The reader's time budget (`days`): one GitHub read answers every budget.

Since ticket 08 a rules report's verdict is the same for any budget; only the
note saying replies are slow reads it. So a report for 14 or 30 days comes
from a fresh one for 7, with the note redone, instead of a second run.
"""

from __future__ import annotations

from holt.agent.verdict import slow_note
from holt_server.report import retime

MEDIAN = 277.5  # efcore: first replies take ~11.6 days


def live_report(days: int = 7, verdict: str = "viable") -> dict:
    lines = [("These numbers come from 396 pull requests.", "sample_period"),
             ("41 pull requests from outside contributors were merged.", "merges")]
    if verdict == "insufficient_evidence":
        lines = [lines[0], ("Only 1 pull request got merged.", "few_merges")]
    report = {
        "repo": "dotnet/efcore", "mode": "rules", "days": days, "verdict": verdict,
        "stats": {"outsider_attempts": 44, "outsider_merged": 41, "distinct_outsiders": 30,
                  "first_time_merged_authors": 12, "no_reply": 0,
                  "median_first_response_hours": MEDIAN, "bot_share": 0.1},
        "decided_by": [t for t, _ in lines], "rule_codes": [c for _, c in lines],
        "unknowns": [], "landing": [], "never_landed": [], "evidence": [],
        "evidence_until": None, "generated_at": "2026-09-28T00:00:00Z", "cost": None,
        "budget_independent": True,
    }
    return retime(report, days)


def test_retime_puts_the_note_after_the_merge_count_only_when_replies_are_slow():
    week = live_report(7)
    assert week["rule_codes"] == ["sample_period", "merges", "slow_note"]
    assert week["decided_by"][-1] == str(slow_note(MEDIAN, 7))
    fortnight = retime(week, 14)
    assert fortnight["days"] == 14 and fortnight["rule_codes"] == ["sample_period", "merges"]
    assert retime(fortnight, 7) == week
    assert "beyond your 1-day budget" in retime(week, 1)["decided_by"][-1]


def test_retime_puts_the_slow_line_before_the_thin_evidence_reason():
    week = live_report(7, "insufficient_evidence")
    assert week["rule_codes"] == ["sample_period", "slow", "few_merges"]
    assert "longer than the 7 days you have" in week["decided_by"][1]
    assert retime(week, 30)["rule_codes"] == ["sample_period", "few_merges"]


def test_older_reports_and_ai_reports_are_not_retimed():
    old = {**live_report(7), "budget_independent": False}
    assert retime(old, 14) is None
    assert retime({**live_report(7), "mode": "ai"}, 14) is None


def test_another_budget_is_served_from_the_same_read(h):
    h.svc.analysis_fn = lambda **kw: (h.engine.calls.append(kw), live_report(kw["days"]))[1]
    job = h.post("/v1/analyses", {"repo": "pallets/flask"}).json()["job_id"]
    assert h.wait(job)["status"] == "done"

    week = h.get("/v1/reports/pallets/flask?days=7").json()
    assert "Replies are slow here: typically 11.6 days, beyond your 7-day budget." in week["verdict_line"]
    fortnight = h.get("/v1/reports/pallets/flask?days=14").json()
    assert fortnight["days"] == 14 and fortnight["verdict"] == "viable"
    assert "slow" not in fortnight["verdict_line"]
    assert "slow_note" not in fortnight["rule_codes"]

    # Asking for an analysis at another budget doesn't read GitHub again.
    done = h.post("/v1/analyses", {"repo": "pallets/flask", "days": 30})
    assert done.status_code == 200 and done.json()["report"]["days"] == 30
    assert len(h.engine.calls) == 1
