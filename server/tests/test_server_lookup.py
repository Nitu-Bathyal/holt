"""The existence check before a job is queued: one REST request, no GraphQL
points, with the GraphQL lookup behind it when REST doesn't answer. Every
response comes from `httpx.MockTransport`; nothing reaches GitHub."""

from __future__ import annotations

import httpx
import pytest
from holt_server.errors import ApiError
from holt_server.github import GitHubLookup, TokenPool


class GitHub:
    """REST answers `rest(request)`; GraphQL finds `graphql_name` (or nothing)."""

    def __init__(self, rest, graphql_name: str | None = "o/r") -> None:
        self.rest = rest
        self.graphql_name = graphql_name
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/graphql":
            repo = ({"nameWithOwner": self.graphql_name, "isPrivate": False}
                    if self.graphql_name else None)
            return httpx.Response(200, json={"data": {"repository": repo}})
        return self.rest(request)

    def lookup(self, tokens=("tok",)) -> GitHubLookup:
        return GitHubLookup(TokenPool(list(tokens)),
                            httpx.Client(transport=httpx.MockTransport(self.handler)))

    @property
    def graphql_calls(self) -> int:
        return sum(1 for r in self.requests if r.url.path == "/graphql")


def test_the_lookup_is_one_rest_request():
    gh = GitHub(lambda r: httpx.Response(200, json={"full_name": "Pallets/Flask",
                                                    "private": False}))
    assert gh.lookup()._repo("pallets/flask").name_with_owner == "Pallets/Flask"
    [request] = gh.requests
    assert request.method == "GET"
    assert str(request.url) == "https://api.github.com/repos/pallets/flask"
    assert request.headers["Authorization"] == "Bearer tok"


def test_a_renamed_repository_follows_githubs_redirect():
    def rest(request):
        if request.url.path == "/repos/facebook/react-native":
            return httpx.Response(301, headers={
                "Location": "https://api.github.com/repositories/29028775"})
        return httpx.Response(200, json={"full_name": "react/react-native", "private": False})

    gh = GitHub(rest)
    assert gh.lookup()._repo("facebook/react-native").name_with_owner == "react/react-native"
    assert gh.graphql_calls == 0


@pytest.mark.parametrize("answer", [
    httpx.Response(404, json={"message": "Not Found"}),
    httpx.Response(200, json={"full_name": "o/r", "private": True}),
])
def test_missing_or_private_is_not_found(answer):
    gh = GitHub(lambda r: answer)
    with pytest.raises(ApiError) as caught:
        gh.lookup()._repo("o/r")
    assert caught.value.code == "not_found"
    assert gh.graphql_calls == 0


@pytest.mark.parametrize("answer", [
    httpx.Response(403, headers={"x-ratelimit-remaining": "0"}, json={}),
    httpx.Response(429, headers={"retry-after": "30"}, json={}),
    httpx.Response(502),
    httpx.Response(200, text="not json"),
])
def test_when_rest_doesnt_answer_graphql_decides(answer):
    gh = GitHub(lambda r: answer, graphql_name="O/R")
    assert gh.lookup()._repo("o/r").name_with_owner == "O/R"
    assert gh.graphql_calls == 1


def test_a_dropped_connection_falls_back_too():
    def rest(request):
        raise httpx.ConnectError("reset")

    gh = GitHub(rest, graphql_name=None)
    with pytest.raises(ApiError) as caught:
        gh.lookup()._repo("o/r")
    assert caught.value.code == "not_found"  # GraphQL's answer
    assert gh.graphql_calls == 1


def test_a_refused_token_is_left_out():
    def rest(request):
        if request.headers["Authorization"] == "Bearer bad":
            return httpx.Response(401, json={})
        return httpx.Response(200, json={"full_name": "o/r", "private": False})

    gh = GitHub(rest)
    lookup = gh.lookup(tokens=("bad", "good"))
    assert lookup._repo("o/r").name_with_owner == "o/r"
    assert gh.graphql_calls == 1  # asked on the next token
    assert {lookup.pool.next() for _ in range(3)} == {"good"}
