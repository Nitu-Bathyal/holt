"""My Contributions: a connected user's public pull requests, seen through Holt.

    GET  /v1/me/contributions             the list and its summary (API.md)
    POST /v1/me/contributions/refresh     read GitHub again (at most every 15 minutes)
    GET  /v1/metrics/contributions        the product metric: counts only
    python -m holt_server.contributions metric [--since YYYY-MM-DD] [--json]
    python -m holt_server.contributions stats   recount repo statistics now

The pull requests come from GitHub's public search (`is:pr is:public
author:<login>`), read with the server's token pool, never the user's token:
the last `WINDOW_DAYS`, at most `MAX_PRS`, leaving out the user's own
repositories. They are fetched when GitHub is connected, again once a day in
the background (HOLT_CONTRIBUTIONS_REFRESH_HOURS), and when the user presses
refresh. Each fetch replaces the user's rows; disconnecting deletes them.

Each pull request carries Holt's latest rules verdict for its repository when
the report cache has one. Nothing here starts an analysis.

"Found via Holt": the user opened the pull request within `AFTER_HOLT_DAYS`
of opening that repository's report page on Holt. `repo_views` keeps the first
and the last view of each repository, so only a pull request within 30 days
after one of those two counts: it can miss one after a view in between, but it
never counts one it can't show.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import and_, delete, func, select, text

from holt_server import repo_stats, repos, schema
from holt_server.db import (
    Contribution,
    ContributionSync,
    GitHubConnection,
    Report,
    RepoView,
    iso,
    now,
    utc,
)
from holt_server.deps import Caller, caller, services, signed_in
from holt_server.errors import ApiError
from holt_server.ratelimit import RateLimiter
from holt_server.services import Services

log = logging.getLogger("holt_server.contributions")

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})

WINDOW_DAYS = 365
MAX_PRS = 200
PAGE = 100
AFTER_HOLT_DAYS = 30
COOLDOWN = timedelta(minutes=15)
# Refreshes that reach GitHub, per user per hour. The cooldown already allows
# only four that succeed; this also bounds retries after GitHub trouble.
REFRESH_PER_HOUR = 6
SEARCH_TIMEOUT_S = 20.0
# The background pass checks GitHub points every this many users.
BUDGET_EVERY = 10
LOCK_ID = 7_406_112

SEARCH = """
query($q:String!, $n:Int!, $cursor:String) {
  rateLimit { remaining resetAt }
  search(query:$q, type:ISSUE, first:$n, after:$cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url state isDraft createdAt closedAt mergedAt
        repository { nameWithOwner isPrivate owner { login } }
      }
    }
  }
}
"""

_refresh_limiter = RateLimiter()
# Background fetches started on connect, kept so they are not collected mid-run.
_background: set[asyncio.Task] = set()


# --- reading GitHub --------------------------------------------------------------------


def search_query(login: str, today: datetime) -> str:
    since = (today - timedelta(days=WINDOW_DAYS)).date().isoformat()
    return (f"is:pr is:public author:{login} -user:{login} created:>={since} "
            "sort:created-desc")


def _state(node: dict[str, Any]) -> str:
    if node.get("mergedAt") or node.get("state") == "MERGED":
        return "merged"
    return "closed" if node.get("state") == "CLOSED" else "open"


def _when(value: Any) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def parse(nodes: Iterable[dict[str, Any] | None], login: str) -> list[dict[str, Any]]:
    """Search nodes -> row values. Private repositories and the user's own are
    left out even if a token could see them."""
    out, seen = [], set()
    for node in nodes:
        repo = (node or {}).get("repository") or {}
        name = repo.get("nameWithOwner")
        if not name or repo.get("isPrivate") or not node.get("number"):
            continue
        if ((repo.get("owner") or {}).get("login") or "").lower() == login.lower():
            continue
        key = (repos.key(name), int(node["number"]))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "repo": name, "repo_key": key[0], "number": key[1],
            "title": str(node.get("title") or "")[:1000],
            "url": str(node.get("url") or f"https://github.com/{name}/pull/{key[1]}")[:500],
            "state": _state(node), "draft": bool(node.get("isDraft")),
            "created_at": _when(node.get("createdAt")) or now(),
            "closed_at": _when(node.get("closedAt")), "merged_at": _when(node.get("mergedAt")),
        })
    return out


def search(svc: Services, login: str) -> tuple[list[dict[str, Any]], bool]:
    """(pull requests, whether GitHub had more). Blocking; at most two queries."""
    from holt_server.engine import translate

    q = search_query(login, now())
    rows: list[dict[str, Any]] = []
    cursor, more = None, False
    try:
        gql = svc.pool.transport(svc.http)
        while len(rows) < MAX_PRS:
            data = gql.query(SEARCH, timeout=SEARCH_TIMEOUT_S, q=q,
                             n=min(PAGE, MAX_PRS - len(rows)), cursor=cursor)
            found = data.get("search") or {}
            rows.extend(found.get("nodes") or [])
            page = found.get("pageInfo") or {}
            more = bool(page.get("hasNextPage"))
            if not more:
                break
            cursor = page.get("endCursor")
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise translate(exc, login) from exc
    return parse(rows, login), more


# --- storing -----------------------------------------------------------------------


async def fetch(svc: Services, user_id: str, login: str) -> bool:
    """Read GitHub for `user_id` and replace their rows. Concurrent calls for
    one user share one fetch. False when they disconnected meanwhile."""
    key = f"contributions:{user_id}"
    if (pending := svc.inflight.get(key)) is not None:
        return await asyncio.shield(pending)
    task = asyncio.ensure_future(_fetch_and_store(svc, user_id, login))
    svc.inflight[key] = task
    try:
        return await asyncio.shield(task)
    finally:
        if task.done():
            svc.inflight.pop(key, None)
        else:
            task.add_done_callback(lambda _: svc.inflight.pop(key, None))


async def _fetch_and_store(svc: Services, user_id: str, login: str) -> bool:
    rows, truncated = await asyncio.to_thread(search, svc, login)
    async with svc.db.session() as s:
        # Locks the connection row, so a disconnect in the middle either runs
        # first (and we store nothing) or waits and then deletes what we wrote.
        conn = (await s.execute(select(GitHubConnection).where(
            GitHubConnection.user_id == user_id).with_for_update())).scalar_one_or_none()
        if conn is None or conn.login != login:
            return False
        await s.execute(delete(Contribution).where(Contribution.user_id == user_id))
        s.add_all(Contribution(user_id=user_id, **r) for r in rows)
        sync = await s.get(ContributionSync, user_id)
        if sync is None:
            sync = ContributionSync(user_id=user_id)
            s.add(sync)
        sync.login, sync.fetched_at, sync.truncated = login, now(), truncated
        await s.commit()
    return True


async def forget(s, user_id: str) -> None:
    """Delete a user's fetched pull requests (disconnect). Caller commits."""
    await s.execute(delete(Contribution).where(Contribution.user_id == user_id))
    await s.execute(delete(ContributionSync).where(ContributionSync.user_id == user_id))


