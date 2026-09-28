"""The golden set: ~50 recorded repositories that pin down what the engine says.

Every engine change is judged against the same frozen evidence. `repos.json` is
written by hand (which repositories, what shape each one is, and for ten of
them what the verdict *should* be and why). `expected.json` is written by this
tool: the verdict, the deciding rules and the counts the engine produced from
each recording, plus a log of every approved verdict change and its reason.

    python -m golden record [REPO ...]      capture live evidence (needs GITHUB_TOKEN)
    python -m golden diff [--base REF]      before/after table for the current engine
    python -m golden approve --reason TEXT  accept the current engine's output
    python -m golden check                  exit 1 on any unapproved change (CI)

The replay is the free report exactly as the web app computes it: no model,
`contributor_days` 7, read at the moment the recording was made, with the
"too new to judge" window a live read gets. Nothing here reaches the network
except `record`.
"""

from __future__ import annotations

import argparse
import gzip
import json
import subprocess
import sys
import time
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from holt.agent.pipeline import analyze_without_model
from holt.agent.verdict import DEFAULT_CONTRIBUTOR_DAYS, rule_codes
from holt.evidence.fixtures import content_hash, record_from_dict, record_to_dict, redact_records
from holt.evidence.provider import EvidenceProvider
from holt.types import EvidenceRecord, Window

HERE = Path(__file__).resolve().parent
REPOS = HERE / "repos.json"
EXPECTED = HERE / "expected.json"
RECORDINGS = HERE / "recordings"

# What a report reads: the newest 200 pull requests, as the server and the CLI
# fetch them (the provider reads further back on a busy repository; see
# github_graphql.SETTLED_TARGET).
PAGES = 8

LABEL = {"viable": "Worth", "not_viable": "Not worth", "insufficient_evidence": "Not enough"}


def recording_path(repo: str, root: Path = RECORDINGS) -> Path:
    return root / (repo.replace("/", "__") + ".json.gz")


# --- recordings ----------------------------------------------------------------


