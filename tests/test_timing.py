"""How long it takes here: first reply, time to merge, rhythm (agent/timing.py).

Every share is over pull requests old enough to have had the whole wait, so a
young one never counts as "not yet" for a wait it hasn't had time for. Open
and closed-unmerged pull requests count as not merged, never as missing.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from holt.agent import timing
from holt.agent.signals import build_threads
from holt.agent.timing import Waited
from holt.types import EvidenceRecord

NOW = datetime(2026, 9, 25, 12, tzinfo=UTC)
DAY = 24.0


# --- the maths ----------------------------------------------------------------


def test_share_within_counts_only_those_old_enough():
    items = [Waited(age_hours=100 * DAY, hours=2 * DAY)] * 8 + [
        Waited(age_hours=100 * DAY, hours=None)] * 2 + [
        # Too young to have had a week: in no share over a week.
        Waited(age_hours=3 * DAY, hours=None)] * 5
    assert timing.share_within(items, 7 * DAY) == 0.8
    # Over two days the young ones count, and they haven't had it happen.
    assert timing.share_within(items, 2 * DAY) == 8 / 15


def test_share_within_needs_the_minimum():
    items = [Waited(age_hours=100 * DAY, hours=DAY)] * 7
    assert timing.share_within(items, 7 * DAY) is None
    assert timing.share_within(items + [Waited(100 * DAY, None)], 7 * DAY) == 7 / 8


def test_within_is_the_shortest_wait_that_covers_the_share():
    hours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    items = [Waited(age_hours=1000, hours=h) for h in hours]
    assert timing.within(items, 0.8) == 8
    assert timing.within(items, 0.5) == 5


def test_within_counts_never_as_not_yet():
    """Four of ten never got one: "most (8 in 10) within N" has no N."""
    items = [Waited(1000, h) for h in (1, 2, 3, 4, 5, 6)] + [Waited(1000, None)] * 4
    assert timing.within(items, 0.8) is None
    assert timing.within(items, 0.5) == 5


def test_quantile_nearest_rank():
    assert timing.quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9) == 9
    assert timing.quantile([5.0], 0.9) == 5.0


# --- rhythm ---------------------------------------------------------------------


def _weeks_ago(*weeks: float) -> list[datetime]:
    return [NOW - timedelta(weeks=w) for w in weeks]


def test_a_burst_is_flagged():
    # Twelve merges: ten in two weeks, two stragglers months apart.
    merges = _weeks_ago(*([3.1] * 5 + [4.2] * 5 + [15, 22]))
    assert timing.bursts(merges, NOW) is True


def test_a_steady_flow_is_not():
    merges = _weeks_ago(*[w + 0.5 for w in range(0, 26, 2)])  # every other week
    assert timing.bursts(merges, NOW) is False


def test_too_few_merges_say_nothing():
    assert timing.bursts(_weeks_ago(*([3.1] * 7)), NOW) is None


def test_merges_older_than_26_weeks_leave_the_count():
    merges = _weeks_ago(*([3.1] * 5 + [30] * 10))
    assert timing.bursts(merges, NOW) is None


# --- from evidence ------------------------------------------------------------------


def _meta() -> EvidenceRecord:
    return EvidenceRecord("repo:a/b:meta", "github", "https://github.com/a/b",
                          NOW - timedelta(days=2000), {"pushed_at": NOW.isoformat()})


def _window(source: str, **extra) -> EvidenceRecord:
    return EvidenceRecord("timing:a/b:window", "github", "https://github.com/a/b",
                          NOW - timedelta(days=60), {"source": source, **extra})


def _cohort_pr(n: int, days_ago: float, merged_after_days: float | None = None,
               login: str | None = None, association: str = "NONE",
               bot: bool = False, draft: bool = False) -> list[EvidenceRecord]:
    opened = NOW - timedelta(days=days_ago)
    url = f"https://github.com/a/b/pull/{n}"
    out = [EvidenceRecord(f"timing:a/b#{n}", "github", url, opened,
                          {"login": login or f"user{n}", "association": association,
                           "bot": bot, "draft": draft})]
    if merged_after_days is not None:
        out.append(EvidenceRecord(f"timing:a/b#{n}:landed", "github", url,
                                  opened + timedelta(days=merged_after_days), {}))
    return out


def _read(records: list[EvidenceRecord]) -> timing.Timing:
    threads = build_threads(records)
    return timing.read(records, threads, NOW, settle_hours=14 * DAY)


def test_the_cohort_from_the_search():
    records = [_meta(), _window("search", pages=1, complete=True)]
    # 10 outside pull requests 90-99 days old: 4 merged in 2 days, 2 in 20 days,
    # 1 in 50 days, 3 never (open or closed unmerged count the same).
    waits = [2, 2, 2, 2, 20, 20, 50, None, None, None]
    for i, w in enumerate(waits):
        records += _cohort_pr(i + 1, 90 + i, w)
    t = _read(records)
    assert t.merge_cohort_prs == 10 and t.merge_cohort_merged == 7
    assert t.merged_within == {3: 0.4, 7: 0.4, 14: 0.4, 30: 0.6, 60: 0.7}
    assert t.merge_typical_days == 2.0
    # Seven merges: under the minimum for a slow number.
    assert t.merge_slow_days is None
    assert t.merge_cohort_from.date() == (NOW - timedelta(days=99)).date()


def test_team_bots_and_drafts_leave_the_cohort():
    records = [_meta(), _window("search", pages=1, complete=True)]
    for i in range(8):
        records += _cohort_pr(i + 1, 90, 1)
    records += _cohort_pr(20, 90, None, association="MEMBER")
    records += _cohort_pr(21, 90, None, login="dependabot[bot]", bot=True)
    records += _cohort_pr(22, 90, None, draft=True)
    t = _read(records)
    assert t.merge_cohort_prs == 8 and t.merged_within[3] == 1.0


def test_team_from_the_main_sample_leaves_the_cohort():
    """Someone the sample shows merging others' work is team, whatever
    GitHub's association says."""
    records = [_meta(), _window("search", pages=1, complete=True)]
    for i in range(8):
        records += _cohort_pr(i + 1, 90, 1)
    records += _cohort_pr(30, 90, None, login="lead", association="CONTRIBUTOR")
    url = "https://github.com/a/b/pull/500"
    records += [
        EvidenceRecord("pr:a/b#500:opened", "github", url, NOW - timedelta(days=20),
                       {"author": "someone", "author_association": "NONE"}),
        EvidenceRecord("pr:a/b#500:merged", "github", url, NOW - timedelta(days=19),
                       {"author": "someone", "merged": True, "merged_by": "lead",
                        "merged_by_is_bot": False}),
    ]
    assert _read(records).merge_cohort_prs == 8


