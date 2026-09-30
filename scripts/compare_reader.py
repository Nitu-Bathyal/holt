"""Read live repositories with two versions of the evidence reader, side by side.

    uv run python scripts/compare_reader.py --base origin/main pallets/flask psf/requests

Loads `src/holt/evidence/github_graphql.py` as it was at `--base` next to the
one in the working tree, reads each repository with both at the same moment
(same cutoff, same token, on two threads) and compares the evidence records:
ids, links, timestamps and payloads. Prints the GraphQL points and queries
each reader used. For a change to the reader that must not change what it
reads. Needs GITHUB_TOKEN; costs about 10-30 points per repository.

Fields GitHub reports as of the moment it's asked (stars, labels, who is a
collaborator) can differ if they change between the two reads; the reads are
concurrent so that is rare, and the output names every difference.
"""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import Any

from holt.evidence import github_graphql as current
from holt.types import Window

READER = "src/holt/evidence/github_graphql.py"


def load_reader(rev: str) -> ModuleType:
    source = subprocess.run(["git", "show", f"{rev}:{READER}"], check=True,
                            capture_output=True, text=True, encoding="utf-8").stdout
    path = Path(tempfile.mkdtemp()) / "github_graphql_base.py"
    path.write_text(source, encoding="utf-8")
    spec = importlib.util.spec_from_file_location("github_graphql_base", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Counting:
    """Wraps a transport's `query` to count the queries sent."""

    def __init__(self, reader: ModuleType) -> None:
        outer = self

        class Transport(reader.GitHubGraphQL):
            def query(self, document, *, timeout=None, **variables):
                with self._lock:
                    outer.queries += 1
                return super().query(document, timeout=timeout, **variables)

        self.queries = 0
        self.transport = Transport()


def read(reader: ModuleType, repo: str, cutoff: datetime) -> tuple[dict[str, Any], int, int]:
    counting = Counting(reader)
    provider = reader.LiveGitHubProvider(Window.PRE_T, cutoff=cutoff,
                                         transport=counting.transport)
    records = {r.evidence_id: (r.url, r.timestamp.isoformat(), r.payload)
               for r in provider.fetch(repo)}
    return records, counting.transport.points_used, counting.queries


def differences(a: dict[str, Any], b: dict[str, Any]) -> list[str]:
    out = [f"only in base: {k}" for k in sorted(a.keys() - b.keys())]
    out += [f"only in current: {k}" for k in sorted(b.keys() - a.keys())]
    for k in sorted(a.keys() & b.keys()):
        if a[k] != b[k]:
            (ua, ta, pa), (ub, tb, pb) = a[k], b[k]
            fields = [f for f in sorted(set(pa) | set(pb)) if pa.get(f) != pb.get(f)]
            if ua != ub:
                fields.append("url")
            if ta != tb:
                fields.append("timestamp")
            out.append(f"differs: {k} ({', '.join(fields)})")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("repos", nargs="+")
    parser.add_argument("--base", default="origin/main", help="git revision of the old reader")
    args = parser.parse_args(argv)

    base = load_reader(args.base)
    totals = {"base": [0, 0], "current": [0, 0]}
    failed = 0
    print(f"{'repository':32} {'records':>8} {'base pts/q':>11} {'now pts/q':>10}  result")
    for repo in args.repos:
        cutoff = datetime.now(UTC).replace(microsecond=0)
        with ThreadPoolExecutor(2) as pool:
            old_run = pool.submit(read, base, repo, cutoff)
            new_run = pool.submit(read, current, repo, cutoff)
            (old, old_pts, old_q), (new, new_pts, new_q) = old_run.result(), new_run.result()
        totals["base"][0] += old_pts
        totals["base"][1] += old_q
        totals["current"][0] += new_pts
        totals["current"][1] += new_q
        diff = differences(old, new)
        failed += bool(diff)
        print(f"{repo:32} {len(new):>8} {old_pts:>6}/{old_q:<4} {new_pts:>5}/{new_q:<4}  "
              f"{'identical' if not diff else f'{len(diff)} differences'}")
        for line in diff[:20]:
            print(f"    {line}")
    print(f"{'total':32} {'':>8} {totals['base'][0]:>6}/{totals['base'][1]:<4} "
          f"{totals['current'][0]:>5}/{totals['current'][1]:<4}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
