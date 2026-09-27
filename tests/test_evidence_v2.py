"""The v2 evidence capture: who wrote what, drafts, labels, how a PR was closed.

The recorded answers in `recordings/evidence_v2/recorded.json` are what GitHub
really sent for a few repositories picked for their shape (see `record.py`
there). Everything here runs them through the same projection the live
provider uses, with no network.

The other half of the contract is that nothing old moves: committed fixtures
predate these fields, and the verdict must not read them yet.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from holt.agent.findings import Findings
from holt.agent.pipeline import analyze_without_model
from holt.agent.signals import build_threads, compute
from holt.agent.verdict import classify
from holt.evidence import github_graphql as gql
from holt.evidence.fixtures import FixtureProvider, fixture_root, write_fixture
from holt.evidence.provider import EvidenceProvider
from holt.types import EvidenceRecord, Window

_FILE = json.loads(
    (Path(__file__).parent / "recordings" / "evidence_v2" / "recorded.json")
    .read_text(encoding="utf-8")
)
RECORDED = _FILE["repos"]
RECORDED_AT = datetime.fromisoformat(_FILE["recorded_at"])

# Payload keys the v2 capture added. None may appear in a committed fixture.
V2_KEYS = {
    "author_association", "is_draft", "labels", "merged_by", "merged_by_is_bot",
    "closed_by", "closed_by_is_bot", "closer", "name_with_owner", "parent",
    "mirror_url", "release_count",
}


def records(slug: str) -> dict[str, EvidenceRecord]:
    return {r.evidence_id: r for r in gql.project(slug, RECORDED[slug]["pull_requests"])}


def payload(slug: str, evidence_id: str) -> dict:
    return records(slug)[f"pr:{slug}#{evidence_id}"].payload


# --- author association ----------------------------------------------------


def test_pull_request_author_association_is_on_every_pr_event():
    # A flask maintainer's own PR, merged: MEMBER on the opening and the merge.
    assert payload("pallets/flask", "6133:opened")["author_association"] == "MEMBER"
    assert payload("pallets/flask", "6133:merged")["author_association"] == "MEMBER"
    # A stranger's PR closed in triage: NONE on the close too.
    assert payload("pallets/flask", "6162:closed")["author_association"] == "NONE"


def test_comment_and_review_authors_carry_their_association():
    replies = [
        r.payload for eid, r in records("pytorch/pytorch").items()
        if ":comment:" in eid or ":review:" in eid
    ]
    assert replies
    assert all("author_association" in p for p in replies)
    assert {p["author_association"] for p in replies} >= {"COLLABORATOR", "NONE"}


# --- drafts and labels -----------------------------------------------------


def test_draft_state_is_read():
    assert payload("pallets/flask", "6132:opened")["is_draft"] is True
    assert payload("pallets/flask", "6133:opened")["is_draft"] is False


def test_labels_are_read_by_name():
    assert payload("pallets/flask", "6162:opened")["labels"] == ["rejected AI"]
    assert "Merged" in payload("react/react-native", "58688:opened")["labels"]
    assert payload("pallets/flask", "6133:opened")["labels"] == []


# --- merges and closes -----------------------------------------------------


def test_merged_by_names_who_pressed_the_button():
    merged = payload("pallets/flask", "6133:merged")
    assert merged["merged_by"] == "davidism"
    assert merged["merged_by_is_bot"] is False


def test_a_pr_closed_by_a_commit_from_an_app_bot():
    # react-native lands work through an internal sync: the PR is closed, not
    # merged, by a GitHub App, and the timeline names the commit that did it.
    closed = payload("react/react-native", "58688:closed")
    assert closed["merged"] is False
    assert closed["closed_by"] == "meta-codesync"
    assert closed["closed_by_is_bot"] is True
    assert closed["closer"]["kind"] == "commit"
    assert len(closed["closer"]["oid"]) == 40


def test_a_user_account_merge_bot_is_recorded_as_github_reports_it():
    # pytorchmergebot is an ordinary user account. The capture records what
    # GitHub says (not a bot); reading the name as a bot is the signals' job,
    # applied at read time so the fixture stays as captured.
    closed = payload("pytorch/pytorch", "198719:closed")
    assert closed["closed_by"] == "pytorchmergebot"
    assert closed["closed_by_is_bot"] is False
    assert closed["closer"]["kind"] == "commit"


def test_a_pr_closed_by_a_person_has_no_closer():
    closed = payload("pallets/flask", "6162:closed")
    assert closed["closed_by"] == "ThiefMaster"
    assert closed["closed_by_is_bot"] is False
    assert closed["closer"] is None


def test_a_pr_closed_by_another_pr():
    node = _node(timeline=[{
        "__typename": "ClosedEvent", "createdAt": "2026-09-02T00:00:00Z",
        "actor": {"login": "maint", "__typename": "User"},
        "closer": {"__typename": "PullRequest", "number": 7},
    }])
    closed = _project_one(node)["pr:a/b#1:closed"].payload
    assert closed["closer"] == {"kind": "pull_request", "number": 7}


def test_close_event_outside_the_timeline_window_is_unknown_not_absent():
    # Asked for, not found: the keys are there and say "unknown". An old
    # capture that never asked has no keys at all, and the two must not blur.
    closed = _project_one(_node(timeline=[]))["pr:a/b#1:closed"].payload
    assert closed["closed_by"] is None
    assert closed["closed_by_is_bot"] is False
    assert closed["closer"] is None


# --- commit references -----------------------------------------------------


def test_same_repo_commit_references_become_dated_records():
    recs = records("openssl/openssl")
    ref = recs["pr:openssl/openssl#33003:reference:0"]
    assert len(ref.payload["commit"]) == 40
    assert ref.payload["actor"] == "openssl-machine"
    assert ref.timestamp.tzinfo is not None
    # openssl pushes by hand and then closes: the close names no commit, the
    # reference is the only trace of where the work went.
    assert recs["pr:openssl/openssl#33003:closed"].payload["closer"] is None


def test_references_from_forks_are_dropped():
    raw = next(p for p in RECORDED["react/react-native"]["pull_requests"] if p["number"] == 58679)
    forks = [n for n in raw["timelineItems"]["nodes"] if n["__typename"] == "ReferencedEvent"]
    assert forks, "the recording should hold fork references for this PR"
    assert not [eid for eid in records("react/react-native") if "#58679:reference:" in eid]


def test_reference_records_are_not_read_as_replies_or_outcomes():
    recs = list(records("pytorch/pytorch").values())
    assert any(":reference:" in r.evidence_id for r in recs)
    with_refs = build_threads(recs)
    without = build_threads(r for r in recs if ":reference:" not in r.evidence_id)
    assert with_refs.keys() == without.keys()
    for key, thread in with_refs.items():
        other = without[key]
        assert (thread.merged, thread.closed_unmerged, thread.responses) == (
            other.merged, other.closed_unmerged, other.responses
        )


# --- repository: releases, forks, mirrors ----------------------------------


def test_releases_become_dated_records_and_a_count():
    meta = RECORDED["pallets/flask"]["meta"]
    assert gql.project_repo_meta("pallets/flask", meta).payload["release_count"] >= 10
    releases = list(gql.project_releases("pallets/flask", meta))
    assert len(releases) == 10
    first = releases[0]
    assert first.evidence_id == "repo:pallets/flask:release:0"
    assert first.payload["tag"]
    assert first.url.startswith("https://github.com/pallets/flask/releases/tag/")
    assert releases == sorted(releases, key=lambda r: r.timestamp, reverse=True)


def test_a_fork_names_its_parent():
    meta = gql.project_repo_meta("base/chains", RECORDED["base/chains"]["meta"]).payload
    assert meta["is_fork"] is True
    assert meta["parent"] == "ethereum-lists/chains"
    assert meta["mirror_url"] is None


def test_a_mirror_names_where_it_copies_from():
    meta = gql.project_repo_meta("v8/v8", RECORDED["v8/v8"]["meta"]).payload
    assert meta["is_mirror"] is True
    assert meta["mirror_url"] == "https://chromium.googlesource.com/v8/v8.git"
    assert meta["parent"] is None
    assert meta["name_with_owner"] == "v8/v8"


def test_the_live_provider_slices_releases_and_references_at_the_cutoff():
    # A release and a commit reference made after the cutoff are later facts,
    # and must not reach an agent reading as of it.
    cutoff = datetime(2026, 9, 1, tzinfo=UTC)
    meta = {**_meta(), "releases": {"totalCount": 2, "nodes": [
        {"tagName": "v2", "name": "2", "createdAt": "2026-09-10T00:00:00Z",
         "publishedAt": "2026-09-10T00:00:00Z", "isPrerelease": False},
        {"tagName": "v1", "name": "1", "createdAt": "2026-08-01T00:00:00Z",
         "publishedAt": "2026-08-01T00:00:00Z", "isPrerelease": False},
    ]}}
    node = _node(closed_at="2026-08-20T00:00:00Z", timeline=[
        {"__typename": "ReferencedEvent", "createdAt": "2026-08-10T00:00:00Z",
         "actor": {"login": "m", "__typename": "User"}, "commit": {"oid": "a" * 40},
         "commitRepository": {"nameWithOwner": "a/b"}},
        {"__typename": "ReferencedEvent", "createdAt": "2026-09-05T00:00:00Z",
         "actor": {"login": "m", "__typename": "User"}, "commit": {"oid": "b" * 40},
         "commitRepository": {"nameWithOwner": "A/B"}},
    ])

    class Transport:
        def repo_meta(self, owner, name, until):
            return meta

        def search_pull_requests(self, q, max_pages):
            return [node]

    provider = gql.LiveGitHubProvider(Window.PRE_T, cutoff=cutoff, transport=Transport())
    ids = {r.evidence_id: r for r in provider.fetch("a/b")}
    assert "repo:a/b:release:1" in ids and "repo:a/b:release:0" not in ids
    assert ids["pr:a/b#1:reference:0"].payload["commit"] == "a" * 40
    assert "pr:a/b#1:reference:1" not in ids  # after the cutoff


# --- the old contract holds -------------------------------------------------


def test_an_old_shaped_node_projects_exactly_as_before():
    # What the v1 query returned. Its projection must not grow a single key,
    # which is what keeps re-projected old evidence byte-identical.
    old = {
        "number": 1, "title": "t", "createdAt": "2026-08-01T00:00:00Z",
        "mergedAt": None, "closedAt": "2026-08-02T00:00:00Z", "merged": False,
        "additions": 1, "deletions": 0, "changedFiles": 1,
        "author": {"login": "x", "__typename": "User"},
        "files": {"nodes": [{"path": "a.py", "additions": 1, "deletions": 0}]},
        "reviews": {"nodes": [{"createdAt": "2026-08-01T01:00:00Z", "state": "COMMENTED",
                               "body": "hi", "author": {"login": "m", "__typename": "User"}}]},
        "comments": {"nodes": [{"createdAt": "2026-08-01T02:00:00Z", "body": "yo",
                                "author": {"login": "m", "__typename": "User"}}]},
    }
    recs = {r.evidence_id: r.payload for r in gql.project("a/b", [old])}
    assert recs == {
        "pr:a/b#1:opened": {"author": "x", "author_is_bot": False, "title": "t",
                            "additions": 1, "deletions": 0, "changed_files": 1,
                            "files": ["a.py"]},
        "pr:a/b#1:closed": {"author": "x", "author_is_bot": False, "merged": False},
        "pr:a/b#1:review:0": {"author": "m", "author_is_bot": False,
                              "state": "COMMENTED", "body": "hi"},
        "pr:a/b#1:comment:0": {"author": "m", "author_is_bot": False, "body": "yo"},
    }
    old_meta = {k: v for k, v in _meta().items()
                if k not in ("nameWithOwner", "parent", "mirrorUrl", "releases")}
    assert set(gql.project_repo_meta("a/b", old_meta).payload) & V2_KEYS == set()
    assert list(gql.project_releases("a/b", old_meta)) == []


def test_no_committed_fixture_carries_v2_fields():
    # They were captured before v2 and must replay as they were recorded.
    paths = sorted((fixture_root() / Window.PRE_T.value).glob("*.json"))
    assert paths
    for path in paths:
        for rec in json.loads(path.read_text(encoding="utf-8"))["records"]:
            assert not (set(rec["payload"]) & V2_KEYS), (path, rec["evidence_id"])
            assert ":reference:" not in rec["evidence_id"]
            assert ":release:" not in rec["evidence_id"]


class _Serve(EvidenceProvider):
    """Hands back fixed records, through the base class's window check."""

    def __init__(self, recs: list[EvidenceRecord], cutoff: datetime) -> None:
        super().__init__(Window.PRE_T, cutoff)
        self.recs = recs

    def _fetch_raw(self, request, /, **params):
        return self.recs

    def _resolve_raw(self, evidence_id):
        return None


