"""Evidence snapshots: the pull requests, comments and repository facts a
report read, kept on disk so history accumulates and a report can be made
again without GitHub.

One gzipped JSON file per report, in the shape of a golden recording
(golden/recordings/*.json.gz, v2 evidence), under HOLT_EVIDENCE_DIR:

    <dir>/<owner>__<name>/<cutoff, UTC>.json.gz      (lower-cased directory)

Not in Postgres: its volume sits on the small root disk. Every snapshot is
kept unless HOLT_EVIDENCE_KEEP_DAYS is set; the newest one never goes.
Records pass through the recordings' redaction first, so the file holds the
same public GitHub data a recording does and never a credential. Holt's own
tokens are never part of the evidence.

`save` never raises: a snapshot is a by-product, and a failed write logs and
leaves the report alone. `newest` returns None for a missing, unreadable or
edited file, and the caller reads GitHub as it would without a store.
"""

from __future__ import annotations

import gzip
import json
import logging
import os
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from holt.engine_version import ENGINE_VERSION
from holt.evidence.fixtures import content_hash, record_from_dict, record_to_dict, redact_records
from holt.evidence.provider import EvidenceProvider
from holt.types import EvidenceRecord, Window

log = logging.getLogger("holt_server.evidence_store")

SUFFIX = ".json.gz"
STAMP = "%Y%m%dT%H%M%SZ"
# The host's user manages the files too (backups, clean-up): group-writable,
# and new files keep the directory's group (setgid). deploy/prod/env.sh.
DIR_MODE = 0o2775
FILE_MODE = 0o664


@dataclass(frozen=True)
class Snapshot:
    repo: str
    cutoff: datetime
    records: list[EvidenceRecord] = field(repr=False)
    # Whether the provider that read it applied "too new to judge"; a replay
    # must do the same to give the same report.
    judges_recency: bool = True

    def provider(self) -> EvidenceProvider:
        """Serves the snapshot as the live provider served it at `cutoff`."""
        return SnapshotProvider(self)


class SnapshotProvider(EvidenceProvider):
    def __init__(self, snap: Snapshot) -> None:
        super().__init__(Window.PRE_T, snap.cutoff)
        self.judges_recency = snap.judges_recency
        self.repo = snap.repo
        self._records = list(snap.records)
        self._by_id = {r.evidence_id: r for r in self._records}

    def _fetch_raw(self, request: str, /, **params: object) -> Iterable[EvidenceRecord]:
        if request.lower() != self.repo.lower():
            raise ValueError(f"this snapshot is of {self.repo}, not {request}")
        return list(self._records)

    def _resolve_raw(self, evidence_id: str) -> EvidenceRecord | None:
        return self._by_id.get(evidence_id)


class EvidenceStore:
    """`root` None or empty: off (nothing written, nothing found)."""

    def __init__(self, root: str | Path | None, keep_days: float = 0) -> None:
        self.root = Path(root) if root else None
        self.keep_days = keep_days

    @property
    def enabled(self) -> bool:
        return self.root is not None

    def folder(self, repo: str) -> Path:
        assert self.root is not None
        return self.root / repo.lower().replace("/", "__")

    def save(self, repo: str, records: Iterable[EvidenceRecord], cutoff: datetime,
             judges_recency: bool = True) -> Path | None:
        """Write one snapshot; the path, or None when off or the write failed."""
        if self.root is None:
            return None
        try:
            path = self._write(repo, list(records), cutoff, judges_recency)
        except Exception:  # noqa: BLE001 -- a by-product; the report stands without it
            log.exception("saving the evidence of %s failed", repo)
            return None
        if self.keep_days > 0:
            try:
                self._prune(repo)
            except Exception:  # noqa: BLE001
                log.exception("pruning the evidence of %s failed", repo)
        return path

    def _write(self, repo: str, records: list[EvidenceRecord], cutoff: datetime,
               judges_recency: bool) -> Path:
        records, removed = redact_records(records)
        records = sorted(records, key=lambda r: r.evidence_id)
        cutoff = cutoff.astimezone(UTC)
        body = {
            "repo": repo,
            "cutoff": cutoff.isoformat(),
            "judges_recency": judges_recency,
            "engine_version": ENGINE_VERSION,
            "content_sha256": content_hash(records),
            "credentials_redacted": removed,
            "records": [record_to_dict(r) for r in records],
        }
        folder = self.folder(repo)
        if not folder.is_dir():
            folder.mkdir(parents=True, exist_ok=True)
            _chmod(folder, DIR_MODE)
        path = folder / (cutoff.strftime(STAMP) + SUFFIX)
        raw = json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
        _chmod(tmp, FILE_MODE)
        tmp.replace(path)  # never half a snapshot
        return path

    def _files(self, repo: str) -> list[Path]:
        """The repo's snapshots, oldest first (the names sort by time)."""
        folder = self.folder(repo)
        if not folder.is_dir():
            return []
        return sorted(p for p in folder.iterdir() if p.name.endswith(SUFFIX))

    def newest(self, repo: str) -> Snapshot | None:
        if self.root is None:
            return None
        try:
            files = self._files(repo)
            return read(files[-1]) if files else None
        except Exception:  # noqa: BLE001 -- the caller reads GitHub instead
            log.exception("reading the newest evidence of %s failed", repo)
            return None

    def _prune(self, repo: str) -> int:
        cutoff = datetime.now(UTC) - timedelta(days=self.keep_days)
        old = [p for p in self._files(repo)[:-1] if _stamp(p) < cutoff]
        for path in old:
            path.unlink(missing_ok=True)
        return len(old)


def rederive(snap: Snapshot, days: int, analyze=None) -> dict[str, Any]:
    """The rules report `snap` gives with this engine, as the job would have
    made it when the evidence was read: no GitHub call, no model. Its
    `generated_at` is the snapshot's time, so it never looks newer than its
    evidence. Raises `ApiError` as `engine.analyze` does."""
    from holt_server import engine
    from holt_server import report as report_mod

    report = (analyze or engine.analyze)(
        repo=snap.repo, mode="rules", days=days, provider=snap.provider(), model=None,
        emit=lambda stage, value: None, as_of=snap.cutoff)
    return {**report, "generated_at": report_mod.iso(snap.cutoff)}


def read(path: Path) -> Snapshot:
    data = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
    records = [record_from_dict(r) for r in data["records"]]
    if content_hash(records) != data["content_sha256"]:
        raise ValueError(f"{path} was edited after it was written (content hash mismatch)")
    return Snapshot(repo=data["repo"], cutoff=datetime.fromisoformat(data["cutoff"]),
                    records=records, judges_recency=bool(data.get("judges_recency", True)))


def _stamp(path: Path) -> datetime:
    return datetime.strptime(path.name.removesuffix(SUFFIX), STAMP).replace(tzinfo=UTC)


def _chmod(path: Path, mode: int) -> None:
    try:
        os.chmod(path, mode)
    except OSError:
        pass  # a filesystem without modes; the write itself is what matters
