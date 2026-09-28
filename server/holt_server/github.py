"""GitHub access for the server: the token pool and a cheap repo lookup.

Both go through the engine's own transport (`holt.evidence.github_graphql`),
so retries, rate-limit handling and the typed errors are the engine's. The
pool's transport (`PooledGraphQL`) also tells the pool what GitHub said about
each token, so a dead or used-up token is skipped until it can work again.

Tokens are only ever named in logs by their place in `GITHUB_TOKENS`
("token #2"), never by value.
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

import httpx

from holt.evidence.errors import AuthError, RateLimited
from holt.evidence.github_graphql import GitHubGraphQL
from holt_server.errors import ApiError, github_rate_limited, upstream

log = logging.getLogger("holt_server.github")

LOOKUP = """
query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) { nameWithOwner isPrivate }
}
"""

RATE_LIMIT = "query { rateLimit { remaining resetAt } }"

# Repositories per details query. GitHub charges about one point for a query
# of up to a hundred small lookups.
DETAILS_BATCH = 100
DETAILS_FIELDS = """
  nameWithOwner description stargazerCount pushedAt isArchived isFork isPrivate
  primaryLanguage { name }
  repositoryTopics(first: 20) { nodes { topic { name } } }
"""

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


@dataclass
class TokenState:
    remaining: int | None = None
    reset_at: float | None = None  # epoch seconds, when `remaining` refills
    out_until: float = 0.0  # epoch seconds; refused or rate-limited until then
    reason: str = ""


class TokenPool:
    """`GITHUB_TOKENS`, handed out round-robin, skipping the ones that can't work.

    A token is skipped while GitHub is refusing it (bad or revoked token, or a
    403), while it is rate-limited, and while its points-left (read from every
    reply, see `PooledGraphQL`) are below `LOW_POINTS` and its reset time has
    not come. When every token is out, the caller gets a plain "try again"
    error instead of a GitHub failure halfway through a job.
    """

    def __init__(self, tokens: list[str], clock=time.time) -> None:
        self._tokens = list(tokens)
        self._state = [TokenState() for _ in self._tokens]
        self._cursor = 0
        self._lock = threading.Lock()
        self._clock = clock

    def __bool__(self) -> bool:
        return bool(self._tokens)

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
            for step in range(n):
                i = (self._cursor + step) % n
                if self._usable(i, now):
                    self._cursor = (i + 1) % n
                    return i, self._tokens[i]
            waits = [self._back_at(i) - now for i in range(n)
                     if self._state[i].reason != "refused"]
        if waits:
            wait = max(60, round(min(waits)))
            log.warning("every GitHub token is rate-limited or used up; next back in %ds", wait)
            raise github_rate_limited(wait)
        log.error("GitHub refused every token in GITHUB_TOKENS")
        raise upstream()

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

    def all(self) -> list[str]:
        return list(self._tokens)

    def index(self, token: str) -> int | None:
        try:
            return self._tokens.index(token)
        except ValueError:
            return None

    def transport(self, http: httpx.Client | None = None,
                  index: int | None = None) -> PooledGraphQL:
        """A GraphQL client on the next usable token (or on token `index`)."""
        if index is None:
            index, token = self.lease()
        else:
            token = self._tokens[index]
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
            log.warning("token #%d is nearly used up (%d points left); skipping it "
                        "until it resets", index + 1, left)

    def note_refused(self, index: int, detail: str) -> None:
        with self._lock:
            st = self._state[index]
            st.out_until = self._clock() + DEAD_SECONDS
            st.reason = "refused"
        log.error("GitHub refused token #%d (%s); leaving it out for %d minutes",
                  index + 1, detail, DEAD_SECONDS // 60)

    def note_rate_limited(self, index: int, retry_after: float | None) -> None:
        wait = retry_after if retry_after else LIMITED_SECONDS
        with self._lock:
            st = self._state[index]
            st.out_until = self._clock() + wait
            st.reason = "limited"
        log.warning("token #%d is rate-limited; leaving it out for %ds", index + 1, round(wait))


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
        try:
            return super().query(document, timeout=timeout, **variables)
        except AuthError as exc:
            self.pool.note_refused(self.index, str(exc)[:40])
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


def _details(node: dict[str, Any]) -> dict[str, Any]:
    topics = [((t or {}).get("topic") or {}).get("name")
              for t in ((node.get("repositoryTopics") or {}).get("nodes") or [])]
    return {
        "repo": node.get("nameWithOwner"),
        "description": EMOJI_CODE.sub("", node.get("description") or "").strip() or None,
        "language": (node.get("primaryLanguage") or {}).get("name"),
        "stars": int(node.get("stargazerCount") or 0),
        "topics": [t for t in topics if t],
        "pushed_at": node.get("pushedAt"),
        "archived": bool(node.get("isArchived")),
        "fork": bool(node.get("isFork")),
    }


@dataclass
class RepoInfo:
    name_with_owner: str


class GitHubLookup:
    """Checks a repository exists and returns GitHub's casing for its name.

    One GraphQL point per call. Done before a job is queued, so a typo gets
    `not_found` at once instead of a failed job a minute later.
    """

    def __init__(self, pool: TokenPool, http: httpx.Client) -> None:
        self.pool = pool
        self.http = http
        # GraphQL points the `details` queries have cost, as GitHub reported.
        self.points_used = 0

    async def repo(self, repo: str) -> RepoInfo:
        return await asyncio.to_thread(self._repo, repo)

    def _repo(self, repo: str) -> RepoInfo:
        from holt_server.engine import translate

        owner, _, name = repo.partition("/")
        try:
            data = self.pool.transport(self.http).query(
                LOOKUP, timeout=LOOKUP_TIMEOUT_S, owner=owner, name=name)
        except ApiError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise translate(exc, repo) from exc
        found = data.get("repository")
        if not found or found.get("isPrivate"):
            from holt_server.errors import not_found_repo

            raise not_found_repo(repo)
        return RepoInfo(name_with_owner=found["nameWithOwner"])

    async def details(self, repos: list[str]) -> dict[str, dict[str, Any] | None]:
        """Description, language, stars, topics and last push for up to
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
                    + f"fragment details on Repository {{{DETAILS_FIELDS}}}")
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
        for index in range(len(self.pool.all())):
            try:
                data = self.pool.transport(self.http, index=index).query(
                    RATE_LIMIT, timeout=LOOKUP_TIMEOUT_S)
            except AuthError:
                continue
            except RateLimited:
                counts.append(0)
                continue
            counts.append(int((data.get("rateLimit") or {}).get("remaining") or 0))
        return min(counts) if counts else 0
