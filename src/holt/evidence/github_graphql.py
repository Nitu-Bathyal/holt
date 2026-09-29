"""Live GitHub evidence, via GraphQL.

REST needs roughly four calls per pull request (the PR, its reviews, its
comments, its files). At 5,000 requests/hour that exhausts the budget well
before the pool is crawled. One GraphQL query returns a page of PRs with all
four, so the same crawl costs a couple of hundred points instead.

A pull request is decomposed into *events*, not stored whole. A PR opened in
April and merged in July is two facts with two timestamps: the agent may see
the first and must not see the second. Storing the PR as a single record with
a single timestamp would force a choice between leaking the merge and hiding
the thread. Event decomposition removes the choice.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable, Iterable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx

from holt.evidence.errors import AuthError, RateLimited, RepoNotFound, UpstreamError
from holt.evidence.provider import EvidenceProvider
from holt.types import EvidenceRecord, Window

API = "https://api.github.com/graphql"

log = logging.getLogger(__name__)

# A pull request page asks for files, reviews and comments on 25 PRs at once,
# and on a busy repository GitHub can take well over thirty seconds to build it.
# The old 30s client timeout turned exactly those repositories -- the popular
# ones people ask about most -- into failures.
TIMEOUT_S = 60.0
HEAVY_TIMEOUT_S = 120.0

# Transient failures (5xx, timeouts, dropped connections) are retried with
# exponential backoff. GitHub answers an expensive GraphQL query with a 502
# more often than one would like, and the second try usually succeeds.
MAX_ATTEMPTS = 4
BACKOFF_BASE_S = 1.5

# A secondary rate limit asks us to wait. Short waits are worth sitting out;
# longer ones go back to the caller as `RateLimited(retry_after)`, because a web
# request cannot hang for ten minutes.
MAX_RATE_LIMIT_WAIT_S = 60.0

# Comment and review bodies carry the signal Holt actually reads: tone, intent,
# whether a maintainer engaged. Four thousand characters is far more than any of
# that needs. What blows past it is log dumps and stack traces -- one observed
# comment ran to 74,000 characters -- which cost a judge download size and cost
# the model context without changing a single judgement. Truncation is recorded
# on the record so a reader is never silently shown a partial quote.
MAX_BODY_CHARS = 4000

REPO_META = """
query($owner:String!, $name:String!, $until:GitTimestamp!) {
  rateLimit { cost remaining resetAt }
  repository(owner:$owner, name:$name) {
    createdAt pushedAt isArchived isMirror isFork stargazerCount
    description homepageUrl primaryLanguage { name }
    nameWithOwner mirrorUrl parent { nameWithOwner }
    repositoryTopics(first:20) { nodes { topic { name } } }
    releases(first:10, orderBy:{field:CREATED_AT, direction:DESC}) {
      totalCount
      nodes { tagName name createdAt publishedAt isPrerelease }
    }
    defaultBranchRef {
      name
      target {
        ... on Commit { history(until:$until, first:1) { nodes { oid committedDate } } }
      }
    }
  }
}
"""

# The README as it stood at the cutoff, not as it stands today. Reading HEAD
# would hand the agent a document rewritten months after the window it is
# supposed to be reasoning about -- a leak that would never announce itself.
#
# Projects put these files in more places than the root, and name them in more
# ways than `README.md`: `.github/CONTRIBUTING.md` is GitHub's own recommended
# location, and Python projects often ship `README.rst`. Every candidate is
# asked for in one query (an aliased blob lookup each) and the first that
# exists wins, in the order listed.
README_CANDIDATES = (
    "README.md", "README.rst", "README", "README.txt", "README.markdown",
    "readme.md", "Readme.md", "README.MD", "readme.rst", ".github/README.md",
    "docs/README.md",
)
CONTRIBUTING_CANDIDATES = (
    "CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md",
    "CONTRIBUTING.rst", ".github/CONTRIBUTING.rst", "docs/CONTRIBUTING.rst",
    "CONTRIBUTING", "CONTRIBUTING.txt", "contributing.md",
    ".github/contributing.md", "docs/contributing.md", "Contributing.md",
    "CONTRIBUTING.MD", "docs/source/contributing.rst", "docs/contributing.rst",
)
DOC_CANDIDATES = {"readme": README_CANDIDATES, "contributing": CONTRIBUTING_CANDIDATES}


def docs_query(oid: str) -> tuple[str, dict[str, tuple[str, str]]]:
    """A query asking for every candidate path, and alias -> (kind, path)."""
    aliases: dict[str, tuple[str, str]] = {}
    fields = []
    for kind, paths in DOC_CANDIDATES.items():
        for i, path in enumerate(paths):
            alias = f"{kind}{i}"
            aliases[alias] = (kind, path)
            # oid is a hex sha and paths are our own constants: nothing here
            # comes from the user, so interpolating is safe.
            fields.append(
                f'{alias}: object(expression:"{oid}:{path}") {{ ... on Blob {{ text }} }}'
            )
    document = (
        "query($owner:String!, $name:String!) {\n"
        "  rateLimit { cost remaining resetAt }\n"
        "  repository(owner:$owner, name:$name) {\n    "
        + "\n    ".join(fields)
        + "\n  }\n}\n"
    )
    return document, aliases


# Date filtering happens server-side. Ordering by newest and paging until the
# timestamps fall past the cutoff would burn most of the rate-limit budget on
# records the window filter then discards.
#
# What it costs: GitHub charges one point per hundred connections a query asks
# for, rounded. A page of 25 pull requests asks for the search plus five
# connections per PR (files, reviews, comments, labels, timeline) -- 126, so
# one point a page. A sixth per-PR connection would make it 151 and two
# points, doubling a report's spend. That is why the close event and commit
# references share one timeline window instead of having one each; the price is
# that ten or more commit references after a close can crowd the close event
# out, and then how the PR was closed is recorded as unknown.
#
# The timeline is also the slow part: it added seven to twelve seconds to a
# report's fetch when measured. The one-page screen that `discover` and `find`
# run over many repositories at once is only a pre-filter, so it uses
# PR_SEARCH_SCREEN, which leaves the timeline out; its closes then carry no
# `closed_by` keys at all, as in a capture that never asked.
_PR_TIMELINE = """\
        timelineItems(last:10, itemTypes:[CLOSED_EVENT, REFERENCED_EVENT]) {
          nodes {
            __typename
            ... on ClosedEvent {
              createdAt actor { login __typename }
              closer { __typename ... on Commit { oid } ... on PullRequest { number } }
            }
            ... on ReferencedEvent {
              createdAt actor { login __typename }
              commit { oid } commitRepository { nameWithOwner }
            }
          }
        }
