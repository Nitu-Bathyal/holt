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
    assert line.startswith("Outside contributors do get merged here, but")
    assert "most of their pull requests don't land" in line and "about half get no reply" in line
    assert report("viable", stats(100, 40, 10)).verdict_line == (
        "Outside contributors get real replies here, and their work gets merged.")


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


# --- the top of the report (ticket 19) ---------------------------------------------

SAMPLE = {"pull_requests": 200, "first_opened": "2026-06-03T10:00:00Z",
          "last_opened": "2026-09-26T09:00:00Z", "team_pull_requests": 40,
          "team_people": 9, "bot_pull_requests": 12}


def top(verdict: str, s: dict, decided_by=(), rule_codes=(), **extra) -> schema.Report:
    body = canned_report("o/r", verdict=verdict)
    body.update(stats=s, decided_by=list(decided_by), rule_codes=list(rule_codes), **extra)
    return schema.Report.model_validate(body)


def test_numbers_line_carries_the_dates_and_the_same_counts():
    r = top("viable", stats(120, 22, 30), sample=SAMPLE)
    assert r.numbers_line == (
        "Of 120 pull requests from outside contributors (3 Jun – 26 Sep 2026), 22 were "
        "merged (18%). When a maintainer replied, it was typically within 2 hours. "
        "25% got no reply at all.")
    assert r.stat_line == "22 of 120 outside PRs merged"


def test_numbers_line_without_a_sample_or_replies():
    s = stats(10, 0, 10) | {"median_first_response_hours": None}
    assert top("not_viable", s).numbers_line == (
        "Of 10 pull requests from outside contributors, 0 were merged (0%). "
        "No maintainer replied to any of them. 100% got no reply at all.")
    assert top("insufficient_evidence", stats(0, 0, 0)).numbers_line == (
        "Nobody outside the project's team opened a pull request.")
    assert top("insufficient_evidence", stats(0, 0, 0)).stat_line is None


def test_period_spans_years_and_single_days():
    one = schema.Sample(**(SAMPLE | {"first_opened": "2026-09-26T01:00:00Z"}))
    assert schema.period(one) == "26 Sep 2026"
    two = schema.Sample(**(SAMPLE | {"first_opened": "2025-10-22T01:00:00Z"}))
    assert schema.period(two) == "22 Oct 2025 – 26 Sep 2026"


def test_first_timer_line():
    assert top("viable", stats(50, 9, 3)).first_timer_line == (
        "9 people got their first pull request merged here.")
    assert top("viable", stats(50, 1, 3)).first_timer_line == (
        "1 person got their first pull request merged here.")
    assert top("not_viable", stats(50, 0, 3)).first_timer_line == (
        "Nobody got their first pull request merged here in this period.")
    assert top("insufficient_evidence", stats(0, 0, 0)).first_timer_line is None


def test_next_step_names_where_work_lands_and_what_is_asked():
    landing = [{"path": "(root)", "merged": 9, "attempted": 10},
               {"path": "docs/guide", "merged": 3, "attempted": 4},
               {"path": "src/core", "merged": 12, "attempted": 60}]
    never = [{"path": "src/api", "attempted": 2}, {"path": "src/engine", "attempted": 14}]
    asks = [{"code": "cla", "url": "https://github.com/o/r/pull/1"},
            {"code": "issue_first", "url": "https://github.com/o/r/blob/x/CONTRIBUTING.md"}]
    r = top("viable", stats(80, 20, 5), landing=landing, never_landed=never, asks=asks)
    assert r.next_step == (
        "Best bet: a small change in src/core, where 12 of 60 outside pull requests were "
        "merged. Nothing from outside landed in src/engine (14 tried). "
        + schema.ASK_STEP["cla"] + " " + schema.ASK_STEP["issue_first"])
    # Two merges in a folder is luck, not a place to aim for.
    thin = top("viable", stats(80, 20, 5), landing=[{"path": "a/b", "merged": 2, "attempted": 3}])
    assert thin.next_step.startswith("Best bet: a small, focused change")


def test_next_step_follows_the_rule_that_decided():
    rubber = top("not_viable", stats(42, 33, 6), ["33 merged.", "But only 18%."],
                 ["merges", "rubber_stamp"])
    assert rubber.next_step == schema.NOT_VIABLE_STEP["rubber_stamp"]
    archived = top("not_viable", stats(0, 0, 0), ["Archived."], ["archived"])
    assert archived.next_step == schema.NOT_VIABLE_STEP["archived"]
    assert top("not_viable", stats(40, 0, 30), ["Ignored."], ["ignored"]).next_step == (
        schema.NOT_VIABLE_DEFAULT_STEP)
    assert top("insufficient_evidence", stats(3, 1, 1)).next_step == schema.INSUFFICIENT_STEP


def test_an_informational_line_last_never_reads_as_the_reason():
    """react-native: the off-button line comes after the deciding rule."""
    ignored = "30 of 40 pull requests from outside contributors got no reply at all."
    landed = "All merged pull requests ... are counted as merged here."
    r = top("not_viable", stats(40, 0, 30), [ignored, landed], ["ignored", "landed_off_button"])
    assert r.verdict_line == ignored
    rubber = top("not_viable", stats(42, 33, 6), ["33 merged.", "But only 18%.", landed],
                 ["merges", "rubber_stamp", "landed_off_button"])
    assert rubber.verdict_line == schema.RUBBER_STAMP_LINE
    assert rubber.next_step == schema.NOT_VIABLE_STEP["rubber_stamp"]


def test_how_this_was_counted():
    landed = "All merged pull requests were landed by a merge bot."
    r = top("viable", stats(120, 22, 30), ["22 merged, out of 120.", landed],
            ["merges", "landed_off_button"], sample=SAMPLE | {"bot_pull_requests": 0})
    topics = [c.topic for c in r.counted]
    assert topics == ["What we read", "The team and outside contributors", "Bots",
                      "Merges GitHub shows as closed", "What decided it", "The rule"]
    by = {c.topic: c.text for c in r.counted}
    assert by["What we read"] == "200 pull requests on GitHub, opened 3 Jun – 26 Sep 2026."
    assert by["The team and outside contributors"].startswith(
        "40 of them came from 9 people on the project's team")
    assert by["Bots"].startswith("No pull requests were opened by bots.")
    assert by["What decided it"] == "22 merged, out of 120."
    assert "no AI chooses the verdict" in by["The rule"]
    # A report cached before `sample` existed still says what it can.
    old = top("viable", stats(120, 22, 30), evidence_until="2026-09-26T00:00:00Z")
    assert old.counted[0].text == "The newest pull requests on GitHub, up to 26 Sep 2026."


def test_numbers_line_keeps_still_open_and_silent_closes_apart():
    """pytorch after ticket 06: most outside pull requests are too new to judge."""
    s = stats(18, 7, 0) | {"still_open": 42, "closed_silently": 5}
    assert top("viable", s, sample=SAMPLE).numbers_line == (
        "Of 18 pull requests from outside contributors (3 Jun – 26 Sep 2026) that have had "
        "time for an answer, 7 were merged (39%). When a maintainer replied, it was "
        "typically within 2 hours. 28% were closed without a word. Another 42 were opened "
        "in the last 14 days, too recently to count.")
    fresh = stats(0, 0, 0) | {"still_open": 3}
    assert top("insufficient_evidence", fresh).numbers_line == (
        "Outside contributors opened 3 pull requests, all in the last 14 days, too recently "
        "to judge.")