def fetch_soon(svc: Services, user_id: str, login: str) -> None:
    """Start a fetch in the background (on connect); failures are only logged,
    the page fetches again when it is opened."""
    async def run() -> None:
        try:
            await fetch(svc, user_id, login)
        except Exception as exc:  # noqa: BLE001
            log.warning("fetching pull requests after connect failed: %s",
                        getattr(exc, "code", type(exc).__name__))

    task = asyncio.ensure_future(run())
    _background.add(task)
    task.add_done_callback(_background.discard)


# --- "found via Holt" -------------------------------------------------------------------


def after_holt(created: datetime, first_view: datetime | None,
               last_view: datetime | None) -> bool:
    window = timedelta(days=AFTER_HOLT_DAYS)
    created = utc(created)
    return any(v is not None and utc(v) <= created <= utc(v) + window
               for v in (first_view, last_view))


# --- the page ---------------------------------------------------------------------------


async def verdicts(s, keys: set[str]) -> dict[str, schema.RepoVerdict]:
    """The latest 7-day rules verdict per repository, where one is cached."""
    if not keys:
        return {}
    rules = and_(Report.mode == "rules", Report.days == 7)
    latest = (select(Report.repo_key, func.max(Report.created_at).label("at"))
              .where(Report.repo_key.in_(keys), rules)
              .group_by(Report.repo_key).subquery())
    got = await s.execute(
        select(Report.repo_key, Report.created_at, Report.report["verdict"].as_string())
        .join(latest, and_(Report.repo_key == latest.c.repo_key,
                           Report.created_at == latest.c.at))
        .where(rules))
    out = {}
    for key, at, verdict in got:
        if verdict in schema.TONES:
            out[key] = schema.RepoVerdict(verdict=verdict, checked_at=iso(at))
    return out


