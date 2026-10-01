"""The report's "About this repo": read with the batched details query, kept
in repo_meta, served with GET /v1/reports (never stored with the report)."""

from __future__ import annotations

from conftest import canned_report
from holt_server import discover, github
from holt_server.db import RepoMeta, Report, now
from test_server_discover import add, lookup_with

REPO = "pallets/flask"

NODE = {
    "nameWithOwner": "pallets/flask", "description": "The Python micro framework",
    "stargazerCount": 69_800, "pushedAt": "2026-09-27T10:00:00Z", "isArchived": False,
    "isFork": True, "isPrivate": False, "primaryLanguage": {"name": "Python"},
    "repositoryTopics": {"nodes": [{"topic": {"name": "wsgi"}}]},
    "forkCount": 16_300, "createdAt": "2010-04-06T11:11:59Z",
    "homepageUrl": "flask.palletsprojects.com", "parent": {"nameWithOwner": "orig/flask"},
    "licenseInfo": {"spdxId": "BSD-3-Clause", "name": "BSD 3-Clause"},
    "issues": {"totalCount": 5}, "defaultBranchRef": {"name": "main"},
    "pullRequests": {"totalCount": 4_100}, "openPrs": {"totalCount": 12},
    "languages": {"totalSize": 1000, "edges": [
        {"size": 50, "node": {"name": "HTML"}}, {"size": 950, "node": {"name": "Python"}}]},
    "readme0": None,
    "readme1": {"text": "Flask\n=====\n\n.. image:: x\n\nFlask is a lightweight WSGI "
                        "web application framework. It is designed to be quick."},
}


def test_details_query_reads_the_about_fields_in_the_same_request():
    lookup, transport = lookup_with(lambda v: {"r0": NODE})
    out = lookup._details([REPO])["pallets/flask"]
    document, _ = transport.sent[0]
    assert len(transport.sent) == 1
    for field in ("forkCount", "licenseInfo", "issues(states: OPEN)", "createdAt",
                  "homepageUrl", "languages(first: 3", 'object(expression: "HEAD:README.md")'):
        assert field in document
    assert out["forks"] == 16_300 and out["open_issues"] == 5
    assert out["pull_requests"] == 4_100 and out["open_pull_requests"] == 12
    assert out["license"] == "BSD-3-Clause" and out["default_branch"] == "main"
    assert out["language_shares"] == [{"name": "Python", "share": 0.95}, {"name": "HTML", "share": 0.05}]
    assert out["fork_of"] == "orig/flask" and out["homepage"] == "flask.palletsprojects.com"
    # The README's first sentence, never the README.
    assert out["readme_line"] == "Flask is a lightweight WSGI web application framework."


def test_unrecognised_licence_reads_as_its_name():
    node = {**NODE, "licenseInfo": {"spdxId": "NOASSERTION", "name": "Other"}}
    lookup, _ = lookup_with(lambda v: {"r0": node})
    assert lookup._details([REPO])[REPO]["license"] == "Other"


def _served(h):
    r = h.get(f"/v1/reports/{REPO}")
    assert r.status_code == 200, r.text
    return r.json()["about"]


def test_report_serves_about_from_repo_meta(h):
    lookup, _ = lookup_with(lambda v: {"r0": NODE})
    details = lookup._details([REPO])
    add(h, Report(repo=REPO, repo_key=REPO, mode="rules", days=7,
                  report=canned_report(REPO), created_at=now()))
    assert _served(h) is None  # not read yet
    h.client.portal.call(lambda: discover.store_meta(h.svc, details))
    about = _served(h)
    assert about["description"] == "The Python micro framework"
    assert about["readme_line"].startswith("Flask is a lightweight")
    assert about["stars"] == 69_800 and about["forks"] == 16_300
    assert about["open_issues"] == 5 and about["license"] == "BSD-3-Clause"
    assert about["pull_requests"] == 4_100 and about["open_pull_requests"] == 12
    assert about["contributors"] is None  # `_details` alone doesn't ask REST
    assert about["topics"] == ["wsgi"] and about["languages"][0]["name"] == "Python"
    assert about["created_at"].startswith("2010-04-06") and about["pushed_at"].startswith("2026-09-27")
    assert about["default_branch"] == "main" and about["fork"] is True
    assert about["fork_of"] == "orig/flask" and about["archived"] is False
    # A bare host becomes a link.
    assert about["homepage"] == "https://flask.palletsprojects.com"
    # Served, never stored with the report.
    assert "about" not in h.client.portal.call(_stored_body, h)


async def _stored_body(h):
    async with h.svc.db.session() as s:
        return (await s.get(Report, 1)).report


def test_rows_read_before_the_new_fields_still_serve(h):
    add(h, Report(repo=REPO, repo_key=REPO, mode="rules", days=7,
                  report=canned_report(REPO), created_at=now()),
        RepoMeta(repo_key=REPO, repo=REPO, description="d", language="Python", stars=3,
                 topics=[], archived=True, fork=False))
    about = _served(h)
    assert about["stars"] == 3 and about["archived"] is True
    assert about["forks"] is None and about["languages"] == [] and about["readme_line"] is None