@pytest.mark.parametrize("slug", ["pytorch/pytorch", "react/react-native",
                                  "openssl/openssl", "pallets/flask"])
def test_v2_fields_only_add_to_what_older_captures_show(slug):
    # Same evidence with and without the v2 additions. The v2 fields (how a
    # pull request was closed) can only reveal more landings than an older
    # capture sees; where nothing landed off the button (flask) the two read
    # identically, and an older capture still replays. Drafts and labels are
    # set aside here: they take attempts out of the counts (rates.py), which
    # test_rates covers.
    as_of = RECORDED_AT
    meta = RECORDED[slug]["meta"]
    v2 = [gql.project_repo_meta(slug, meta), *gql.project_releases(slug, meta),
          *gql.project(slug, RECORDED[slug]["pull_requests"])]
    v1 = [
        EvidenceRecord(r.evidence_id, r.source, r.url, r.timestamp,
                       {k: v for k, v in r.payload.items() if k not in V2_KEYS})
        for r in v2 if ":reference:" not in r.evidence_id and ":release:" not in r.evidence_id
    ]
    v2 = [EvidenceRecord(r.evidence_id, r.source, r.url, r.timestamp,
                         {k: v for k, v in r.payload.items() if k not in ("is_draft", "labels")})
          for r in v2]
    t2, t1 = build_threads(v2), build_threads(v1)
    assert t2.keys() == t1.keys()
    assert {k for k, t in t1.items() if t.merged} <= {k for k, t in t2.items() if t.merged}

    a2, _ = analyze_without_model(slug, _Serve(v2, as_of), as_of=as_of)
    a1, _ = analyze_without_model(slug, _Serve(v1, as_of), as_of=as_of)
    if slug == "pallets/flask":
        assert compute(t2, as_of).as_dict() == compute(t1, as_of).as_dict()
        assert classify(Findings(), compute(t2, as_of)) == classify(Findings(), compute(t1, as_of))
        assert a2 == a1


