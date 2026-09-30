"""Pull request pages are read several at a time, and read the same as one by one.

GitHub's search cursors are page offsets (`base64("cursor:25")` is the second
page of 25), so once the first page confirms that, the rest can be asked for at
once. What comes back must be exactly what sequential paging would have read:
same pull requests, same order, same stopping point. Every response here comes
from `httpx.MockTransport`; nothing reaches GitHub.
"""

from __future__ import annotations

import base64
import contextvars
import json
import threading
import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from holt.evidence import github_graphql as gql
from holt.types import Window


def cursor(offset: int) -> str:
    return base64.b64encode(f"cursor:{offset}".encode()).decode()


class FakeSearch:
    """GitHub's PR search over `total` pull requests, paged by offset cursors."""

    def __init__(self, total: int, *, count: int | None = None, cursors: bool = True,
                 delay: float = 0.0) -> None:
        self.total = total
        self.count = total if count is None else count  # what issueCount claims
        self.cursors = cursors  # False: opaque cursors, as GitHub may one day send
        self.delay = delay
        self.lock = threading.Lock()
        self.offsets: list[int] = []
        self.in_flight = 0
        self.most_in_flight = 0

    def _offset(self, value: str | None) -> int:
        if value is None:
            return 0
        if self.cursors:
            return int(base64.b64decode(value).decode().split(":")[1])
        return int(value.removeprefix("opaque-"))

    def _cursor(self, offset: int) -> str:
        return cursor(offset) if self.cursors else f"opaque-{offset}"

    def handler(self, request: httpx.Request) -> httpx.Response:
        variables = json.loads(request.content)["variables"]
        if "cursor" not in variables:  # repo meta or docs
            return httpx.Response(200, json={"data": {"repository": None}})
        offset = self._offset(variables["cursor"])
        with self.lock:
            self.offsets.append(offset)
            self.in_flight += 1
            self.most_in_flight = max(self.most_in_flight, self.in_flight)
        try:
            time.sleep(self.delay)
            numbers = range(self.total - offset, max(self.total - offset - 25, 0), -1)
            nodes = [{"number": n} for n in numbers]
            end = offset + len(nodes)
            return httpx.Response(200, json={"data": {
                "rateLimit": {"cost": 1, "remaining": 4000, "resetAt": None},
                "search": {
                    "issueCount": self.count,
                    "pageInfo": {"hasNextPage": end < self.total,
                                 "endCursor": self._cursor(end) if nodes else None},
                    "nodes": nodes,
                },
            }})
        finally:
            with self.lock:
                self.in_flight -= 1

    def transport(self) -> gql.GitHubGraphQL:
        client = httpx.Client(transport=httpx.MockTransport(self.handler))
        return gql.GitHubGraphQL(token="t", client=client, sleep=lambda s: None)


def numbers(nodes) -> list[int]:
    return [n["number"] for n in nodes]


def sequential(total: int, max_pages: int) -> list[int]:
    """What reading one page at a time returns."""
    return list(range(total, max(total - 25 * max_pages, 0), -1))


