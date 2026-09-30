"""Reading GitHub as the Holt GitHub App instead of a person's tokens.

When `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID` and a private key
(`GITHUB_APP_PRIVATE_KEY_FILE`, or `GITHUB_APP_PRIVATE_KEY` inline) are set,
the server signs a short JWT with the key, trades it for an installation
access token (good for an hour), and hands that token out until shortly before
it expires. Without them the server reads with `GITHUB_TOKENS`, as before.
Why an App and not a machine user: docs/adr/0001-read-github-as-an-app.md.

Neither the key, the JWT nor a token is ever put in a log or an error.

`python -m holt_server.github_app` prints who the server reads GitHub as, the
points it has left, and whether it can read public repositories
(docs/ops/github-app.md).
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from pathlib import Path

import httpx
import jwt

from holt.evidence.errors import AuthError, RateLimited, UpstreamError

log = logging.getLogger("holt_server.github")

API = "https://api.github.com"
HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
# GitHub refuses a JWT that expires more than 10 minutes out, and one issued
# "in the future" by a clock running ahead of its own; so it is backdated.
JWT_BACKDATE_S = 60
JWT_LIFETIME_S = 540
# A new installation token is fetched this long before the old one expires.
# Longer than any job's time limit (settings.py): starter issues and find take
# the token as a string and keep it for the whole job.
REFRESH_BEFORE_S = 600
MINT_TIMEOUT_S = 15.0


class AppConfigError(RuntimeError):
    """The GitHub App is half set up, or its key can't be read."""


class GitHubApp:
    """One installation of the Holt GitHub App: a token source for the pool.

    `token()` is thread-safe; when the cached token is due for renewal, one
    caller fetches the next and the others wait for it.
    """

    label = "the GitHub App"
    renews = True

    def __init__(self, app_id: str, installation_id: str, private_key: str,
                 http: httpx.Client | None = None, clock=time.time, api: str = API) -> None:
        self.app_id = str(app_id)
        self.installation_id = str(installation_id)
        self._key = private_key
        self.http = http or httpx.Client(timeout=30.0)
        self._clock = clock
        self._api = api.rstrip("/")
        self._token: str | None = None
        self._expires_at = 0.0
        self._lock = threading.Lock()

    def jwt(self) -> str:
        now = int(self._clock())
        return jwt.encode({"iat": now - JWT_BACKDATE_S, "exp": now + JWT_LIFETIME_S,
                           "iss": self.app_id}, self._key, algorithm="RS256")

    def token(self) -> str:
        with self._lock:
            if self._token is None or self._clock() >= self._expires_at - REFRESH_BEFORE_S:
                self._token, self._expires_at = self._mint()
            return self._token

    def invalidate(self, token: str) -> None:
        """GitHub refused `token`: fetch a new one next time (unless another
        thread already has)."""
        with self._lock:
            if self._token == token:
                self._token = None

    def _mint(self) -> tuple[str, float]:
        url = f"{self._api}/app/installations/{self.installation_id}/access_tokens"
        try:
            res = self.http.post(url, headers={**HEADERS, "Authorization": f"Bearer {self.jwt()}"},
                                 timeout=MINT_TIMEOUT_S)
        except httpx.HTTPError as exc:
            raise UpstreamError(f"installation token request: {type(exc).__name__}") from None
        status = res.status_code
        if status == 429 or (status == 403 and res.headers.get("x-ratelimit-remaining") == "0"):
            retry = res.headers.get("retry-after")
            raise RateLimited(float(retry) if retry and retry.isdigit() else None)
        if status in (401, 403, 404, 422):
            # Wrong app id or key, or the app isn't installed there (any more).
            raise AuthError(f"installation token request: HTTP {status}")
        if status != 201:
            raise UpstreamError(f"installation token request: HTTP {status}")
        body = res.json() or {}
        token, expires = body.get("token"), body.get("expires_at")
        if not isinstance(token, str) or not token:
            raise UpstreamError("installation token request: no token in the reply")
        try:
            expires_at = datetime.fromisoformat(str(expires).replace("Z", "+00:00")).timestamp()
        except ValueError:
            expires_at = self._clock() + 3600
        log.info("got a new installation token for %s (expires in %d min)",
                 self.label, round((expires_at - self._clock()) / 60))
        return token, expires_at