def test_v2_records_survive_a_fixture_round_trip(tmp_path):
    slug = "react/react-native"
    original = list(gql.project(slug, RECORDED[slug]["pull_requests"]))
    original += list(gql.project_releases(slug, RECORDED[slug]["meta"]))
    original.append(gql.project_repo_meta(slug, RECORDED[slug]["meta"]))
    write_fixture(slug, Window.PRE_T, original, root=tmp_path, cutoff=RECORDED_AT)
    reloaded = FixtureProvider(Window.PRE_T, root=tmp_path, cutoff=RECORDED_AT).fetch(slug)
    assert {r.evidence_id: r.payload for r in reloaded} == {
        r.evidence_id: r.payload for r in original
    }


# --- cost -------------------------------------------------------------------


def test_the_transport_adds_up_rate_limit_points():
    answers = [{"rateLimit": {"cost": 1, "remaining": 10, "resetAt": "x"}, "a": 1},
               {"rateLimit": {"cost": 2, "remaining": 8, "resetAt": "x"}, "a": 1},
               {"rateLimit": {"remaining": 8, "resetAt": "x"}, "a": 1}]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": answers.pop(0)})

    t = gql.GitHubGraphQL(token="t", client=httpx.Client(transport=httpx.MockTransport(handler)))
    for _ in range(3):
        t.query("q")
    assert t.points_used == 3
    assert t.remaining == 8