def write_recording(repo: str, records: Iterable[EvidenceRecord], cutoff: datetime,
                    root: Path = RECORDINGS) -> Path:
    """Scrubbed of third-party credentials, hashed, gzipped. Deterministic bytes."""
    records, removed = redact_records(records)
    records = sorted(records, key=lambda r: r.evidence_id)
    body = {
        "repo": repo,
        "cutoff": cutoff.isoformat(),
        "pages": PAGES,
        "content_sha256": content_hash(records),
        "credentials_redacted": removed,
        "records": [record_to_dict(r) for r in records],
    }
    path = recording_path(repo, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    # mtime=0 so re-writing the same evidence gives the same bytes.
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    tmp.replace(path)  # an interrupted run never leaves half a recording
    return path


def read_recording(repo: str, root: Path = RECORDINGS) -> tuple[datetime, list[EvidenceRecord]]:
    path = recording_path(repo, root)
    if not path.exists():
        raise FileNotFoundError(
            f"No golden recording for {repo} at {path}. Record it with "
            f"`python -m golden record {repo}`."
        )
    data = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
    records = [record_from_dict(r) for r in data["records"]]
    if content_hash(records) != data["content_sha256"]:
        raise ValueError(f"{path} was edited after it was recorded (content hash mismatch)")
    return datetime.fromisoformat(data["cutoff"]), records


class RecordingProvider(EvidenceProvider):
    """Serves one recording as the live provider served it at capture time."""

    # A live read, frozen: the "too new to judge" window applies, measured from
    # the moment of capture, exactly as it did for the report a user saw then.
    judges_recency = True

    def __init__(self, repo: str, root: Path = RECORDINGS) -> None:
        cutoff, self._records = read_recording(repo, root)
        super().__init__(Window.PRE_T, cutoff)
        self.repo = repo
        self._by_id = {r.evidence_id: r for r in self._records}

    def _fetch_raw(self, request: str, /, **params: object) -> Iterable[EvidenceRecord]:
        if request != self.repo:
            raise ValueError(f"this provider serves {self.repo}, not {request}")
        return list(self._records)

    def _resolve_raw(self, evidence_id: str) -> EvidenceRecord | None:
        return self._by_id.get(evidence_id)


def record(repos: list[str], root: Path = RECORDINGS, force: bool = False) -> int:
    """Capture each repository live, now. Returns the number that failed."""
    from holt.evidence.github_graphql import GitHubGraphQL, LiveGitHubProvider

    transport = GitHubGraphQL()
    failed = 0
    for i, repo in enumerate(repos, 1):
        if recording_path(repo, root).exists() and not force:
            print(f"[{i}/{len(repos)}] {repo}: already recorded (--force to redo)")
            continue
        cutoff = datetime.now(UTC).replace(microsecond=0)
        try:
            provider = LiveGitHubProvider(
                Window.PRE_T, cutoff=cutoff, transport=transport, max_pages=PAGES)
            records = provider.fetch(repo)
        except Exception as exc:  # noqa: BLE001 -- reported, and the rest still run
            failed += 1
            print(f"[{i}/{len(repos)}] {repo}: FAILED {type(exc).__name__}: {exc}")
            continue
        meta = next((r for r in records if r.evidence_id.endswith(":meta")), None)
        canonical = (meta.payload.get("name_with_owner") if meta else None) or repo
        if canonical.lower() != repo.lower():
            # A search under an old name finds nothing; record the real name.
            failed += 1
            print(f"[{i}/{len(repos)}] {repo}: renamed to {canonical}; list that instead")
            continue
        path = write_recording(repo, records, cutoff, root)
        prs = sum(1 for r in records if r.evidence_id.endswith(":opened"))
        print(f"[{i}/{len(repos)}] {repo}: {prs} PRs, {len(records)} records, "
              f"{path.stat().st_size // 1024} KB (rate {transport.remaining})", flush=True)
        time.sleep(0.3)
    return failed


# --- the engine's answer -------------------------------------------------------


def _round(value: Any) -> Any:
    return round(value, 3) if isinstance(value, float) else value


def run(repo: str, root: Path = RECORDINGS) -> dict[str, Any]:
    """The free report's verdict, deciding rules and counts for one recording."""
    provider = RecordingProvider(repo, root)
    assessment, trace = analyze_without_model(
        repo, provider, contributor_days=DEFAULT_CONTRIBUTOR_DAYS, as_of=provider.cutoff)
    return {
        "verdict": assessment.verdict.value,
        "rules": rule_codes(trace.rules),
        "numbers": {k: _round(v) for k, v in trace.signals.as_dict().items()},
    }


def run_all(repos: Iterable[str], root: Path = RECORDINGS) -> dict[str, dict[str, Any]]:
    return {repo: run(repo, root) for repo in repos}


# --- files -----------------------------------------------------------------------


def load_repos(path: Path = REPOS) -> dict[str, dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))["repos"]


def load_expected(path: Path = EXPECTED) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def expected_at(ref: str) -> dict[str, dict[str, Any]]:
    """`expected.json` as committed at a git ref, e.g. origin/main."""
    known = subprocess.run(["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"],
                           capture_output=True, cwd=HERE, check=False)
    if known.returncode != 0:
        raise SystemExit(f"{ref} is not a git ref here (try `git fetch` first)")
    rel = EXPECTED.relative_to(_git_root()).as_posix()
    out = subprocess.run(["git", "show", f"{ref}:{rel}"], capture_output=True, text=True,
                         cwd=HERE, check=False)
    if out.returncode != 0:
        # The golden set did not exist yet at that ref.
        return {}
    return json.loads(out.stdout)


def _git_root() -> Path:
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True,
                         text=True, cwd=HERE, check=True)
    return Path(out.stdout.strip()).resolve()


def save_expected(expected: dict[str, dict[str, Any]], path: Path = EXPECTED) -> None:
    path.write_text(json.dumps(dict(sorted(expected.items())), indent=1) + "\n",
                    encoding="utf-8")


