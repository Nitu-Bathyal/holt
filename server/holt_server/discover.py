"""Discover: browse the repositories Holt has checked, and the "most
welcoming <language> repos" boards.

    GET /v1/discover?language=python&topic=cli&sort=welcoming|stars|trending&hacktoberfest=true

Everything here comes from the latest 7-day **rules** report of each
repository, never from a model, and ranks repositories, never people:

* `welcoming` (the boards): only repos whose verdict is "Worth your time",
  best odds first (good, fair, long), then the share of outside pull
  requests merged (a small sample counts for less, see `merged_share`), the
  reply time and how many outsiders tried.
* `stars`: GitHub stars, every verdict.
* `trending`: how many people checked the repo on Holt in the last 7 days
  (`usage_events`: one per person per day, see usage.py). Only repos with at
  least `TRENDING_MIN` are shown, so a handful of visits (or one person) can't
  put a repo on the list.

`hacktoberfest=true` keeps only repos tagged with the `hacktoberfest` topic
(how a project opts in to Hacktoberfest, and what a Hacktoberfest find searches
for) that aren't archived, under any sort. The language chips then count those
repos only.

Language, stars, topics and descriptions live in `repo_meta`: read right
after a repo's report is stored (meta_refresh.py), and daily by the warm pass
(`warm_meta`), one GraphQL query per hundred repositories, for every reported
repo and every repo a find returned in the last day. Find results take their
description, language and stars from it too (`with_meta`).
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field
from sqlalchemy import func, select

from holt_server import repos, schema
from holt_server.db import FindCache, RepoMeta, Report, Usage, current_engine, iso, now, utc
from holt_server.deps import internal, services
from holt_server.github import DETAILS_BATCH
from holt_server.schema import Model, Stats, VerdictView, odds_for, verdict_line
from holt_server.services import Services

log = logging.getLogger("holt_server.discover")

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})

Sort = Literal["welcoming", "stars", "trending"]
DAYS = 7
# People (per day) who checked a repo in the last week before it counts as
# trending, and before the count is shown at all.
TRENDING_MIN = 5
TRENDING_DAYS = 7
# Languages offered as filters: the most common ones among checked repos.
LANGUAGES_SHOWN = 16
# Repository details older than this are read again by the warm pass.
META_MAX_AGE_HOURS = 24
# The GitHub topic a project adds to take part in Hacktoberfest.
HACKTOBERFEST_TOPIC = "hacktoberfest"
# GitHub allows a repository 20 topics; all are kept so a late one still counts.
MAX_TOPICS = 20
ODDS_RANK = {"good": 0, "fair": 1, "long": 2}
# Welcoming order: small samples are pulled toward a typical merged share.
PRIOR_PRS, PRIOR_RATE = 10, 0.2
VERDICTS = set(schema.TONES)


class DiscoverRepo(VerdictView):
    repo: str
    description: str | None = None
    language: str | None = None
    # The main languages, primary first; a second only when it is a real
    # share of the code. Empty until the details are read.
    languages: list[str] = Field(default_factory=list)
    stars: int | None = None
    topics: list[str] = Field(default_factory=list)
    # When someone last pushed to the repository, per GitHub.
    pushed_at: str | None = None
    # The report's one-line reason (the same sentence the report shows).
    reason: str
    stats: Stats
    # People who checked it on Holt in the last 7 days; null below TRENDING_MIN.
    checked_this_week: int | None = None
    generated_at: str | None = None


class LanguageCount(Model):
    name: str
    repos: int


class DiscoverOut(Model):
    sort: Sort
    language: str | None
    topic: str | None
    hacktoberfest: bool = False
    repos: list[DiscoverRepo]
    # The languages to offer as filters, most repos first (ignores the
    # language and topic filters, so the chips don't vanish once one is picked;
    # with `hacktoberfest` they count Hacktoberfest repos only).
    languages: list[LanguageCount]
    trending_min: int


def _norm(value: str | None) -> str | None:
    value = (value or "").strip().lower()
    return value or None


async def _latest(svc: Services, keys: list[str] | None = None) -> list[tuple]:
    """(repo, report fields..., meta) for the latest 7-day rules report of each
    repo (only those in `keys`, when given). Only the fields a card needs come
    out of the report JSON, not whole bodies. Reports from an older engine are
    left out until the warm pass redoes them."""
    latest = (select(func.max(Report.id).label("id"))
              .where(Report.mode == "rules", Report.days == DAYS, current_engine()))
    if keys is not None:
        latest = latest.where(Report.repo_key.in_(keys))
    latest = latest.group_by(Report.repo_key).subquery()
    async with svc.db.session() as s:
        return (await s.execute(
            select(Report.repo, Report.repo_key, Report.created_at,
                   Report.report["verdict"].as_string(),
                   Report.report["generated_at"].as_string(),
                   Report.report["stats"], Report.report["decided_by"],
                   Report.report["rule_codes"], RepoMeta)
            .join(latest, Report.id == latest.c.id)
            .outerjoin(RepoMeta, RepoMeta.repo_key == Report.repo_key)
        )).all()


async def checked_this_week(svc: Services) -> dict[str, int]:
    """repo_key -> people who asked for its report in the last 7 days. `who`
    changes every UTC day, so this counts each person once per day."""
    since = (now() - timedelta(days=TRENDING_DAYS - 1)).strftime("%Y-%m-%d")
    people = func.count(func.distinct(Usage.day + ":" + Usage.who))
    async with svc.db.session() as s:
        rows = (await s.execute(
            select(Usage.repo_key, people)
            .where(Usage.kind == "analysis", Usage.day >= since, Usage.repo_key.is_not(None))
            .group_by(Usage.repo_key)
            .having(people >= TRENDING_MIN))).all()
    return {key: n for key, n in rows}


def _card(row: tuple, views: dict[str, int]) -> DiscoverRepo | None:
    repo, key, created, verdict, generated, stats, decided_by, rule_codes, meta = row
    if verdict not in VERDICTS or not isinstance(stats, dict):
        return None
    try:
        st = Stats.model_validate(stats)
    except ValueError:
        return None
    decided_by, rule_codes = decided_by or [], rule_codes or []
    return DiscoverRepo(
        repo=meta.repo if meta else repo, verdict=verdict,
        description=meta.description if meta else None,
        language=meta.language if meta else None,
        languages=list(meta.languages or []) if meta else [],
        stars=meta.stars if meta else None,
        topics=list(meta.topics or []) if meta else [],
        pushed_at=iso(meta.pushed_at) if meta else None,
        reason=verdict_line(verdict, st, decided_by, rule_codes), stats=st,
        checked_this_week=views.get(key), generated_at=generated or iso(created))


def is_hacktoberfest(meta: RepoMeta | None) -> bool:
    """Tagged for Hacktoberfest and not archived (archived repos can't take
    pull requests). Repos whose details haven't been read yet aren't."""
    return (meta is not None and not meta.archived
            and HACKTOBERFEST_TOPIC in {t.lower() for t in meta.topics or []})


def merged_share(s: Stats) -> float:
    """The share of outside pull requests merged, as if `PRIOR_PRS` more at a
    typical `PRIOR_RATE` had been seen too: 6 of 8 merged is less sure than
    60 of 105, so it shouldn't top the board."""
    return (s.outsider_merged + PRIOR_RATE * PRIOR_PRS) / (s.outsider_attempts + PRIOR_PRS)


