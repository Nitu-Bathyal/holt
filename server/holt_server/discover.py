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
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, Request
from holt.about import MAX_README
from pydantic import Field
from sqlalchemy import func, select

from holt_server import repos, schema, starter
from holt_server.db import (
    FindCache, RepoMeta, Report, StarterCache, Usage, current_engine, iso, now, utc,
)
from holt_server.deps import internal, services
from holt_server.github import DETAILS_BATCH
from holt_server.schema import Model, StarterIssue, Stats, VerdictView, odds_for, verdict_line
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
# Personal projects aren't set up for outside contributors, so Discover never
# lists them, under any sort.
VERDICTS = set(schema.TONES) - {"personal"}
# Starter issues this old may be closed by now; older ones aren't shown.
STARTER_MAX_HOURS = 72
# Starter issues a card carries, as on a find result: the card shows the
# first and counts them, the focus view lists them.
CARD_ISSUES = 5


class DiscoverRepo(VerdictView):
    repo: str
    description: str | None = None
    language: str | None = None
    # The main languages, primary first; a second only when it is a real
    # share of the code. Empty until the details are read.
    languages: list[str] = Field(default_factory=list)
    stars: int | None = None
    # The whole repository, not Holt's sample: open issues, pull requests ever
    # opened, how many of those are open, and people who committed. Null until
    # the details are read again (and contributors when GitHub wouldn't say).
    open_issues: int | None = None
    pull_requests: int | None = None
    open_pull_requests: int | None = None
    contributors: int | None = None
    topics: list[str] = Field(default_factory=list)
    # When someone last pushed to the repository, per GitHub.
    pushed_at: str | None = None
    # The report's one-line reason (the same sentence the report shows).
    reason: str
    stats: Stats
    # People who checked it on Holt in the last 7 days; null below TRENDING_MIN.
    checked_this_week: int | None = None
    generated_at: str | None = None
    # Open issues to start with, from the starter-issue cache (what the
    # starter-issues endpoint or the warm pass last read, within
    # STARTER_MAX_HOURS). Empty when none are cached; Discover never reads
    # GitHub for them.
    issues: list[StarterIssue] = Field(default_factory=list)


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


async def starter_issues(svc: Services, keys: list[str]) -> dict[str, list[dict]]:
    """repo_key -> its cached starter issues, for those cached recently by
    the current rules. Reads only the database."""
    if not keys:
        return {}
    since = now() - timedelta(hours=STARTER_MAX_HOURS)
    async with svc.db.session() as s:
        rows = (await s.execute(select(StarterCache.repo_key, StarterCache.issues,
                                       StarterCache.rules_version)
                                .where(StarterCache.repo_key.in_(keys),
                                       StarterCache.created_at >= since))).all()
    return {key: list(issues or []) for key, issues, version in rows
            if starter.current(issues or [], version)}


def card_issues(raw: list[dict]) -> list[StarterIssue]:
    """The first CARD_ISSUES that parse, nobody-on-it first (stable)."""
    issues = []
    for i in raw:
        try:
            issues.append(StarterIssue.model_validate(i))
        except ValueError:
            continue
    return sorted(issues, key=lambda i: bool(i.people or i.open_prs))[:CARD_ISSUES]


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
        **counts(meta),
        topics=list(meta.topics or []) if meta else [],
        pushed_at=iso(meta.pushed_at) if meta else None,
        reason=verdict_line(verdict, st, decided_by, rule_codes), stats=st,
        checked_this_week=views.get(key), generated_at=generated or iso(created))