async def page(svc: Services, user_id: str, conn: GitHubConnection) -> schema.Contributions:
    async with svc.db.session() as s:
        sync = await s.get(ContributionSync, user_id)
        prs = (await s.execute(select(Contribution).where(Contribution.user_id == user_id)
                               .order_by(Contribution.created_at.desc()))).scalars().all()
        seen = {v.repo_key: v for v in (await s.execute(
            select(RepoView).where(RepoView.user_id == user_id))).scalars()}
        known = await verdicts(s, {p.repo_key for p in prs})
    if sync is None:  # disconnected while the first fetch ran
        raise ApiError("not_found", "Connect your GitHub account to see your contributions.")
    items = []
    for p in prs:
        view = seen.get(p.repo_key)
        items.append(schema.ContributionPullRequest(
            repo=p.repo, number=p.number, title=p.title, url=p.url, state=p.state,
            draft=p.draft, created_at=iso(p.created_at), closed_at=iso(p.closed_at),
            merged_at=iso(p.merged_at), verdict=known.get(p.repo_key),
            found_via_holt=view is not None and after_holt(
                p.created_at, view.first_viewed_at, view.last_viewed_at)))
    merged = sum(i.state == "merged" for i in items)
    closed = sum(i.state == "closed" for i in items)
    ready = utc(sync.fetched_at) + COOLDOWN
    return schema.Contributions(
        login=conn.login, fetched_at=iso(sync.fetched_at),
        next_refresh_at=iso(ready) if ready > now() else None,
        window_days=WINDOW_DAYS, truncated=sync.truncated,
        summary=schema.ContributionSummary(
            opened=len(items), merged=merged, closed=closed,
            waiting=sum(i.state == "open" for i in items),
            landed_share=round(merged / (merged + closed), 4) if merged + closed else None,
            found_via_holt=sum(i.found_via_holt for i in items)),
        pull_requests=items)


async def _connection(svc: Services, user_id: str,
                      ) -> tuple[GitHubConnection, ContributionSync | None]:
    async with svc.db.session() as s:
        conn = await s.get(GitHubConnection, user_id)
        sync = await s.get(ContributionSync, user_id)
    if conn is None:
        raise ApiError("not_found", "Connect your GitHub account to see your contributions.")
    return conn, sync


@router.get("/me/contributions")
async def get_contributions(request: Request,
                            who: Caller = Depends(caller)) -> schema.Contributions:
    """The stored list. The first time (or after a rename) it reads GitHub."""
    svc = services(request)
    user_id = signed_in(who)
    conn, sync = await _connection(svc, user_id)
    if sync is None or sync.login != conn.login:
        await fetch(svc, user_id, conn.login)
    return await page(svc, user_id, conn)


@router.post("/me/contributions/refresh")
async def refresh_contributions(request: Request,
                                who: Caller = Depends(caller)) -> schema.Contributions:
    """Read GitHub again, unless the last read is under 15 minutes old: then
    the stored list comes back unchanged, with `next_refresh_at`."""
    svc = services(request)
    user_id = signed_in(who)
    conn, sync = await _connection(svc, user_id)
    fresh = (sync is not None and sync.login == conn.login
             and utc(sync.fetched_at) + COOLDOWN > now())
    if not fresh:
        _refresh_limiter.hit(f"user:{user_id}", REFRESH_PER_HOUR)
        await fetch(svc, user_id, conn.login)
    return await page(svc, user_id, conn)


# --- the product metric -----------------------------------------------------------------


@dataclass
class Metric:
    connected_users: int = 0
    users_with_pull_requests: int = 0
    users_with_pr_after_holt: int = 0
    prs_after_holt: int = 0
    prs_after_holt_merged: int = 0


async def metric(svc: Services, since: datetime | None = None) -> Metric:
    """Counts over connected users who didn't opt out of statistics; pull
    requests opened on or after `since` (all stored ones by default)."""
    counted = GitHubConnection.stats_opt_out.is_(False)
    m = Metric()
    after = [Contribution.created_at >= since] if since else []
    async with svc.db.session() as s:
        m.connected_users = (await s.execute(
            select(func.count()).select_from(GitHubConnection).where(counted))).scalar_one()
        m.users_with_pull_requests = (await s.execute(
            select(func.count(func.distinct(Contribution.user_id)))
            .join(GitHubConnection, GitHubConnection.user_id == Contribution.user_id)
            .where(counted, *after))).scalar_one()
        rows = await s.execute(
            select(Contribution.user_id, Contribution.state, Contribution.created_at,
                   RepoView.first_viewed_at, RepoView.last_viewed_at)
            .join(RepoView, and_(RepoView.user_id == Contribution.user_id,
                                 RepoView.repo_key == Contribution.repo_key))
            .join(GitHubConnection, GitHubConnection.user_id == Contribution.user_id)
            .where(counted, *after))
        users = set()
        for user_id, state, created, first, last in rows:
            if after_holt(created, first, last):
                users.add(user_id)
                m.prs_after_holt += 1
                m.prs_after_holt_merged += state == "merged"
        m.users_with_pr_after_holt = len(users)
    return m


