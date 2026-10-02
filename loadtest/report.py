#!/usr/bin/env python3
"""Turn one run's files into a short Markdown report.

    python3 loadtest/report.py loadtest/results/<run>

Reads what run.sh left in that directory: k6's summary (summary.json), the
watcher's samples (samples.jsonl), the jobs the run started (jobs.tsv) and
the GitHub points before and after (points.txt). Any of them may be missing.
Standard library only.
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def load_samples(path: Path) -> list[dict]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def table(head: list[str], rows: list[list]) -> str:
    def cell(v) -> str:
        return "-" if v is None or v == "" else str(v)

    lines = ["| " + " | ".join(head) + " |", "|" + "|".join("---" if i == 0 else "---:" for i in range(len(head))) + "|"]
    lines += ["| " + " | ".join(cell(v) for v in row) + " |" for row in rows]
    return "\n".join(lines)


def percent(rate: float | None) -> str | None:
    return None if rate is None else f"{rate * 100:.2f}%"


def server_rows(samples: list[dict], windows: list[tuple[str, float, float]]) -> tuple[list[str], list[list]]:
    """Per window: each service's CPU and memory, the database's connections, the queue, the host."""
    services = sorted({name for s in samples for name in s.get("containers", {})})
    head = ["window"]
    for name in services:
        head += [f"{name} CPU avg / peak", f"{name} MB peak"]
    head += ["DB open peak (active)", "jobs queued peak", "k6 CPU avg", "host load peak", "host MB free min"]
    rows = []
    for name, start, end in windows:
        inside = [s for s in samples if start <= s["t"] <= end]
        if not inside:
            continue
        row: list = [name]
        for service in services:
            cpu = [s["containers"][service]["cpu"] for s in inside if service in s.get("containers", {})]
            mem = [s["containers"][service]["mem_mb"] for s in inside if service in s.get("containers", {})]
            row += [f"{statistics.fmean(cpu):.0f}% / {max(cpu):.0f}%" if cpu else None, f"{max(mem):.0f}" if mem else None]
        db = [s["db"] for s in inside if s.get("db")]
        row.append(f"{max(d['open'] for d in db)} ({max(d['active'] for d in db)})" if db else None)
        queue = [s["jobs"]["queued"] for s in inside if s.get("jobs")]
        row.append(max(queue) if queue else None)
        k6 = [s["k6_cpu"] for s in inside if s.get("k6_cpu") is not None]
        row.append(f"{statistics.fmean(k6):.0f}%" if k6 else None)
        row.append(f"{max(s['load1'] for s in inside):.1f}")
        row.append(min(s["available_mb"] for s in inside))
        rows.append(row)
    return head, rows


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    run = Path(sys.argv[1])
    summary = load_json(run / "summary.json")
    samples = load_samples(run / "samples.jsonl")
    out: list[str] = [f"## {summary.get('scenario', run.name)}: {summary.get('path', 'no k6 summary')}", ""]
    if summary:
        out += [f"Target {summary.get('target')}, build `{(summary.get('live') or 'unknown')[:7]}`.", ""]

    windows = summary.get("windows") or []
    if windows:
        out.append(table(
            ["window", "VUs", "pages/s", "p50 ms", "p95 ms", "p99 ms", "max ms", "first byte p95 ms", "failed", "bad"],
            [[w["name"], w.get("vus"), w.get("per_second"), *((w.get("duration") or {}).get(k) for k in ("p50", "p95", "p99", "max")),
              (w.get("first_byte") or {}).get("p95"), percent(w.get("failed")), percent(w.get("bad"))] for w in windows]))
        out.append("")
        pages = sorted({p for w in windows for p in w.get("pages", {})})
        if pages:
            out += ["p95 ms by page (share of bad answers):", ""]
            out.append(table(["window", *pages], [
                [w["name"], *(f"{w['pages'][p]['p95']:.0f} ({percent(w['pages'][p].get('bad'))})" if p in w.get("pages", {}) else None for p in pages)]
                for w in windows]))
            out.append("")

    checks = summary.get("checks")
    if checks:
        total = checks.get("total") or {}
        outcomes = ", ".join(f"{n} {name}" for name, n in checks.get("outcomes", {}).items() if n)
        out += [f"Checks: {outcomes or 'none ran'}.",
                f"From starting a check to its report: p50 {total.get('p50')} ms, p95 {total.get('p95')} ms, max {total.get('max')} ms. "
                f"Most checks ahead in the queue on arrival: {checks.get('most_ahead')}.", ""]

    if samples:
        started = (summary.get("started") or samples[0]["t"] * 1000) / 1000
        spans = [(w["name"], started + w["from"], started + w["to"]) for w in windows]
        spans.append(("whole run", samples[0]["t"], samples[-1]["t"]))
        head, rows = server_rows(samples, spans)
        out += ["Server side (CPU is percent of one core):", "", table(head, rows), ""]
        by_db: dict[str, int] = {}
        for s in samples:
            for name, n in (s.get("db") or {}).get("by_database", {}).items():
                by_db[name] = max(by_db.get(name, 0), n)
        if by_db:
            out += ["Most connections open per database: " + ", ".join(f"{k} {v}" for k, v in sorted(by_db.items())) + ".", ""]
        for s in samples:
            if s.get("stopped"):
                out += [f"**Stopped early:** {s['stopped']}.", ""]

    try:
        jobs = [line.split("\t") for line in (run / "jobs.tsv").read_text(encoding="utf-8").splitlines() if line]
    except OSError:
        jobs = []
    if jobs:
        out += ["Jobs started during the run:", "",
                table(["kind", "repo", "status", "queue wait s", "run s"], [[*job[:3], *job[3:5]] for job in jobs]), ""]
        waits = [float(j[3]) for j in jobs if len(j) > 3 and j[3]]
        runs = [float(j[4]) for j in jobs if len(j) > 4 and j[4]]
        if waits and runs:
            out += [f"Queue wait: median {statistics.median(waits):.1f} s, longest {max(waits):.1f} s. "
                    f"Run time: median {statistics.median(runs):.1f} s, longest {max(runs):.1f} s.", ""]

    try:
        before, after = (int(v) for v in (run / "points.txt").read_text(encoding="utf-8").split())
        out += [f"GitHub points on staging's tokens: {before} before, {after} after ({before - after} used while the run lasted).", ""]
    except (OSError, ValueError):
        pass

    print("\n".join(out).rstrip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