def test_every_query_asks_what_it_cost():
    documents = [gql.REPO_META, gql.PR_SEARCH, gql.PR_SEARCH_SCREEN,
                 gql.ISSUE_SEARCH, gql.REPO_SEARCH,
                 gql.docs_query("0" * 40)[0]]
    assert all("rateLimit { cost " in d for d in documents)


def test_pr_page_stays_at_five_connections_per_pull_request():
    # 1 + 25 x 5 = 126 connections is one point a page; a sixth per-PR
    # connection makes it 151 and two points. See the note on PR_SEARCH.
    body = gql.PR_SEARCH.split("... on PullRequest", 1)[1]
    per_pr = sum(body.count(f"{field}(") for field in
                 ("files", "reviews", "comments", "labels", "timelineItems"))
    assert per_pr == 5
    assert body.count("(first:") + body.count("(last:") == 5


# --- the screening query ----------------------------------------------------


def test_the_screen_query_is_the_full_one_without_the_timeline():
    assert "timelineItems" in gql.PR_SEARCH
    assert "timelineItems" not in gql.PR_SEARCH_SCREEN
    assert gql.PR_SEARCH_SCREEN == gql.PR_SEARCH.replace(gql._PR_TIMELINE, "")
    for field in ("authorAssociation", "isDraft", "labels(", "mergedBy"):
        assert field in gql.PR_SEARCH_SCREEN


