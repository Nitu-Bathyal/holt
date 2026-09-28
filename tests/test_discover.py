"""Screening is arithmetic, its buckets track verdict.py's wording, and a
recorded session replays without credentials.

The category buckets in `discover._categorise` key off phrases `verdict.py`
emits. Each bucket is walked here from synthetic evidence, so rewording a rule
trace fails these tests instead of silently miscounting a rejection summary.
"""

import json
from datetime import UTC, datetime, timedelta

from holt import discover
from holt.discover import (
    CAT_ARCHIVED,
    CAT_HOSTILE,
    CAT_NO_LANDING,
    CAT_RUBBER_STAMP,
    CAT_SLOW,
    Candidate,
    contribution_notes,
    screen_records,
)
from holt.agent import landing as landing_mod
from holt.agent.signals import build_threads
from holt.evidence.fixtures import write_fixture
from holt.profile import Profile
from holt.types import EvidenceRecord, Window

SLUG = "owner/repo"
OPENED = datetime(2026, 5, 1, tzinfo=UTC)
CUTOFF = datetime(2026, 6, 1, tzinfo=UTC)
CAND = Candidate(slug=SLUG)


def pr(n, author, *, merged=False, response_after_hours=None, files=()):
    base = f"pr:{SLUG}#{n}"
    url = f"https://github.com/{SLUG}/pull/{n}"
    opened = OPENED + timedelta(minutes=n)
    records = [EvidenceRecord(
        evidence_id=f"{base}:opened", source="github", url=url, timestamp=opened,
        payload={"author": author, "files": list(files), "changed_files": len(files),
                 "additions": 5, "deletions": 1},
    )]
    if merged:
        records.append(EvidenceRecord(
            evidence_id=f"{base}:merged", source="github", url=url,
            timestamp=opened + timedelta(hours=48), payload={"author": author, "merged": True},
        ))
    if response_after_hours is not None:
        records.append(EvidenceRecord(
            evidence_id=f"{base}:comment:0", source="github", url=url,
            timestamp=opened + timedelta(hours=response_after_hours),
            payload={"author": "maintainer", "body": "thanks"},
        ))
    return records


def meta(archived=False):
    return [EvidenceRecord(
        evidence_id=f"repo:{SLUG}:meta", source="github",
        url=f"https://github.com/{SLUG}", timestamp=OPENED,
        payload={"is_archived": archived},
    )]


def test_welcoming_repo_survives_screening():
    records = (meta()
               + pr(1, "alice", merged=True, response_after_hours=4)
               + pr(2, "bob", merged=True, response_after_hours=6)
               + pr(3, "carol", response_after_hours=2))
    result = screen_records(CAND, records, days=7)
    assert result.category is None


def test_rubber_stamp_rejected_without_any_model_call():
    # Everything lands, nobody says anything: merge rate 3/4, reviewed share 0.
    records = (meta()
               + pr(1, "alice", merged=True) + pr(2, "bob", merged=True)
               + pr(3, "carol", merged=True) + pr(4, "dave"))
    result = screen_records(CAND, records, days=7)
    assert result.category == CAT_RUBBER_STAMP


def test_slow_replies_rejected_against_the_stated_day_budget():
    records = (meta()
               + pr(1, "alice", merged=True, response_after_hours=300)
               + pr(2, "bob", merged=True, response_after_hours=400))
    assert screen_records(CAND, records, days=7).category == CAT_SLOW
    # The same repository is fine for someone with three months.
    assert screen_records(CAND, records, days=90).category is None


def test_ignored_attempts_rejected_as_hostile():
    records = meta() + [r for n in range(1, 9) for r in pr(n, f"person{n}")]
    assert screen_records(CAND, records, days=7).category == CAT_HOSTILE


def test_too_little_history_is_not_called_viable():
    records = meta() + pr(1, "alice", merged=True, response_after_hours=4)
    assert screen_records(CAND, records, days=7).category == CAT_NO_LANDING


def test_archived_repo_rejected():
    records = meta(archived=True) + pr(1, "alice", merged=True)
    assert screen_records(CAND, records, days=7).category == CAT_ARCHIVED


def test_contribution_notes_match_where_outsider_work_landed():
    records = (pr(1, "alice", merged=True, files=["docs/guide.md"])
               + pr(2, "bob", merged=True, files=["docs/api.md"])
               + pr(3, "carol", merged=True, files=["src/core.py"]))
    landing = landing_mod.compute(build_threads(records))
    notes = contribution_notes(landing, ["docs", "tests", "code"])
    assert any("docs" in n and "merged" in n for n in notes)
    assert any(n.startswith("tests: no outsider merge") for n in notes)
    # "code" maps to no directory hint and annotates nothing.
    assert not any(n.startswith("code") for n in notes)


def test_recorded_session_replays_without_credentials(tmp_path, monkeypatch):
    """The free path end to end: manifest + screen fixtures, no model, no net."""
    monkeypatch.setattr(discover, "DISCOVER_ROOT", tmp_path)
    write_fixture(SLUG, Window.PRE_T,
                  meta() + [r for n in range(1, 9) for r in pr(n, f"p{n}")],
                  root=tmp_path / "demo" / "screen", cutoff=CUTOFF)
    (tmp_path / "demo.json").write_text(json.dumps({
        "name": "demo",
        "queries": ["language:python topic:cli"],
        "as_of": CUTOFF.isoformat(),
        "profile": {"languages": ["python"], "topics": ["cli"],
                    "contributions": [], "days": 7},
        "candidates": [{"slug": SLUG}],
    }))
    out = discover.run_replay("demo")
    assert "Replaying a recorded discovery session" in out
    assert "GitHub repository search" in out  # sourcing is disclosed, not claimed
    assert CAT_HOSTILE in out
    assert "No candidate survived" in out


def test_committed_demo_session_replays_from_a_clean_clone():
    """The shipped demo: `holt discover` with no flags, no token, no key."""
    import pytest

    if not (discover.DISCOVER_ROOT / "demo.json").exists():
        pytest.skip("demo session not recorded yet")
    out = discover.run_replay("demo")
    assert "Replaying a recorded discovery session" in out
    assert "GitHub repository search" in out
    assert "no model calls" in out
    assert "not ranked" in out or "No candidate survived" in out


def test_screening_needs_no_model():
    """Structural: the screening pass has no model parameter to pass one to."""
    import inspect

    assert "model" not in inspect.signature(screen_records).parameters
    assert "client" not in inspect.signature(screen_records).parameters


def test_the_merge_rate_floor_has_its_own_bucket():
    from holt.agent.verdict import Rule
    from holt.discover import CAT_LONG_ODDS, _categorise
    from holt.report import Verdict

    trace = [Rule("2 merged.", code="merges"), Rule("Only 2 of 60.", code="long_odds")]
    assert _categorise(Verdict.NOT_VIABLE, trace) == CAT_LONG_ODDS
