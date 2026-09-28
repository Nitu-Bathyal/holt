"""Repository statistics from Holt users: what connected users' public pull
requests to a repository came to, shown on its report page.

Counted from `contributions` (My Contributions) of connected users who didn't
turn on "Don't include me in statistics". Only counts are kept, never who, and
a repository gets a row only when at least `MIN_PEOPLE` different people make
up its numbers: one person with many pull requests is still one person.
Nobody is ranked.

The rows are a cache (`repo_user_stats`), rebuilt by the daily contributions
refresh. Opting out or disconnecting rebuilds that user's repositories in the
same transaction, so they drop out of every number at once. Rebuilds take one
Postgres advisory lock, so a daily rebuild that read before an opt-out cannot
write its numbers after the opt-out's own rebuild.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import case, delete, func, select, text

from holt_server import repos, schema
from holt_server.db import Contribution, GitHubConnection, RepoUserStats, iso, now
from holt_server.services import Services

MIN_PEOPLE = 5
LOCK_ID = 7_406_113


async def rebuild(s, repo_keys: Iterable[str] | None = None) -> int:
    """Recount `repo_keys` (every repository when None) in session `s`.
    Caller commits. Returns how many repositories now have numbers."""
    keys = None if repo_keys is None else set(repo_keys)
    if keys is not None and not keys:
        return 0
    if s.bind.dialect.name == "postgresql":
        await s.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": LOCK_ID})
    only = [] if keys is None else [Contribution.repo_key.in_(keys)]
    people = func.count(func.distinct(Contribution.user_id))
    got = (await s.execute(
        select(Contribution.repo_key, people, func.count(),
               func.sum(case((Contribution.state == "merged", 1), else_=0)),
               func.sum(case((Contribution.state == "closed", 1), else_=0)),
               func.sum(case((Contribution.state == "open", 1), else_=0)))
        .join(GitHubConnection, GitHubConnection.user_id == Contribution.user_id)
        .where(GitHubConnection.stats_opt_out.is_(False), *only)
        .group_by(Contribution.repo_key)
        .having(people >= MIN_PEOPLE))).all()
    await s.execute(delete(RepoUserStats).where(*(
        [] if keys is None else [RepoUserStats.repo_key.in_(keys)])))
    at = now()
    s.add_all(RepoUserStats(repo_key=key, people=n, pull_requests=total, merged=merged,
                            closed=closed, waiting=waiting, computed_at=at)
              for key, n, total, merged, closed, waiting in got)
    await s.flush()
    return len(got)


async def rebuild_all(svc: Services) -> int:
    async with svc.db.session() as s:
        n = await rebuild(s)
        await s.commit()
    return n


async def user_repos(s, user_id: str) -> set[str]:
    """The repositories a user's stored pull requests went to."""
    return set((await s.execute(select(Contribution.repo_key).distinct()
                                .where(Contribution.user_id == user_id))).scalars())


async def for_repo(svc: Services, repo: str) -> schema.HoltUsers | None:
    """The numbers for a report page, or None below the threshold."""
    from holt_server.contributions import WINDOW_DAYS

    async with svc.db.session() as s:
        row = await s.get(RepoUserStats, repos.key(repo))
    if row is None or row.people < MIN_PEOPLE:
        return None
    return schema.HoltUsers(people=row.people, pull_requests=row.pull_requests,
                            merged=row.merged, closed=row.closed, waiting=row.waiting,
                            window_days=WINDOW_DAYS, computed_at=iso(row.computed_at))
