"""How an unmerged outside pull request was closed, and what the reader is told.

Only a close by a person, with no reply from the project, is "closed without a
word". A bot's check, a stale bot, and the author withdrawing are said apart.
See rates.closure().
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from holt.agent import rates
from holt.agent.findings import Findings
from holt.agent.signals import build_threads, compute
from holt.agent.verdict import classify, rule_codes
from holt.types import EvidenceRecord

NOW = datetime(2026, 9, 25, 12, tzinfo=UTC)
OLD = rates.SETTLE_HOURS + 24 * 60  # hours: long settled


def rec(eid: str, hours_ago: float, author: str = "", **payload) -> EvidenceRecord:
    return EvidenceRecord(eid, "github", "https://github.com/a/b/pull/1",
                          NOW - timedelta(hours=hours_ago),
                          {"author": author, "author_is_bot": False, **payload})


def closed(n: int, after_hours: float, by: str | None, *, bot: bool = False,
           replied: bool = False, title: str = "Fix a thing", **close) -> list[EvidenceRecord]:
    """An outside pull request closed `after_hours` after it was opened, by `by`."""
    out = [rec(f"pr:a/b#{n}:opened", OLD, f"user{n}", title=title)]
    if replied:
        out.append(rec(f"pr:a/b#{n}:comment:0", OLD - 1, "maintainer"))
    out.append(rec(f"pr:a/b#{n}:closed", OLD - after_hours, f"user{n}",
                   closed_by=by, closed_by_is_bot=bot, closer=None, merged=False, **close))
    return out


def signals_of(*prs: list[EvidenceRecord]):
    return compute(build_threads([r for p in prs for r in p]), as_of=NOW)


def test_each_kind_of_close_is_counted_once():
    s = signals_of(
        closed(1, 0.1, "github-actions", bot=True),     # a bot's check
        closed(2, 30, "is-a-dev-reviewbot"),             # a check a day later, on a user account
        closed(3, 24 * 40, "stale[bot]", bot=True),      # a stale bot
        closed(4, 5, "user4"),                           # withdrawn by the author
        closed(5, 5, "maintainer", replied=True),        # closed with a reply
        closed(6, 5, "maintainer"),                      # closed without a word
        closed(7, 0.1, "github-actions", bot=True, replied=True),  # a reply wins
    )
    assert s.outsider_closed_by_bot == 2
    assert s.outsider_closed_stale == 1
    assert s.outsider_withdrawn == 1
    assert s.outsider_closed_silently == 1
    # None of them is "ignored", and every one is a decided attempt.
    assert s.outsider_ignored == 0 and s.outsider_threads == 7
    assert s.merge_rate == 0.0


def test_a_close_from_before_closers_were_recorded_is_silent_as_before():
    old = [rec("pr:a/b#1:opened", OLD, "user1"), rec("pr:a/b#1:closed", OLD - 1, "user1")]
    s = signals_of(old)
    assert s.outsider_closed_silently == 1
    assert s.outsider_closed_by_bot == s.outsider_withdrawn == 0


def test_an_unknown_closer_is_silent():
    s = signals_of(closed(1, 1, None))
    assert s.outsider_closed_silently == 1


def test_a_bot_closing_its_own_pull_request_is_not_a_check():
    """A bot's own pull request isn't an outsider's attempt at all."""
    records = closed(1, 0.1, "github-actions", bot=True)
    records[0].payload.update(author="renovate[bot]", author_is_bot=True)
    s = signals_of(records)
    assert s.outsider_threads == 0 and s.outsider_closed_by_bot == 0


def test_the_closure_kinds_leave_the_verdict_alone():
    """Sorting closes changes what the reader is told, never the counts a rule
    reads: 20 bot-closed pull requests are still 0 of 20 merged."""
    bots = signals_of(*(closed(i, 0.1, "github-actions", bot=True) for i in range(1, 21)))
    people = signals_of(*(closed(i, 1, "maintainer") for i in range(1, 21)))
    assert classify(Findings(), bots)[0] == classify(Findings(), people)[0]
    codes = rule_codes(classify(Findings(), bots)[1])
    assert "closed_by_bot" in codes and "closed_silently" not in codes


# --- retitled as spam -----------------------------------------------------------------


@pytest.mark.parametrize("title", [
    "AI junk", "AI spam", "<spam>", "spam", "[rejected AI] add Cloudflare Workers hosting guide",
    "[spam] Update README.md", "ai slop",
])
def test_a_title_a_maintainer_rewrote_as_spam_leaves_the_counts(title):
    """flask and click retitle junk instead of labelling it."""
    assert rates.off_topic_title(title)
    s = signals_of(closed(1, 1, "maintainer", title=title), closed(2, 1, "maintainer"))
    assert s.outsider_excluded == 1 and s.outsider_threads == 1


def test_a_frozen_capture_keeps_its_retitled_pull_requests():
    """The benchmark and recorded demos were scored with them counted."""
    records = [r for p in (closed(1, 1, "maintainer", title="AI junk"), closed(2, 1, "x"))
               for r in p]
    s = compute(build_threads(records), as_of=None)
    assert s.outsider_excluded == 0 and s.outsider_threads == 2


@pytest.mark.parametrize("title", [
    "Fix spam filter", "Detect AI junk in uploads", "Add AI provider", "Rejected AI suggestions fixed",
    "", None,
])
def test_a_title_about_spam_is_not_spam(title):
    assert not rates.off_topic_title(title)


# --- what the reader is told ------------------------------------------------------------


def test_each_close_line_agrees_with_its_number():
    one = dict((c, t) for t, c in rates.count_sentences(0, 0, 0, closed_by_bot=1,
                                                         closed_stale=1, withdrawn=1))
    assert one["closed_by_bot"] == ("1 pull request from an outside contributor was closed "
                                    "by a bot soon after it was opened.")
    assert one["closed_stale"] == ("1 pull request from an outside contributor was closed "
                                   "later by a bot, with no reply from the project.")
    assert one["withdrawn"] == ("1 pull request from an outside contributor was closed "
                                "by the person who opened it.")
    many = dict((c, t) for t, c in rates.count_sentences(0, 0, 0, closed_by_bot=4,
                                                          closed_stale=2, withdrawn=3))
    assert many["closed_by_bot"].startswith("4 pull requests from outside contributors were "
                                            "closed by a bot soon after they were opened")
    assert many["withdrawn"].endswith("by the people who opened them.")
    assert "closed_silently" not in many


@pytest.mark.parametrize("code", ["closed_by_bot", "closed_stale", "withdrawn"])
def test_the_close_lines_only_inform(code):
    assert code in rates.INFO_CODES
