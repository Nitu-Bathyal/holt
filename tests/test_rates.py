"""Rates over decided pull requests, silent closes, drafts and spam, and dates.

See src/holt/agent/rates.py for why each of these exists.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

import pytest

from golden import golden
from holt.agent import pipeline, rates
from holt.agent.findings import Findings
from holt.agent.signals import build_threads, compute
from holt.agent.verdict import classify, rule_codes
from holt.evidence.fixtures import FixtureProvider
from holt.evidence.provider import EvidenceProvider
from holt.report import Verdict
from holt.types import EvidenceRecord, Window

NOW = datetime(2026, 9, 25, 12, tzinfo=UTC)
OLD = rates.SETTLE_HOURS + 100  # hours: past the settle window


def rec(eid: str, hours_ago: float, author: str = "", **payload) -> EvidenceRecord:
    return EvidenceRecord(eid, "github", "https://github.com/a/b/pull/1",
                          NOW - timedelta(hours=hours_ago),
                          {"author": author, "author_is_bot": False, **payload})


def pr(n: int, hours_ago: float = OLD, *, outcome: str = "open", replied: bool = False,
       **opened) -> list[EvidenceRecord]:
    """One newcomer pull request: open, merged or closed, with or without a reply."""
    out = [rec(f"pr:a/b#{n}:opened", hours_ago, f"user{n}", **opened)]
    if replied:
        out.append(rec(f"pr:a/b#{n}:comment:0", hours_ago - 1, "maintainer"))
    if outcome in ("merged", "closed"):
        out.append(rec(f"pr:a/b#{n}:{outcome}", hours_ago - 2, "maintainer"))
    return out


def signals_of(*prs: list[EvidenceRecord], as_of: datetime | None = NOW):
    return compute(build_threads([r for p in prs for r in p]), as_of=as_of)


class Live(EvidenceProvider):
    def __init__(self, records: list[EvidenceRecord]) -> None:
        super().__init__(Window.PRE_T, NOW)
        self._records = records

    def _fetch_raw(self, request: str, /, **params: object) -> Iterable[EvidenceRecord]:
        return self._records

    def _resolve_raw(self, evidence_id: str) -> EvidenceRecord | None:
        return None


# --- what is left out ------------------------------------------------------------


@pytest.mark.parametrize("label", [
    "spam", "Spam", "hacktoberfest-spam", "invalid", "Invalid", "status: invalid",
    "rejected AI", "bot:ai-policy-close", "ai-slop", "junk",
])
def test_spam_and_invalid_labels_are_recognised(label):
    assert rates.off_topic_label(["bug", label]) == label


@pytest.mark.parametrize("label", [
    "wontfix", "do-not-merge/invalid-commit-message", "bot:ai-policy-comment",
    "cla: 1.0 no ai", "assisted: ai", "awaiting review", "domain",
])
def test_ordinary_labels_are_not(label):
    assert rates.off_topic_label([label]) is None


def test_drafts_and_spam_leave_every_count():
    s = signals_of(pr(1, outcome="merged"), pr(2, outcome="merged"),
                   pr(3, is_draft=True), pr(4, outcome="closed", labels=["spam"]),
                   pr(5, labels=["invalid"]))
    assert s.outsider_excluded == 3
    assert s.outsider_threads == 2 and s.outsider_judgeable == 2
    assert s.outsider_ignored == 0 and s.outsider_closed_silently == 0
    assert s.merge_rate == 1.0 and s.distinct_outsider_authors == 2


def test_a_merged_pull_request_is_never_left_out():
    s = signals_of(pr(1, outcome="merged", labels=["invalid"]))
    assert s.outsider_excluded == 0 and s.outsider_merged == 1


# --- decided, still open, closed silently, ignored ----------------------------------


def test_each_outcome_lands_in_one_bucket():
    s = signals_of(
        pr(1, outcome="merged"),
        pr(2, outcome="closed", replied=True),
        pr(3, outcome="closed"),                    # closed silently
        pr(4, replied=True),                        # open, answered, settled
        pr(5),                                      # ignored
        pr(6, hours_ago=5),                         # still open
        pr(7, hours_ago=5, replied=True),           # still open, answered
        pr(8, hours_ago=5, outcome="merged"),       # decided fast: merged
        pr(9, hours_ago=5, outcome="closed"),       # decided fast: closed silently
    )
    assert s.outsider_threads == 9
    assert s.outsider_still_open == 2
    assert s.outsider_judgeable == 7
    assert s.outsider_merged == 2
    assert s.outsider_closed_silently == 2
    assert s.outsider_ignored == 1
    assert s.merge_rate == pytest.approx(2 / 7)


def test_without_a_reference_time_a_silent_close_is_still_no_reply():
    """The frozen benchmark's arithmetic, unchanged."""
    s = signals_of(pr(1, outcome="closed"), pr(2, hours_ago=1), as_of=None)
    assert s.outsider_ignored == 2
    assert s.outsider_closed_silently == 0 and s.outsider_still_open == 0


