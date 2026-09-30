"""Evidence snapshots: every report keeps the evidence it read, and a report
can be made again from it without GitHub (evidence_store.py)."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from holt_server import engine, evidence_store, warm
from holt_server.db import ENGINE_VERSION, Report, SavedRepo
from holt_server.evidence_store import EvidenceStore

from holt.evidence.fixtures import FixtureProvider
from holt.types import T_CUTOFF, Window
from sqlalchemy import select

from conftest import canned_report

ROOT = Path(__file__).resolve().parents[2]
REPO = "NixOS/nixpkgs"


def fixture_records():
    return FixtureProvider(Window.PRE_T, root=ROOT / "fixtures").fetch(REPO)


def test_a_snapshot_reads_back_as_it_was_written(tmp_path):
    store = EvidenceStore(tmp_path)
    records = fixture_records()
    path = store.save(REPO, records, T_CUTOFF, judges_recency=False)

    assert path.parent == tmp_path / "nixos__nixpkgs"
    assert path.name.endswith(".json.gz")
    snap = store.newest("nixos/NIXPKGS")
    assert snap is not None
    assert snap.repo == REPO and snap.cutoff == T_CUTOFF and snap.judges_recency is False
    assert sorted(snap.records, key=lambda r: r.evidence_id) == sorted(
        records, key=lambda r: r.evidence_id)


def test_the_newest_snapshot_wins(tmp_path):
    store = EvidenceStore(tmp_path)
    records = fixture_records()
    store.save(REPO, records[:5], datetime(2026, 9, 1, tzinfo=UTC))
    store.save(REPO, records, datetime(2026, 9, 8, tzinfo=UTC))
    store.save(REPO, records[:3], datetime(2026, 9, 4, tzinfo=UTC))

    assert len(list((tmp_path / "nixos__nixpkgs").iterdir())) == 3  # every one kept
    assert store.newest(REPO).cutoff == datetime(2026, 9, 8, tzinfo=UTC)
    assert store.newest("octo/none") is None


# --- the report job keeps its evidence ------------------------------------------


def replay_harness(make_harness, tmp_path, **overrides):
    h = make_harness(HOLT_EVIDENCE_DIR=str(tmp_path / "evidence"), **overrides)
    h.svc.analysis_fn = engine.analyze
    h.svc.provider_factory = lambda repo, as_of: FixtureProvider(Window.PRE_T,
                                                                 root=ROOT / "fixtures")
    return h


def newest(h, repo, timeout=10.0):
    """The snapshot, once written: the job is done when its report is stored,
    and the evidence follows."""
    deadline = time.monotonic() + timeout
    while (snap := h.svc.evidence.newest(repo)) is None:
        assert time.monotonic() < deadline, f"no snapshot of {repo}"
        time.sleep(0.05)
    return snap


def without_time(report):
    return {k: v for k, v in report.items() if k != "generated_at"}


def test_a_report_keeps_its_evidence_and_can_be_made_again_from_it(make_harness, tmp_path):
    h = replay_harness(make_harness, tmp_path)
    live = h.wait(h.post("/v1/analyses", {"repo": REPO}).json()["job_id"])["report"]

    snap = newest(h, REPO)
    assert snap.cutoff == T_CUTOFF
    again = evidence_store.rederive(snap, days=7)
    assert without_time(again) == without_time(live)
    assert again["generated_at"] == "2026-06-01T00:00:00Z"  # when the evidence was read


def test_a_failed_write_never_fails_the_report(make_harness, tmp_path, caplog):
    blocked = tmp_path / "not-a-directory"
    blocked.write_text("a file where the directory should be", encoding="utf-8")
    h = make_harness(HOLT_EVIDENCE_DIR=str(blocked))
    h.svc.analysis_fn = engine.analyze
    h.svc.provider_factory = lambda repo, as_of: FixtureProvider(Window.PRE_T,
                                                                 root=ROOT / "fixtures")
    with caplog.at_level("ERROR", logger="holt_server"):
        body = h.wait(h.post("/v1/analyses", {"repo": REPO}).json()["job_id"])
        deadline = time.monotonic() + 10
        while "saving the evidence" not in caplog.text:
            assert time.monotonic() < deadline, "the failed write was never logged"
            time.sleep(0.05)

    assert body["status"] == "done" and body["report"]["repo"] == REPO
    assert h.svc.evidence.newest(REPO) is None
    # And the next person's request is served from the stored report.
    assert h.get(f"/v1/reports/{REPO}").status_code == 200


def test_off_without_a_directory(make_harness, tmp_path):
    h = make_harness()
    assert not h.svc.evidence.enabled
    assert h.svc.evidence.save(REPO, fixture_records(), T_CUTOFF) is None
    assert h.svc.evidence.newest(REPO) is None


# --- warm --stale-only makes reports again from snapshots ---------------------------


@pytest.fixture
def warm_h(make_harness, tmp_path, monkeypatch):
    monkeypatch.setattr(warm, "POLL_S", 0.02)
    h = make_harness(HOLT_EVIDENCE_DIR=str(tmp_path / "evidence"))

    async def remaining():
        return 5000
    h.svc.lookup.remaining = remaining
    return h


def old_report(h, repo, made_at):
    """A stored report from an older engine, as after an ENGINE_VERSION bump."""
    async def add():
        async with h.svc.db.session() as s:
            s.add(Report(repo=repo, repo_key=repo.lower(), mode="rules", days=7,
                         report=canned_report(repo), created_at=made_at,
                         engine_version=ENGINE_VERSION - 1))
            await s.commit()
    h.client.portal.call(add)


def reports(h, repo):
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(Report).where(Report.repo_key == repo.lower())
                                    .order_by(Report.id))).scalars().all()
    return h.client.portal.call(q)


def stale_pass(h, seeds):
    return h.client.portal.call(
        lambda: warm.warm_once(h.svc, seeds=seeds, stale_only=True))


def test_stale_only_remakes_a_report_from_a_fresh_snapshot_without_github(warm_h):
    read_at = datetime.now(UTC).replace(microsecond=0) - timedelta(days=2)
    warm_h.svc.evidence.save(REPO, fixture_records(), read_at, judges_recency=False)
    old_report(warm_h, REPO, read_at + timedelta(minutes=1))

    result = stale_pass(warm_h, [REPO])

    assert warm_h.engine.calls == []  # no job, so no GitHub read
    assert (result.reports_rederived, result.reports_run) == (1, 0)
    new = reports(warm_h, REPO)[-1]
    assert new.engine_version == ENGINE_VERSION and not new.outdated
    assert new.report["verdict"] == evidence_store.rederive(
        warm_h.svc.evidence.newest(REPO), days=7)["verdict"]
    # As old as the evidence behind it: the refresh tiers still see its real age.
    assert new.report["generated_at"] == read_at.strftime("%Y-%m-%dT%H:%M:%SZ")
    assert stale_pass(warm_h, [REPO]).reports_fresh == 1  # and it's current now


def test_stale_only_reads_github_when_the_snapshot_is_too_old(warm_h):
    read_at = datetime.now(UTC) - timedelta(days=40)  # past the monthly tier (30 days)
    warm_h.svc.evidence.save(REPO, fixture_records(), read_at, judges_recency=False)
    old_report(warm_h, REPO, read_at)

    result = stale_pass(warm_h, [REPO])

    assert [c["repo"] for c in warm_h.engine.calls] == [REPO]
    assert (result.reports_rederived, result.reports_run) == (0, 1)


def test_stale_only_reuses_a_snapshot_as_old_as_the_repos_refresh_tier(warm_h):
    # Ten days: past HOLT_EVIDENCE_REUSE_HOURS (a week), inside the monthly
    # tier, so a seed nobody saved or viewed is made again from it...
    read_at = datetime.now(UTC).replace(microsecond=0) - timedelta(days=10)
    for repo in (REPO, "NixOS/other"):
        warm_h.svc.evidence.save(repo, fixture_records(), read_at, judges_recency=False)
        old_report(warm_h, repo, read_at)
    # ...but one someone saved is in the weekly tier, and is read again.
    async def save():
        async with warm_h.svc.db.session() as s:
            s.add(SavedRepo(user_id="u1", repo_key="nixos/other", repo="NixOS/other"))
            await s.commit()
    warm_h.client.portal.call(save)

    result = stale_pass(warm_h, [REPO, "NixOS/other"])

    assert [c["repo"] for c in warm_h.engine.calls] == ["NixOS/other"]
    assert (result.reports_rederived, result.reports_run) == (1, 1)
    remade = reports(warm_h, REPO)[-1]
    assert remade.engine_version == ENGINE_VERSION
    assert remade.report == evidence_store.rederive(warm_h.svc.evidence.newest(REPO), days=7)


def test_stale_only_reads_github_without_a_snapshot(warm_h):
    old_report(warm_h, REPO, datetime.now(UTC) - timedelta(hours=1))
    result = stale_pass(warm_h, [REPO])
    assert (result.reports_rederived, result.reports_run) == (0, 1)


def test_stale_only_reads_github_when_the_report_is_newer_than_the_snapshot(warm_h):
    # The report was read from GitHub while its evidence wasn't kept: the
    # older snapshot would take the report back in time.
    read_at = datetime.now(UTC) - timedelta(days=3)
    warm_h.svc.evidence.save(REPO, fixture_records(), read_at, judges_recency=False)
    old_report(warm_h, REPO, datetime.now(UTC) - timedelta(hours=2))
    result = stale_pass(warm_h, [REPO])
    assert (result.reports_rederived, result.reports_run) == (0, 1)


def test_stale_only_reads_github_when_reuse_is_off(make_harness, tmp_path, monkeypatch):
    monkeypatch.setattr(warm, "POLL_S", 0.02)
    h = make_harness(HOLT_EVIDENCE_DIR=str(tmp_path / "ev"), HOLT_EVIDENCE_REUSE_HOURS=0)

    async def remaining():
        return 5000
    h.svc.lookup.remaining = remaining
    read_at = datetime.now(UTC) - timedelta(hours=1)
    h.svc.evidence.save(REPO, fixture_records(), read_at, judges_recency=False)
    old_report(h, REPO, read_at)
    assert stale_pass(h, [REPO]).reports_run == 1
