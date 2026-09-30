"""The backtest harness (golden/backtest.py): recordings, outcomes, counting, scoring.

Everything runs on hand-built records; nothing reaches the network.
"""

from __future__ import annotations

import gzip
import json
from datetime import UTC, datetime, timedelta

import pytest

from golden import backtest as bt
from holt.agent.signals import build_threads, compute
from holt.types import EvidenceRecord

REPO = "o/r"
AS_OF = datetime(2026, 6, 15, tzinfo=UTC)
END = AS_OF + timedelta(days=45)
CAPTURED = datetime(2026, 9, 29, tzinfo=UTC)
DAY = timedelta(days=1)


def _pr(number: int, author: str, opened: datetime, *, merged: datetime | None = None,
        reply: datetime | None = None, assoc: str = "NONE") -> list[EvidenceRecord]:
    key = f"pr:{REPO}#{number}"
    url = f"https://github.com/{REPO}/pull/{number}"
    out = [EvidenceRecord(f"{key}:opened", "github", url, opened,
                          {"author": author, "title": f"PR {number}", "files": ["src/a.py"],
                           "author_association": assoc})]
    if reply:
        out.append(EvidenceRecord(f"{key}:comment:0", "github", url, reply,
                                  {"author": "boss", "body": "thanks!",
                                   "author_association": "MEMBER"}))
    if merged:
        out.append(EvidenceRecord(f"{key}:merged", "github", url, merged,
                                  {"author": author, "merged_by": "boss",
                                   "author_association": assoc}))
    return out


def _meta() -> EvidenceRecord:
    return EvidenceRecord(f"repo:{REPO}:meta", "github", f"https://github.com/{REPO}",
                          AS_OF - 400 * DAY, {"name_with_owner": REPO})


def _backtest(before_prs: list[list[EvidenceRecord]],
              after_prs: list[list[EvidenceRecord]]) -> bt.Backtest:
    before = [_meta()] + [r for pr in before_prs for r in pr]
    after = [r for pr in after_prs for r in pr]
    return bt.Backtest(REPO, AS_OF, END, CAPTURED, before, after)


def test_a_backtest_round_trips_and_refuses_edits(tmp_path):
    rec = _backtest([_pr(1, "ann", AS_OF - 30 * DAY, merged=AS_OF - 29 * DAY)],
                    [_pr(2, "bob", AS_OF + DAY)])
    path = bt.write_backtest(rec, tmp_path)
    first = path.read_bytes()
    back = bt.read_backtest(REPO, tmp_path)
    assert (back.as_of, back.window_end, back.captured_at) == (AS_OF, END, CAPTURED)
    assert {r.evidence_id for r in back.after} == {r.evidence_id for r in rec.after}
    bt.write_backtest(back, tmp_path)
    assert path.read_bytes() == first

    data = json.loads(gzip.decompress(first))
    data["after"][0]["payload"]["author"] = "someone-else"
    path.write_bytes(gzip.compress(json.dumps(data).encode()))
    with pytest.raises(ValueError, match="edited"):
        bt.read_backtest(REPO, tmp_path)


def test_the_window_query_starts_where_the_before_read_stops():
    q = bt.after_query(REPO, AS_OF, END)
    assert q == "repo:o/r is:pr created:2026-06-15..2026-07-29 sort:created-asc"


def test_recording_stops_at_the_points_floor(tmp_path, capsys):
    class Spent:
        remaining = bt.MIN_POINTS - 1

    assert bt.record([REPO], transport=Spent(), root=tmp_path) == 1
    assert "floor" in capsys.readouterr().out
    assert not any(tmp_path.iterdir())