def test_only_web_addresses_are_kept_as_the_homepage():
    assert discover._homepage("javascript:alert(1)") is None
    assert discover._homepage("ftp://x.y") is None
    assert discover._homepage("") is None
    assert discover._homepage("http://x.y/docs") == "http://x.y/docs"


def test_details_fields_are_one_query_per_hundred(h):
    # No extra per-repo call: the README is an alias inside the same query.
    assert github.README_FIELDS.count("object(expression:") == len(github.README_PATHS)
    assert "languages(first: 3" in github.DETAILS_FIELDS


class _Response:
    def __init__(self, status, links=None, body=None, headers=None, text=""):
        self.status_code, self.links, self._body = status, links or {}, body
        self.headers, self.text = headers or {}, text

    def json(self):
        return self._body


class _Http:
    def __init__(self, response):
        self.response, self.asked = response, []

    def get(self, url, **kw):
        self.asked.append((url, kw.get("params")))
        return self.response


def _counting(response):
    lookup, _ = lookup_with(lambda v: {"r0": NODE})
    lookup.http = _Http(response)
    return lookup


def test_contributors_are_the_last_page_of_a_one_per_page_list():
    last = "https://api.github.com/repositories/1/contributors?per_page=1&anon=1&page=812"
    lookup = _counting(_Response(200, {"last": {"url": last}}))
    out = lookup._details_with_people([REPO])[REPO]
    assert out["contributors"] == 812
    url, params = lookup.http.asked[0]
    assert url.endswith("/repos/pallets/flask/contributors") and params == {"per_page": 1, "anon": 1}


def test_contributors_without_a_next_page_are_counted():
    assert _counting(_Response(200, body=[{"login": "a"}]))._contributors(REPO) == 1
    assert _counting(_Response(204))._contributors(REPO) == 0
    assert _counting(_Response(500))._contributors(REPO) is None


def test_rate_limited_contributors_leave_the_rest_of_the_details():
    out = _counting(_Response(403, headers={"x-ratelimit-remaining": "0"}))._details_with_people([REPO])[REPO]
    assert out["contributors"] is None and out["open_issues"] == 5


def test_a_missing_contributor_count_keeps_the_stored_one(h):
    details = {REPO: {**lookup_with(lambda v: {"r0": NODE})[0]._details([REPO])[REPO], "contributors": 40}}
    h.client.portal.call(lambda: discover.store_meta(h.svc, details))
    details[REPO]["contributors"] = None
    h.client.portal.call(lambda: discover.store_meta(h.svc, details))
    add(h, Report(repo=REPO, repo_key=REPO, mode="rules", days=7,
                  report=canned_report(REPO), created_at=now()))
    assert _served(h)["contributors"] == 40


def test_links_and_the_latest_release_are_read_and_served(h):
    node = {**NODE, "hasDiscussionsEnabled": True,
            "contributingGuidelines": {"url": "https://github.com/pallets/flask/blob/main/CONTRIBUTING.md"},
            "latestRelease": {"tagName": "3.1.0", "publishedAt": "2026-09-01T00:00:00Z",
                              "url": "https://github.com/pallets/flask/releases/tag/3.1.0"},
            "readme0": {"text": "Chat: https://discord.gg/pallets and https://flask.readthedocs.io/"}}
    lookup, _ = lookup_with(lambda v: {"r0": node})
    details = lookup._details([REPO])
    assert [x["kind"] for x in details[REPO]["links"]] == ["contributing", "discussions", "docs", "discord"]
    add(h, Report(repo=REPO, repo_key=REPO, mode="rules", days=7,
                  report=canned_report(REPO), created_at=now()))
    h.client.portal.call(lambda: discover.store_meta(h.svc, details))
    about = _served(h)
    assert [x["kind"] for x in about["links"]] == ["contributing", "discussions", "docs", "discord"]
    assert about["latest_release"] == {"tag": "3.1.0", "published_at": "2026-09-01T00:00:00Z",
                                       "url": "https://github.com/pallets/flask/releases/tag/3.1.0"}


def test_unsafe_or_repeated_links_are_dropped():
    kept = discover._links([{"kind": "docs", "url": "javascript:alert(1)"},
                            {"kind": "docs", "url": "https://a.dev"},
                            {"kind": "docs", "url": "https://b.dev"},
                            {"kind": "twitter", "url": "https://x.com/a"}, "junk", None])
    assert kept == [{"kind": "docs", "url": "https://a.dev"}]
    assert discover._release({"tag": "v1", "url": "ftp://x"}) is None
    assert discover._release(None) is None


