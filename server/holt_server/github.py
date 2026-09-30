"""GitHub access for the server: the token pool and a cheap repo lookup.

GraphQL goes through the engine's own transport (`holt.evidence.github_graphql`),
so retries, rate-limit handling and the typed errors are the engine's; the
lookup tries one REST request first, and falls back to GraphQL. The
pool's transport (`PooledGraphQL`) also tells the pool what GitHub said about
each token, so a dead or used-up token is skipped until it can work again.

The pool is the GitHub App when one is set up (github_app.py), else the
tokens in `GITHUB_TOKENS`. Logs name them "the GitHub App" or by their place
in `GITHUB_TOKENS` ("token #2"), never by value.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import quote

import httpx

from holt.about import language_shares, license_name, readme_line
from holt.evidence.errors import AuthError, GitHubError, RateLimited
from holt.evidence.github_graphql import GitHubGraphQL
from holt_server import github_app
from holt_server.errors import ApiError, github_rate_limited, upstream

log = logging.getLogger("holt_server.github")

LOOKUP = """
query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) { nameWithOwner isPrivate }
}
"""
# The same lookup over REST, which has a budget of its own: Holt reads GitHub
# almost entirely through GraphQL, so this takes a GraphQL point off every
# uncached report. GitHub redirects a renamed repository's old name here.
REPO_URL = "https://api.github.com/repos/{owner}/{name}"
REST_HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

RATE_LIMIT = "query { rateLimit { remaining resetAt } }"

# Where the details query looks for a README (its first sentence is kept, not
# the file), first found wins.
README_PATHS = ("README.md", "README.rst", "readme.md")
README_FIELDS = "".join(
    f'  readme{i}: object(expression: "HEAD:{path}") {{ ... on Blob {{ text }} }}\n'
    for i, path in enumerate(README_PATHS))
# Repositories per details query. GitHub charges about one point for a query
# of up to a hundred small lookups.
DETAILS_BATCH = 100
DETAILS_FIELDS = """
  nameWithOwner description stargazerCount pushedAt isArchived isFork isPrivate
  primaryLanguage { name }
  languages(first: 3, orderBy: {field: SIZE, direction: DESC}) { totalSize edges { size node { name } } }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  forkCount createdAt homepageUrl parent { nameWithOwner }
  licenseInfo { spdxId name } issues(states: OPEN) { totalCount }
  defaultBranchRef { name }
  pullRequests { totalCount } openPrs: pullRequests(states: OPEN) { totalCount }
  hasDiscussionsEnabled contributingGuidelines { url }
  latestRelease { tagName publishedAt url }
