"""GET /v1/repos/search: which repository does a bare name mean? Read with
GitHub's REST search (one request, its own budget), cached for a few minutes."""

from __future__ import annotations

import pytest
from holt.evidence.errors import RateLimited
from holt_server import api, github
from holt_server.errors import ApiError
from test_server_discover import lookup_with


@pytest.fixture(autouse=True)
def _fresh_cache():
    api._repo_searches.clear()
    yield
    api._repo_searches.clear()


# --- the GitHub side ----------------------------------------------------------

ITEMS = [
    {"full_name": "excalidraw/excalidraw", "description": " Virtual whiteboard ", "stargazers_count": 90_000},
    {"full_name": "someone/excalidraw-tools", "description": None, "stargazers_count": 12},
    {"full_name": "hidden/excalidraw", "description": "x", "stargazers_count": 5, "private": True},
    "junk",
    {"description": "no name", "stargazers_count": 1},
]


class _Response:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class _Http:
    def __init__(self, response):
        self.response, self.asked = response, []

    def get(self, url, **kw):
        self.asked.append((url, kw.get("params"), kw.get("headers")))
        return self.response


def _search(response):
    lookup, _ = lookup_with(lambda v: {})
    lookup.http = _Http(response)
    return lookup


def test_the_search_asks_for_names_most_starred_first_without_forks():
    lookup = _search(_Response(200, {"items": ITEMS}))
    out = lookup._search("excalidraw")
    url, params, headers = lookup.http.asked[0]
    assert url == github.SEARCH_URL
    assert params == {"q": "excalidraw in:name fork:false", "sort": "stars", "order": "desc",
                      "per_page": github.SEARCH_RESULTS}
    assert headers["Authorization"] == "Bearer tok"
    # Private repos, junk and entries with no name are left out; a blank description is None.
    assert out == [{"repo": "excalidraw/excalidraw", "description": "Virtual whiteboard", "stars": 90_000},
                   {"repo": "someone/excalidraw-tools", "description": None, "stars": 12}]


def test_no_matches_is_an_empty_list():
    assert _search(_Response(200, {"items": []}))._search("zzzz") == []
    assert _search(_Response(200, {}))._search("zzzz") == []
    assert _search(_Response(422, {"message": "Validation Failed"}))._search("x") == []


def test_a_rate_limited_search_says_so_and_other_failures_are_upstream():
    for status in (403, 429):
        with pytest.raises(RateLimited):
            _search(_Response(status))._search("x")
    for response in (_Response(500), _Response(401), _Response(200, ValueError("not json"))):
        with pytest.raises(ApiError) as err:
            _search(response)._search("x")
        assert err.value.code == "upstream"


# --- the endpoint -------------------------------------------------------------

class _Fake:
    def __init__(self, results=None, error=None):
        self.calls, self.results, self.error = [], results or [], error

    async def __call__(self, name):
        self.calls.append(name)
        if self.error is not None:
            raise self.error
        return list(self.results)


HIT = {"repo": "excalidraw/excalidraw", "description": "Virtual whiteboard", "stars": 90_000}


def test_a_name_finds_its_repositories(h):
    h.svc.lookup.search = _Fake([HIT])
    r = h.get("/v1/repos/search?q=Excalidraw")
    assert r.status_code == 200, r.text
    assert r.json() == {"query": "excalidraw", "results": [HIT]}
    assert h.svc.lookup.search.calls == ["excalidraw"]  # lower-cased


def test_the_same_name_is_answered_from_the_cache(h):
    h.svc.lookup.search = _Fake([HIT])
    for q in ("excalidraw", "Excalidraw", "  EXCALIDRAW "):
        assert h.get(f"/v1/repos/search?q={q.strip()}").json()["results"] == [HIT]
    assert h.svc.lookup.search.calls == ["excalidraw"]


def test_a_name_with_no_matches_is_an_empty_answer_not_an_error(h):
    h.svc.lookup.search = _Fake([])
    r = h.get("/v1/repos/search?q=nosuchthingatall")
    assert r.status_code == 200 and r.json()["results"] == []


@pytest.mark.parametrize("q", ["owner/name", "a;b", "x:y", "a%20in:name", "<script>", "a" * 61, ""])
def test_a_query_that_is_not_a_name_is_refused(h, q):
    h.svc.lookup.search = _Fake([HIT])
    r = h.get(f"/v1/repos/search?q={q}")
    assert r.status_code in (400, 422), r.text
    assert h.svc.lookup.search.calls == []


def test_github_rate_limiting_is_passed_on_and_not_cached(h):
    h.svc.lookup.search = _Fake(error=RateLimited(retry_after=None))
    r = h.get("/v1/repos/search?q=excalidraw")
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"
    h.svc.lookup.search = _Fake([HIT])
    assert h.get("/v1/repos/search?q=excalidraw").json()["results"] == [HIT]


def test_the_internal_key_is_needed(h):
    h.svc.lookup.search = _Fake([HIT])
    r = h.client.get("/v1/repos/search?q=excalidraw")
    assert r.status_code in (401, 403)
    assert h.svc.lookup.search.calls == []


def test_a_search_from_nobody_in_particular_is_refused(h):
    h.svc.lookup.search = _Fake([HIT])
    r = h.get("/v1/repos/search?q=excalidraw", ip=None)
    assert r.status_code == 400 and "X-Holt-Client-Ip" in r.json()["error"]["message"]