def welcoming_key(card: DiscoverRepo) -> tuple:
    """Best first. Only rules numbers: odds, merged share, reply time, sample size."""
    s = card.stats
    odds = odds_for(card.verdict, s)
    reply = s.median_first_response_hours
    return (ODDS_RANK[odds.level] if odds else 3, -round(merged_share(s), 3),
            reply if reply is not None else float("inf"), -s.outsider_attempts,
            card.repo.lower())


def rank(cards: list[DiscoverRepo], sort: Sort) -> list[DiscoverRepo]:
    if sort == "welcoming":
        return sorted((c for c in cards if c.verdict == "viable"), key=welcoming_key)
    if sort == "trending":
        return sorted((c for c in cards if c.checked_this_week),
                      key=lambda c: (-(c.checked_this_week or 0), -(c.stars or 0),
                                     c.repo.lower()))
    return sorted(cards, key=lambda c: (-(c.stars or 0), c.repo.lower()))


async def discover_body(svc: Services, sort: Sort, language: str | None,
                        topic: str | None, limit: int,
                        hacktoberfest: bool = False) -> DiscoverOut:
    language, topic = _norm(language), _norm(topic)
    views = await checked_this_week(svc)
    cards = [c for row in await _latest(svc)  # row[-1] is the repo's RepoMeta
             if (not hacktoberfest or is_hacktoberfest(row[-1])) and (c := _card(row, views))]
    counts = Counter(c.language for c in cards if c.language)
    chosen = [c for c in cards
              if (language is None or (c.language or "").lower() == language)
              and (topic is None or topic in {t.lower() for t in c.topics})]
    # The language as GitHub spells it, when a repo has it.
    shown = next((name for name in counts if name.lower() == language), language)
    return DiscoverOut(
        sort=sort, language=shown, topic=topic, hacktoberfest=hacktoberfest,
        repos=rank(chosen, sort)[:limit],
        languages=[LanguageCount(name=name, repos=n)
                   for name, n in sorted(counts.items(), key=lambda x: (-x[1], x[0].lower()))
                   [:LANGUAGES_SHOWN]],
        trending_min=TRENDING_MIN)