def test_under_eight_pull_requests_no_merge_numbers():
    records = [_meta(), _window("search", pages=1, complete=True)]
    for i in range(7):
        records += _cohort_pr(i + 1, 90, 1)
    t = _read(records)
    assert t.merge_cohort_prs == 7
    assert t.merged_within is None and t.merge_typical_days is None


def test_merges_after_the_reading_never_count():
    """A merge dated after the reading isn't in the evidence (the provider
    slices it off); a cohort pull request merged later is not merged here."""
    records = [_meta(), _window("search", pages=1, complete=True)]
    for i in range(8):
        records += _cohort_pr(i + 1, 90, 1 if i < 4 else None)
    t = _read(records)
    assert t.merged_within[60] == 0.5


def test_the_cohort_window_is_60_to_240_days():
    records = [_meta(), _window("sample")]
    def pr(n, days_ago, merged_after=None):
        opened = NOW - timedelta(days=days_ago)
        url = f"https://github.com/a/b/pull/{n}"
        out = [EvidenceRecord(f"pr:a/b#{n}:opened", "github", url, opened,
                              {"author": f"u{n}", "author_association": "NONE"})]
        if merged_after is not None:
            out.append(EvidenceRecord(f"pr:a/b#{n}:merged", "github", url,
                                      opened + timedelta(days=merged_after),
                                      {"author": f"u{n}", "merged": True}))
        return out
    for i in range(8):
        records += pr(i + 1, 100 + i, 5)
    records += pr(50, 30, 1)    # too young: under 60 days
    records += pr(51, 300, 1)   # too old: over 240 days
    t = _read(records)
    assert t.merge_cohort_prs == 8 and t.merged_within[7] == 1.0


