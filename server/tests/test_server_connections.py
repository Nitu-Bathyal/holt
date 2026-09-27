"""Connect GitHub: the connection, the 18+ confirmation, the statistics
opt-out, and the report pages a connected user opened. GitHub is faked."""

from __future__ import annotations

import httpx
import pytest
from holt_server.db import GitHubConnection, RepoView
from sqlalchemy import select


@pytest.fixture
def gh(h):
    """GitHub's `/user/{id}`: ids in `users` exist, anything else is a 404."""
    users = {583231: "octocat", 42: "someone"}
    seen: list[httpx.Request] = []

    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        uid = int(req.url.path.rsplit("/", 1)[1])
        if uid in users:
            return httpx.Response(200, json={"id": uid, "login": users[uid]})
        return httpx.Response(404, json={"message": "Not Found"})

    h.svc.http.close()
    h.svc.http = httpx.Client(transport=httpx.MockTransport(handle))
    h.users, h.seen = users, seen
    return h


def connect(h, user="u1", github_id=583231, adult=True, opt_out=False):
    return h.post("/v1/me/github", {"github_id": github_id, "adult_confirmed": adult,
                                    "stats_opt_out": opt_out}, user=user)


def patch(h, json, user="u1"):
    return h.client.patch("/v1/me/github", json=json, headers=h.headers(user))


def view(h, repo, user="u1"):
    return h.post("/v1/me/activity", {"repo": repo}, user=user)


def views(h):
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(RepoView).order_by(RepoView.repo_key))).scalars().all()
    return h.client.portal.call(q)


def test_not_connected_by_default(gh):
    assert gh.get("/v1/me/github", user="u1").json() == {"connected": False, "account": None}


def test_signed_in_only(gh):
    for r in (gh.get("/v1/me/github"), gh.post("/v1/me/github", {"github_id": 1, "adult_confirmed": True}),
              gh.delete("/v1/me/github"), gh.post("/v1/me/activity", {"repo": "a/b"})):
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "unauthorized"


def test_connect_resolves_login_with_a_pool_token(gh):
    r = connect(gh)
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["connected"] is True
    acct = got["account"]
    assert (acct["id"], acct["login"], acct["stats_opt_out"]) == (583231, "octocat", False)
    assert acct["connected_at"].endswith("Z") and acct["adult_confirmed_at"].endswith("Z")
    [req] = gh.seen
    assert str(req.url) == "https://api.github.com/user/583231"
    assert req.headers["authorization"] in ("Bearer tok1", "Bearer tok2")
    assert gh.get("/v1/me/github", user="u1").json() == got


def test_connect_needs_the_18_plus_confirmation(gh):
    r = connect(gh, adult=False)
    assert r.status_code == 400
    assert "18" in r.json()["error"]["message"]
    assert gh.get("/v1/me/github", user="u1").json()["connected"] is False
    assert gh.seen == []


def test_opt_out_at_connect_and_later_in_settings(gh):
    assert connect(gh, opt_out=True).json()["account"]["stats_opt_out"] is True
    r = patch(gh, {"stats_opt_out": False})
    assert r.status_code == 200
    assert r.json()["account"]["stats_opt_out"] is False
    assert gh.get("/v1/me/github", user="u1").json()["account"]["stats_opt_out"] is False


def test_settings_toggle_needs_a_connection(gh):
    r = patch(gh, {"stats_opt_out": True})
    assert r.status_code == 404


def test_unknown_github_account(gh):
    r = connect(gh, github_id=999)
    assert r.status_code == 400
    assert "couldn't find" in r.json()["error"]["message"]
    assert gh.get("/v1/me/github", user="u1").json()["connected"] is False


def test_one_github_account_one_holt_user(gh):
    assert connect(gh, user="u1").status_code == 200
    r = connect(gh, user="u2")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "invalid_request"
    # Connecting again as the same user is fine and keeps the first date.
    first = gh.get("/v1/me/github", user="u1").json()["account"]["connected_at"]
    again = connect(gh, user="u1", opt_out=True).json()["account"]
    assert again["connected_at"] == first and again["stats_opt_out"] is True


def test_reconnecting_picks_up_a_renamed_login(gh):
    connect(gh)
    gh.users[583231] = "octo-renamed"
    assert connect(gh).json()["account"]["login"] == "octo-renamed"


def test_github_trouble_is_a_plain_error(gh):
    def boom(req):
        raise httpx.ConnectError("down")
    gh.svc.http = httpx.Client(transport=httpx.MockTransport(boom))
    r = connect(gh)
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "upstream"

    gh.svc.http = httpx.Client(transport=httpx.MockTransport(
        lambda req: httpx.Response(403, headers={"x-ratelimit-remaining": "0"})))
    r = connect(gh)
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"


def test_views_are_recorded_only_while_connected(gh):
    assert view(gh, "pallets/flask").status_code == 204
    assert views(gh) == []

    connect(gh)
    view(gh, "pallets/flask")
    view(gh, "Pallets/Flask")
    view(gh, "https://github.com/NixOS/nixpkgs")
    view(gh, "pallets/flask", user="u2")  # not connected: nothing kept
    got = views(gh)
    assert [(v.user_id, v.repo_key, v.repo, v.views) for v in got] == [
        ("u1", "nixos/nixpkgs", "NixOS/nixpkgs", 1),
        ("u1", "pallets/flask", "Pallets/Flask", 2),
    ]
    flask = got[1]
    assert flask.last_viewed_at >= flask.first_viewed_at


def test_bad_repo_is_rejected(gh):
    connect(gh)
    r = view(gh, "not a repo")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_repo"


def test_disconnect_deletes_the_connection_and_the_views(gh):
    connect(gh)
    connect(gh, user="u2", github_id=42)
    view(gh, "pallets/flask")
    view(gh, "pallets/flask", user="u2")
    r = gh.delete("/v1/me/github", user="u1")
    assert r.status_code == 200
    assert r.json() == {"connected": False, "account": None}
    assert [v.user_id for v in views(gh)] == ["u2"]

    async def conns():
        async with gh.svc.db.session() as s:
            return (await s.execute(select(GitHubConnection.user_id))).scalars().all()
    assert gh.client.portal.call(conns) == ["u2"]
    # And the GitHub account is free to connect again, to anyone.
    assert connect(gh, user="u3").status_code == 200