def test_triage_closes_do_not_make_a_repo_look_hostile():
    """flask's shape: most newcomer PRs closed without a word (spam and AI
    junk), none merged. That used to read as "ignored" and decide Not worth."""
    s = signals_of(*(pr(i, outcome="closed") for i in range(1, 21)))
    assert s.outsider_ignored == 0 and s.outsider_closed_silently == 20
    verdict, trace = classify(Findings(), s)
    assert verdict is Verdict.INSUFFICIENT_EVIDENCE
    assert "closed_silently" in rule_codes(trace) and "ignored" not in rule_codes(trace)
    legacy = signals_of(*(pr(i, outcome="closed") for i in range(1, 21)), as_of=None)
    assert classify(Findings(), legacy)[0] is Verdict.NOT_VIABLE


def test_open_and_unanswered_for_weeks_is_still_ignored():
    s = signals_of(*(pr(i) for i in range(1, 11)))
    verdict, trace = classify(Findings(), s)
    assert verdict is Verdict.NOT_VIABLE and rule_codes(trace)[-1] == "ignored"


def test_a_busy_repo_is_not_judged_on_hours_old_pull_requests():
    young = [pr(i, hours_ago=3) for i in range(1, 51)]
    s = signals_of(pr(100, outcome="merged", replied=True),
                   pr(101, outcome="merged", replied=True),
                   pr(102, outcome="closed", replied=True), *young)
    assert s.outsider_still_open == 50 and s.outsider_judgeable == 3
    assert s.merge_rate == pytest.approx(2 / 3)
    verdict, trace = classify(Findings(), s)
    assert verdict is Verdict.VIABLE
    merges = next(r for r in trace if r.code == "merges")
    assert "out of 3 attempts" in merges


# --- what the reader is told ------------------------------------------------------------


@pytest.mark.parametrize(("n", "want"), [
    (1, "1 pull request from a newcomer is less than 14 days old and still open, "
        "so it isn't counted yet."),
    (3, "3 pull requests from newcomers are less than 14 days old and still open, "
        "so they aren't counted yet."),
])
def test_the_still_open_line_agrees_with_its_number(n, want):
    lines = dict((code, text) for text, code in rates.count_sentences(n, 0, 0))
    assert lines["still_open"] == want


def test_the_silent_close_and_excluded_lines_agree_with_their_numbers():
    one = dict((c, t) for t, c in rates.count_sentences(0, 1, 1))
    assert one["closed_silently"].startswith("1 pull request from a newcomer was closed")
    assert "it isn't counted as ignored" in one["closed_silently"]
    assert one["excluded"].startswith("1 pull request from a newcomer was a draft or was")
    many = dict((c, t) for t, c in rates.count_sentences(0, 5, 2))
    assert many["closed_silently"].startswith("5 pull requests from newcomers were closed")
    assert many["excluded"].startswith("2 pull requests from newcomers were drafts")


def test_no_merges_is_not_only_zero():
    s = signals_of(pr(1, replied=True), pr(2, replied=True))
    _, trace = classify(Findings(), s)
    line = next(r for r in trace if r.code == "few_merges")
    assert "Only 0" not in line and line.startswith("No pull request")
    one = signals_of(pr(1, outcome="merged"), pr(2, replied=True))
    line = next(r for r in classify(Findings(), one)[1] if r.code == "few_merges")
    assert line.startswith("Only 1 pull request from a first-time contributor got merged")


# --- the dates, and dormancy ---------------------------------------------------------