"""
PR_SEARCH = """
query($q:String!, $cursor:String) {
  rateLimit { cost remaining resetAt }
  search(query:$q, type:ISSUE, first:25, after:$cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title createdAt mergedAt closedAt merged
        additions deletions changedFiles isDraft authorAssociation
        author { login __typename }
        mergedBy { login __typename }
        labels(first:10) { nodes { name } }
        files(first:20) { nodes { path additions deletions } }
        reviews(first:20) {
          nodes { createdAt state body authorAssociation author { login __typename } }
        }
        comments(first:30) {
          nodes { createdAt body authorAssociation author { login __typename } }
        }
""" + _PR_TIMELINE + """\
      }
    }
  }
}
"""
PR_SEARCH_SCREEN = PR_SEARCH.replace(_PR_TIMELINE, "")
PAGE_SIZE = 25  # PR_SEARCH's `first:25`


# Issues, for Path Finder. Decomposed the same way pull requests are: an issue
# opening is a pre-cutoff fact, and an issue being closed by somebody's merged
# pull request is a post-cutoff one. The two must not travel together.
ISSUE_SEARCH = """
query($q:String!, $cursor:String) {
  rateLimit { cost remaining resetAt }
  search(query:$q, type:ISSUE, first:50, after:$cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue {
        number title body createdAt closedAt lastEditedAt
        author { login __typename }
        labels(first:12) { nodes { name } }
        comments { totalCount }
        closedByPullRequestsReferences(first:5, includeClosedPrs:true) {
          nodes { number mergedAt author { login __typename } }
        }
      }
    }
  }
}
"""

MAX_ISSUE_BODY = 4000

# Repository search, for `holt discover`. Sourcing only: these results are where
# candidates come from, and the output says so. Nothing downstream treats search
# rank as a signal — the screening pass re-derives everything it uses from the
# contribution history.
REPO_SEARCH = """
query($q:String!, $cursor:String) {
  rateLimit { cost remaining resetAt }
  search(query:$q, type:REPOSITORY, first:25, after:$cursor) {
    repositoryCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Repository {
        nameWithOwner description stargazerCount pushedAt isArchived isFork
        primaryLanguage { name }
        goodFirstIssues: issues(states:OPEN, labels:["good first issue",
          "good-first-issue", "beginner", "first-timers-only", "easy"]) { totalCount }
      }
    }
  }
}
"""


def _ts(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def _body(text: str | None) -> tuple[str | None, bool, int]:
    """Return (possibly truncated body, was_truncated, original_length)."""
    if not text:
        return text, False, 0
    if len(text) <= MAX_BODY_CHARS:
        return text, False, len(text)
    return text[:MAX_BODY_CHARS], True, len(text)


def _login(actor: dict[str, Any] | None) -> str:
    """Deleted accounts come back as null; bots carry a distinct __typename."""
    if not actor:
        return "(ghost)"
    return actor.get("login") or "(ghost)"


def _is_bot(actor: dict[str, Any] | None) -> bool:
    if not actor:
        return False
    if actor.get("__typename") == "Bot":
        return True
    login = (actor.get("login") or "").lower()
    return login.endswith("[bot]") or login in {"dependabot", "renovate", "greenkeeper"}


def _rate_limit_wait(response: httpx.Response) -> float | None:
    """Seconds GitHub asks us to wait, or None if this is not a rate limit.

    Secondary limits send `Retry-After`; the primary limit sends
    `x-ratelimit-remaining: 0` with a reset time. A 403 with neither, and no
    mention of a rate limit in the body, is a permissions problem instead.
    """
    headers = response.headers
    if (after := headers.get("retry-after")) is not None:
        try:
            return max(0.0, float(after))
        except ValueError:
            return None
    if headers.get("x-ratelimit-remaining") == "0" and headers.get("x-ratelimit-reset"):
        try:
            return max(0.0, float(headers["x-ratelimit-reset"]) - time.time())
        except ValueError:
            return None
    try:
        text = response.text.lower()
    except Exception:  # pragma: no cover - a body we cannot decode says nothing
        text = ""
    if "rate limit" in text:
        # GitHub's documented advice for a secondary limit with no header.
        return 60.0
    return None


def _not_found_name(errors: list[dict[str, Any]]) -> str:
    for e in errors:
        message = str(e.get("message", ""))
        if "name '" in message:
            return message.split("name '", 1)[1].split("'", 1)[0]
    return "that repository"


class GitHubGraphQL:
    """Thin transport. Knows about auth, retries, pagination and rate limits.

    Failures come back as the typed errors in `holt.evidence.errors`. A
    response carrying both `errors` and `data` is kept -- GitHub does that when
    one node of a big page could not be resolved, and throwing away twenty-four
    good pull requests for one bad one is worse than reading what arrived. What
    was lost is recorded in `partial_errors`.
    """

    def __init__(
        self,
        token: str | None = None,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.token = token or os.environ.get("GITHUB_TOKEN")
        if not self.token:
            raise AuthError(
                "GITHUB_TOKEN is not set. Live mode needs a token; "
                "use fixture or replay mode to run without one"
            )
        self._client = client or httpx.Client(timeout=TIMEOUT_S)
        self._sleep = sleep
        self.remaining: int | None = None
        # Rate-limit points GitHub charged this transport, summed over every
        # query. What one report costs is the difference across its fetch.
        self.points_used = 0
        self.partial_errors: list[dict[str, Any]] = []

    def query(
        self, document: str, *, timeout: float | None = None, **variables: object
    ) -> dict[str, Any]:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            last = attempt == MAX_ATTEMPTS
            try:
                response = self._client.post(
                    API,
                    headers={"Authorization": f"bearer {self.token}"},
                    json={"query": document, "variables": variables},
                    **({"timeout": timeout} if timeout else {}),
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if last:
                    raise UpstreamError(f"{type(exc).__name__} after {attempt} tries") from exc
                self._backoff(attempt)
                continue

            status = response.status_code
            if status == 401:
                raise AuthError("401 Unauthorized")
            if status in (403, 429):
                wait = _rate_limit_wait(response)
                if wait is None and status == 403:
                    raise AuthError("403 Forbidden")
                if last or (wait or 0) > MAX_RATE_LIMIT_WAIT_S:
                    raise RateLimited(wait)
                self._sleep(wait if wait is not None else self._delay(attempt))
                continue
            if status >= 500:
                if last:
                    raise UpstreamError(f"HTTP {status} after {attempt} tries")
                self._backoff(attempt)
                continue
            if status >= 400:
                raise UpstreamError(f"HTTP {status}")

            try:
                body = response.json()
            except ValueError as exc:
                if last:
                    raise UpstreamError("GitHub sent a response that was not JSON") from exc
                self._backoff(attempt)
                continue
            return self._data(body)
        raise UpstreamError("no attempts made")  # pragma: no cover

    def _data(self, body: dict[str, Any]) -> dict[str, Any]:
        errors = body.get("errors") or []
        data = body.get("data")
        types = {e.get("type") for e in errors}
        if "RATE_LIMITED" in types:
            raise RateLimited(None)
        content = {k: v for k, v in (data or {}).items() if k != "rateLimit"}
        if errors and (not content or all(v is None for v in content.values())):
            if "NOT_FOUND" in types:
                raise RepoNotFound(_not_found_name(errors))
            raise UpstreamError("; ".join(str(e.get("message", "")) for e in errors)[:300])
        if errors:
            log.warning("GitHub returned partial data: %s", errors)
            self.partial_errors.extend(errors)
        if limit := (data or {}).get("rateLimit"):
            self.remaining = limit["remaining"]
            self.points_used += limit.get("cost") or 0
        return data or {}

    def _delay(self, attempt: int) -> float:
        return BACKOFF_BASE_S * (2 ** (attempt - 1))

    def _backoff(self, attempt: int) -> None:
        self._sleep(self._delay(attempt))

    def repo_meta(self, owner: str, name: str, until: datetime) -> dict[str, Any]:
        repo = self.query(
            REPO_META, owner=owner, name=name, until=until.isoformat()
        ).get("repository")
        if repo is None:
            raise RepoNotFound(f"{owner}/{name}")
        return repo

    def docs_at(self, owner: str, name: str, oid: str) -> dict[str, Any]:
        """README and CONTRIBUTING at a specific commit, wherever they live.

        Returns `{"readme": {"text", "path"} | None, "contributing": ...}`.
        """
        document, aliases = docs_query(oid)
        repo = self.query(document, owner=owner, name=name).get("repository") or {}
        found: dict[str, Any] = {kind: None for kind in DOC_CANDIDATES}
        for alias, (kind, path) in aliases.items():  # dicts keep candidate order
            blob = repo.get(alias)
            if found[kind] is None and blob and blob.get("text"):
                found[kind] = {"text": blob["text"], "path": path}
        return found

    def search_issues(self, q: str, max_pages: int = 6) -> Iterator[dict[str, Any]]:
        cursor: str | None = None
        for _ in range(max_pages):
            search = self.query(ISSUE_SEARCH, q=q, cursor=cursor)["search"]
            yield from (n for n in search["nodes"] if n)
            page = search["pageInfo"]
            if not page["hasNextPage"]:
                return
            cursor = page["endCursor"]

    def search_repositories(self, q: str, max_pages: int = 2) -> Iterator[dict[str, Any]]:
        cursor: str | None = None
        for _ in range(max_pages):
            search = self.query(REPO_SEARCH, q=q, cursor=cursor)["search"]
            yield from (n for n in search["nodes"] if n)
            page = search["pageInfo"]
            if not page["hasNextPage"]:
                return
            cursor = page["endCursor"]

    def search_pull_requests(
        self, q: str, max_pages: int = 8, timeline: bool = True
    ) -> Iterator[dict[str, Any]]:
        """Pull request pages; `timeline=False` is the faster screening query."""
        document = PR_SEARCH if timeline else PR_SEARCH_SCREEN
        cursor: str | None = None
        for _ in range(max_pages):
            search = self.query(
                document, timeout=HEAVY_TIMEOUT_S, q=q, cursor=cursor
            )["search"]
            yield from (n for n in search["nodes"] if n)
            page = search["pageInfo"]
            if not page["hasNextPage"]:
                return
            cursor = page["endCursor"]


def search_query(repo_slug: str, window: Window, cutoff: datetime) -> str:
    """Bound the crawl by date server-side, on the side of the holdout we are on."""
    day = cutoff.date().isoformat()
    bound = f"created:<{day}" if window is Window.PRE_T else f"created:>={day}"
    return f"repo:{repo_slug} is:pr {bound} sort:created-desc"


# --- the settled sample -------------------------------------------------------
#
# A busy repository's newest 200 pull requests span a day or two (pytorch,
# llvm, nixpkgs, cpython), and the engine's rates only count pull requests
# opened at least SETTLE_DAYS before the read (agent/rates.py), because what
# has already happened to a two-day-old pull request is mostly the fast
# outcomes: quick merges and quick triage closes. Rates over those read
# pytorch's merge rate as 39% and openssl's as 40%, where the pull requests
# that had two weeks to get an answer show 11% for openssl.
#
# So when the newest pages hold fewer than SETTLED_TARGET outside pull requests
# old enough to count, a second search reads further back: pull requests
# opened before the settle window (or before the oldest one already read),
# newest first, one page at a time until the target is met, at most
# SETTLED_MAX_PAGES pages. Each page is the same query, one point.
SETTLE_DAYS = 14
SETTLED_TARGET = 60
SETTLED_MAX_PAGES = 8

_TEAM = {"OWNER", "MEMBER", "COLLABORATOR"}


def settled_query(repo_slug: str, cutoff: datetime, oldest: datetime | None) -> str:
    """Pull requests old enough to count, from where the newest pages stopped."""
    settle_day = (cutoff - timedelta(days=SETTLE_DAYS)).date()
    if oldest is not None and oldest.date() < settle_day:
        # The newest pages already reach past the window; carry on from their
        # last day (inclusive: the rest of that day wasn't read; repeats are
        # dropped by number).
        bound = f"created:<={oldest.date().isoformat()}"
    else:
        bound = f"created:<{settle_day.isoformat()}"
    return f"repo:{repo_slug} is:pr {bound} sort:created-desc"


def _outside_and_settled(node: dict[str, Any], before: datetime) -> bool:
    """Roughly what the engine will count: an outside, non-draft pull request
    opened before `before`. Only steers how far to read; the engine decides."""
    author = node.get("author") or {}
    login = (author.get("login") or "").lower()
    created = _ts(node.get("createdAt"))
    return bool(
        created is not None and created < before
        and author.get("__typename") != "Bot" and not login.endswith("bot")
        and not login.endswith("[bot]")
        and node.get("authorAssociation") not in _TEAM
        and not node.get("isDraft")
    )


def _nodes(connection: dict[str, Any] | None) -> list[dict[str, Any]]:
    """A connection with nothing in it can come back as null, not as an empty list.

    Observed on a pull request that changed no files: `files` was null while
    `changedFiles` was 0. Treating null and empty as the same thing here keeps a
    single odd pull request from aborting a repository's whole capture.
    """
    if not connection:
        return []
    return [n for n in (connection.get("nodes") or []) if n]


def _with_body(payload: dict[str, Any], raw: str | None) -> dict[str, Any]:
    body, truncated, original = _body(raw)
    payload["body"] = body
    if truncated:
        payload["body_truncated"] = True
        payload["body_original_chars"] = original
    return payload


def _with_association(payload: dict[str, Any], node: dict[str, Any]) -> dict[str, Any]:
    """The author's relationship to the repository, when the capture asked for it.

    GitHub's CommentAuthorAssociation: OWNER, MEMBER, COLLABORATOR,
    CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, FIRST_TIMER, MANNEQUIN or NONE. It is
    GitHub's view at fetch time, not when the comment was written, so a
    first-timer whose pull request has since been merged can read CONTRIBUTOR.
    Captures made before this field existed do not carry the key at all, so
    every reader must treat it as optional; that is also what keeps their
    recorded runs replaying unchanged.
    """
    if "authorAssociation" in node:
        payload["author_association"] = node["authorAssociation"]
    return payload


def _actor(prefix: str, actor: dict[str, Any] | None) -> dict[str, Any]:
    """`{prefix}` login and `{prefix}_is_bot`, or None when GitHub gave nobody."""
    return {
        prefix: _login(actor) if actor else None,
        f"{prefix}_is_bot": _is_bot(actor),
    }


def _closer(node: dict[str, Any] | None) -> dict[str, Any] | None:
    """What closed a pull request, when it was a commit or another pull request.

    A commit closing a pull request that was never merged through the button is
    how projects that land work outside GitHub (an internal sync, a merge bot,
    a maintainer pushing by hand) show up in the timeline.
    """
    if not node:
        return None
    kind = node.get("__typename")
    if kind == "Commit":
        return {"kind": "commit", "oid": node.get("oid")}
    if kind == "PullRequest":
        return {"kind": "pull_request", "number": node.get("number")}
    return None


def _closure(pr: dict[str, Any]) -> dict[str, Any]:
    """Who or what closed an unmerged pull request, from its last close event.

    Empty for a capture that did not ask for the timeline, so old fixtures stay
    as they were. When the timeline was asked for but the close event was not
    in the window (see PR_SEARCH), the fields are present and None: unknown,
    which is different from absent.
    """
    if "timelineItems" not in pr:
        return {}
    closes = [n for n in _nodes(pr["timelineItems"]) if n.get("__typename") == "ClosedEvent"]
    last = closes[-1] if closes else {}
    return {
        **_actor("closed_by", last.get("actor")),
        "closer": _closer(last.get("closer")),
    }


def _same_repo_references(repo_slug: str, pr: dict[str, Any]) -> list[dict[str, Any]]:
    """Commits *in this repository* that mention the pull request.

    Contributors pushing to their own forks generate most reference events, and
    those say nothing about whether the project landed the work, so they are
    dropped at capture. What is kept is a commit on the project itself naming
    the pull request -- often the only trace that a maintainer applied it by
    hand and then closed it. It is evidence for a merge, not proof: a commit on
    a work branch of the same repository mentions the PR too.
    """
    out = []
    for node in _nodes(pr.get("timelineItems")):
        if node.get("__typename") != "ReferencedEvent":
            continue
        where = (node.get("commitRepository") or {}).get("nameWithOwner") or ""
        if where.lower() != repo_slug.lower() or not node.get("createdAt"):
            continue
        out.append(node)
    return out


def project(
    repo_slug: str, nodes: Iterable[dict[str, Any]], home: str | None = None
) -> Iterator[EvidenceRecord]:
    """Turn pull requests into timestamped, individually-addressable evidence.

    `home` is the name GitHub currently uses for the repository, when it
    differs from `repo_slug` (the name asked for, which the evidence ids keep).
    Links and same-repository commit references use it.

    The fields the v2 capture added -- `author_association`, `is_draft`,
    `labels`, `merged_by`, `closed_by`/`closer` and the `:reference:` records --
    are written only when the query asked for them. Every reader must treat them
    as optional: committed fixtures predate them.

    Draft state and labels are read at fetch time, like the association: a pull
    request labelled `spam` after the cutoff carries the label here.
    """
    home = home or repo_slug
    for pr in nodes:
        number = pr["number"]
        base = f"pr:{repo_slug}#{number}"
        url = f"https://github.com/{home}/pull/{number}"
        shared = _with_association(
            {"author": _login(pr["author"]), "author_is_bot": _is_bot(pr["author"])}, pr
        )

        opened: dict[str, Any] = {
            **shared,
            "title": pr["title"],
            "additions": pr["additions"],
            "deletions": pr["deletions"],
            "changed_files": pr["changedFiles"],
            "files": [f["path"] for f in _nodes(pr["files"])],
        }
        if "isDraft" in pr:
            opened["is_draft"] = bool(pr["isDraft"])
        if "labels" in pr:
            opened["labels"] = [n["name"] for n in _nodes(pr["labels"])]
        yield EvidenceRecord(
            evidence_id=f"{base}:opened",
            source="github",
            url=url,
            timestamp=_ts(pr["createdAt"]),
            payload=opened,
        )

        if merged_at := _ts(pr["mergedAt"]):
            merged: dict[str, Any] = {**shared, "merged": True}
            if "mergedBy" in pr:
                merged.update(_actor("merged_by", pr["mergedBy"]))
            yield EvidenceRecord(
                evidence_id=f"{base}:merged",
                source="github",
                url=url,
                timestamp=merged_at,
                payload=merged,
            )
        elif (closed_at := _ts(pr["closedAt"])) and not pr["merged"]:
            yield EvidenceRecord(
                evidence_id=f"{base}:closed",
                source="github",
                url=url,
                timestamp=closed_at,
                payload={**shared, "merged": False, **_closure(pr)},
            )

        for i, review in enumerate(_nodes(pr["reviews"])):
            yield EvidenceRecord(
                evidence_id=f"{base}:review:{i}",
                source="github",
                url=url,
                timestamp=_ts(review["createdAt"]),
                payload=_with_body(
                    _with_association(
                        {
                            "author": _login(review["author"]),
                            "author_is_bot": _is_bot(review["author"]),
                            "state": review["state"],
                        },
                        review,
                    ),
                    review["body"],
                ),
            )

        for i, comment in enumerate(_nodes(pr["comments"])):
            yield EvidenceRecord(
                evidence_id=f"{base}:comment:{i}",
                source="github",
                url=url,
                timestamp=_ts(comment["createdAt"]),
                payload=_with_body(
                    _with_association(
                        {
                            "author": _login(comment["author"]),
                            "author_is_bot": _is_bot(comment["author"]),
                        },
                        comment,
                    ),
                    comment["body"],
                ),
            )

        # Each reference is its own dated fact: a commit can land after the
        # cutoff on a pull request opened before it, and must be sliced off
        # like any other later event.
        for i, ref in enumerate(_same_repo_references(home, pr)):
            yield EvidenceRecord(
                evidence_id=f"{base}:reference:{i}",
                source="github",
                url=url,
                timestamp=_ts(ref["createdAt"]),
                payload={
                    "commit": (ref.get("commit") or {}).get("oid"),
                    **_actor("actor", ref.get("actor")),
                },
            )


def project_repo_meta(repo_slug: str, repo: dict[str, Any]) -> EvidenceRecord:
    """Repository-level facts.

    Mutable counters (stars) are as-of-fetch, not as-of-T: GitHub does not expose
    a historical star count, so they cannot be reconstructed at the cutoff. The
    payload says so. Holt's own reasoning must not lean on them; the popularity
    diagnostic does, and that limitation is published rather than hidden.
    """
    payload: dict[str, Any] = {
        "pushed_at": repo["pushedAt"],
        "is_archived": repo["isArchived"],
        "is_mirror": repo["isMirror"],
        "is_fork": repo["isFork"],
        "description": repo["description"],
        "homepage_url": repo["homepageUrl"],
        "primary_language": (repo["primaryLanguage"] or {}).get("name"),
        "stargazer_count": repo["stargazerCount"],
        "_counters_are_as_of_fetch_not_cutoff": True,
    }
    # Added with the v2 capture; absent from older fixtures. `parent` is the
    # repository this one was forked from, `mirror_url` where a mirror copies
    # from: both say "the real project is elsewhere".
    if "nameWithOwner" in repo:
        payload["name_with_owner"] = repo["nameWithOwner"]
    if "parent" in repo:
        payload["parent"] = (repo["parent"] or {}).get("nameWithOwner")
    if "mirrorUrl" in repo:
        payload["mirror_url"] = repo["mirrorUrl"]
    if "releases" in repo:
        payload["release_count"] = (repo["releases"] or {}).get("totalCount", 0)
    # Added with the personal-project rule (agent/personal.py); absent before.
    if "repositoryTopics" in repo:
        payload["topics"] = [
            n["topic"]["name"] for n in _nodes(repo["repositoryTopics"]) if n.get("topic")
        ]
    return EvidenceRecord(
        evidence_id=f"repo:{repo_slug}:meta",
        source="github",
        url=f"https://github.com/{repo_slug}",
        timestamp=_ts(repo["createdAt"]),
        payload=payload,
    )


def project_releases(repo_slug: str, repo: dict[str, Any]) -> Iterator[EvidenceRecord]:
    """The newest releases, one dated record each, so they slice at the cutoff.

    Only the newest ten are asked for: enough to tell a project that ships
    monthly from one that last shipped years ago. A reading as of a past cutoff
    may find all ten after it and keep none; the count on the meta record is
    as-of-fetch, like the other counters there.
    """
    for i, rel in enumerate(_nodes(repo.get("releases"))):
        when = _ts(rel.get("publishedAt") or rel.get("createdAt"))
        if when is None:
            continue
        tag = rel.get("tagName") or ""
        yield EvidenceRecord(
            evidence_id=f"repo:{repo_slug}:release:{i}",
            source="github",
            url=f"https://github.com/{repo_slug}/releases/tag/{quote(tag, safe='')}",
            timestamp=when,
            payload={
                "tag": tag,
                "name": rel.get("name"),
                "is_prerelease": bool(rel.get("isPrerelease")),
            },
        )


MAX_DOC_CHARS = 12000


def project_docs(repo_slug: str, docs: dict[str, Any], commit: dict[str, Any]) -> Iterator[EvidenceRecord]:
    """README and CONTRIBUTING as they stood at the cutoff commit."""
    when = _ts(commit["committedDate"])
    for kind in ("readme", "contributing"):
        blob = docs.get(kind)
        text = (blob or {}).get("text")
        if not text:
            continue
        path = (blob or {}).get("path") or f"{kind.upper()}.md"
        truncated = len(text) > MAX_DOC_CHARS
        payload: dict[str, Any] = {
            "path": path,
            "kind": kind,
            "text": text[:MAX_DOC_CHARS],
            "commit_oid": commit["oid"],
        }
        if truncated:
            payload["text_truncated"] = True
            payload["text_original_chars"] = len(text)
        yield EvidenceRecord(
            evidence_id=f"repo:{repo_slug}:{kind}",
            source="github",
            url=f"https://github.com/{repo_slug}/blob/{commit['oid']}/{path}",
            timestamp=when,
            payload=payload,
        )


def project_issues(repo_slug: str, nodes: Iterable[dict[str, Any]]) -> Iterator[EvidenceRecord]:
    """Issue events. Opening is pre-cutoff evidence; being resolved is the label."""
    for issue in nodes:
        number = issue["number"]
        base = f"issue:{repo_slug}#{number}"
        url = f"https://github.com/{repo_slug}/issues/{number}"
        body = issue.get("body") or ""

        yield EvidenceRecord(
            evidence_id=f"{base}:opened",
            source="github",
            url=url,
            timestamp=_ts(issue["createdAt"]),
            payload={
                "title": issue.get("title"),
                "body": body[:MAX_ISSUE_BODY],
                "body_truncated": len(body) > MAX_ISSUE_BODY,
                "labels": [n["name"] for n in (issue.get("labels") or {}).get("nodes", [])],
                "comments": (issue.get("comments") or {}).get("totalCount", 0),
                "author": _login(issue.get("author")),
                # The body GitHub returns is the current one, not the one that
                # existed at the cutoff. `lastEditedAt` is null unless the body
                # itself was edited; `updatedAt` bumps on any comment or label
                # change, and using it measured "had activity" rather than "was
                # edited" -- reporting a 100% leak that was not real.
                "last_edited_at": issue.get("lastEditedAt"),
            },
        )

        closed_at = _ts(issue.get("closedAt"))
        if not closed_at:
            continue
        merged = [
            p for p in (issue.get("closedByPullRequestsReferences") or {}).get("nodes", [])
            if p and p.get("mergedAt")
        ]
        yield EvidenceRecord(
            evidence_id=f"{base}:closed",
            source="github",
            url=url,
            timestamp=closed_at,
            payload={
                "resolved_by_merged_pr": bool(merged),
                "closing_prs": [
                    {"number": p["number"], "author": _login(p.get("author")),
                     "author_is_bot": _is_bot(p.get("author"))}
                    for p in merged
                ],
            },
        )


class LiveGitHubProvider(EvidenceProvider):
    """Crawls GitHub, then hands every record to the base-class window check.

    The default cutoff is **now**, not the benchmark's T. T = 2026-06-01 is an
    evaluation device; a live reader wants everything up to today, and a caller
    that inherited T by default reported an active repository created in July as
    having no history at all. The evaluation and the fixture capture pass their
    cutoff explicitly, which is the correct place for that decision to be
    visible.
    """

    def __init__(
        self,
        window: Window,
        cutoff: datetime | None = None,
        transport: GitHubGraphQL | None = None,
        max_pages: int = 8,
        timeline: bool = True,
        settled_pages: int | None = None,
    ) -> None:
        super().__init__(window, cutoff or datetime.now(UTC))
        self.transport = transport or GitHubGraphQL()
        self.max_pages = max_pages
        # How far past the newest pages a full report may read for pull
        # requests old enough to count (see SETTLED_TARGET). A screen doesn't.
        self.settled_pages = (
            (SETTLED_MAX_PAGES if timeline else 0) if settled_pages is None else settled_pages
        )
        # False for a quick screen: no close events or commit references (see
        # PR_SEARCH_SCREEN). A full report always reads them.
        self.timeline = timeline
        self._seen: dict[str, EvidenceRecord] = {}

    def _fetch_raw(self, request: str, /, **params: object) -> Iterable[EvidenceRecord]:
        owner, _, name = request.partition("/")
        meta = self.transport.repo_meta(owner, name, self.cutoff)
        records: list[EvidenceRecord] = [project_repo_meta(request, meta)]
        records.extend(project_releases(request, meta))

        branch = meta.get("defaultBranchRef") or {}
        history = ((branch.get("target") or {}).get("history") or {}).get("nodes") or []
        if history:
            docs = self.transport.docs_at(owner, name, history[0]["oid"])
            records.extend(project_docs(request, docs, history[0]))
        # A search under a repository's old name finds nothing, although
        # GitHub answers the lookup above under either name and redirects its
        # pages: facebook/react-native, now react/react-native, read as a
        # project with no pull requests at all. So the search uses the name
        # GitHub gives back. The evidence ids keep the name asked for, which
        # is the one every caller looks them up by.
        home = meta.get("nameWithOwner") or request
        query = search_query(home, self.window, self.cutoff)
        # The keyword only when screening, so a transport written before it
        # existed (the tests have several) still serves full fetches.
        nodes = list(
            self.transport.search_pull_requests(query, self.max_pages)
            if self.timeline
            else self.transport.search_pull_requests(query, self.max_pages, timeline=False)
        )
        if self.window is Window.PRE_T:
            nodes += self._settled(home, nodes)
        records.extend(project(request, nodes, home=home))

        # Slice at the source; the base-class assertion is the safety net, not
        # the filter. A PR created before T can still carry a merge after it.
        kept = [r for r in records if self._in_window(r)]
        self._seen.update({r.evidence_id: r for r in kept})
        return kept

    def _settled(self, home: str, nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Older pull requests, when the newest pages hold too few that count."""
        # Fewer than the pages could hold means the repository has no more.
        if not self.settled_pages or len(nodes) < self.max_pages * PAGE_SIZE:
            return []
        before = self.cutoff - timedelta(days=SETTLE_DAYS)
        have = sum(1 for n in nodes if _outside_and_settled(n, before))
        if have >= SETTLED_TARGET:
            return []
        seen = {n.get("number") for n in nodes}
        oldest = min((t for n in nodes if (t := _ts(n.get("createdAt")))), default=None)
        query = settled_query(home, self.cutoff, oldest)
        more: list[dict[str, Any]] = []
        for i, node in enumerate(
            self.transport.search_pull_requests(query, self.settled_pages), 1
        ):
            if node.get("number") not in seen:
                seen.add(node.get("number"))
                more.append(node)
                have += _outside_and_settled(node, before)
            # Stop at a page boundary, so no page is paid for and left unread.
            if i % PAGE_SIZE == 0 and have >= SETTLED_TARGET:
                break
        return more

    def _in_window(self, record: EvidenceRecord) -> bool:
        if self.window is Window.PRE_T:
            return record.timestamp <= self.cutoff
        return record.timestamp > self.cutoff

    def _resolve_raw(self, evidence_id: str) -> EvidenceRecord | None:
        return self._seen.get(evidence_id)