def test_no_window_record_no_timing():
    """Evidence read before the cohort existed (frozen captures) has none."""
    t = _read([_meta()] + _cohort_pr(1, 90, 1))
    assert t.merge_cohort_prs == 0 and t.merged_within is None


def _landed_elsewhere(n: int, days_ago: float) -> list[EvidenceRecord]:
    opened = NOW - timedelta(days=days_ago)
    url = f"https://github.com/a/b/pull/{n}"
    return [
        EvidenceRecord(f"pr:a/b#{n}:opened", "github", url, opened,
                       {"author": f"u{n}", "author_association": "NONE"}),
        EvidenceRecord(f"pr:a/b#{n}:closed", "github", url, opened + timedelta(days=3),
                       {"author": f"u{n}", "merged": False, "closed_by": "gopherbot",
                        "closed_by_is_bot": True,
                        "closer": {"kind": "commit", "oid": "abc"}}),
    ]


def test_work_that_lands_elsewhere_gets_no_merge_timing():
    records = [_meta(), _window("search", pages=1, complete=True)]
    for i in range(10):
        records += _cohort_pr(i + 1, 90, 1)
    for i in range(4):
        records += _landed_elsewhere(100 + i, 30 + i)
    threads = build_threads(records)
    assert sum(1 for t in threads.values() if t.landed_via) == 4
    t = timing.read(records, threads, NOW, settle_hours=14 * DAY)
    assert t.merged_within is None and t.merges_in_bursts is None


def _answered(n: int, days_ago: float, reply_after_hours: float | None) -> list[EvidenceRecord]:
    opened = NOW - timedelta(days=days_ago)
    url = f"https://github.com/a/b/pull/{n}"
    out = [EvidenceRecord(f"pr:a/b#{n}:opened", "github", url, opened,
                          {"author": f"u{n}", "author_association": "NONE"})]
    if reply_after_hours is not None:
        out.append(EvidenceRecord(f"pr:a/b#{n}:comment:0", "github", url,
                                  opened + timedelta(hours=reply_after_hours),
                                  {"author": "maint", "author_association": "MEMBER",
                                   "body": "Thanks, looking."}))
    return out


def test_first_reply_slow_is_when_8_in_10_had_one():
    records = [_meta()]
    for i, h in enumerate([1, 2, 3, 4, 5, 6, 7, 30, 80, None]):
        records += _answered(i + 1, 20 + i, h)
    assert _read(records).first_reply_slow_hours == 30


def test_first_reply_slow_leaves_out_pull_requests_still_settling():
    records = [_meta()]
    for i, h in enumerate([1, 2, 3, 4, 5, 6, 7, 30, 80, None]):
        records += _answered(i + 1, 20 + i, h)
    for i in range(10):
        records += _answered(100 + i, 2, None)  # two days old: still settling
    assert _read(records).first_reply_slow_hours == 30


def test_first_reply_slow_needs_eight_answered():
    records = [_meta()]
    for i, h in enumerate([1, 2, 3, 4, 5, 6, 7]):
        records += _answered(i + 1, 20 + i, h)
    assert _read(records).first_reply_slow_hours is None


