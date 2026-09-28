"""The golden set: the engine's verdicts on ~50 recorded repositories, pinned.

The first test is the CI gate. It replays every recording offline and fails on
any verdict, rule or count that differs from `golden/expected.json`. An
intended change is approved with `python -m golden approve --reason "..."` in
the same PR; see golden/README.md.
"""

from __future__ import annotations

import gzip
import json
from datetime import UTC, datetime, timedelta

import pytest

from golden import golden
from holt.types import EvidenceRecord

VERDICTS = set(golden.LABEL)


def test_the_engine_still_gives_every_approved_answer():
    repos = golden.load_repos()
    expected = golden.load_expected()
    missing = [r for r in repos if not golden.recording_path(r).exists()]
    assert not missing, f"golden repositories with no recording: {missing}"

    current = golden.run_all(repos)
    changes = golden.compare(expected, current)
    assert not changes, (
        "The engine's answers on the golden set changed. If that is intended, run "
        "`uv run python -m golden approve --reason \"...\"` and commit "
        "golden/expected.json in this PR.\n\n"
        + golden.table(changes, repos, expected, current)
    )
    assert golden.history_problems(expected) == []


def test_ten_repositories_are_hand_checked_with_a_reason():
    repos = golden.load_repos()
    checked = {r: m["expected"] for r, m in repos.items() if m.get("expected")}
    assert len(checked) >= 10
    for repo, want in checked.items():
        assert want["verdict"] in VERDICTS, repo
        assert want["reason"].strip(), repo
    # Every repository says what shape it is there to cover.
    assert all(m["shape"] and m["note"] for m in repos.values())


def test_recordings_are_the_size_they_should_be():
    """Kept small on purpose: the repository is already large."""
    total = sum(p.stat().st_size for p in golden.RECORDINGS.glob("*.json.gz"))
    assert total < 12 * 1024 * 1024
    assert {p.name for p in golden.RECORDINGS.glob("*.json.gz")} == {
        golden.recording_path(r).name for r in golden.load_repos()}


# --- the tool itself ------------------------------------------------------------

CUTOFF = datetime(2026, 9, 27, 12, 0, tzinfo=UTC)
REPO = "o/r"


def _pr(number: int, author: str, opened: datetime, *, merged: datetime | None = None,
        reply: tuple[str, datetime] | None = None) -> list[EvidenceRecord]:
    key = f"pr:{REPO}#{number}"
    url = f"https://github.com/{REPO}/pull/{number}"
    out = [EvidenceRecord(f"{key}:opened", "github", url, opened,
                          {"author": author, "title": f"PR {number}", "files": ["src/a.py"]})]
    if reply:
        out.append(EvidenceRecord(f"{key}:comment:0", "github", url, reply[1],
                                  {"author": reply[0], "body": "thanks!"}))
    if merged:
        out.append(EvidenceRecord(f"{key}:merged", "github", url, merged, {"author": author}))
    return out


def _records() -> list[EvidenceRecord]:
    day = timedelta(days=1)
    meta = EvidenceRecord(f"repo:{REPO}:meta", "github", f"https://github.com/{REPO}",
                          CUTOFF - 400 * day, {"name_with_owner": REPO})
    records = [meta]
    for i, who in enumerate(["ann", "bob", "cat"]):
        opened = CUTOFF - (30 - i) * day
        records += _pr(i + 1, who, opened, merged=opened + day,
                       reply=("maintainer", opened + timedelta(hours=3)))
    # Opened an hour before the recording, unanswered: too new to count as ignored.
    records += _pr(9, "dan", CUTOFF - timedelta(hours=1))
    return records


def test_a_recording_round_trips_to_the_same_bytes(tmp_path):
    path = golden.write_recording(REPO, _records(), CUTOFF, tmp_path)
    first = path.read_bytes()
    cutoff, records = golden.read_recording(REPO, tmp_path)
    assert cutoff == CUTOFF
    assert {r.evidence_id for r in records} == {r.evidence_id for r in _records()}
    golden.write_recording(REPO, list(reversed(records)), CUTOFF, tmp_path)
    assert path.read_bytes() == first


def test_an_edited_recording_is_refused(tmp_path):
    path = golden.write_recording(REPO, _records(), CUTOFF, tmp_path)
    data = json.loads(gzip.decompress(path.read_bytes()))
    data["records"][0]["payload"]["author"] = "someone-else"
    path.write_bytes(gzip.compress(json.dumps(data).encode()))
    with pytest.raises(ValueError, match="edited"):
        golden.read_recording(REPO, tmp_path)


def test_the_replay_reads_as_a_live_report_did_at_capture_time(tmp_path):
    golden.write_recording(REPO, _records(), CUTOFF, tmp_path)
    result = golden.run(REPO, tmp_path)
    assert result["verdict"] == "viable"
    numbers = result["numbers"]
    assert numbers["outsider_merged"] == 3
    # The hour-old PR is still open, not ignored, because the replay is read
    # at the moment of capture with the live "too new to judge" window.
    assert numbers["outsider_still_open"] == 1
    assert numbers["outsider_ignored"] == 0


def _snap(verdict: str, merged: int) -> dict:
    return {"verdict": verdict, "rules": ["merges"], "numbers": {"outsider_merged": merged}}


def test_approve_logs_a_verdict_change_with_its_reason():
    expected = {"a/a": {**_snap("viable", 3), "history": [
        {"date": "2026-09-27", "from": None, "to": "viable", "reason": "first"}]}}
    current = {"a/a": _snap("not_viable", 0), "b/b": _snap("viable", 5)}
    changes = golden.approve(expected, current, "merge-rate floor", today="2026-10-01")
    assert {c.repo for c in changes} == {"a/a", "b/b"}
    assert expected["a/a"]["verdict"] == "not_viable"
    assert expected["a/a"]["history"][-1] == {
        "date": "2026-10-01", "from": "viable", "to": "not_viable", "reason": "merge-rate floor"}
    assert expected["b/b"]["history"] == [
        {"date": "2026-10-01", "from": None, "to": "viable", "reason": "merge-rate floor"}]
    assert golden.history_problems(expected) == []
    assert golden.compare(expected, current) == []


def test_a_count_change_is_approved_without_a_history_entry():
    expected = {"a/a": {**_snap("viable", 3), "history": [
        {"date": "2026-09-27", "from": None, "to": "viable", "reason": "first"}]}}
    golden.approve(expected, {"a/a": _snap("viable", 4)}, "recount", today="2026-10-01")
    assert expected["a/a"]["numbers"] == {"outsider_merged": 4}
    assert len(expected["a/a"]["history"]) == 1


def test_a_hand_edited_verdict_is_caught():
    expected = {"a/a": {**_snap("not_viable", 3), "history": [
        {"date": "2026-09-27", "from": None, "to": "viable", "reason": "first"}]}}
    assert any("never approved" in p for p in golden.history_problems(expected))


def test_the_table_shows_flips_and_hand_check_agreement():
    repos = {"a/a": {"expected": {"verdict": "not_viable", "reason": "x"}}}
    before = {"a/a": _snap("viable", 3), "b/b": _snap("viable", 5)}
    after = {"a/a": _snap("not_viable", 0), "b/b": _snap("viable", 6)}
    out = golden.table(golden.compare(before, after), repos, before, after)
    assert "1 verdict changes, 1 with only rules or counts changed" in out
    assert "0/1 before, 1/1 after" in out
    assert "| a/a | **Worth → Not worth** | Not worth ✗→✓ |" in out
    assert "outsider_merged 5→6" in out
    # Verdict changes come first.
    assert out.index("| a/a") < out.index("| b/b")
