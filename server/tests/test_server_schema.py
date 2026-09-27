"""The typed report contract: derived fields are computed once, here, and
never disagree with the verdict."""

from __future__ import annotations

import itertools

import pytest
from conftest import canned_report
from holt_server import schema
from holt_server.db import Report


def stats(attempts: int, merged: int, no_reply: int) -> dict:
    return {"outsider_attempts": attempts, "outsider_merged": merged,
            "distinct_outsiders": attempts, "first_time_merged_authors": merged,
            "no_reply": no_reply, "median_first_response_hours": 2.0, "bot_share": 0.0}


def report(verdict: str, s: dict, decided_by=(), rule_codes=()) -> schema.Report:
    body = canned_report("o/r", verdict=verdict)
    body.update(stats=s, decided_by=list(decided_by), rule_codes=list(rule_codes))
    return schema.Report.model_validate(body)


def test_headline_and_tone_follow_the_verdict():
    assert report("viable", stats(10, 5, 1)).headline == "Worth your time"
    assert report("viable", stats(10, 5, 1)).tone == "good"
    assert report("not_viable", stats(10, 0, 9)).tone == "bad"
    assert report("insufficient_evidence", stats(0, 0, 0)).tone == "warn"


def test_a_stored_headline_is_ignored():
    body = canned_report("o/r", verdict="not_viable")
    body["headline"] = "Worth your time"
    assert schema.Report.model_validate(body).headline == "Not worth your time"


def test_odds_only_for_worth_your_time():
    """plantuml: rubber-stamped, 33 of 42 merged. The old web odds said "good"
    under "Not worth your time"."""
    plantuml = stats(42, 33, 6)
    assert report("not_viable", plantuml, ["33 merged...", "But only 18%..."],
                  ["merges", "rubber_stamp"]).odds is None
    assert report("insufficient_evidence", stats(3, 1, 1)).odds is None
    for a, m, n in itertools.product((1, 7, 40, 189), (0, 3, 20), (0, 10, 30)):
        if m > a or n > a:
            continue
        for verdict in ("not_viable", "insufficient_evidence"):
            assert report(verdict, stats(a, m, n)).odds is None


@pytest.mark.parametrize(("a", "m", "n", "level", "tone"), [
    (100, 40, 10, "good", "good"),
    (100, 10, 40, "fair", "warn"),
    (189, 5, 100, "long", "bad"),  # flask on the day the audit ran
    (100, 12, 25, "good", "good"),  # the thresholds are inclusive
    (100, 5, 50, "fair", "warn"),
])
def test_odds_levels(a, m, n, level, tone):
    odds = report("viable", stats(a, m, n)).odds
    assert (odds.level, odds.tone) == (level, tone)
    assert odds.text == schema.ODDS_TEXT[level]


def test_long_odds_name_the_weak_part():
    """react: 21 of 151 merged is fine; 107 without a reply is not."""
    odds = report("viable", stats(151, 21, 107)).odds
    assert odds.level == "long" and odds.text == schema.LONG_SILENT_TEXT
    assert "don't land" not in odds.text


def test_viable_line_is_honest_about_long_odds():
    line = report("viable", stats(189, 5, 100)).verdict_line
    assert line.startswith("Outside contributors do get merged here (5 of 189 recently)")
    assert "most pull requests don't land" in line and "about half get no reply" in line
    assert report("viable", stats(100, 40, 10)).verdict_line == (
        "Outside contributors get real replies here, and 40 of 100 of their recent "
        "pull requests were merged.")


def test_not_viable_line_names_the_rule_that_decided_it():
    rubber = report("not_viable", stats(42, 33, 6), ["33 merged.", "But only 18%."],
                    ["merges", "rubber_stamp"])
    assert rubber.verdict_line == schema.RUBBER_STAMP_LINE
    assert "Only 33 of 42" not in rubber.verdict_line
    archived = "The owners have archived this repository, so it no longer accepts contributions."
    assert report("not_viable", stats(0, 0, 0), [archived], ["archived"]).verdict_line == archived
    ignored = "30 of 40 pull requests from newcomers got no reply at all, and none were merged."
    assert report("not_viable", stats(40, 0, 30), [ignored], ["ignored"]).verdict_line == ignored


def test_reports_cached_before_rule_codes_still_read_right():
    rubber = report("not_viable", stats(42, 33, 6), ["33 merged.", "But only 18% of merged..."])
    assert rubber.verdict_line == schema.RUBBER_STAMP_LINE
    assert report("not_viable", stats(40, 0, 30)).verdict_line == (
        "None of the last 40 pull requests from outside contributors were merged.")


def test_find_stats_leave_out_what_the_finder_did_not_have():
    r = schema.FindResult.model_validate({"repo": "o/r", "verdict": "viable",
                                          "stats": {"outsider_merged": 4}})
    body = r.model_dump(mode="json")
    assert body["stats"] == {"outsider_merged": 4}
    assert body["headline"] == "Worth your time" and body["tone"] == "good"


def test_an_old_cached_report_is_served_with_derived_fields(h):
    old = canned_report("octo/one", verdict="not_viable")
    old["stats"] = stats(42, 33, 6)
    old["decided_by"] = ["33 merged.", "But only 18% of merged pull requests..."]

    async def store():
        async with h.svc.db.session() as s:
            s.add(Report(repo="octo/one", repo_key="octo/one", mode="rules", days=7, report=old))
            await s.commit()
    h.client.portal.call(store)
    for body in (h.get("/v1/reports/octo/one").json(),
                 h.post("/v1/analyses", {"repo": "octo/one"}).json()["report"]):
        assert body["headline"] == "Not worth your time" and body["tone"] == "bad"
        assert body["verdict_line"] == schema.RUBBER_STAMP_LINE
        assert body["odds"] is None and body["rule_codes"] == []


def test_openapi_describes_the_derived_fields(make_harness):
    h = make_harness(HOLT_ENV="dev")
    spec = h.get("/openapi.json").json()
    report_schema = spec["components"]["schemas"]["Report"]
    for field in ("headline", "tone", "verdict_line", "odds", "rule_codes"):
        assert field in report_schema["required"], field
    assert {"StarterIssue", "FindResult", "JobStatus", "ErrorBody"} <= set(spec["components"]["schemas"])