def test_last_outside_merge_and_bursts_from_a_long_sample():
    records = [_meta(), _window("sample")]
    n = 0
    for weeks, count in ((3, 6), (4, 4), (20, 1), (40, 1)):
        for _ in range(count):
            n += 1
            opened = NOW - timedelta(weeks=weeks, days=2)
            url = f"https://github.com/a/b/pull/{n}"
            records += [
                EvidenceRecord(f"pr:a/b#{n}:opened", "github", url, opened,
                               {"author": f"u{n}", "author_association": "NONE"}),
                EvidenceRecord(f"pr:a/b#{n}:merged", "github", url, opened + timedelta(days=2),
                               {"author": f"u{n}", "merged": True}),
            ]
    t = _read(records)
    assert t.merges_in_bursts is True
    assert t.last_outside_merge == NOW - timedelta(weeks=3)


def test_no_rhythm_when_the_sample_is_short():
    """A busy repository's sample covers weeks: its quiet weeks aren't seen."""
    records = [_meta(), _window("search", pages=3, complete=False)]
    for i in range(10):
        opened = NOW - timedelta(days=20)
        url = f"https://github.com/a/b/pull/{i}"
        records += [
            EvidenceRecord(f"pr:a/b#{i}:opened", "github", url, opened,
                           {"author": f"u{i}", "author_association": "NONE"}),
            EvidenceRecord(f"pr:a/b#{i}:merged", "github", url, opened + timedelta(days=1),
                           {"author": f"u{i}", "merged": True}),
        ]
    t = _read(records)
    assert t.merges_in_bursts is None
    assert t.last_outside_merge == NOW - timedelta(days=19)


# --- the provider reads the cohort ---------------------------------------------------

from holt.evidence import github_graphql as gql  # noqa: E402
from holt.types import Window  # noqa: E402


def _node(number: int, opened: datetime, merged_at: datetime | None = None) -> dict:
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    return {
        "number": number, "title": "t", "createdAt": iso(opened),
        "mergedAt": iso(merged_at) if merged_at else None,
        "closedAt": iso(merged_at) if merged_at else None, "merged": bool(merged_at),
        "additions": 1, "deletions": 0, "changedFiles": 1, "isDraft": False,
        "authorAssociation": "NONE", "state": "MERGED" if merged_at else "OPEN",
        "author": {"login": f"user{number}", "__typename": "User"},
        "labels": {"nodes": []}, "files": {"nodes": []},
        "reviews": {"nodes": []}, "comments": {"nodes": []},
        "timelineItems": {"nodes": []},
    }


class Transport:
    def __init__(self, newest: list[dict], cohort: list[dict] | None = None,
                 docs: dict | None = None) -> None:
        self.newest, self.cohort, self.docs = newest, cohort or [], docs
        self.timing_queries: list[tuple[str, int]] = []

    def repo_meta(self, owner, name, until):
        return {
            "createdAt": "2020-01-01T00:00:00Z", "pushedAt": NOW.isoformat(),
            "isArchived": False, "isMirror": False, "isFork": False, "stargazerCount": 1,
            "description": None, "homepageUrl": None, "primaryLanguage": None,
            "nameWithOwner": "a/b", "mirrorUrl": None, "parent": None,
            "releases": {"totalCount": 0, "nodes": []},
            "defaultBranchRef": {"name": "main", "target": {"history": {"nodes": [
                {"oid": "abc", "committedDate": "2026-09-01T00:00:00Z"}]}}},
        }

    def docs_at(self, owner, name, oid):
        return self.docs or {"readme": None, "contributing": None, "ai_policy": None}

    def search_pull_requests(self, q, max_pages, timeline=True):
        yield from self.newest

    def search_timing(self, q, max_pages):
        self.timing_queries.append((q, max_pages))
        return self.cohort, True


def _fetch(transport: Transport) -> list[EvidenceRecord]:
    return gql.LiveGitHubProvider(Window.PRE_T, cutoff=NOW, transport=transport).fetch("a/b")