"""

# A second language is named beside the primary one when it is at least this
# share of the code. GitHub's primary language is only the largest by bytes:
# microsoft/TypeScript is mostly Go since its compiler port, and one tag of
# "Go" read as a mistake.
SECOND_LANGUAGE_SHARE = 0.10

LOOKUP_TIMEOUT_S = 15.0

# A token with fewer GraphQL points left than this is skipped until its reset:
# one analysis costs a couple of hundred.
LOW_POINTS = 250
# How long a token GitHub refused (401/403) is left out before it is tried again.
DEAD_SECONDS = 600.0
# How long a rate-limited token is left out when GitHub gave no reset time.
LIMITED_SECONDS = 300.0

# Set by the jobs runner around a job's worker thread (asyncio.to_thread copies
# it in). When the event is set the job has timed out, and the next GitHub
# call in that thread gives up instead of spending more points.
job_stop: contextvars.ContextVar[threading.Event | None] = contextvars.ContextVar(
    "holt_job_stop", default=None)


class JobStopped(Exception):
    """The job this work belongs to has timed out; stop doing it."""


def check_stop() -> None:
    stop = job_stop.get()
    if stop is not None and stop.is_set():
        raise JobStopped


class StaticToken:
    """One token from `GITHUB_TOKENS`."""

    renews = False

    def __init__(self, token: str, label: str) -> None:
        self._token = token
        self.label = label

    def token(self) -> str:
        return self._token

    def invalidate(self, token: str) -> None:
        pass


@dataclass
class TokenState:
    remaining: int | None = None
    reset_at: float | None = None  # epoch seconds, when `remaining` refills
    out_until: float = 0.0  # epoch seconds; refused or rate-limited until then
    reason: str = ""


class TokenPool:
    """`GITHUB_TOKENS` (or the GitHub App), handed out round-robin, skipping the
    ones that can't work.

    A token is skipped while GitHub is refusing it (bad or revoked token, or a
    403), while it is rate-limited, and while its points-left (read from every
    reply, see `PooledGraphQL`) are below `LOW_POINTS` and its reset time has
    not come. When every token is out, the caller gets a plain "try again"
    error instead of a GitHub failure halfway through a job.

    The GitHub App renews its own token: when GitHub refuses one, the app gets
    a new one on the next lease, and is only left out when GitHub won't issue
    one at all.
    """

    def __init__(self, tokens: list, clock=time.time) -> None:
        self._tokens = [t if hasattr(t, "renews") else StaticToken(t, f"token #{i + 1}")
                        for i, t in enumerate(tokens)]
        self._state = [TokenState() for _ in self._tokens]
        self._cursor = 0
        self._lock = threading.Lock()
        self._clock = clock

    def __bool__(self) -> bool:
        return bool(self._tokens)

    def __len__(self) -> int:
        return len(self._tokens)

    def label(self, index: int) -> str:
        return self._tokens[index].label

    def next(self) -> str:
        return self.lease()[1]

    def lease(self) -> tuple[int, str]:
        """The next usable token and its index."""
        if not self._tokens:
            raise ApiError(
                "internal",
                "This server isn't set up to read GitHub yet. Please try again later.",
            )
        with self._lock:
            now = self._clock()
            n = len(self._tokens)
            chosen = None
            for step in range(n):
                i = (self._cursor + step) % n
                if self._usable(i, now):
                    self._cursor = (i + 1) % n
                    chosen = i
                    break
            else:
                waits = [self._back_at(i) - now for i in range(n)
                         if self._state[i].reason != "refused"]
        if chosen is not None:
            # Outside the lock: the app may be fetching a new token.
            return chosen, self.token(chosen)
        if waits:
            wait = max(60, round(min(waits)))
            log.warning("every GitHub token is rate-limited or used up; next back in %ds", wait)
            raise github_rate_limited(wait)
        log.error("GitHub refused every token it was given (%s)",
                  ", ".join(t.label for t in self._tokens))
        raise upstream()

    def token(self, index: int) -> str:
        """Token `index`'s current value. For the GitHub App this may fetch a
        new one; if GitHub won't issue it, the app is left out like a refused
        or rate-limited token and the caller gets the matching `ApiError`."""
        try:
            return self._tokens[index].token()
        except AuthError as exc:
            self._bench(index, "refused", DEAD_SECONDS)
            log.error("GitHub won't issue a token to %s (%s); leaving it out for %d minutes",
                      self.label(index), exc.detail, DEAD_SECONDS // 60)
            raise upstream() from None
        except RateLimited as exc:
            self.note_rate_limited(index, exc.retry_after)
            raise github_rate_limited(round(exc.retry_after or LIMITED_SECONDS)) from None
        except GitHubError as exc:
            log.warning("couldn't get a token for %s: %s", self.label(index),
                        getattr(exc, "detail", type(exc).__name__))
            raise upstream() from None

    def _usable(self, i: int, now: float) -> bool:
        st = self._state[i]
        if st.out_until > now:
            return False
        if st.remaining is not None and st.remaining < LOW_POINTS:
            if st.reset_at is not None and st.reset_at > now:
                return False
            st.remaining = None  # reset has passed; find out afresh
        st.reason = ""
        return True

    def _back_at(self, i: int) -> float:
        st = self._state[i]
        low = (st.reset_at or 0.0) if (st.remaining or 0) < LOW_POINTS else 0.0
        return max(st.out_until, low)

    def points_left(self) -> int | None:
        """GraphQL points left across the tokens usable now, as GitHub last
        reported them (no call); None while any usable token's count is unknown."""
        with self._lock:
            now = self._clock()
            usable = [self._state[i] for i in range(len(self._tokens)) if self._usable(i, now)]
            if any(st.remaining is None for st in usable):
                return None
            return sum(st.remaining or 0 for st in usable)

    def transport(self, http: httpx.Client | None = None,
                  index: int | None = None) -> PooledGraphQL:
        """A GraphQL client on the next usable token (or on token `index`)."""
        if index is None:
            index, token = self.lease()
        else:
            token = self.token(index)
        return PooledGraphQL(self, index, token, client=http)

    # --- what GitHub said ----------------------------------------------------

    def note_points(self, index: int, remaining: Any, reset_at: Any = None) -> None:
        try:
            left = int(remaining)
        except (TypeError, ValueError):
            return
        reset = _epoch(reset_at)
        with self._lock:
            st = self._state[index]
            was_low = st.remaining is not None and st.remaining < LOW_POINTS
            st.remaining, st.reset_at = left, reset
        if left < LOW_POINTS and not was_low:
            log.warning("%s is nearly used up (%d points left); skipping it "
                        "until it resets", self.label(index), left)

    def note_refused(self, index: int, detail: str, token: str | None = None) -> None:
        """GitHub refused token `index` (the value it refused, if known)."""
        source = self._tokens[index]
        if source.renews:
            if token is not None:
                source.invalidate(token)
            log.warning("GitHub refused %s's token (%s); getting a new one",
                        source.label, detail)
            return
        self._bench(index, "refused", DEAD_SECONDS)
        log.error("GitHub refused %s (%s); leaving it out for %d minutes",
                  source.label, detail, DEAD_SECONDS // 60)

    def note_rate_limited(self, index: int, retry_after: float | None) -> None:
        wait = retry_after if retry_after else LIMITED_SECONDS
        self._bench(index, "limited", wait)
        log.warning("%s is rate-limited; leaving it out for %ds", self.label(index), round(wait))

    def _bench(self, index: int, reason: str, seconds: float) -> None:
        with self._lock:
            st = self._state[index]
            st.out_until = self._clock() + seconds
            st.reason = reason


def _epoch(value: Any) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except ValueError:
        return None


class PooledGraphQL(GitHubGraphQL):
    """The engine's GraphQL client, reporting each token's health to the pool.

    Also where a timed-out job's thread stops: every query first checks the
    job's stop flag.
    """

    def __init__(self, pool: TokenPool, index: int, token: str,
                 client: httpx.Client | None = None) -> None:
        super().__init__(token=token, client=client)
        self.pool = pool
        self.index = index

    def query(self, document: str, *, timeout: float | None = None,
              **variables: object) -> dict[str, Any]:
        check_stop()
        # The GitHub App's token is renewed while a long job runs.
        self.token = self.pool.token(self.index)
        try:
            return super().query(document, timeout=timeout, **variables)
        except AuthError as exc:
            self.pool.note_refused(self.index, str(exc)[:40], self.token)
            raise
        except RateLimited as exc:
            self.pool.note_rate_limited(self.index, exc.retry_after)
            raise

    def _data(self, body: dict[str, Any]) -> dict[str, Any]:
        limit = ((body or {}).get("data") or {}).get("rateLimit")
        if limit:
            self.pool.note_points(self.index, limit.get("remaining"), limit.get("resetAt"))
        return super()._data(body)


# GitHub shows ":books:" in a description as an emoji; the API sends the code.
EMOJI_CODE = re.compile(r":[a-z0-9_+-]+:\s*")


def main_languages(node: dict[str, Any]) -> list[str]:
    """The primary language, then a second one if it's a real share of the code."""
    primary = (node.get("primaryLanguage") or {}).get("name")
    langs = node.get("languages") or {}
    total = langs.get("totalSize") or 0
    out = [primary] if primary else []
    for edge in langs.get("edges") or []:
        name = ((edge or {}).get("node") or {}).get("name")
        if not name or name in out:
            continue
        if total and (edge.get("size") or 0) / total >= SECOND_LANGUAGE_SHARE:
            out.append(name)
        break  # only the largest language after the primary one is considered
    return out[:2]


def _details(node: dict[str, Any]) -> dict[str, Any]:
    topics = [((t or {}).get("topic") or {}).get("name")
              for t in ((node.get("repositoryTopics") or {}).get("nodes") or [])]
    return {
        "repo": node.get("nameWithOwner"),
        "description": EMOJI_CODE.sub("", node.get("description") or "").strip() or None,
        "language": (node.get("primaryLanguage") or {}).get("name"),
        "languages": main_languages(node),
        "stars": int(node.get("stargazerCount") or 0),
        "topics": [t for t in topics if t],
        "pushed_at": node.get("pushedAt"),
        "archived": bool(node.get("isArchived")),
        "fork": bool(node.get("isFork")),
        "forks": node.get("forkCount"),
        "open_issues": (node.get("issues") or {}).get("totalCount"),
        "pull_requests": (node.get("pullRequests") or {}).get("totalCount"),
        "open_pull_requests": (node.get("openPrs") or {}).get("totalCount"),
        # GraphQL has no contributor count; `details` fills it from REST.
        "contributors": None,
        "license": license_name(node.get("licenseInfo")),
        "homepage": (node.get("homepageUrl") or "").strip() or None,
        "language_shares": language_shares(node.get("languages")),
        "created_at": node.get("createdAt"),
        "default_branch": (node.get("defaultBranchRef") or {}).get("name"),
        "fork_of": (node.get("parent") or {}).get("nameWithOwner"),
        "readme_line": next((line for i in range(len(README_PATHS))
                             if (line := readme_line((node.get(f"readme{i}") or {}).get("text")))),
                            None),
    }


@dataclass
class RepoInfo:
    name_with_owner: str


class GitHubLookup:
    """Checks a repository exists and returns GitHub's casing for its name.

    One REST request per call (no GraphQL points). Done before a job is
    queued, so a typo gets `not_found` at once instead of a failed job a minute
    later.
    """

    def __init__(self, pool: TokenPool, http: httpx.Client) -> None:
        self.pool = pool
        self.http = http
        # GraphQL points the `details` queries have cost, as GitHub reported.
        self.points_used = 0

    async def repo(self, repo: str) -> RepoInfo:
        return await asyncio.to_thread(self._repo, repo)

    def _repo(self, repo: str) -> RepoInfo:
        owner, _, name = repo.partition("/")
        found = self._repo_rest(owner, name)
        if found is None:
            found = self._repo_graphql(repo, owner, name)
        if not found or found.get("isPrivate"):
            from holt_server.errors import not_found_repo

            raise not_found_repo(repo)
        return RepoInfo(name_with_owner=found["nameWithOwner"])

    def _repo_rest(self, owner: str, name: str) -> dict[str, Any] | None:
        """`{"nameWithOwner", "isPrivate"}`, `{}` when GitHub says there's no
        such repository, or None when REST didn't answer (rate-limited, down,
        or the token refused): then the GraphQL lookup decides."""
        index, token = self.pool.lease()
        try:
            response = self.http.get(
                REPO_URL.format(owner=quote(owner, safe=""), name=quote(name, safe="")),
                headers={**REST_HEADERS, "Authorization": f"Bearer {token}"},
                timeout=LOOKUP_TIMEOUT_S, follow_redirects=True)
        except httpx.HTTPError as exc:
            log.warning("REST repository lookup failed (%s); asking GraphQL", type(exc).__name__)
            return None
        if response.status_code == 404:
            return {}
        if response.status_code == 401:
            self.pool.note_refused(index, "401 Unauthorized", token)
        if response.status_code != 200:
            log.warning("REST repository lookup answered %d; asking GraphQL",
                        response.status_code)
            return None
        try:
            body = response.json()
            return {"nameWithOwner": body["full_name"], "isPrivate": bool(body.get("private"))}
        except (ValueError, KeyError, TypeError):
            log.warning("REST repository lookup sent an unexpected answer; asking GraphQL")
            return None

    def _repo_graphql(self, repo: str, owner: str, name: str) -> dict[str, Any] | None:
        from holt_server.engine import translate

        try:
            data = self.pool.transport(self.http).query(
                LOOKUP, timeout=LOOKUP_TIMEOUT_S, owner=owner, name=name)
        except ApiError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise translate(exc, repo) from exc
        return data.get("repository")

    async def details(self, repos: list[str]) -> dict[str, dict[str, Any] | None]:
        """Description, language, stars, topics, last push and the rest of the
        report's "About" (repo_meta) for up to
        `DETAILS_BATCH` repositories, in one GraphQL query. Keyed by the
        requested `owner/repo`; None for one that is missing or private."""
        return await asyncio.to_thread(self._details, repos)

    def _details(self, repos: list[str]) -> dict[str, dict[str, Any] | None]:
        from holt.evidence.errors import RepoNotFound

        if len(repos) > DETAILS_BATCH:
            raise ValueError(f"at most {DETAILS_BATCH} repositories per query")
        if not repos:
            return {}
        params, parts, variables = [], [], {}
        for i, repo in enumerate(repos):
            owner, _, name = repo.partition("/")
            params.append(f"$o{i}:String!, $n{i}:String!")
            parts.append(f"r{i}: repository(owner:$o{i}, name:$n{i}) {{ ...details }}")
            variables[f"o{i}"], variables[f"n{i}"] = owner, name
        document = (f"query({', '.join(params)}) {{\n  " + "\n  ".join(parts)
                    + "\n  rateLimit { cost remaining resetAt }\n}\n"
                    + f"fragment details on Repository {{{DETAILS_FIELDS}{README_FIELDS}}}")
        from holt_server.engine import translate

        transport = self.pool.transport(self.http)
        try:
            data = transport.query(document, timeout=LOOKUP_TIMEOUT_S * 2, **variables)
        except RepoNotFound:
            data = {}  # every one of them is gone
        except ApiError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise translate(exc, repos[0]) from exc
        finally:
            self.points_used += getattr(transport, "points_used", 0) or 0
        out: dict[str, dict[str, Any] | None] = {}
        for i, repo in enumerate(repos):
            node = data.get(f"r{i}")
            out[repo] = None if not node or node.get("isPrivate") else _details(node)
        return out

    async def remaining(self) -> int:
        """The fewest GraphQL points left on any working token (checking is free).

        A token GitHub refuses is left out (and the pool skips it); if none
        answer, 0.
        """
        return await asyncio.to_thread(self._remaining)

    def _remaining(self) -> int:
        counts = []
        for index in range(len(self.pool)):
            try:
                data = self.pool.transport(self.http, index=index).query(
                    RATE_LIMIT, timeout=LOOKUP_TIMEOUT_S)
            except AuthError:
                continue
            except ApiError as exc:  # the app couldn't get a token
                if exc.code == "rate_limited":
                    counts.append(0)
                continue
            except RateLimited:
                counts.append(0)
                continue
            counts.append(int((data.get("rateLimit") or {}).get("remaining") or 0))
        return min(counts) if counts else 0


def build_pool(settings, http: httpx.Client) -> TokenPool:
    """The GitHub App when it is set up, else `GITHUB_TOKENS`.

    A half-configured app raises `github_app.AppConfigError` (the server
    doesn't start) rather than quietly reading with a person's tokens.
    """
    app = github_app.from_settings(settings, http)
    if app is None:
        return TokenPool(settings.token_list)
    log.info("reading GitHub as %s (app %s, installation %s)",
             app.label, app.app_id, app.installation_id)
    if settings.token_list:
        log.info("GITHUB_TOKENS is set but not used while the GitHub App is set up")
    return TokenPool([app])
