"""Find answers from Holt's own index first, then from a GitHub search.

    POST /v1/find {"languages": [...], "topics": [...], "hacktoberfest": true, "days": 7}

The **index** is every repository with a current-engine 7-day **rules**
report (what Discover reads, discover.py): those whose verdict is "Worth your
time", matching the filters through `repo_meta`, ranked like Discover's
welcoming board. It is read from the database only, so it answers at once
and costs nothing:

* languages: the repo's main language, or its second when that is a real
  share of the code (`repo_meta.languages`); any one of the picked languages.
* topics: any one of the picked topics; `hacktoberfest` adds the
  `hacktoberfest` topic as a requirement, as the search does.
* archived repos and forks are left out (the search leaves them out too); a
  repo closed to outside pull requests already is by its verdict.
* the maintainers' typical first reply must fit in the time picked (`days`),
  the same line the verdict draws for "too slow for the time you have".
* it must have starter issues Holt knows about (`starter_cache`, at most
  `recommendations.STARTER_MAX_HOURS` old): a repo whose known issues are
  none, or unknown yet, isn't listed. Up to `ISSUES_PER_REPO`, best first.

The **search** is the GitHub search `holt.starter.find` runs (jobs.py, cached
6 h per search in `find_cache`). A search job also reads the starter issues
of the first `FILL_ISSUES` index matches that have none known yet, so they
join the list when it finishes.

Results are the index first, then the search's repos that aren't already
there. While a search runs, `/v1/find` answers 202 with the index part in
`results`; its `done` event, and a cached search, carry both. When the caller
is over their work limit the index part is the answer, marked `complete:
false`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from holt_server import recommendations, repos, schema, starter
from holt_server.discover import _card, _latest, welcoming_key
from holt_server.services import Services

log = logging.getLogger("holt_server.find")

# Starter issues listed per repo, as the search lists them.
ISSUES_PER_REPO = 3
# Index matches with no known starter issues whose issues one search reads
# (the web's first page), and how many at a time.
FILL_ISSUES = 12
FILL_AT_ONCE = 4
# How long a search waits for those reads after its own part is done.
FILL_WAIT_SECONDS = 20.0


def _matches(meta, params: dict[str, Any]) -> bool:
    languages = set(params.get("languages") or [])
    topics = set(params.get("topics") or [])
    hacktoberfest = bool(params.get("hacktoberfest"))
    if meta is None:
        # Without details nothing is known about language, topics or archiving.
        return not (languages or topics or hacktoberfest)
    if meta.archived or meta.fork:
        return False
    if languages:
        langs = {x.lower() for x in [meta.language or "", *(meta.languages or [])] if x}
        if not languages & langs:
            return False
    tags = {t.lower() for t in meta.topics or []}
    if hacktoberfest and "hacktoberfest" not in tags:
        return False
    return not topics or bool(topics & tags)


def _fits_time(card, days: int) -> bool:
    reply = card.stats.median_first_response_hours
    return reply is None or reply <= days * 24


async def matches(svc: Services, params: dict[str, Any]) -> list:
    """Index cards ("Worth your time") matching the filters, best first."""
    days = int(params.get("days") or 7)
    cards = [c for row in await _latest(svc)  # row[-1] is the repo's RepoMeta
             if row[3] == "viable" and _matches(row[-1], params)
             and (c := _card(row, {})) is not None and _fits_time(c, days)]
    return sorted(cards, key=welcoming_key)


def _result(card, issues: list[dict]) -> dict[str, Any]:
    stats = card.stats.model_dump()
    return schema.FindResult.model_validate({
        "repo": card.repo, "verdict": card.verdict, "description": card.description,
        "language": card.language, "languages": card.languages, "stars": card.stars,
        "stats": {k: stats[k] for k in starter.STAT_KEYS if k in stats},
        "issues": issues[:ISSUES_PER_REPO],
    }).model_dump(mode="json")


async def index_results(svc: Services, params: dict[str, Any]) -> list[dict[str, Any]]:
    """The index part of a find: matches with starter issues, best first."""
    cards = await matches(svc, params)
    known = await recommendations.starter_issues(svc, [repos.key(c.repo) for c in cards])
    return [_result(c, issues) for c in cards if (issues := known.get(repos.key(c.repo)))]


async def unlisted(svc: Services, params: dict[str, Any], limit: int = FILL_ISSUES) -> list[str]:
    """The first index matches whose starter issues aren't known, or are too
    old: the ones a search reads issues for. A repo known to have none isn't
    read again until that answer is old."""
    cards = await matches(svc, params)
    known = await recommendations.starter_issues(svc, [repos.key(c.repo) for c in cards])
    return [c.repo for c in cards if repos.key(c.repo) not in known][:limit]


async def fill_issues(svc: Services, params: dict[str, Any]) -> int:
    """Read and cache the starter issues of the first index matches that have
    none known. Returns how many were read; a failure is skipped."""
    from holt_server.api import fetch_starter_issues

    names = await unlisted(svc, params)
    gate = asyncio.Semaphore(FILL_AT_ONCE)

    async def one(repo: str) -> bool:
        try:
            async with gate:
                await fetch_starter_issues(svc, repo)
            return True
        except Exception as exc:  # noqa: BLE001 -- one repo must not sink the search
            log.info("starter issues for %s: %s", repo, exc)
            return False

    return sum(await asyncio.gather(*(one(r) for r in names)))


def merge(index: list[dict], search: list[dict]) -> list[dict]:
    """The index first, then the search's repos that aren't in it."""
    seen = {repos.key(r["repo"]) for r in index}
    extra = [r for r in search if isinstance(r, dict) and r.get("repo")
             and repos.key(r["repo"]) not in seen]
    return [*index, *extra]


def run(svc: Services, params: dict[str, Any], days: int, emit, loop, cached) -> dict[str, Any]:
    """A find job, on a worker thread: the GitHub search, while the starter
    issues of unlisted index matches are read on the loop. Returns the
    search's results only; `_finish` stores them and adds the index."""
    fill = None
    if getattr(starter.module(), "starter_issues", None) is not None:
        fill = asyncio.run_coroutine_threadsafe(
            fill_issues(svc, {**params, "days": days}), loop)
    try:
        return starter.run_find(
            languages=params.get("languages") or [], topics=params.get("topics") or [],
            hacktoberfest=bool(params.get("hacktoberfest")), days=days,
            limit=int(params.get("limit") or 20), token=svc.pool.next(), emit=emit,
            cached=cached, http=getattr(svc, "http", None),
        )
    finally:
        if fill is not None:
            try:
                fill.result(timeout=FILL_WAIT_SECONDS)
            except Exception:  # noqa: BLE001 -- the search's own results still count
                fill.cancel()
                log.info("reading starter issues for index matches didn't finish")
