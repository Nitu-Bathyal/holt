"""How long it takes here (engine 7): `stats.timing`, the stale bot's ask, and
the derived `how_long` lines."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from conftest import STATS, canned_report
from holt.types import EvidenceRecord
from holt_server import report as report_mod
from holt_server import schema

from holt.report import Assessment, Verdict


def served(timing: dict | None, median: float | None = 14.0, asks=()) -> schema.Report:
    body = canned_report("o/r")
    body["stats"] = {**STATS, "median_first_response_hours": median, "timing": timing}
    body["asks"] = list(asks)
    return schema.Report.model_validate(body)


def lines(r: schema.Report) -> dict[str, str]:
    return {c.topic: c.text for c in r.how_long}


def test_the_block_in_plain_words():
    r = served({"first_reply_slow_hours": 70.2, "merged_within_7_days": 0.52,
                "merged_within_30_days": 0.8, "stale_bot": True, "stale_close_days": 37})
    assert lines(r) == {
        "first reply": "Typically 14 hours. Most get one within 3 days.",
        "merged": "About half within a week, most within a month.",
        "closed if quiet": "A bot closes pull requests after 37 quiet days.",
    }


def test_the_same_share_is_said_once():
    r = served({"merged_within_7_days": 0.8, "merged_within_30_days": 0.9})
    assert lines(r)["merged"] == "Most within a week."


def test_half_when_most_never_get_a_reply():
    r = served({"first_reply_half_hours": 30.0, "first_reply_slow_hours": None})
    assert lines(r) == {"first reply": "About half get one within 2 days."}


def test_bursts_name_the_last_outside_merge():
    r = served({"merges_in_bursts": True, "last_outside_merge": "2026-09-14"})
    assert lines(r)["rhythm"] == "In bursts. The last outside merge was on 14 Sep 2026."
    steady = served({"merges_in_bursts": False, "last_outside_merge": "2026-09-14"})
    assert "rhythm" not in lines(steady)


def test_a_stale_bot_seen_only_by_its_closes():
    r = served({"stale_bot": True, "stale_close_days": None})
    assert lines(r)["closed if quiet"] == "A bot closes quiet pull requests."


def test_nothing_under_the_minimums_and_nothing_on_older_reports():
    assert served({}).how_long == []
    assert served(None).how_long == []


def test_the_stale_bot_is_an_ask_with_its_days():
    ask = {"code": "stale_bot", "url": "https://github.com/o/r/blob/abc/.github/stale.yml",
           "link": None, "days": 37}
    r = served(None, asks=[ask])
    assert "Keep yours active: a bot closes pull requests after 37 quiet days." in r.next_step
    no_days = served(None, asks=[{**ask, "days": None}])
    assert "Keep yours active: a bot closes quiet pull requests." in no_days.next_step


def test_wait_and_share_phrases():
    assert [schema.wait_phrase(h) for h in (0.5, 5.2, 23, 30, 24 * 12.5, 24 * 20, 24 * 100)] == [
        "an hour", "6 hours", "a day", "2 days", "13 days", "3 weeks", "4 months"]
    assert [schema.share_phrase(x) for x in (0.97, 0.8, 0.5, 0.27, 0.02)] == [
        "nearly all", "most", "about half", "about 3 in 10", "hardly any"]


NOW = datetime(2026, 9, 25, 12, tzinfo=UTC)


def test_build_carries_timing_and_the_stale_ask():
    """From evidence to the stored report: stats.timing and the ask."""
    records = [EvidenceRecord("repo:o/r:meta", "github", "https://github.com/o/r",
                              NOW - timedelta(days=900), {"pushed_at": NOW.isoformat()}),
               EvidenceRecord("repo:o/r:stale:0", "github",
                              "https://github.com/o/r/blob/abc/.github/stale.yml",
                              NOW - timedelta(days=3),
                              {"kind": "probot", "path": ".github/stale.yml",
                               "text": "daysUntilStale: 30\ndaysUntilClose: 7\n"})]
    for i in range(10):
        opened = NOW - timedelta(days=30 + i)
        url = f"https://github.com/o/r/pull/{i}"
        records += [EvidenceRecord(f"pr:o/r#{i}:opened", "github", url, opened,
                                   {"author": f"u{i}", "author_association": "NONE"}),
                    EvidenceRecord(f"pr:o/r#{i}:comment:0", "github", url,
                                   opened + timedelta(hours=3),
                                   {"author": "m", "author_association": "MEMBER",
                                    "body": "Thanks!"})]
    from holt.agent.signals import build_threads, compute

    signals = compute(build_threads(records), NOW, 14 * 24.0)
    assessment = Assessment(repo="o/r", verdict=Verdict.VIABLE, summary="", as_of=NOW)
    out = report_mod.build(repo="o/r", mode="rules", assessment=assessment, signals=signals,
                           records=records, generated_at=NOW)
    assert out["stats"]["timing"]["first_reply_slow_hours"] == 3.0
    assert out["stats"]["timing"]["stale_close_days"] == 37
    assert out["asks"] == [{"code": "stale_bot", "url": records[1].url, "link": None,
                            "days": 37}]
    assert {c["topic"] for c in out["how_long"]} == {"first reply", "closed if quiet"}