def threads_of(*prs):
    records = [r for p in prs for r in p]
    return records, build_threads(records)


def test_the_period_line_names_the_first_and_last_dates():
    _, threads = threads_of(pr(1, hours_ago=24 * 30), pr(2, hours_ago=24))
    line = rates.period_sentence(threads, NOW)
    assert line == ("These numbers come from the newest 2 pull requests, opened "
                    "between 26 Aug 2026 and 24 Sep 2026.")


def test_the_period_line_warns_when_the_sample_is_over_a_year_old():
    _, threads = threads_of(pr(1, hours_ago=24 * 400), pr(2, hours_ago=24))
    assert "more than a year" in rates.period_sentence(threads, NOW)


def test_a_recent_merge_is_not_dormant():
    records, threads = threads_of(pr(1, hours_ago=24 * 30, outcome="merged"))
    assert rates.dormant_sentence(records, threads, NOW, {}) is None


def test_no_merge_for_months_and_no_push_reads_as_inactive():
    records, threads = threads_of(pr(1, hours_ago=24 * 200, outcome="merged"),
                                  pr(2, hours_ago=24 * 10))
    line = rates.dormant_sentence(records, threads, NOW,
                                  {"pushed_at": "2026-03-01T00:00:00Z"})
    assert line.startswith("The last pull request merged here was on ")
    assert "looks inactive" in line


def test_a_recent_push_softens_the_dormancy_line():
    records, threads = threads_of(pr(1, hours_ago=24 * 200, outcome="merged"))
    line = rates.dormant_sentence(records, threads, NOW,
                                  {"pushed_at": "2026-09-20T00:00:00Z"})
    assert "code was pushed on 20 Sep 2026" in line and "inactive" not in line


def test_a_push_after_the_reading_says_nothing_about_then():
    records, threads = threads_of(pr(1, hours_ago=24 * 200, outcome="merged"))
    line = rates.dormant_sentence(records, threads, NOW,
                                  {"pushed_at": "2026-12-01T00:00:00Z"})
    assert "looks inactive" in line


def test_a_short_sample_with_no_merge_proves_nothing_about_three_months():
    records, threads = threads_of(pr(1, hours_ago=24 * 5), pr(2, hours_ago=24 * 20))
    assert rates.dormant_sentence(records, threads, NOW, {}) is None


def test_a_long_sample_with_no_merge_is_dormant():
    records, threads = threads_of(pr(1, hours_ago=24 * 5), pr(2, hours_ago=24 * 120))
    line = rates.dormant_sentence(records, threads, NOW, {})
    assert line.startswith("No pull request has been merged here in the last 90 days")


def test_every_live_report_starts_with_its_dates():
    records = [r for p in (pr(1, outcome="merged", replied=True),
                           pr(2, outcome="merged", replied=True), pr(3)) for r in p]
    assessment, _ = pipeline.analyze_without_model("a/b", Live(records), as_of=NOW)
    assert rule_codes(assessment.rules)[0] == "sample_period"
    # The bottom line is the deciding rule, not the dates.
    assert assessment.bottom_line.startswith("Worth your time. 2 pull requests")


def test_the_frozen_benchmark_gets_no_date_lines():
    provider = FixtureProvider(Window.PRE_T)
    assessment, _ = pipeline.analyze_without_model(
        "NixOS/nixpkgs", provider, as_of=provider.cutoff)
    assert not set(rule_codes(assessment.rules)) & rates.INFO_CODES


# --- on the recordings ----------------------------------------------------------------


def test_flask_triage_closes_are_not_ignored():
    """Ticket 06: flask's ~100 silent closes are mostly spam and AI junk."""
    cutoff, _ = golden.read_recording("pallets/flask")
    _, trace = pipeline.analyze_without_model(
        "pallets/flask", golden.RecordingProvider("pallets/flask"), as_of=cutoff)
    s = trace.signals
    assert s.outsider_closed_silently > 50
    assert s.outsider_ignored < 10
    assert s.outsider_excluded > 0


def test_click_rejected_ai_pull_requests_leave_the_counts():
    cutoff, _ = golden.read_recording("pallets/click")
    _, trace = pipeline.analyze_without_model(
        "pallets/click", golden.RecordingProvider("pallets/click"), as_of=cutoff)
    assert trace.signals.outsider_excluded > 100
