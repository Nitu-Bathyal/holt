"""scripts/build_seed_list.py: hygiene, search paging and programme mapping, GitHub faked."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "build_seed_list.py"
spec = importlib.util.spec_from_file_location("build_seed_list", SCRIPT)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def repo(name="octo/one", stars=500, **over):
    return {"nameWithOwner": name, "isArchived": False, "isFork": False, "isMirror": False,
            "pushedAt": "2026-09-20T00:00:00Z", "stargazerCount": stars,
            "hasPullRequestsEnabled": True, "pullRequestCreationPolicy": "ALL"} | over


def test_drop_reasons():
    assert builder.drop_reason(repo()) is None
    assert builder.drop_reason(None) == "gone"
    assert builder.drop_reason(repo(isArchived=True)) == "archived"
    assert builder.drop_reason(repo(isFork=True)) == "fork or mirror"
    assert builder.drop_reason(repo(isMirror=True)) == "fork or mirror"
    assert builder.drop_reason(repo(stars=19)) == "under 20 stars"
    assert builder.drop_reason(repo(pushedAt="2026-05-31T23:59:59Z")) == "no push since 2026-06-01"
    closed = "closed to outside pull requests"
    assert builder.drop_reason(repo(hasPullRequestsEnabled=False)) == closed
    assert builder.drop_reason(repo(pullRequestCreationPolicy="COLLABORATORS_ONLY")) == closed


def test_catalogues_and_farms_are_skipped_by_name():
    assert builder.skipped("someone/awesome-python")
    assert builder.skipped("someone/first-contributions")
    assert builder.skipped("swisskyrepo/PayloadsAllTheThings")
    assert not builder.skipped("pallets/flask")


class FakeSearch:
    """A search index of repos by star count, 100 a page and 1,000 a query like GitHub's."""

    def __init__(self, stars):
        self.repos = sorted((repo(f"octo/r{i}", s) for i, s in enumerate(stars)),
                            key=lambda n: -n["stargazerCount"])
        self.queries = []

    def graphql(self, query, variables):
        q = variables["q"]
        self.queries.append(q)
        band = next(t for t in q.split() if t.startswith("stars:")).removeprefix("stars:")
        low, high = (int(band[2:]), None) if band.startswith(">=") else map(int, band.split(".."))
        hits = [n for n in self.repos
                if n["stargazerCount"] >= low and (high is None or n["stargazerCount"] <= high)]
        start = int(variables["after"] or 0)
        end = min(start + 100, 1000, len(hits))
        return {"search": {"repositoryCount": len(hits), "nodes": hits[start:end],
                           "pageInfo": {"hasNextPage": end < min(len(hits), 1000),
                                        "endCursor": str(end)}}}


def test_search_walks_down_the_star_ranges_past_the_cap():
    gh = FakeSearch(range(20, 2520))
    found = {n["nameWithOwner"] for n in builder.search(gh, "topic:hacktoberfest", 20)}
    assert len(found) == 2500
    assert len(gh.queries) == 10 + 10 + 6  # 1,000 + 1,000 + 502 results, one page per 100
    assert all("sort:stars-desc" in q for q in gh.queries)


def test_search_gets_past_a_thousand_repos_with_the_same_stars():
    gh = FakeSearch([50] * 1200 + [30] * 5)
    found = {n["nameWithOwner"] for n in builder.search(gh, "x", 20)}
    assert {f"octo/r{i}" for i in range(1200, 1205)} <= found


def test_search_stops_as_soon_as_the_caller_has_enough():
    gh = FakeSearch(range(20, 2520))
    results = builder.search(gh, "x", 20)
    assert [next(results)["stargazerCount"] for _ in range(150)][-1] == 2370
    assert len(gh.queries) == 2


def test_gsoc_maps_repos_hand_mapped_orgs_and_bare_orgs(monkeypatch):
    orgs = [{"source_code": "https://github.com/octo/one/"},
            {"source_code": "https://github.com/ceph"},
            {"source_code": "https://github.com/orgs/unmapped-org/repositories"},
            {"source_code": "https://github.com/another-org/.github"},
            {"source_code": "https://gitlab.com/somewhere/else"},
            {"source_code": "https://python-gsoc.org/"},
            {"source_code": None}]
    monkeypatch.setattr(builder, "get", lambda url: json.dumps(orgs).encode())
    assert builder.gsoc(2024) == ["octo/one", "ceph/ceph", "unmapped-org", "another-org",
                                  "python/cpython"]


def test_lfx_takes_recent_github_links(monkeypatch):
    def project(link, created="2025-01-01 00:00:00 +0000"):
        return {"_source": {"repoLink": link, "createdOn": created}}

    pages = {0: [project("https://github.com/octo/one/tree/main/docs"),
                 project("https://github.com/octo/old", "2022-05-01 00:00:00 +0000"),
                 project("https://gitlab.com/octo/elsewhere"),
                 project("https://github.com/some-org")],
             4: []}

    def get(url):
        start = int(url.split("from=")[1].split("&")[0])
        return json.dumps({"hits": {"hits": pages[start]}}).encode()

    monkeypatch.setattr(builder, "get", get)
    assert builder.lfx() == ["octo/one", "some-org"]


def test_outreachy_reads_only_community_names(monkeypatch):
    index = '<a href="/alums/2022-12/">x</a><a href="/alums/2024-05/">y</a>'
    page = ("<h4>Some Intern</h4><BR>Wagtail mentor(s): A and B <BR>Project: p"
            "<h4>Other Intern</h4><BR>Perl &amp; Raku mentor(s): C <BR>"
            "<h4>Third</h4><BR>Debian mentor(s): D <BR>")
    fetched = []

    def get(url):
        fetched.append(url)
        return (index if url.endswith("/alums/") else page).encode()

    monkeypatch.setattr(builder, "get", get)
    assert builder.outreachy() == ["wagtail/wagtail", "Perl/perl5", "rakudo/rakudo"]
    assert fetched == [builder.OUTREACHY_URL, builder.OUTREACHY_URL + "2024-05/"]