# --- comparing -----------------------------------------------------------------


@dataclass(slots=True)
class Change:
    repo: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None

    @property
    def verdict_changed(self) -> bool:
        return _verdict(self.before) != _verdict(self.after)

    @property
    def numbers_changed(self) -> dict[str, tuple[Any, Any]]:
        b = (self.before or {}).get("numbers", {})
        a = (self.after or {}).get("numbers", {})
        return {k: (b.get(k), a.get(k)) for k in sorted(set(b) | set(a))
                if b.get(k) != a.get(k)}

    @property
    def rules_changed(self) -> bool:
        return (self.before or {}).get("rules") != (self.after or {}).get("rules")


def _verdict(entry: dict[str, Any] | None) -> str | None:
    return entry.get("verdict") if entry else None


def _snapshot(entry: dict[str, Any] | None) -> dict[str, Any] | None:
    """The part of an expected.json entry that the engine produces."""
    if entry is None:
        return None
    return {k: entry[k] for k in ("verdict", "rules", "numbers") if k in entry}


def compare(before: dict[str, dict[str, Any]], after: dict[str, dict[str, Any]]) -> list[Change]:
    out = []
    for repo in sorted(set(before) | set(after), key=str.lower):
        b, a = _snapshot(before.get(repo)), _snapshot(after.get(repo))
        if b != a:
            out.append(Change(repo, b, a))
    return out


def _fmt(value: Any) -> str:
    if value is None:
        return "–"
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


def _cell(text: str) -> str:
    return text.replace("|", "\\|")


def hand_check_score(snapshot: dict[str, dict[str, Any]],
                     repos: dict[str, dict[str, Any]]) -> tuple[int, int]:
    checked = {r: m["expected"]["verdict"] for r, m in repos.items() if m.get("expected")}
    agree = sum(1 for r, v in checked.items() if _verdict(snapshot.get(r)) == v)
    return agree, len(checked)


def table(changes: list[Change], repos: dict[str, dict[str, Any]],
          before: dict[str, dict[str, Any]], after: dict[str, dict[str, Any]],
          show_numbers: bool = True) -> str:
    """Markdown: one row per repository whose verdict, rules or counts moved."""
    lines = []
    flips = [c for c in changes if c.verdict_changed]
    lines.append(f"Golden set: {len(after)} repositories, {len(flips)} verdict changes, "
                 f"{len(changes) - len(flips)} with only rules or counts changed.")
    b_ok, n = hand_check_score(before, repos)
    a_ok, _ = hand_check_score(after, repos)
    if n:
        lines.append(f"Hand-checked repositories where the engine agrees: {b_ok}/{n} before, "
                     f"{a_ok}/{n} after.")
    if not changes:
        lines.append("No differences.")
        return "\n".join(lines)

    lines += ["", "| repo | verdict | hand check | rules | counts that moved |",
              "|---|---|---|---|---|"]
    for c in sorted(changes, key=lambda c: (not c.verdict_changed, c.repo.lower())):
        vb, va = _verdict(c.before), _verdict(c.after)
        verdict = (f"**{LABEL.get(vb, _fmt(vb))} → {LABEL.get(va, _fmt(va))}**"
                   if c.verdict_changed else LABEL.get(va, _fmt(va)))
        expected = (repos.get(c.repo) or {}).get("expected")
        if expected:
            want = expected["verdict"]
            hand = (f"{LABEL[want]} "
                    f"{'✓' if vb == want else '✗'}→{'✓' if va == want else '✗'}")
        else:
            hand = ""
        rules = ""
        if c.rules_changed:
            rb = ", ".join((c.before or {}).get("rules", [])) or "–"
            ra = ", ".join((c.after or {}).get("rules", [])) or "–"
            rules = f"{rb} → {ra}"
        moved = ""
        if show_numbers:
            moved = "; ".join(f"{k} {_fmt(x)}→{_fmt(y)}" for k, (x, y) in c.numbers_changed.items())
        lines.append(f"| {c.repo} | {verdict} | {hand} | {_cell(rules)} | {_cell(moved)} |")
    return "\n".join(lines)


