"""Re-record the v2 evidence fixture from live GitHub. Not run by the tests.

    GITHUB_TOKEN=... uv run python tests/recordings/evidence_v2/record.py

Writes `recorded.json`: for a handful of repositories chosen for their shape,
the raw `REPO_META` answer and a few raw pull-request nodes from `PR_SEARCH`,
exactly as the live provider receives them. `tests/test_evidence_v2.py` runs
them through the projection, so the parsing of every v2 field is tested on
what GitHub really sends, with no network.

Only a few pull requests per repository are kept, picked so that each field
the v2 capture added shows up at least once. Bodies are cut short and
credential formats scrubbed; the token travels in a header and is never
recorded.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from holt.evidence.github_graphql import GitHubGraphQL, search_query
from holt.evidence.redact import redact_payload
from holt.types import Window

HERE = Path(__file__).parent
MAX_BODY = 300
PER_REPO = 5

# Why each is here:
#   pytorch/pytorch     merged by a bot that closes PRs with a commit; drafts; labels
#   react/react-native  merged by an internal sync that closes PRs with a commit
#   openssl/openssl     maintainers push by hand, then close: same-repo references
#   pallets/flask       ordinary merges and quick triage closes by a person
#   v8/v8, base/chains  a mirror and a fork (repository metadata only)
PR_REPOS = ("pytorch/pytorch", "react/react-native", "openssl/openssl", "pallets/flask")
META_ONLY = ("v8/v8", "base/chains")


def _closer_type(pr: dict[str, Any]) -> str | None:
    for node in (pr.get("timelineItems") or {}).get("nodes") or []:
        if node and node.get("__typename") == "ClosedEvent":
            return (node.get("closer") or {}).get("__typename") or "person"
    return None


def _has_same_repo_reference(slug: str) -> Callable[[dict[str, Any]], bool]:
    def check(pr: dict[str, Any]) -> bool:
        return any(
            ((n or {}).get("commitRepository") or {}).get("nameWithOwner", "").lower()
            == slug.lower()
            for n in (pr.get("timelineItems") or {}).get("nodes") or []
        )
    return check


def _wanted(slug: str) -> list[Callable[[dict[str, Any]], bool]]:
    """One predicate per field shape worth covering; the first match wins each."""
    return [
        lambda pr: bool(pr.get("mergedAt")) and bool(pr.get("mergedBy")),
        lambda pr: not pr.get("merged") and _closer_type(pr) == "Commit",
        lambda pr: not pr.get("merged") and _closer_type(pr) == "person",
        _has_same_repo_reference(slug),
        lambda pr: bool(pr.get("isDraft")),
        lambda pr: bool((pr.get("labels") or {}).get("nodes")),
    ]


def _pick(slug: str, nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    picked: list[dict[str, Any]] = []
    for predicate in _wanted(slug):
        if len(picked) >= PER_REPO:
            break
        match = next((n for n in nodes if predicate(n) and n not in picked), None)
        if match is not None:
            picked.append(match)
    return picked


def _trim(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: (v[:MAX_BODY] if k == "body" and isinstance(v, str) else _trim(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_trim(v) for v in value]
    return value


def main() -> None:
    now = datetime.now(UTC).replace(microsecond=0)
    gh = GitHubGraphQL()
    repos: dict[str, Any] = {}
    for slug in PR_REPOS + META_ONLY:
        owner, _, name = slug.partition("/")
        entry: dict[str, Any] = {"meta": gh.repo_meta(owner, name, now)}
        if slug in PR_REPOS:
            nodes = list(gh.search_pull_requests(
                search_query(slug, Window.PRE_T, now), max_pages=4
            ))
            entry["pull_requests"] = _pick(slug, nodes)
        clean, _ = redact_payload(_trim(entry))
        repos[slug] = clean
        print(f"{slug}: {len(entry.get('pull_requests', []))} pull requests", file=sys.stderr)

    path = HERE / "recorded.json"
    path.write_text(
        json.dumps({"recorded_at": now.isoformat(), "points_used": gh.points_used,
                    "repos": repos}, indent=1, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {path} ({gh.points_used} rate-limit points)", file=sys.stderr)


if __name__ == "__main__":
    main()