@pytest.mark.parametrize("total", [0, 1, 24, 25, 26, 50, 199, 200, 201, 1000])
def test_parallel_pages_read_exactly_what_sequential_paging_reads(total):
    fake = FakeSearch(total)
    t = fake.transport()
    assert numbers(t.search_pull_requests("repo:a/b is:pr", 8)) == sequential(total, 8)
    # No page asked for twice, none past the end or past the cap.
    pages = min(8, max(1, -(-total // 25)))
    assert sorted(fake.offsets) == [25 * i for i in range(pages)]
    assert t.points_used == pages


def test_the_first_page_goes_alone_and_the_rest_together():
    fake = FakeSearch(1000, delay=0.05)
    list(fake.transport().search_pull_requests("q", 8))
    assert fake.offsets[0] == 0
    assert fake.most_in_flight == gql.PAGE_CONCURRENCY


def test_opaque_cursors_fall_back_to_one_page_at_a_time():
    fake = FakeSearch(300, cursors=False, delay=0.01)
    assert numbers(fake.transport().search_pull_requests("q", 8)) == sequential(300, 8)
    assert fake.offsets == [25 * i for i in range(8)]
    assert fake.most_in_flight == 1


def test_an_undercounting_total_still_reads_every_page():
    # issueCount says two pages; GitHub actually has five.
    fake = FakeSearch(125, count=40)
    assert numbers(fake.transport().search_pull_requests("q", 8)) == sequential(125, 8)


def test_an_overcounting_total_stops_where_github_does():
    fake = FakeSearch(60, count=500)
    assert numbers(fake.transport().search_pull_requests("q", 8)) == sequential(60, 8)


def test_wanted_limits_how_many_pages_are_asked_for_ahead():
    fake = FakeSearch(1000)
    read: list[int] = []
    for node in fake.transport().search_pull_requests("q", 8, wanted=lambda: 1):
        read.append(node["number"])
        if len(read) == 50:
            break
    assert read == sequential(1000, 2)
    # Page 1, then one more at a time, asked for once the one before is read.
    assert sorted(fake.offsets) == [0, 25]


def test_a_failed_page_raises_to_the_reader():
    fake = FakeSearch(200)
    inner = fake.handler

    def handler(request):
        if json.loads(request.content)["variables"].get("cursor") == cursor(75):
            return httpx.Response(404)
        return inner(request)

    t = gql.GitHubGraphQL(token="t", client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(gql.UpstreamError):
        list(t.search_pull_requests("q", 8))


def test_pages_run_in_the_callers_context():
    # The server stops a timed-out job at its next GitHub call through a
    # context variable; the page threads must see it.
    flag: contextvars.ContextVar[str] = contextvars.ContextVar("flag", default="unset")
    seen: set[str] = set()
    fake = FakeSearch(200)

    class Watching(gql.GitHubGraphQL):
        def query(self, document, *, timeout=None, **variables):
            seen.add(flag.get())
            return super().query(document, timeout=timeout, **variables)

    t = Watching(token="t", client=httpx.Client(transport=httpx.MockTransport(fake.handler)))
    flag.set("job-7")
    list(t.search_pull_requests("q", 8))
    assert seen == {"job-7"}


# --- the provider -------------------------------------------------------------

NOW = datetime(2026, 9, 29, 12, tzinfo=UTC)


def _pr(number: int, created: datetime, association: str = "NONE") -> dict:
    return {
        "number": number, "title": f"PR {number}", "createdAt": created.isoformat(),
        "mergedAt": None, "closedAt": None, "merged": False,
        "additions": 1, "deletions": 0, "changedFiles": 1, "isDraft": False,
        "authorAssociation": association,
        "author": {"login": f"user{number}", "__typename": "User"}, "mergedBy": None,
        "labels": {"nodes": []}, "files": {"nodes": []},
        "reviews": {"nodes": []}, "comments": {"nodes": []},
        "timelineItems": {"nodes": []},
    }


class GitHub:
    """A repository on fake GitHub: meta, docs, and two PR searches."""

    def __init__(self, newest: list[dict], older: list[dict]) -> None:
        self.newest, self.older = newest, older
        self.lock = threading.Lock()
        self.pages: list[tuple[str, int]] = []
        self.queries: list[tuple[str, int]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        variables = body["variables"]
        if "until" in variables:
            return httpx.Response(200, json={"data": {"repository": {
                "createdAt": "2020-01-01T00:00:00Z", "pushedAt": NOW.isoformat(),
                "isArchived": False, "isMirror": False, "isFork": False,
                "description": None, "homepageUrl": None, "primaryLanguage": None,
                "stargazerCount": 1, "nameWithOwner": "a/b",
                "defaultBranchRef": {"name": "main", "target": {"history": {"nodes": [
                    {"oid": "abc", "committedDate": "2026-09-01T00:00:00Z"}]}}},
            }}})
        if "cursor" not in variables:
            return httpx.Response(200, json={"data": {"repository": {
                "readme0": {"text": "# b"}}}})
        if ".." in variables["q"]:  # the timing cohort's search: none here
            with self.lock:
                self.queries.append((variables["q"], 0))
            return httpx.Response(200, json={"data": {"search": {
                "issueCount": 0, "pageInfo": {"hasNextPage": False, "endCursor": None},
                "nodes": []}}})
        pool = self.older if self._is_settled(variables["q"]) else self.newest
        offset = 0 if variables["cursor"] is None else int(
            base64.b64decode(variables["cursor"]).decode().split(":")[1])
        with self.lock:
            self.pages.append(("older" if pool is self.older else "newest", offset))
            self.queries.append((variables["q"], offset))
        chunk = pool[offset:offset + 25]
        end = offset + len(chunk)
        return httpx.Response(200, json={"data": {"search": {
            "issueCount": len(pool),
            "pageInfo": {"hasNextPage": end < len(pool), "endCursor": cursor(end)},
            "nodes": chunk,
        }}})

    @staticmethod
    def _is_settled(q: str) -> bool:
        return f"created:<{NOW.date().isoformat()}" not in q

    def provider(self) -> gql.LiveGitHubProvider:
        client = httpx.Client(transport=httpx.MockTransport(self.handler))
        return gql.LiveGitHubProvider(
            Window.PRE_T, cutoff=NOW,
            transport=gql.GitHubGraphQL(token="t", client=client, sleep=lambda s: None))


def test_the_settled_read_asks_only_for_pages_it_expects_to_need():
    # A busy repository: 200 pull requests in the last two days, then older
    # ones where one in five is from an outsider (5 a page, 60 wanted).
    newest = [_pr(10_000 - i, NOW - timedelta(hours=1 + i * 0.24)) for i in range(200)]
    older = [_pr(5_000 - i, NOW - timedelta(days=15, hours=i),
                 association="NONE" if i % 5 == 0 else "MEMBER") for i in range(400)]
    gh = GitHub(newest, older)
    records = gh.provider().fetch("a/b")
    older_pages = sorted(o for kind, o in gh.pages if kind == "older")
    # Sequential paging would read 8 pages (the cap) and use every one.
    assert older_pages == [25 * i for i in range(8)]
    opened = [r for r in records if r.evidence_id.endswith(":opened")]
    assert len(opened) == 400


def test_the_settled_read_stops_at_the_same_page_as_before():
    # Half the older pull requests are from outsiders: 12-13 a page, so the
    # target of 60 is met on the fifth page, and reading stops there.
    newest = [_pr(10_000 - i, NOW - timedelta(hours=1 + i * 0.24)) for i in range(200)]
    older = [_pr(5_000 - i, NOW - timedelta(days=15, hours=i),
                 association="NONE" if i % 2 == 0 else "MEMBER") for i in range(400)]
    gh = GitHub(newest, older)
    records = gh.provider().fetch("a/b")
    opened = [r for r in records if r.evidence_id.endswith(":opened")]
    assert len(opened) == 200 + 5 * 25
    older_pages = sorted(o for kind, o in gh.pages if kind == "older")
    # At most one page read past the stop, from an estimate made on page 1.
    assert older_pages[:5] == [0, 25, 50, 75, 100]
    assert len(older_pages) <= 6


@pytest.fixture
def early(monkeypatch) -> list[str]:
    """The queries whose first page was started early."""
    started: list[str] = []
    real = gql.GitHubGraphQL.first_page

    def first_page(self, q):
        started.append(q)
        return real(self, q)

    monkeypatch.setattr(gql.GitHubGraphQL, "first_page", first_page)
    return started


def test_a_busy_repository_starts_the_older_read_early(early):
    # The search leaves out today, so the newest page starts hours back.
    newest = [_pr(10_000 - i, NOW - timedelta(hours=20, minutes=i * 10)) for i in range(200)]
    older = [_pr(5_000 - i, NOW - timedelta(days=15, hours=i)) for i in range(100)]
    gh = GitHub(newest, older)
    records = gh.provider().fetch("a/b")
    settle_day = (NOW - timedelta(days=gql.SETTLE_DAYS)).date().isoformat()
    # The first older page was asked for once, under the query the read uses.
    query = f"repo:a/b is:pr created:<{settle_day} sort:created-desc"
    assert early == [query]
    assert gh.queries.count((query, 0)) == 1
    assert len([r for r in records if r.evidence_id.endswith(":opened")]) == 200 + 75


def test_a_wrong_early_guess_is_left_unread(early):
    # The first page is busy, then the pace drops: the newest pages reach back
    # 30 days, so the read carries on from their oldest day instead.
    newest = [_pr(10_000 - i, NOW - timedelta(minutes=5 + i)) for i in range(25)]
    newest += [_pr(9_000 - i, NOW - timedelta(days=1 + i * 29 / 175),
                   association="MEMBER") for i in range(175)]
    older = [_pr(5_000 - i, NOW - timedelta(days=31, hours=i)) for i in range(100)]
    gh = GitHub(newest, older)
    records = gh.provider().fetch("a/b")
    oldest_day = (NOW - timedelta(days=1 + 174 * 29 / 175)).date().isoformat()
    carry_on = f"repo:a/b is:pr created:<={oldest_day} sort:created-desc"
    assert [o for q, o in gh.queries if q == carry_on] == [0, 25, 50]
    assert len([r for r in records if r.evidence_id.endswith(":opened")]) == 200 + 75
    # The early guess cost its one page, and nothing from it was kept.
    settle_day = (NOW - timedelta(days=gql.SETTLE_DAYS)).date().isoformat()
    guess = f"repo:a/b is:pr created:<{settle_day} sort:created-desc"
    assert early == [guess]
    assert [o for q, o in gh.queries if q == guess] == [0]


def test_a_quiet_repository_never_starts_the_older_read(early):
    newest = [_pr(10_000 - i, NOW - timedelta(days=i)) for i in range(200)]
    gh = GitHub(newest, [])
    gh.provider().fetch("a/b")
    assert early == []
    assert all(kind == "newest" for kind, _ in gh.pages)
