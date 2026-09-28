"""The settled sample: a busy repository is read back past the settle window.

A busy repository's newest 200 pull requests span a day or two, and none of
them is old enough for the rates (rates.py counts only pull requests opened
at least 14 days before the read). The live provider then reads further back,
a page at a time, until it has enough outside pull requests that count.
Fake transport; no network.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from holt.agent.signals import build_threads, compute
from holt.evidence import github_graphql as gql
from holt.types import Window

NOW = datetime(2026, 9, 28, 12, tzinfo=UTC)


def _meta() -> dict:
    return {
        "createdAt": "2020-01-01T00:00:00Z", "pushedAt": "2026-09-27T00:00:00Z",
        "isArchived": False, "isMirror": False, "isFork": False, "stargazerCount": 1,
        "description": None, "homepageUrl": None, "primaryLanguage": None,
        "nameWithOwner": "a/b", "mirrorUrl": None, "parent": None,
        "releases": {"totalCount": 0, "nodes": []}, "defaultBranchRef": None,
    }


def _node(number: int, opened: datetime, association: str = "NONE",
          merged: bool = False) -> dict:
    iso = opened.strftime("%Y-%m-%dT%H:%M:%SZ")
    done = (opened + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "number": number, "title": "t", "createdAt": iso,
        "mergedAt": done if merged else None, "closedAt": done if merged else None,
        "merged": merged, "additions": 1, "deletions": 0, "changedFiles": 1,
        "isDraft": False, "authorAssociation": association,
        "author": {"login": f"user{number}", "__typename": "User"},
        "mergedBy": {"login": "m", "__typename": "User"} if merged else None,
        "labels": {"nodes": []}, "files": {"nodes": []},
        "reviews": {"nodes": []}, "comments": {"nodes": []},
        "timelineItems": {"nodes": []},
    }


class Transport:
    """Serves `newest` for the first search and pages of `older` after it."""

    def __init__(self, newest: list[dict], older: list[dict]) -> None:
        self.newest, self.older = newest, older
        self.queries: list[str] = []
        self.pages_served = 0

    def repo_meta(self, owner, name, until):
        return _meta()

    def search_pull_requests(self, q, max_pages):
        self.queries.append(q)
        if len(self.queries) == 1:
            yield from self.newest
            return
        for page in range(max_pages):
            chunk = self.older[page * gql.PAGE_SIZE:(page + 1) * gql.PAGE_SIZE]
            if not chunk:
                return
            self.pages_served += 1
            yield from chunk


def _busy(n: int = 200) -> list[dict]:
    """n pull requests in the last two days, newest first."""
    return [_node(10_000 - i, NOW - timedelta(hours=1 + i * 48 / n)) for i in range(n)]


def _older(n: int, start_days: float = 15, association: str = "NONE",
           merged_every: int = 10) -> list[dict]:
    return [_node(5_000 - i, NOW - timedelta(days=start_days, hours=i),
                  association=association, merged=i % merged_every == 0)
            for i in range(n)]


def _fetch(transport: Transport, **kw) -> list:
    provider = gql.LiveGitHubProvider(Window.PRE_T, cutoff=NOW, transport=transport, **kw)
    return provider.fetch("a/b")


def test_a_busy_repository_is_read_back_past_the_settle_window():
    t = Transport(_busy(), _older(150))
    records = _fetch(t)
    assert len(t.queries) == 2
    assert "created:<2026-09-14" in t.queries[1]
    # Three pages hold 75 outside pull requests: past the target of 60, so it stops.
    assert t.pages_served == 3
    s = compute(build_threads(records), as_of=NOW)
    assert s.outsider_still_open == 200
    assert s.outsider_judgeable == 75
    assert s.merge_rate == 8 / 75


def test_the_extra_read_is_capped():
    # Only the team opens the older pull requests: the target is never met.
    t = Transport(_busy(), _older(400, association="MEMBER"))
    _fetch(t)
    assert t.pages_served == gql.SETTLED_MAX_PAGES


def test_no_extra_read_when_the_newest_pages_are_enough():
    newest = [_node(10_000 - i, NOW - timedelta(days=i)) for i in range(200)]
    t = Transport(newest, _older(100))
    _fetch(t)
    assert len(t.queries) == 1


def test_no_extra_read_when_the_repository_has_no_more():
    t = Transport(_busy(120), _older(100))
    _fetch(t)
    assert len(t.queries) == 1


def test_a_screen_never_reads_further():
    class ScreenTransport(Transport):
        def search_pull_requests(self, q, max_pages, timeline=True):
            return super().search_pull_requests(q, max_pages)

    t = ScreenTransport(_busy(), _older(100))
    _fetch(t, timeline=False)
    assert len(t.queries) == 1


def test_it_carries_on_from_the_oldest_day_already_read():
    # The newest pages reach back 20 days, with few outsiders among them.
    newest = [_node(10_000 - i, NOW - timedelta(hours=i * 2.4), association="MEMBER")
              for i in range(200)]
    older = [_node(9_801, NOW - timedelta(hours=199 * 2.4)), *_older(60, start_days=21)]
    t = Transport(newest, older)
    records = _fetch(t)
    oldest_day = (NOW - timedelta(hours=199 * 2.4)).date().isoformat()
    assert f"created:<={oldest_day}" in t.queries[1]
    # The repeat of #9801 is read once.
    assert sum(1 for r in records if r.evidence_id == "pr:a/b#9801:opened") == 1


def test_settled_query_bounds():
    assert gql.settled_query("a/b", NOW, NOW - timedelta(days=2)) == (
        "repo:a/b is:pr created:<2026-09-14 sort:created-desc")
    assert gql.settled_query("a/b", NOW, NOW - timedelta(days=30)) == (
        "repo:a/b is:pr created:<=2026-08-29 sort:created-desc")