def from_settings(settings, http: httpx.Client | None = None) -> GitHubApp | None:
    """The GitHub App the settings describe, or None when none is set up.

    Raises `AppConfigError` when it is only partly set up or the key can't be
    used: a silent fallback to a person's tokens is what this replaces.
    """
    app_id = settings.github_app_id.strip()
    installation = settings.github_app_installation_id.strip()
    inline, path = settings.github_app_private_key, settings.github_app_private_key_file.strip()
    if not (app_id or installation or inline.strip() or path):
        return None
    missing = [name for name, value in (("GITHUB_APP_ID", app_id),
                                        ("GITHUB_APP_INSTALLATION_ID", installation))
               if not value]
    if not (inline.strip() or path):
        missing.append("GITHUB_APP_PRIVATE_KEY_FILE (or GITHUB_APP_PRIVATE_KEY)")
    if missing:
        raise AppConfigError(f"the GitHub App is only partly set up: {', '.join(missing)} "
                             "not set. Set all of them, or none to read with GITHUB_TOKENS.")
    if path:
        try:
            key = Path(path).read_text(encoding="utf-8")
        except OSError as exc:
            raise AppConfigError(f"can't read GITHUB_APP_PRIVATE_KEY_FILE {path} "
                                 f"({type(exc).__name__})") from None
        source = "GITHUB_APP_PRIVATE_KEY_FILE"
    else:
        # A PEM in an env file is often one line with "\n" written out.
        key = inline.replace("\\n", "\n") if "\n" not in inline.strip() else inline
        source = "GITHUB_APP_PRIVATE_KEY"
    app = GitHubApp(app_id, installation, key.strip() + "\n", http=http)
    try:
        app.jwt()
    except Exception as exc:  # noqa: BLE001 -- the message could quote the key
        raise AppConfigError(f"{source} is not a usable RSA private key "
                             f"({type(exc).__name__})") from None
    return app


# What the verify command reads: a public repository the app is not installed
# on, the way a report does (pull requests with their timelines, a file, a
# search), and a user by id, as My Contributions does.
PUBLIC_CHECK = """
query {
  repository(owner: "pallets", name: "flask") {
    nameWithOwner
    pullRequests(first: 1, states: MERGED) { nodes { number timelineItems(first: 1) { totalCount } } }
    object(expression: "HEAD:README.md") { ... on Blob { byteSize } }
  }
  search(query: "repo:pallets/flask is:pr", type: ISSUE, first: 1) { issueCount }
  rateLimit { cost remaining resetAt }
}
"""


def main(settings=None, http: httpx.Client | None = None) -> int:
    """Who the server reads GitHub as, what it has left, and whether it can
    read public repositories. Prints no secret."""
    from holt_server.github import build_pool
    from holt_server.settings import get_settings

    settings = settings or get_settings()
    http = http or httpx.Client(timeout=30.0)
    try:
        app = from_settings(settings, http)
    except AppConfigError as exc:
        print(f"error: {exc}")
        return 1
    if app is None:
        print(f"GitHub App: not set up; reading with GITHUB_TOKENS "
              f"({len(settings.token_list)} token(s))")
        return 0
    res = http.get(f"{API}/app", headers={**HEADERS, "Authorization": f"Bearer {app.jwt()}"})
    if res.status_code != 200:
        print(f"error: GitHub refused the app's JWT (HTTP {res.status_code}): "
              "check GITHUB_APP_ID and the private key")
        return 1
    print(f"GitHub App: {(res.json() or {}).get('slug')} "
          f"(app {app.app_id}, installation {app.installation_id})")
    pool = build_pool(settings, http)
    try:
        gql = pool.transport(http)
        data = gql.query(PUBLIC_CHECK)
        user = http.get(f"{API}/user/583231",  # octocat, by id
                        headers={**HEADERS, "Authorization": f"Bearer {gql.token}"})
    except Exception as exc:  # noqa: BLE001 -- ApiError and the engine's errors carry no secret
        print(f"error: {getattr(exc, 'message', None) or exc}")
        return 1
    repo = data.get("repository") or {}
    readable = bool(repo.get("nameWithOwner") and (repo.get("pullRequests") or {}).get("nodes")
                    and repo.get("object") and (data.get("search") or {}).get("issueCount")
                    and user.status_code == 200)
    limit = data.get("rateLimit") or {}
    print(f"GraphQL points left: {limit.get('remaining')} (resets {limit.get('resetAt')})")
    print("public repositories outside holt-oss: "
          + ("readable" if readable else f"NOT readable (user lookup HTTP {user.status_code})"))
    return 0 if readable else 1


if __name__ == "__main__":
    raise SystemExit(main())
