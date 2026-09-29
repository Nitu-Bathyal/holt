"""Each person's first pull request, and when an open one counts (signals.first_prs)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from holt.agent.signals import FIRST_PR_OPEN_DAYS, build_threads, compute
from holt.types import EvidenceRecord

REPO = "o/r"
NOW = datetime(2026, 9, 29, tzinfo=UTC)
DAY = timedelta(days=1)


def _pr(n: int, author: str, age_days: float, *, merged: bool = False,
        closed: bool = False, assoc: str = "NONE") -> list[EvidenceRecord]:
    key, url = f"pr:{REPO}#{n}", f"https://github.com/{REPO}/pull/{n}"
    opened = NOW - age_days * DAY
    out = [EvidenceRecord(f"{key}:opened", "github", url, opened,
                          {"author": author, "title": "t", "author_association": assoc})]
    if merged:
        out.append(EvidenceRecord(f"{key}:merged", "github", url, opened + DAY,
                                  {"author": author, "merged_by": "boss", "author_association": assoc}))
    if closed:
        out.append(EvidenceRecord(f"{key}:closed", "github", url, opened + DAY,
                                  {"author": author, "author_association": assoc}))
    return out


def _signals(*prs: list[EvidenceRecord]):
    meta = EvidenceRecord(f"repo:{REPO}:meta", "github", "", NOW - 900 * DAY, {})
    return compute(build_threads([meta] + [r for pr in prs for r in pr]), NOW)


def test_each_person_counts_once_by_their_first_pull_request():
    s = _signals(
        _pr(1, "ann", 100, merged=True), _pr(2, "ann", 90), _pr(3, "ann", 80),
        _pr(4, "bob", 100), _pr(5, "bob", 50, merged=True),  # bob's first wasn't merged
        _pr(6, "cat", 100, closed=True),
    )
    assert (s.first_pr_merged, s.first_pr_people) == (1, 3)
    assert s.first_pr_rate == 1 / 3


def test_an_open_first_pull_request_counts_only_once_it_is_old_enough():
    """Review takes weeks on some projects: an open first PR a month old is
    likely still on its way in, so it is neither merged nor not."""
    young, old = FIRST_PR_OPEN_DAYS - 5, FIRST_PR_OPEN_DAYS + 5
    s = _signals(_pr(1, "ann", 100, merged=True), _pr(2, "bob", young), _pr(3, "cat", old))
    assert (s.first_pr_merged, s.first_pr_people) == (1, 2)


def test_first_pull_requests_skip_the_team_and_what_no_rate_counts():
    s = _signals(
        _pr(1, "boss", 100, merged=True, assoc="MEMBER"),
        _pr(2, "ann", 400, merged=True),  # older than the sample reaches
        _pr(3, "ann", 100),               # so this is ann's first counted one
        _pr(4, "dan", 3),                 # too new to judge at all
    )
    assert (s.first_pr_merged, s.first_pr_people) == (0, 1)