def _since(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).replace(tzinfo=UTC)
    except ValueError:
        raise ApiError("invalid_request", "`since` must be a date like 2026-10-01.") from None


@router.get("/metrics/contributions")
async def get_metric(request: Request, since: str | None = None,
                     _: Caller = Depends(caller)) -> schema.ContributionMetric:
    """Internal (the internal key, like every /v1 route): no user needed."""
    svc = services(request)
    start = _since(since)
    m = await metric(svc, start)
    return schema.ContributionMetric(since=start.date().isoformat() if start else "",
                                     window_days=AFTER_HOLT_DAYS, **m.__dict__)


# --- the daily background refresh -------------------------------------------------------


async def refresh_all(svc: Services, max_age: timedelta) -> int:
    """Fetch every connected user whose list is older than `max_age`, oldest
    first, one at a time. Stops when GitHub points run low. Then recounts the
    repository statistics (repo_stats.py). Returns how many users."""
    async with svc.db.session() as s:
        due = (await s.execute(
            select(GitHubConnection.user_id, GitHubConnection.login)
            .outerjoin(ContributionSync, ContributionSync.user_id == GitHubConnection.user_id)
            .where((ContributionSync.fetched_at.is_(None))
                   | (ContributionSync.fetched_at < now() - max_age))
            .order_by(ContributionSync.fetched_at.asc().nulls_first()))).all()
    done = 0
    for i, (user_id, login) in enumerate(due):
        if i % BUDGET_EVERY == 0:
            left = await svc.lookup.remaining()
            if left < svc.settings.warm_min_points:
                log.info("contributions refresh: stopping, GitHub points left %d", left)
                break
        try:
            done += await fetch(svc, user_id, login)
        except ApiError as err:
            log.warning("contributions refresh: a user failed (%s)", err.code)
            if err.code == "rate_limited":
                break
    # Repository statistics from Holt users are recounted from the fresh lists.
    await repo_stats.rebuild_all(svc)
    return done


async def refresh_once(svc: Services, max_age: timedelta) -> int | None:
    """One pass; on Postgres only one process runs it (None if another does)."""
    if svc.db.engine.dialect.name != "postgresql":
        return await refresh_all(svc, max_age)
    async with svc.db.engine.connect() as conn:
        if not (await conn.execute(text("SELECT pg_try_advisory_lock(:id)"),
                                   {"id": LOCK_ID})).scalar():
            return None
        try:
            return await refresh_all(svc, max_age)
        finally:
            await conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})


async def schedule(svc: Services, first_delay_s: float = 300.0) -> None:
    """Every HOLT_CONTRIBUTIONS_REFRESH_HOURS, in the API process, until cancelled."""
    hours = svc.settings.contributions_refresh_hours
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            n = await refresh_once(svc, timedelta(hours=hours * 0.8))
            if n is not None:
                log.info("contributions refresh: %d users", n)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 -- try again next time
            log.exception("contributions refresh failed")
        await asyncio.sleep(hours * 3600)


# --- CLI ---------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    from holt_server.settings import get_settings

    p = argparse.ArgumentParser(prog="python -m holt_server.contributions",
                                description="My Contributions: the product metric.")
    sub = p.add_subparsers(dest="command", required=True)
    m = sub.add_parser("metric", help="pull requests opened after checking a repo on Holt")
    m.add_argument("--since", help="only pull requests opened on or after YYYY-MM-DD")
    m.add_argument("--json", action="store_true")
    sub.add_parser("stats", help="recount repository statistics from Holt users now")
    args = p.parse_args(argv)

    async def run() -> Metric | int:
        svc = Services(get_settings())
        try:
            if args.command == "stats":
                return await repo_stats.rebuild_all(svc)
            return await metric(svc, _since(args.since))
        finally:
            svc.http.close()
            await svc.db.dispose()

    result = asyncio.run(run())
    if isinstance(result, int):
        print(f"repositories with statistics: {result}")
        return 0
    if args.json:
        print(json.dumps(result.__dict__))
    else:
        for name, value in result.__dict__.items():
            print(f"{name.replace('_', ' ')}: {value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