async def cards(svc: Services, keys: list[str]) -> dict[str, DiscoverRepo]:
    """repo_key -> the card for each of `keys` that has a current report."""
    if not keys:
        return {}
    return {row[1]: c for row in await _latest(svc, keys) if (c := _card(row, {})) is not None}


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
    ranked = rank(chosen, sort)[:limit]
    # Only for the cards shown, so a board is one more small read.
    cached = await starter_issues(svc, [repos.key(c.repo) for c in ranked])
    ranked = [c.model_copy(update={"issues": card_issues(cached.get(repos.key(c.repo), []))})
              for c in ranked]
    return DiscoverOut(
        sort=sort, language=shown, topic=topic, hacktoberfest=hacktoberfest,
        repos=ranked,
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
        # Read before the README, links and release were kept: read again now,
        # not in a day, so a report shows them as soon as the next pass runs.
        old_shape = set((await s.execute(
            select(RepoMeta.repo_key).where(RepoMeta.links.is_(None)))).scalars())
        finds = (await s.execute(
            select(FindCache.results).where(FindCache.created_at >= cutoff))).scalars()
        found = [r["repo"] for results in finds for r in results or []
                 if isinstance(r, dict) and r.get("repo")]
    names = {key: repo for key, repo in reported}
    for repo in [*found, *extra]:
        names.setdefault(repos.key(repo), repo)
    return [repo for key, repo in names.items()
            if key not in fetched or key in old_shape or utc(fetched[key]) < cutoff]


async def with_meta(s, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Find results with the description, language, stars and counts `repo_meta` has
    for them: the finder screens repos without reading those. A repo with no
    details yet keeps what its result had (null). No GitHub call."""
    keys = {repos.key(r["repo"]) for r in results if isinstance(r, dict) and r.get("repo")}
    if not keys:
        return results
    metas = {m.repo_key: m for m in (await s.execute(
        select(RepoMeta).where(RepoMeta.repo_key.in_(keys)))).scalars()}
    breakdowns = await _breakdowns(s, keys)
    out = []
    for r in results:
        if not isinstance(r, dict):
            out.append(r)
            continue
        key = repos.key(r.get("repo") or "")
        m = metas.get(key)
        if m is not None:
            r = {**r, "description": m.description or r.get("description"),
                 "language": m.language or r.get("language"),
                 "languages": list(m.languages or []), "stars": m.stars, **counts(m)}
        if (extra := breakdowns.get(key)) and _same_sample(r.get("stats"), extra):
            r = {**r, "stats": {**r["stats"], **{k: extra[k] for k in BREAKDOWN}}}
        out.append(r)
    return out


# What became of the pull requests that weren't merged: a find screen doesn't
# count these, a report does, and the odds bar draws them.
BREAKDOWN = ("closed_silently", "closed_by_bot", "withdrawn", "still_open")


async def _breakdowns(s, keys: set[str]) -> dict[str, dict[str, Any]]:
    """repo_key -> the latest 7-day rules report's stats, for the repos that have one."""
    latest = (select(func.max(Report.id).label("id"))
              .where(Report.mode == "rules", Report.days == DAYS, current_engine(),
                     Report.repo_key.in_(keys))
              .group_by(Report.repo_key).subquery())
    rows = (await s.execute(
        select(Report.repo_key, Report.report["stats"])
        .join(latest, Report.id == latest.c.id))).all()
    return {key: st for key, st in rows
            if isinstance(st, dict) and all(isinstance(st.get(k), int) for k in BREAKDOWN)}


def _same_sample(stats: Any, report_stats: dict[str, Any]) -> bool:
    """The screen counted the same pull requests as the report, so the report's
    breakdown describes it (a find of another window has other counts)."""
    return (isinstance(stats, dict)
            and stats.get("outsider_attempts") == report_stats.get("outsider_attempts")
            and stats.get("outsider_merged") == report_stats.get("outsider_merged"))


def _parse_ts(value: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


def _int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _homepage(value: Any) -> str | None:
    """A web address only: the page links to it."""
    url = str(value or "").strip()
    if not url or len(url) > 500:
        return None
    scheme = urlsplit(url).scheme.lower()
    if not scheme:
        url, scheme = f"https://{url}", "https"
    return url if scheme in ("http", "https") and "://" in url else None


def _web_url(value: Any) -> str | None:
    """An absolute http(s) address, else None: the page links to it."""
    url = str(value or "").strip()
    parts = urlsplit(url)
    return url if len(url) <= 500 and parts.scheme.lower() in ("http", "https") and parts.netloc else None


def _links(value: Any) -> list[dict[str, str]]:
    out = []
    for link in value or []:
        kind = (link or {}).get("kind") if isinstance(link, dict) else None
        url = _web_url((link or {}).get("url")) if isinstance(link, dict) else None
        if kind in schema.LINK_KINDS and url and all(o["kind"] != kind for o in out):
            out.append({"kind": kind, "url": url})
    return out


def _release(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or not value.get("tag") or not _web_url(value.get("url")):
        return None
    return {"tag": str(value["tag"])[:100], "published_at": value.get("published_at"), "url": value["url"]}


def _people(value: Any) -> list[dict[str, Any]]:
    """Contributors as stored and served: a login, a GitHub profile and avatar
    address, a commit count and the profile name when there is one. Anything
    else is dropped."""
    out = []
    for p in value or []:
        if not isinstance(p, dict) or not isinstance(p.get("login"), str) or not p["login"]:
            continue
        url = _web_url(p.get("url"))
        if not url or not url.startswith("https://github.com/"):
            continue
        avatar = _web_url(p.get("avatar_url"))
        out.append({"login": p["login"][:100], "name": (str(p.get("name") or "").strip()[:100]) or None,
                    "url": url, "avatar_url": avatar if avatar and avatar.startswith("https://") else None,
                    "contributions": _int(p.get("contributions"))})
    return out


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
            row.forks = _int(d.get("forks"))
            row.open_issues = _int(d.get("open_issues"))
            row.pull_requests = _int(d.get("pull_requests"))
            row.open_pull_requests = _int(d.get("open_pull_requests"))
            # A count GitHub wouldn't give this time keeps yesterday's.
            if d.get("contributors") is not None:
                row.contributors = _int(d.get("contributors"))
            row.license = (d.get("license") or "")[:80] or None
            row.homepage = _homepage(d.get("homepage"))
            row.language_shares = list(d.get("language_shares") or [])[:3]
            row.created_at = _parse_ts(d.get("created_at"))
            row.default_branch = (d.get("default_branch") or "")[:200] or None
            row.fork_of = (d.get("fork_of") or "")[:200] or None
            row.readme_line = (d.get("readme_line") or "")[:500] or None
            row.readme = (d.get("readme") or "")[:MAX_README] or None
            row.links = _links(d.get("links"))
            row.latest_release = _release(d.get("latest_release"))
            # A list GitHub wouldn't give this time keeps yesterday's.
            if d.get("top_contributors") is not None:
                row.top_contributors = _people(d.get("top_contributors"))
            row.fetched_at = now()
            s.add(row)
            written += 1
        await s.commit()
    return written


COUNTS = ("open_issues", "pull_requests", "open_pull_requests", "contributors")


def counts(meta: RepoMeta | None) -> dict[str, int | None]:
    """The repository's own counts for a card; all None until its details are read."""
    return {name: getattr(meta, name, None) if meta else None for name in COUNTS}


def about_view(meta: RepoMeta) -> schema.RepoAbout:
    return schema.RepoAbout(
        description=meta.description, readme_line=meta.readme_line, readme=meta.readme, homepage=meta.homepage,
        stars=meta.stars, forks=meta.forks, open_issues=meta.open_issues,
        pull_requests=meta.pull_requests, open_pull_requests=meta.open_pull_requests,
        contributors=meta.contributors,
        license=meta.license, topics=list(meta.topics or []),
        languages=[lang for lang in meta.language_shares or []
                   if isinstance(lang, dict) and lang.get("name")],
        created_at=iso(meta.created_at),
        pushed_at=iso(meta.pushed_at),
        default_branch=meta.default_branch, archived=bool(meta.archived),
        fork=bool(meta.fork), fork_of=meta.fork_of,
        links=_links(meta.links), latest_release=_release(meta.latest_release),
        top_contributors=_people(meta.top_contributors),
        fetched_at=iso(meta.fetched_at))


async def about(svc: Services, repo: str) -> schema.RepoAbout | None:
    """The report's "About this repo", from `repo_meta` (one database read, no
    GitHub call). None until the repo's details have been read."""
    async with svc.db.session() as s:
        meta = await s.get(RepoMeta, repos.key(repo))
    return about_view(meta) if meta is not None else None


def batches(items: list[str], size: int = DETAILS_BATCH) -> list[list[str]]:
    return [items[i:i + size] for i in range(0, len(items), size)]