def test_a_repo_without_links_or_releases_serves_empty(h):
    lookup, _ = lookup_with(lambda v: {"r0": NODE})
    add(h, Report(repo=REPO, repo_key=REPO, mode="rules", days=7,
                  report=canned_report(REPO), created_at=now()))
    h.client.portal.call(lambda: discover.store_meta(h.svc, lookup._details([REPO])))
    about = _served(h)
    assert about["links"] == [] and about["latest_release"] is None


def _person(login, n, kind="User"):
    return {"login": login, "type": kind, "contributions": n, "html_url": f"https://github.com/{login}",
            "avatar_url": f"https://avatars.githubusercontent.com/u/{n}?v=4"}


PEOPLE = [_person("davidism", 2500), _person("dependabot[bot]", 900, "Bot"),
          _person("pre-commit-ci[bot]", 300), _person("mitsuhiko", 2000), _person("ghost-user", 5)]


def _people_lookup(body=PEOPLE, names=None, status=200):
    names = names if names is not None else {"u0": {"name": "David Lord"}, "u1": None, "u2": {"name": " Armin Ronacher "}}
    lookup, transport = lookup_with(lambda v: names if "l0" in v else {"r0": NODE})
    lookup.http = _Http(_Response(status, body=body))
    return lookup, transport


def test_top_contributors_are_githubs_order_without_bots_and_with_real_names():
    lookup, transport = _people_lookup()
    out = lookup._details_with_people([REPO])[REPO]
    assert [p["login"] for p in out["top_contributors"]] == ["davidism", "mitsuhiko", "ghost-user"]
    named = {p["login"]: p["name"] for p in out["top_contributors"]}
    # Logins are asked for in sorted order: davidism, ghost-user, mitsuhiko.
    assert named == {"davidism": "David Lord", "ghost-user": None, "mitsuhiko": "Armin Ronacher"}
    assert out["top_contributors"][0]["contributions"] == 2500
    url, params = lookup.http.asked[1]
    assert url.endswith("/repos/pallets/flask/contributors") and params == {"per_page": github.TOP_CONTRIBUTORS_ASKED}
    # One names query for the whole batch, after the details query.
    document, variables = transport.sent[-1]
    assert "u2: user(login:$l2) { name }" in document and variables == {"l0": "davidism", "l1": "ghost-user", "l2": "mitsuhiko"}


def test_at_most_ten_contributors_are_kept():
    body = [_person(f"p{i}", 100 - i) for i in range(15)]
    out = _people_lookup(body, names={})[0]._details_with_people([REPO])[REPO]
    assert len(out["top_contributors"]) == github.TOP_CONTRIBUTORS == 10


def test_a_failed_names_query_leaves_logins_only():
    lookup, _ = lookup_with(lambda v: (_ for _ in ()).throw(RuntimeError("down")) if "l0" in v else {"r0": NODE})
    lookup.http = _Http(_Response(200, body=PEOPLE))
    out = lookup._details_with_people([REPO])[REPO]
    assert [p["name"] for p in out["top_contributors"]] == [None, None, None]


def test_contributors_are_stored_served_and_kept_when_github_wont_say(h):
    details = _people_lookup()[0]._details_with_people([REPO])
    h.client.portal.call(lambda: discover.store_meta(h.svc, details))
    add(h, Report(repo=REPO, repo_key=REPO, mode="rules", days=7,
                  report=canned_report(REPO), created_at=now()))
    served = _served(h)["top_contributors"]
    assert served[0] == {"login": "davidism", "name": "David Lord", "url": "https://github.com/davidism",
                         "avatar_url": "https://avatars.githubusercontent.com/u/2500?v=4", "contributions": 2500}
    # GitHub didn't answer this time: yesterday's list stays.
    again = _people_lookup(status=500)[0]._details_with_people([REPO])
    assert again[REPO]["top_contributors"] is None
    h.client.portal.call(lambda: discover.store_meta(h.svc, again))
    assert len(_served(h)["top_contributors"]) == 3


def test_only_github_profiles_are_served_as_contributors():
    people = discover._people([
        {"login": "ok", "url": "https://github.com/ok", "avatar_url": "javascript:x", "contributions": "7"},
        {"login": "evil", "url": "https://evil.example/ok"},
        {"login": "", "url": "https://github.com/x"}, "nonsense"])
    assert people == [{"login": "ok", "name": None, "url": "https://github.com/ok", "avatar_url": None, "contributions": 7}]


def test_a_repository_too_large_to_list_is_not_a_rate_limit():
    # GitHub's answer for NixOS/nixpkgs, with quota to spare: that repository
    # gets no count or list, and the rest of the batch carries on.
    too_large = _Response(403, headers={"x-ratelimit-remaining": "4970"},
                          text='{"message":"The history or contributor list is too large to list contributors for this repository via the API."}')
    lookup = _counting(too_large)
    assert lookup._contributors(REPO) is None and lookup._top_contributors(REPO) is None
    assert github._rate_limited(_Response(403, text='{"message":"You have exceeded a secondary rate limit."}'))
    assert github._rate_limited(_Response(429))