def issue_query(repo_slug: str, cutoff: datetime) -> str:
    """Open issues created before the cutoff, newest first.

    `is:open` because the product asks where to start *now*: a closed issue is
    not a place to start, and without the qualifier half of the page budget went
    on issues that were already finished. The sort is explicit because GitHub's
    default "best match" ordering is not stable between calls, which made two
    runs on the same repository rank different candidate sets. (The benchmark's
    capture script builds its own query and still reads closed issues, because
    closure is its label.)
    """
    day = cutoff.date().isoformat()
    return f"repo:{repo_slug} is:issue is:open created:<{day} sort:created-desc"


class LiveGitHubIssueProvider(EvidenceProvider):
    """Issues, through the same chokepoint as everything else.

    Separate from `LiveGitHubProvider` rather than a flag on it because the two
    answer different questions and are captured into different fixture roots. A
    provider that returned issues or pull requests depending on a constructor
    argument would make every window assertion harder to read for no gain.
    """

    def __init__(
        self,
        window: Window,
        cutoff: datetime | None = None,
        transport: GitHubGraphQL | None = None,
        max_pages: int = 6,
    ) -> None:
        # Same default as LiveGitHubProvider, for the same reason: live means now.
        super().__init__(window, cutoff or datetime.now(UTC))
        self.transport = transport or GitHubGraphQL()
        self.max_pages = max_pages
        self._seen: dict[str, EvidenceRecord] = {}

    def _fetch_raw(self, request: str, /, **params: object) -> Iterable[EvidenceRecord]:
        # Slice at the source. `created:<T` is a server-side qualifier, so the
        # newest-first ordering cannot fill the page with issues we must not see.
        nodes = self.transport.search_issues(
            issue_query(request, self.cutoff), self.max_pages
        )
        kept = [r for r in project_issues(request, nodes) if r.timestamp <= self.cutoff]
        self._seen.update({r.evidence_id: r for r in kept})
        return kept

    def _resolve_raw(self, evidence_id: str) -> EvidenceRecord | None:
        return self._seen.get(evidence_id)
