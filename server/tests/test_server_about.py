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
    def __init__(self, status, links=None, body=None):
        self.status_code, self.links, self._body = status, links or {}, body

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
    out = _counting(_Response(403))._details_with_people([REPO])[REPO]
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