def test_discover_screens_without_the_timeline_and_reports_read_it(monkeypatch):
    from holt import discover

    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        document = json.loads(request.content)["query"]
        asked.append(document)
        if "repository(" in document and "search(" not in document:
            return httpx.Response(200, json={"data": {"repository": _meta()}})
        return httpx.Response(200, json={"data": {"search": {
            "issueCount": 1, "pageInfo": {"hasNextPage": False, "endCursor": None},
            "nodes": [{k: v for k, v in _node([]).items() if k != "timelineItems"}],
        }}})

    transport = gql.GitHubGraphQL(
        token="t", client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    _, recs = discover.screen_slug("a/b", transport, RECORDED_AT, 7)
    assert gql.PR_SEARCH_SCREEN in asked and gql.PR_SEARCH not in asked
    closed = next(r for r in recs if r.evidence_id == "pr:a/b#1:closed").payload
    assert "closed_by" not in closed and "closer" not in closed  # not asked, not unknown

    asked.clear()
    gql.LiveGitHubProvider(Window.PRE_T, cutoff=RECORDED_AT, transport=transport).fetch("a/b")
    assert gql.PR_SEARCH in asked and gql.PR_SEARCH_SCREEN not in asked


# --- helpers ------------------------------------------------------------------


def _meta() -> dict:
    return {
        "createdAt": "2020-01-01T00:00:00Z", "pushedAt": "2026-08-01T00:00:00Z",
        "isArchived": False, "isMirror": False, "isFork": False, "stargazerCount": 1,
        "description": None, "homepageUrl": None, "primaryLanguage": None,
        "nameWithOwner": "a/b", "mirrorUrl": None, "parent": None,
        "releases": {"totalCount": 0, "nodes": []}, "defaultBranchRef": None,
    }


def _node(timeline: list[dict], closed_at: str = "2026-09-02T00:00:00Z") -> dict:
    return {
        "number": 1, "title": "t", "createdAt": "2026-08-01T00:00:00Z",
        "mergedAt": None, "closedAt": closed_at, "merged": False,
        "additions": 1, "deletions": 0, "changedFiles": 1,
        "isDraft": False, "authorAssociation": "NONE",
        "author": {"login": "x", "__typename": "User"}, "mergedBy": None,
        "labels": {"nodes": []}, "files": {"nodes": []},
        "reviews": {"nodes": []}, "comments": {"nodes": []},
        "timelineItems": {"nodes": timeline},
    }


def _project_one(node: dict) -> dict[str, EvidenceRecord]:
    return {r.evidence_id: r for r in gql.project("a/b", [node])}

