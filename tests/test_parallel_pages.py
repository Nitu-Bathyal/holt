"""Pull request pages are read several at a time, and read the same as one by one.

GitHub's search cursors are page offsets (`base64("cursor:29")` is the page
after the first 29), so once the first page confirms that, the rest can be
asked for at once. What comes back must be exactly what sequential paging in
pages of 25 would have read: same pull requests, same order, same stopping
point, whatever size the pages are read in. Every response here comes from
`httpx.MockTransport`; nothing reaches GitHub.
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
        self.sizes: list[int] = []
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
            size = variables.get("first", 25)
            self.sizes.append(size)
            numbers = range(self.total - offset, max(self.total - offset - size, 0), -1)
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
    """What reading one page of 25 at a time returns."""
    return list(range(total, max(total - 25 * max_pages, 0), -1))


@pytest.mark.parametrize("total", [0, 1, 24, 25, 26, 29, 30, 50, 199, 200, 201, 1000])
def test_parallel_pages_read_exactly_what_sequential_paging_reads(total):
    fake = FakeSearch(total)
    t = fake.transport()
    assert numbers(t.search_pull_requests("repo:a/b is:pr", 8)) == sequential(total, 8)
    # Pages of 29, the most that cost one point. No page asked for twice, none
    # past the end, and none past the cap of 200: the last asks for what's left.
    offsets = list(range(0, max(1, min(total, 200)), gql.FETCH_SIZE))
    assert sorted(fake.offsets) == offsets
    assert t.points_used == len(offsets)
    if total >= 200:
        assert sorted(fake.sizes) == [26] + [29] * 6


def test_the_screen_reads_pages_of_25():
    fake = FakeSearch(1000)
    t = fake.transport()
    assert numbers(t.search_pull_requests("q", 3, timeline=False)) == sequential(1000, 3)
    assert sorted(fake.offsets) == [0, 25, 50]
    assert fake.sizes == [25, 25, 25]  # no `first` sent: PR_SEARCH_SCREEN's own 25


def test_a_first_page_of_another_size_is_carried_on_from():
    # The opening query reads the first 28; the rest follow on from there.
    fake = FakeSearch(1000)
    t = fake.transport()
    first = gql.done(t._page(gql.PR_PAGE, "q", None, gql.OPENING_SIZE))
    assert numbers(t.search_pull_requests("q", 8, first=first)) == sequential(1000, 8)
    assert sorted(fake.offsets) == [0, 28, 57, 86, 115, 144, 173]
    assert sorted(fake.sizes) == [27, 28] + [29] * 5


def test_the_first_page_goes_alone_and_the_rest_together():
    fake = FakeSearch(1000, delay=0.05)
    list(fake.transport().search_pull_requests("q", 8))
    assert fake.offsets[0] == 0
    assert fake.most_in_flight == gql.PAGE_CONCURRENCY


def test_opaque_cursors_fall_back_to_one_page_at_a_time():
    fake = FakeSearch(300, cursors=False, delay=0.01)
    assert numbers(fake.transport().search_pull_requests("q", 8)) == sequential(300, 8)
    assert fake.offsets == [29 * i for i in range(7)]
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
    assert sorted(fake.offsets) == [0, 29]


def test_a_failed_page_raises_to_the_reader():
    fake = FakeSearch(200)
    inner = fake.handler

    def handler(request):
        if json.loads(request.content)["variables"].get("cursor") == cursor(87):
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

    def __init__(self, newest: list[dict], older: list[dict], *, name: str = "a/b",
                 head: str = "abc") -> None:
        self.newest, self.older = newest, older
        self.name = name  # what GitHub calls the repository now
        self.head = head  # HEAD's commit; the cutoff commit is "abc"
        self.lock = threading.Lock()
        self.pages: list[tuple[str, int]] = []
        self.queries: list[tuple[str, int]] = []
        self.docs_read_at: list[str] = []  # commits a docs query asked at

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        variables = body["variables"]
        if "until" in variables:  # the opening query: facts, docs and a first page
            return httpx.Response(200, json={"data": {
                "repository": {
                    "createdAt": "2020-01-01T00:00:00Z", "pushedAt": NOW.isoformat(),
                    "isArchived": False, "isMirror": False, "isFork": False,
                    "description": None, "homepageUrl": None, "primaryLanguage": None,
                    "stargazerCount": 1, "nameWithOwner": self.name,
                    "defaultBranchRef": {"name": "main", "target": {"oid": self.head, "history": {
                        "nodes": [{"oid": "abc", "committedDate": "2026-09-01T00:00:00Z"}]}}},
                    **({"readme0": {"text": f"# b at {self.head}"}}
                       if 'expression:"HEAD:README.md"' in body["query"] else {}),
                },
                "search": self._search(variables["q"], None, variables["first"]),
            }})
        if "cursor" not in variables:
            oid = body["query"].split('expression:"', 1)[1].split(":", 1)[0]
            self.docs_read_at.append(oid)
            return httpx.Response(200, json={"data": {"repository": {
                "readme0": {"text": f"# b at {oid}"}}}})
        if ".." in variables["q"]:  # the timing cohort's search: none here
            with self.lock:
                self.queries.append((variables["q"], 0))
            return httpx.Response(200, json={"data": {"search": {
                "issueCount": 0, "pageInfo": {"hasNextPage": False, "endCursor": None},
                "nodes": []}}})
        return httpx.Response(200, json={"data": {"search": self._search(
            variables["q"], variables["cursor"], variables.get("first", 25))}})

    def _search(self, q: str, after: str | None, size: int) -> dict:
        pool = self.older if self._is_settled(q) else self.newest
        if not q.startswith(f"repo:{self.name} "):
            pool = []  # a search under an old name finds nothing
        offset = 0 if after is None else int(base64.b64decode(after).decode().split(":")[1])
        with self.lock:
            self.pages.append(("older" if pool is self.older else "newest", offset))
            self.queries.append((q, offset))
        chunk = pool[offset:offset + size]
        end = offset + len(chunk)
        return {
            "issueCount": len(pool),
            "pageInfo": {"hasNextPage": end < len(pool), "endCursor": cursor(end)},
            "nodes": chunk,
        }

    @staticmethod
    def _is_settled(q: str) -> bool:
        return f"created:<{NOW.date().isoformat()}" not in q

    def provider(self, cutoff: datetime = NOW) -> gql.LiveGitHubProvider:
        client = httpx.Client(transport=httpx.MockTransport(self.handler))
        return gql.LiveGitHubProvider(
            Window.PRE_T, cutoff=cutoff,
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
    # Sequential paging would read 8 pages of 25 (the cap) and use every one;
    # in pages of 29 that's 7.
    assert older_pages == [29 * i for i in range(7)]
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
    assert older_pages[:5] == [0, 29, 58, 87, 116]
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
    assert [o for q, o in gh.queries if q == carry_on] == [0, 29, 58]
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


# --- the opening query ----------------------------------------------------------


def _readme(records) -> str:
    return next(r for r in records if r.evidence_id == "repo:a/b:readme").payload["text"]


def test_a_live_read_takes_its_docs_from_the_opening_query():
    gh = GitHub([], [])
    records = gh.provider(cutoff=datetime.now(UTC)).fetch("a/b")
    assert _readme(records) == "# b at abc"
    assert gh.docs_read_at == []  # HEAD is the cutoff commit: nothing more to read


def test_a_push_since_the_cutoff_reads_the_docs_at_the_cutoff_commit():
    gh = GitHub([], [], head="def")
    records = gh.provider(cutoff=datetime.now(UTC)).fetch("a/b")
    assert _readme(records) == "# b at abc"
    assert gh.docs_read_at == ["abc"]


def test_a_read_as_of_a_past_date_doesnt_ask_for_docs_at_head():
    gh = GitHub([], [])
    records = gh.provider(cutoff=datetime.now(UTC) - timedelta(days=2)).fetch("a/b")
    assert _readme(records) == "# b at abc"
    assert gh.docs_read_at == ["abc"]


def test_the_opening_page_is_the_first_of_the_newest():
    newest = [_pr(10_000 - i, NOW - timedelta(days=i)) for i in range(300)]
    gh = GitHub(newest, [])
    records = gh.provider().fetch("a/b")
    assert sorted(o for kind, o in gh.pages) == [0, 28, 57, 86, 115, 144, 173]
    opened = sorted(int(r.evidence_id.split("#")[1].split(":")[0])
                    for r in records if r.evidence_id.endswith(":opened"))
    assert opened == list(range(10_000 - 199, 10_001))


def test_a_renamed_repository_drops_the_opening_page_and_searches_the_new_name():
    newest = [_pr(10_000 - i, NOW - timedelta(days=i)) for i in range(40)]
    gh = GitHub(newest, [], name="c/d")
    records = gh.provider().fetch("a/b")
    assert [q.split()[0] for q, _ in gh.queries] == ["repo:a/b", "repo:c/d", "repo:c/d"]
    assert len([r for r in records if r.evidence_id.endswith(":opened")]) == 40


def test_a_missing_repository_is_not_found():
    def handler(request):
        return httpx.Response(200, json={
            "data": {"repository": None, "search": {
                "issueCount": 0, "pageInfo": {"hasNextPage": False, "endCursor": None},
                "nodes": []}},
            "errors": [{"type": "NOT_FOUND", "path": ["repository"],
                        "message": "Could not resolve to a Repository with the name 'a/b'."}],
        })

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = gql.LiveGitHubProvider(
        Window.PRE_T, cutoff=NOW, transport=gql.GitHubGraphQL(token="t", client=client))
    with pytest.raises(gql.RepoNotFound):
        provider.fetch("a/b")


# --- page sizes never change the evidence ---------------------------------------


def _outsiders(every: int, n: int = 400, days: float = 15) -> list[dict]:
    return [_pr(5_000 - i, NOW - timedelta(days=days, hours=i),
                association="NONE" if i % every == 0 else "MEMBER") for i in range(n)]


def _busy(n: int = 200) -> list[dict]:
    return [_pr(10_000 - i, NOW - timedelta(hours=1 + i * 0.24)) for i in range(n)]


def _with_holes(nodes: list) -> list:
    """GitHub sends null for a node it couldn't resolve."""
    return [None if i % 37 == 5 else n for i, n in enumerate(nodes)]