def test_the_outcome_is_each_persons_first_pull_request_in_the_window():
    after = [
        # ann's first PR merged; her second, ignored, doesn't count.
        _pr(10, "ann", AS_OF + DAY, merged=AS_OF + 3 * DAY, reply=AS_OF + 2 * DAY),
        _pr(11, "ann", AS_OF + 5 * DAY),
        # bob replied to on day 20: too late for "replied within 14 days".
        _pr(12, "bob", AS_OF + DAY, reply=AS_OF + 20 * DAY),
        # cat never heard back.
        _pr(13, "cat", AS_OF + 2 * DAY),
        # Opened after the window: not in it.
        _pr(14, "dan", END + DAY, merged=END + 2 * DAY),
        # The team's own: not outside work.
        _pr(15, "boss", AS_OF + DAY, merged=AS_OF + DAY, assoc="MEMBER"),
    ]
    out = bt.outcome(_backtest([], after))
    assert out.people == 3
    assert out.merged == pytest.approx(1 / 3)
    assert out.replied_14d == pytest.approx(1 / 3)
    assert not out.tested


def test_people_and_first_pr_counts_weigh_each_person_once():
    # One prolific author with 6 ignored PRs, and 3 people each merged once.
    prs = [_pr(i, "spammer", AS_OF - (40 + i) * DAY) for i in range(6)]
    prs += [_pr(10 + i, who, AS_OF - 30 * DAY, merged=AS_OF - 29 * DAY,
                reply=AS_OF - 29 * DAY) for i, who in enumerate(["ann", "bob", "cat"])]
    threads = build_threads([_meta()] + [r for pr in prs for r in pr])

    by_pr = compute(threads, AS_OF)
    assert (by_pr.outsider_merged, by_pr.outsider_judgeable, by_pr.outsider_ignored) == (3, 9, 6)

    people = bt.count_people(threads, AS_OF)
    assert (people.outsider_merged, people.outsider_judgeable, people.outsider_ignored) == (3, 4, 1)
    assert people.merge_rate == pytest.approx(0.75)

    firsts = bt.count_first_prs(threads, AS_OF)
    assert (firsts.outsider_merged, firsts.outsider_judgeable) == (3, 4)


def test_scoring_names_false_greens_and_false_reds():
    tested = bt.Outcome(people=20, merged=0.05, replied_14d=0.2)
    open_door = bt.Outcome(people=20, merged=0.6, replied_14d=0.9)
    untested = bt.Outcome(people=3, merged=0.0, replied_14d=0.0)
    score = bt.Score("prs", [
        bt.Row("a/green", "viable", "merges", tested),          # false green
        bt.Row("b/red", "not_viable", "long_odds", open_door),  # false red
        bt.Row("c/right", "viable", "merges", open_door),
        bt.Row("d/untested", "viable", "merges", untested),     # never tested: not scored
        bt.Row("e/long", "long_shot", "mostly_silent", tested),
    ])
    assert [r.repo for r in score.false_greens] == ["a/green"]
    assert [r.repo for r in score.false_reds] == ["b/red"]
    assert len(score.scored) == 4
    assert "a/green (false green" in bt.report([score])


def test_spearman_handles_ties_and_order():
    assert bt.spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1.0)
    assert bt.spearman([1, 2, 3, 4], [40, 30, 20, 10]) == pytest.approx(-1.0)
    assert bt.spearman([3, 3, 1, 1], [0.5, 0.4, 0.1, 0.2]) == pytest.approx(0.894, abs=1e-3)
    assert bt.spearman([1, 2], [1, 2]) is None


def test_the_engine_answers_from_the_before_records_only():
    before = [_pr(i, who, AS_OF - (60 - i) * DAY, merged=AS_OF - (59 - i) * DAY,
                  reply=AS_OF - (59 - i) * DAY)
              for i, who in enumerate(["ann", "bob", "cat"])]
    rec = _backtest(before, [_pr(20, "zed", AS_OF + DAY)])
    verdict, rule, signals = bt.answer(rec, bt.COUNTS["prs"])
    assert verdict == "viable"
    assert rule == "merges"
    assert signals.outsider_merged == 3


def test_the_backtest_recordings_are_the_size_they_should_be():
    """Committed like the golden recordings, and kept small the same way."""
    names = {bt.backtest_path(r, bt.BACKTESTS).name for r in bt.load_repos()}
    for as_of in bt.as_of_dates():
        root = bt.date_root(as_of)
        paths = list(root.glob("*.json.gz"))
        assert sum(p.stat().st_size for p in paths) < 16 * 1024 * 1024, root
        assert not list(root.glob("*.tmp")), root
        assert {p.name for p in paths} <= names, root
