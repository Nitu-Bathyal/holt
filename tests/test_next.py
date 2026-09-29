"""`holt next`: the simple rule that won ships as measured, with its numbers.

The elaborate weighted scorer was cut for failing to beat `path_overlap`
(hit@10 0.211 vs 0.234); what ships is the measured rule, byte-identical in
semantics to the harness's predicate, and the renderer prints the measurement
with every ranking so no code path can show the order without its numbers.
"""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from holt.agent.progression import (
    NEXT_MEASUREMENT,
    history_for,
    overlap_tokens,
    path_overlap_rank,
    render_next,
)
from holt.agent.signals import build_threads
from holt.cli import main
from holt.types import EvidenceRecord

T0 = datetime(2026, 5, 1, tzinfo=UTC)


def issue(n, title, body="", days_old=0):
    return EvidenceRecord(
        evidence_id=f"issue:o/r#{n}:opened", source="github",
        url=f"https://github.com/o/r/issues/{n}",
        timestamp=T0 - timedelta(days=days_old),
        payload={"title": title, "body": body},
    )


def test_overlap_matches_files_dirs_and_suffixes():
    files = {"src/parser/lex.py", "docs/usage.md"}
    assert overlap_tokens(files, issue(1, "crash in src/parser/lex.py"))
    assert overlap_tokens(files, issue(2, "rework src/parser internals"))
    assert overlap_tokens(files, issue(3, "typo", body="see lex.py line 40"))
    assert not overlap_tokens(files, issue(4, "add a Windows installer"))


def test_overlapping_issues_come_first_then_recency_within_groups():
    files = {"src/core.py"}
    issues = {
        "issue:o/r#1": issue(1, "old overlap: src/core.py", days_old=30),
        "issue:o/r#2": issue(2, "newest, no overlap", days_old=1),
        "issue:o/r#3": issue(3, "newer overlap: src/core.py", days_old=5),
    }
    ranked = [k for k, _ in path_overlap_rank(files, issues)]
    assert ranked == ["issue:o/r#3", "issue:o/r#1", "issue:o/r#2"]


def test_history_counts_only_this_persons_merged_work():
    records = []
    for n, (author, merged, files) in enumerate(
        [("alice", True, ["src/a.py"]), ("alice", True, ["src/b.py"]),
         ("alice", False, ["src/c.py"]), ("bob", True, ["src/d.py"])], start=1
    ):
        records.append(EvidenceRecord(
            evidence_id=f"pr:o/r#{n}:opened", source="github",
            url=f"https://github.com/o/r/pull/{n}", timestamp=T0,
            payload={"author": author, "files": files, "additions": 10, "deletions": 2},
        ))
        if merged:
            records.append(EvidenceRecord(
                evidence_id=f"pr:o/r#{n}:merged", source="github",
                url=f"https://github.com/o/r/pull/{n}",
                timestamp=T0 + timedelta(hours=1), payload={"author": author, "merged": True},
            ))
    contributor = history_for("alice", build_threads(records))
    assert contributor.merged_count == 2
    assert contributor.files == {"src/a.py", "src/b.py"}  # the unmerged try is not history
    assert contributor.median_pr_size == 12


def test_renderer_cannot_print_a_ranking_without_the_measurement():
    files = {"src/core.py"}
    issues = {"issue:o/r#1": issue(1, "fix src/core.py")}
    contributor = history_for("alice", {})
    contributor.files = files
    contributor.merged_count = 1
    out = render_next("o/r", contributor, path_overlap_rank(files, issues), issues)
    assert NEXT_MEASUREMENT in out
    # The claim in plain words: best of the orderings tried, not surely better
    # than chance. No statistics in product output.
    assert "rough guide" in NEXT_MEASUREMENT and "random order" in NEXT_MEASUREMENT
    assert "hit@10" not in NEXT_MEASUREMENT and "interval" not in NEXT_MEASUREMENT
    assert "](https://github.com/o/r/issues/1)" in out  # a link, not an evidence id
    assert "src/core.py" in out  # the reason a row is where it is, not just the row


def test_cli_end_to_end_from_committed_fixtures(capsys):
    # mweinelt has three pre-cutoff merged pull requests in the nixpkgs fixture.
    if not Path("fixtures/issues/pre_t/NixOS__nixpkgs.json").exists():
        import pytest

        pytest.skip("issue fixtures not present")
    code = main(["next", "NixOS/nixpkgs", "--as", "mweinelt"])
    out = capsys.readouterr().out
    assert code == 0
    assert NEXT_MEASUREMENT in out
    assert "merged pull request" in out


def test_cli_refuses_to_rank_for_a_stranger(capsys):
    if not Path("fixtures/pre_t/NixOS__nixpkgs.json").exists():
        import pytest

        pytest.skip("fixtures not present")
    code = main(["next", "NixOS/nixpkgs", "--as", "nobody-of-that-name"])
    assert code == 1
    assert "no merged pull request" in capsys.readouterr().err