@router.get("/discover", dependencies=[Depends(internal)])
async def discover(request: Request,
                   sort: Sort = "welcoming",
                   language: str | None = Query(None, max_length=80),
                   topic: str | None = Query(None, max_length=80),
                   limit: int = Query(24, ge=1, le=100),
                   hacktoberfest: bool = False) -> DiscoverOut:
    """Checked repositories, filtered and sorted (see the module docstring).
    Reads only the database: no GitHub call and no rate limit."""
    return await discover_body(services(request), sort, language, topic, limit, hacktoberfest)


# --- the warm pass's part -------------------------------------------------------


async def stale_meta(svc: Services, extra: list[str] = ()) -> list[str]:
    """Repositories with a rules report, in a find stored in the last
    META_MAX_AGE_HOURS, or in `extra`, whose details are missing or older than
    that."""
    cutoff = now() - timedelta(hours=META_MAX_AGE_HOURS)
    async with svc.db.session() as s:
        reported = (await s.execute(
            select(Report.repo_key, func.max(Report.repo))
            .where(Report.mode == "rules").group_by(Report.repo_key))).all()
        fetched = dict((await s.execute(
            select(RepoMeta.repo_key, RepoMeta.fetched_at))).all())
        finds = (await s.execute(
            select(FindCache.results).where(FindCache.created_at >= cutoff))).scalars()
        found = [r["repo"] for results in finds for r in results or []
                 if isinstance(r, dict) and r.get("repo")]
    names = {key: repo for key, repo in reported}
    for repo in [*found, *extra]:
        names.setdefault(repos.key(repo), repo)
    return [repo for key, repo in names.items()
            if key not in fetched or utc(fetched[key]) < cutoff]


async def with_meta(s, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Find results with the description, language and stars `repo_meta` has
    for them: the finder screens repos without reading those. A repo with no
    details yet keeps what its result had (null). No GitHub call."""
    keys = {repos.key(r["repo"]) for r in results if isinstance(r, dict) and r.get("repo")}
    if not keys:
        return results
    metas = {m.repo_key: m for m in (await s.execute(
        select(RepoMeta).where(RepoMeta.repo_key.in_(keys)))).scalars()}
    out = []
    for r in results:
        m = metas.get(repos.key(r.get("repo") or "")) if isinstance(r, dict) else None
        out.append(r if m is None else {
            **r, "description": m.description or r.get("description"),
            "language": m.language or r.get("language"),
            "languages": list(m.languages or []), "stars": m.stars})
    return out


def _parse_ts(value: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


async def store_meta(svc: Services, details: dict[str, dict[str, Any] | None]) -> int:
    """Save what `GitHubLookup.details` returned; missing repos are left alone.
    Returns how many rows were written."""
    written = 0
    async with svc.db.session() as s:
        for requested, d in details.items():
            if d is None:
                continue
            key = repos.key(requested)
            row = await s.get(RepoMeta, key) or RepoMeta(repo_key=key)
            row.repo = d.get("repo") or requested
            row.description = (d.get("description") or "")[:500] or None
            row.language = d.get("language") or None
            row.languages = list(d.get("languages") or [])[:2]
            row.stars = int(d.get("stars") or 0)
            row.topics = list(d.get("topics") or [])[:MAX_TOPICS]
            row.pushed_at = _parse_ts(d.get("pushed_at"))
            row.archived = bool(d.get("archived"))
            row.fork = bool(d.get("fork"))
            row.fetched_at = now()
            s.add(row)
            written += 1
        await s.commit()
    return written


def batches(items: list[str], size: int = DETAILS_BATCH) -> list[list[str]]:
    return [items[i:i + size] for i in range(0, len(items), size)]