def test_a_quiet_repository_uses_its_own_sample():
    t = Transport([_node(i, NOW - timedelta(days=i)) for i in range(1, 50)])
    records = _fetch(t)
    assert t.timing_queries == []
    marker = timing.window(records)
    assert marker is not None and marker.payload["source"] == "sample"


def test_a_busy_repository_searches_the_window_and_slices_at_the_cutoff():
    newest = [_node(10_000 - i, NOW - timedelta(hours=i)) for i in range(200)]
    cohort = [_node(1, NOW - timedelta(days=100), merged_at=NOW - timedelta(days=95)),
              _node(2, NOW - timedelta(days=100), merged_at=NOW + timedelta(days=1))]
    t = Transport(newest, cohort)
    records = _fetch(t)
    assert t.timing_queries == [(
        f"repo:a/b is:pr created:{(NOW - timedelta(days=240)).date()}.."
        f"{(NOW - timedelta(days=60)).date()} sort:created-desc", 1)]
    ids = {r.evidence_id for r in records if r.evidence_id.startswith("timing:")}
    # The merge after the cutoff is not evidence of this reading.
    assert ids == {"timing:a/b:window", "timing:a/b#1", "timing:a/b#1:landed", "timing:a/b#2"}
    assert timing.window(records).payload == {"source": "search", "pages": 1,
                                              "complete": True, "read": 2}
    # The cohort is in no thread and no count.
    assert all(not k.startswith("timing:") for k in build_threads(records))


def test_a_screen_reads_no_cohort():
    newest = [_node(10_000 - i, NOW - timedelta(hours=i)) for i in range(200)]
    t = Transport(newest)
    provider = gql.LiveGitHubProvider(Window.PRE_T, cutoff=NOW, transport=t, timeline=False)
    assert timing.window(provider.fetch("a/b")) is None and t.timing_queries == []


def test_stale_config_is_read_with_the_docs():
    docs = {"readme": None, "contributing": None, "ai_policy": None,
            "stale": [{"kind": "actions", "path": ".github/workflows/stale.yml",
                       "text": "- uses: actions/stale@v9\n  with:\n    days-before-close: 3\n"}]}
    records = _fetch(Transport([_node(1, NOW - timedelta(days=3))], docs=docs))
    config = next(r for r in records if r.evidence_id == "repo:a/b:stale:0")
    assert config.url == "https://github.com/a/b/blob/abc/.github/workflows/stale.yml"
    t = _read(records)
    assert t.stale_bot and t.stale_close_days == 63 and t.stale_url == config.url


def test_docs_query_reads_stale_candidates_and_a_stale_workflow_it_didnt_list():
    import json

    import httpx

    queries: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        doc = json.loads(request.content)["query"]
        aliases = {}
        for line in doc.splitlines():
            line = line.strip()
            if ": object(expression:" in line:
                alias = line.split(":", 1)[0]
                aliases[alias] = line.split('expression:"', 1)[1].split('"', 1)[0].split(":", 1)[1]
        queries.append(aliases)
        texts = {
            ".github/workflows/stale.yml": "steps:\n  - uses: actions/checkout@v4\n",
            ".github/workflows/auto-stale-prs.yml": "- uses: actions/stale@v9\n",
            ".github/stale.yml": "daysUntilStale: 30\n",
        }
        repo = {a: ({"text": texts[p]} if p in texts else None) for a, p in aliases.items()
                if a != "workflows"}
        if "workflows" in aliases:
            repo["workflows"] = {"entries": [{"name": "ci.yml"}, {"name": "stale.yml"},
                                             {"name": "auto-stale-prs.yml"}]}
        return httpx.Response(200, json={"data": {"rateLimit": {"cost": 1, "remaining": 1,
                                                                 "resetAt": "x"},
                                                  "repository": repo}})

    t = gql.GitHubGraphQL(token="t", client=httpx.Client(transport=httpx.MockTransport(handler)))
    docs = t.docs_at("a", "b", "abc123")
    # The stale.yml workflow that isn't actions/stale is dropped.
    assert [(f["kind"], f["path"]) for f in docs["stale"]] == [
        ("probot", ".github/stale.yml"), ("actions", ".github/workflows/auto-stale-prs.yml")]
    assert len(queries) == 2
    assert list(queries[1].values()) == [".github/workflows/auto-stale-prs.yml"]