SAMPLES = {
    "busy, the older read runs to its cap": lambda: (_busy(), _outsiders(5)),
    "busy, stops after 5 steps": lambda: (_busy(), _outsiders(2)),
    "busy, stops after 7 steps": lambda: (_busy(), _outsiders(3)),
    "busy, the older read runs out": lambda: (_busy(), _outsiders(2, n=70)),
    "quiet, no older read": lambda: ([_pr(10_000 - i, NOW - timedelta(days=i))
                                      for i in range(300)], []),
    "small": lambda: ([_pr(10_000 - i, NOW - timedelta(days=i)) for i in range(60)], []),
    "exactly 200": lambda: (_busy(), []),
    "nulls in both reads": lambda: (_with_holes(_busy()), _with_holes(_outsiders(3))),
    "reaching past the window": lambda: (
        [_pr(10_000 - i, NOW - timedelta(hours=i * 2.4), association="MEMBER")
         for i in range(200)], _outsiders(4, days=21)),
}


@pytest.mark.parametrize("sample", SAMPLES)
def test_pages_of_28_and_29_read_what_pages_of_25_read(monkeypatch, sample):
    newest, older = SAMPLES[sample]()

    def read() -> tuple[dict, int]:
        gh = GitHub(newest, older)
        records = gh.provider().fetch("a/b")
        return {r.evidence_id: r.payload for r in records}, len(gh.pages)

    reshaped, pages = read()
    monkeypatch.setattr(gql, "FETCH_SIZE", 25)
    monkeypatch.setattr(gql, "OPENING_SIZE", 25)
    before, pages_before = read()
    assert reshaped == before
    assert pages <= pages_before


def test_a_busy_repository_starts_the_timing_search_with_the_first_page():
    """The first page shows the newest 200 won't reach back 240 days, so the
    cohort's search starts before the rest of them are read, once."""
    newest = [_pr(10_000 - i, NOW - timedelta(hours=1 + i)) for i in range(200)]
    gh = GitHub(newest, [])
    started_before_last_page = []

    handler = gh.handler

    def watching(request):
        q = json.loads(request.content)["variables"].get("q", "")
        if ".." in q:
            started_before_last_page.append(
                sum(1 for kind, _ in gh.pages if kind == "newest"))
        return handler(request)

    gh.handler = watching
    gh.provider().fetch("a/b")
    timing_queries = [q for q, _ in gh.queries if ".." in q]
    assert len(timing_queries) == 1
    assert started_before_last_page and started_before_last_page[0] < 7
