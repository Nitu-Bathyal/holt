"""The personal-project rule (agent/personal.py): conservative on purpose."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from holt.agent.personal import detect
from holt.agent.signals import build_threads
from holt.types import EvidenceRecord

NOW = datetime(2026, 9, 29, tzinfo=UTC)


def rec(eid: str, when: datetime, **payload) -> EvidenceRecord:
    return EvidenceRecord(evidence_id=eid, source="github", url="https://github.com/o/r",
                          timestamp=when, payload=payload)


def meta(created_days_ago=20, pushed_days_ago=1, stars=0, description="", topics=(), name="o/r"):
    return rec(f"repo:{name}:meta", NOW - timedelta(days=created_days_ago),
               name_with_owner=name, stargazer_count=stars, description=description,
               topics=list(topics), pushed_at=(NOW - timedelta(days=pushed_days_ago)).isoformat())


def pr(n: int, author: str, association="OWNER", merged=True, days_ago=10):
    opened = NOW - timedelta(days=days_ago)
    out = [rec(f"pr:o/r#{n}:opened", opened, author=author, author_association=association)]
    if merged:
        out.append(rec(f"pr:o/r#{n}:merged", opened + timedelta(hours=1), author=author))
    return out


def run(*records):
    records = list(records)
    return detect(records, build_threads(records), NOW)


def test_a_hackathon_entry_is_personal():
    line = run(meta(description="Built for the Nairobi Hackathon"),
               *pr(1, "ana"), *pr(2, "ben", "COLLABORATOR"))
    assert line and line.startswith("This looks like a hackathon project")
    assert "small team (2 people)" in line


def test_a_repo_with_no_pull_requests_and_a_hackathon_name_is_personal():
    line = run(meta(name="o/smichovsky-hackathon-site"))
    assert line and "nobody has opened a pull request" in line


def test_a_short_burst_that_stopped_is_personal():
    assert run(meta(created_days_ago=80, pushed_days_ago=35), *pr(1, "ana", days_ago=60))
    # Still being worked on: not a finished burst, and no other sign.
    assert run(meta(created_days_ago=80, pushed_days_ago=2), *pr(1, "ana", days_ago=60)) is None


def test_an_outside_merge_keeps_it_open():
    assert run(meta(description="hackathon"), *pr(1, "ana"), *pr(2, "zed", "NONE")) is None


def test_stars_a_contributing_file_or_a_crowd_keep_it_out():
    assert run(meta(description="hackathon", stars=40), *pr(1, "ana")) is None
    contributing = rec("repo:o/r:contributing", NOW, text="How to contribute")
    assert run(meta(description="hackathon"), contributing, *pr(1, "ana")) is None
    crowd = [r for i in range(6) for r in pr(i, f"dev{i}", "MEMBER")]
    assert run(meta(description="hackathon"), *crowd) is None


def test_a_small_open_project_with_no_sign_stays_out():
    """A solo library with no outside PRs yet is Not enough evidence, not personal."""
    assert run(meta(description="A fast graph engine", stars=10), *pr(1, "ana")) is None


def test_a_history_section_that_mentions_a_hackathon_is_not_a_sign():
    readme = rec("repo:o/r:readme", NOW, text="# Graph engine\n\n" + "x " * 1000 + "Started at a hackathon.")
    assert run(meta(), readme, *pr(1, "ana")) is None


def test_coursework_words_need_to_mean_coursework():
    assert run(meta(description="Course assignment 3 for CS101"), *pr(1, "ana"))
    assert run(meta(description="A task assignment app for teams"), *pr(1, "ana")) is None
