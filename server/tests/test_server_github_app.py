"""Reading GitHub as the GitHub App: the JWT, the installation token's cache
and refresh, the fallback to GITHUB_TOKENS, and that no secret reaches a log
or an error.

No network: GitHub's replies come from an `httpx.MockTransport`.
"""

from __future__ import annotations

import logging
import threading
import time

import httpx
import jwt
import pytest
from conftest import make_settings
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from holt_server import github_app
from holt_server.errors import ApiError
from holt_server.github import TokenPool, build_pool
from holt_server.github_app import AppConfigError, GitHubApp
from holt_server.settings import Settings

from holt.evidence.errors import AuthError

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PEM = _KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                         serialization.NoEncryption()).decode()
PUBLIC = _KEY.public_key()
NOW = 1_800_000_000.0


class Clock:
    def __init__(self) -> None:
        self.t = NOW

    def __call__(self) -> float:
        return self.t


def iso(epoch: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


class FakeGitHub:
    """The token endpoint (and GraphQL), counting how often a token is minted."""

    def __init__(self, clock: Clock, status: int = 201, delay: float = 0.0) -> None:
        self.clock = clock
        self.status = status
        self.delay = delay
        self.minted = 0
        self.jwts: list[str] = []
        self.graphql_auth: list[str] = []
        self._lock = threading.Lock()

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/graphql":
            self.graphql_auth.append(request.headers["Authorization"])
            return httpx.Response(200, json={"data": {"rateLimit": {
                "remaining": 4900, "resetAt": iso(self.clock.t + 3600)}}})
        assert request.method == "POST"
        assert request.url.path == "/app/installations/42/access_tokens"
        self.jwts.append(request.headers["Authorization"].removeprefix("Bearer "))
        if self.delay:
            time.sleep(self.delay)
        if self.status != 201:
            return httpx.Response(self.status, json={"message": "A JSON web token could not be decoded"})
        with self._lock:
            self.minted += 1
            n = self.minted
        return httpx.Response(201, json={"token": f"ghs_installation{n}",
                                         "expires_at": iso(self.clock.t + 3600)})


def make_app(clock: Clock | None = None, **fake) -> tuple[GitHubApp, FakeGitHub]:
    clock = clock or Clock()
    gh = FakeGitHub(clock, **fake)
    app = GitHubApp("123456", "42", PEM, http=httpx.Client(transport=httpx.MockTransport(gh)),
                    clock=clock)
    return app, gh


# --- the JWT ---------------------------------------------------------------------


def test_jwt_is_rs256_backdated_and_short_lived():
    app, _ = make_app()
    token = app.jwt()
    assert jwt.get_unverified_header(token)["alg"] == "RS256"
    claims = jwt.decode(token, PUBLIC, algorithms=["RS256"],
                        options={"verify_exp": False, "verify_iat": False})
    assert claims["iss"] == "123456"
    assert claims["iat"] <= NOW - 30  # backdated for clock drift
    assert claims["exp"] - claims["iat"] <= 600  # GitHub refuses more than 10 minutes
    assert claims["exp"] > NOW


def test_the_token_request_carries_the_jwt():
    app, gh = make_app()
    app.token()
    claims = jwt.decode(gh.jwts[0], PUBLIC, algorithms=["RS256"],
                        options={"verify_exp": False, "verify_iat": False})
    assert claims["iss"] == "123456"


# --- cache and refresh -----------------------------------------------------------


def test_installation_token_is_cached():
    app, gh = make_app()
    assert app.token() == "ghs_installation1"
    assert app.token() == "ghs_installation1"
    assert gh.minted == 1


def test_token_is_refreshed_before_it_expires():
    clock = Clock()
    app, gh = make_app(clock)
    app.token()
    clock.t += 3600 - github_app.REFRESH_BEFORE_S - 1
    assert app.token() == "ghs_installation1"
    clock.t += 2
    assert app.token() == "ghs_installation2"
    assert gh.minted == 2


def test_a_handed_out_token_outlives_the_longest_job():
    # Starter issues and find take the token as a string, so it must still be
    # good when the job's time limit comes.
    settings = Settings(_env_file=None)
    longest = max(settings.job_timeout_rules, settings.job_timeout_ai, settings.job_timeout_find)
    assert github_app.REFRESH_BEFORE_S > longest


def test_concurrent_callers_share_one_refresh():
    app, gh = make_app(delay=0.2)
    start = threading.Barrier(8)
    got: list[str] = []

    def call():
        start.wait()
        got.append(app.token())

    threads = [threading.Thread(target=call) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert gh.minted == 1
    assert got == ["ghs_installation1"] * 8


def test_a_refused_token_is_dropped_and_a_new_one_minted():
    app, gh = make_app()
    first = app.token()
    app.invalidate(first)
    assert app.token() == "ghs_installation2"
    app.invalidate(first)  # someone else's stale report doesn't drop the new one
    assert app.token() == "ghs_installation2"
    assert gh.minted == 2


# --- the pool --------------------------------------------------------------------


def test_pool_leases_the_app_token_and_names_it_in_logs(caplog):
    app, gh = make_app()
    pool = TokenPool([app])
    assert pool.next() == "ghs_installation1"
    with caplog.at_level(logging.WARNING, logger="holt_server.github"):
        pool.note_rate_limited(0, 120)
        pool.note_points(0, 3, iso(NOW + 900))
    assert "the GitHub App" in caplog.text
    assert "ghs_" not in caplog.text and "token #" not in caplog.text


def test_transport_uses_a_fresh_token_for_every_query():
    clock = Clock()
    app, gh = make_app(clock)
    pool = TokenPool([app])
    gql = pool.transport(app.http)
    gql.query("query { rateLimit { remaining resetAt } }")
    clock.t += 3600  # a long job: the first token has run out meanwhile
    gql.query("query { rateLimit { remaining resetAt } }")
    assert gh.graphql_auth == ["bearer ghs_installation1", "bearer ghs_installation2"]


def test_a_401_on_the_app_token_mints_a_new_one_instead_of_benching_the_app():
    clock = Clock()
    gh = FakeGitHub(clock)
    refused = {"ghs_installation1"}

    def handler(request):
        if request.url.path == "/graphql":
            if request.headers["Authorization"].split()[-1] in refused:
                return httpx.Response(401, json={"message": "Bad credentials"})
        return gh(request)

    app = GitHubApp("123456", "42", PEM, http=httpx.Client(transport=httpx.MockTransport(handler)),
                    clock=clock)
    pool = TokenPool([app])
    with pytest.raises(AuthError):
        pool.transport(app.http).query("query { x }")
    assert pool.next() == "ghs_installation2"


def test_github_refusing_to_mint_benches_the_app_without_leaking_secrets(caplog):
    app, gh = make_app(status=401)
    pool = TokenPool([app])
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(ApiError) as err:
            pool.next()
    assert err.value.code == "upstream"
    assert "the GitHub App" in caplog.text
    secrets = [gh.jwts[0], PEM.splitlines()[1]]
    for secret in secrets:
        assert secret not in caplog.text
        assert secret not in err.value.message
    with pytest.raises(ApiError):  # left out for a while, not asked again at once
        pool.next()
    assert len(gh.jwts) == 1


def test_mint_errors_name_no_secret():
    app, gh = make_app(status=500)
    with pytest.raises(Exception) as err:
        app.token()
    text = f"{err.value!r} {err.value}"
    assert gh.jwts[0] not in text and "PRIVATE KEY" not in text


# --- configuration ---------------------------------------------------------------


def test_without_the_app_the_pool_is_github_tokens(tmp_path):
    pool = build_pool(make_settings(tmp_path), httpx.Client())
    assert [pool.next() for _ in range(3)] == ["tok1", "tok2", "tok1"]


def test_with_the_app_the_pool_is_the_app_only(tmp_path, caplog):
    key = tmp_path / "app.pem"
    key.write_text(PEM, encoding="utf-8")
    settings = make_settings(tmp_path, GITHUB_APP_ID="123456", GITHUB_APP_INSTALLATION_ID="42",
                             GITHUB_APP_PRIVATE_KEY_FILE=str(key))
    gh = FakeGitHub(Clock())
    with caplog.at_level(logging.INFO, logger="holt_server.github"):
        pool = build_pool(settings, httpx.Client(transport=httpx.MockTransport(gh)))
    assert len(pool) == 1 and pool.label(0) == "the GitHub App"
    assert "GITHUB_TOKENS" in caplog.text  # says the tokens are not used
    assert "tok1" not in caplog.text


def test_inline_key_with_escaped_newlines(tmp_path):
    settings = make_settings(tmp_path, GITHUB_APP_ID="123456", GITHUB_APP_INSTALLATION_ID="42",
                             GITHUB_APP_PRIVATE_KEY=PEM.replace("\n", "\\n"))
    app = github_app.from_settings(settings, httpx.Client())
    assert app is not None
    jwt.decode(app.jwt(), PUBLIC, algorithms=["RS256"],
               options={"verify_exp": False, "verify_iat": False})


@pytest.mark.parametrize("values, missing", [
    ({"GITHUB_APP_ID": "1"}, "GITHUB_APP_INSTALLATION_ID"),
    ({"GITHUB_APP_ID": "1", "GITHUB_APP_INSTALLATION_ID": "2"}, "GITHUB_APP_PRIVATE_KEY_FILE"),
    ({"GITHUB_APP_INSTALLATION_ID": "2", "GITHUB_APP_PRIVATE_KEY": PEM}, "GITHUB_APP_ID"),
])
def test_half_configured_app_is_an_error_not_a_silent_fallback(tmp_path, values, missing):
    with pytest.raises(AppConfigError) as err:
        github_app.from_settings(make_settings(tmp_path, **values), httpx.Client())
    assert missing in str(err.value)
    assert "PRIVATE KEY-----" not in str(err.value)


def test_unreadable_or_bad_key_is_an_error_that_shows_no_key(tmp_path):
    base = {"GITHUB_APP_ID": "1", "GITHUB_APP_INSTALLATION_ID": "2"}
    with pytest.raises(AppConfigError) as err:
        github_app.from_settings(make_settings(
            tmp_path, **base, GITHUB_APP_PRIVATE_KEY_FILE=str(tmp_path / "nope.pem")),
            httpx.Client())
    assert "nope.pem" in str(err.value)
    bad = "-----BEGIN PRIVATE KEY-----\nnot-a-key-at-all\n-----END PRIVATE KEY-----\n"
    with pytest.raises(AppConfigError) as err:
        github_app.from_settings(make_settings(tmp_path, **base, GITHUB_APP_PRIVATE_KEY=bad),
                                 httpx.Client())
    assert "not-a-key-at-all" not in str(err.value)


# --- the verify command ----------------------------------------------------------


def test_verify_command_names_the_app_and_proves_a_public_read(tmp_path, capsys):
    clock = Clock()
    gh = FakeGitHub(clock)

    def handler(request):
        path = request.url.path
        if path == "/app":
            return httpx.Response(200, json={"slug": "holt-reader", "id": 123456})
        if path == "/graphql":
            return httpx.Response(200, json={"data": {
                "repository": {"nameWithOwner": "pallets/flask",
                               "pullRequests": {"nodes": [{"number": 1}]},
                               "object": {"byteSize": 10}},
                "search": {"issueCount": 3000},
                "rateLimit": {"cost": 1, "remaining": 4999, "resetAt": iso(clock.t + 3600)}}})
        if path.startswith("/user/"):
            return httpx.Response(200, json={"login": "octocat"})
        return gh(request)

    settings = make_settings(tmp_path, GITHUB_APP_ID="123456", GITHUB_APP_INSTALLATION_ID="42",
                             GITHUB_APP_PRIVATE_KEY=PEM)
    assert github_app.main(settings, httpx.Client(transport=httpx.MockTransport(handler))) == 0
    out = capsys.readouterr().out
    assert "holt-reader" in out and "4999" in out and "readable" in out
    assert "ghs_" not in out and gh.jwts[0] not in out and "PRIVATE KEY" not in out


def test_verify_command_without_the_app_says_so(tmp_path, capsys):
    assert github_app.main(make_settings(tmp_path), httpx.Client()) == 0
    assert "not set up" in capsys.readouterr().out