def test_a_window_too_big_for_a_page_is_read_in_three_stretches():
    class Busy(Transport):
        def search_timing(self, q, max_pages):
            self.timing_queries.append((q, max_pages))
            n = len(self.timing_queries)
            return [_node(n * 1000 + i, NOW - timedelta(days=70)) for i in range(100)], False

    t = Busy([_node(10_000 - i, NOW - timedelta(hours=i)) for i in range(200)])
    records = _fetch(t)
    day = lambda d: (NOW - timedelta(days=d)).date()  # noqa: E731
    assert [q for q, _ in t.timing_queries] == [
        f"repo:a/b is:pr created:{day(240)}..{day(60)} sort:created-desc",
        f"repo:a/b is:pr created:{day(180)}..{day(120)} sort:created-desc",
        f"repo:a/b is:pr created:{day(240)}..{day(180)} sort:created-desc",
    ]
    assert timing.window(records).payload == {"source": "search", "pages": 3,
                                              "complete": False, "read": 300}


def test_a_close_with_no_answer_stops_the_wait_there():
    """Closed unanswered at 5 hours: counted for waits up to then, not after."""
    items = [Waited(1000, h) for h in (1, 2, 3, 4, 10, 20, 30, 40)] + [
        Waited(1000, None, stopped_hours=5)] * 4
    assert timing.share_within(items, 4) == 4 / 12
    assert timing.share_within(items, 40) == 1.0
    assert timing.within(items, 0.8) == 30


def test_a_merge_with_no_comment_is_an_answer():
    records = [_meta()]
    for i in range(8):
        opened = NOW - timedelta(days=20 + i)
        url = f"https://github.com/a/b/pull/{i}"
        records += [
            EvidenceRecord(f"pr:a/b#{i}:opened", "github", url, opened,
                           {"author": f"u{i}", "author_association": "NONE"}),
            EvidenceRecord(f"pr:a/b#{i}:merged", "github", url, opened + timedelta(hours=5),
                           {"author": f"u{i}", "merged": True}),
        ]
    assert _read(records).first_reply_slow_hours == 5


def test_first_reply_half_when_most_is_out_of_reach():
    records = [_meta()]
    for i, h in enumerate([1, 2, 3, 4, 5, 6, 7, 8, None, None, None, None]):
        records += _answered(i + 1, 20 + i, h)
    t = _read(records)
    assert t.first_reply_slow_hours is None and t.first_reply_half_hours == 6


def test_whoever_merges_in_the_cohort_is_team():
    """Staff reading as CONTRIBUTOR, whom the sample missed, merge others' work."""
    records = [_meta(), _window("search", pages=1, complete=True)]
    for i in range(8):
        records += _cohort_pr(i + 1, 90, None)
    records += _cohort_pr(40, 95, 1, login="staffer", association="CONTRIBUTOR")
    records += _cohort_pr(41, 95, 1, login="staffer", association="CONTRIBUTOR")
    records[-1].payload.update(by="staffer", by_bot=False)  # merged their own
    records += _cohort_pr(42, 96, 2, login="newcomer")
    records[-1].payload.update(by="staffer", by_bot=False)
    records += _cohort_pr(43, 97, 2, login="helper")
    records[-1].payload.update(by="github-actions[bot]", by_bot=True)
    t = _read(records)
    assert t.merge_cohort_prs == 10 and t.merge_cohort_merged == 2