def history_problems(expected: dict[str, dict[str, Any]]) -> list[str]:
    """Every snapshot verdict must be the last approved one, each with a reason."""
    problems = []
    for repo, entry in expected.items():
        history = entry.get("history") or []
        if not history:
            problems.append(f"{repo}: no approval history")
            continue
        if any(not (h.get("reason") or "").strip() for h in history):
            problems.append(f"{repo}: an approval without a reason")
        if history[-1].get("to") != entry.get("verdict"):
            problems.append(
                f"{repo}: verdict {entry.get('verdict')} was never approved (the last "
                f"approved verdict is {history[-1].get('to')}); use `python -m golden approve`")
    return problems


# --- commands ------------------------------------------------------------------


def approve(expected: dict[str, dict[str, Any]], current: dict[str, dict[str, Any]],
            reason: str, only: set[str] | None = None, today: str | None = None) -> list[Change]:
    """Write the current engine output into `expected`, logging verdict changes."""
    today = today or datetime.now(UTC).date().isoformat()
    changes = [c for c in compare(expected, current) if only is None or c.repo in only]
    for c in changes:
        if c.after is None:
            expected.pop(c.repo, None)
            continue
        entry = expected.setdefault(c.repo, {})
        history = entry.get("history") or []
        if c.verdict_changed:
            history.append({"date": today, "from": _verdict(c.before), "to": _verdict(c.after),
                            "reason": reason})
        entry.clear()
        entry.update(c.after)
        entry["history"] = history
    return changes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m golden", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    rec = sub.add_parser("record", help="capture live evidence (needs GITHUB_TOKEN)")
    rec.add_argument("repos", nargs="*", help="default: every repository in repos.json")
    rec.add_argument("--force", action="store_true", help="re-record existing recordings")
    diff = sub.add_parser("diff", help="before/after table for the current engine")
    diff.add_argument("--base", help="compare against expected.json at this git ref "
                      "(e.g. origin/main) instead of the working tree's")
    diff.add_argument("--no-numbers", action="store_true", help="verdicts and rules only")
    appr = sub.add_parser("approve", help="accept the current engine output")
    appr.add_argument("--reason", required=True, help="why the change is right; logged "
                      "against every verdict that changes")
    appr.add_argument("repos", nargs="*", help="only these (default: every change)")
    sub.add_parser("check", help="exit 1 on an unapproved change (what CI runs)")
    args = parser.parse_args(argv)

    repos = load_repos()
    if args.cmd == "record":
        return 1 if record(args.repos or list(repos), force=args.force) else 0

    current = run_all(r for r in repos if recording_path(r).exists())
    missing = [r for r in repos if not recording_path(r).exists()]
    if missing:
        print(f"Not recorded yet: {', '.join(missing)}", file=sys.stderr)
    if args.cmd == "diff":
        before = expected_at(args.base) if args.base else load_expected()
        print(table(compare(before, current), repos, before, current,
                    show_numbers=not args.no_numbers))
        return 0
    if args.cmd == "approve":
        if not args.reason.strip():
            parser.error("--reason must say why")
        expected = load_expected()
        before = json.loads(json.dumps(expected))
        changes = approve(expected, current, args.reason.strip(),
                          only=set(args.repos) or None)
        save_expected(expected)
        print(table(changes, repos, before, expected))
        return 0
    # check
    expected = load_expected()
    changes = compare(expected, current)
    problems = history_problems(expected)
    if missing:
        problems.append(f"missing recordings: {', '.join(missing)}")
    if changes or problems:
        print(table(changes, repos, expected, current))
        for p in problems:
            print(f"- {p}")
        print("\nIf the change is intended, run `python -m golden approve --reason \"...\"` "
              "and commit golden/expected.json in the same PR.")
        return 1
    print(table([], repos, expected, current))
    return 0
