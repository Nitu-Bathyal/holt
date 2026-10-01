"""PR watch's checker: every half hour, look again at the open pull requests
of everyone who gets alerts, and store an alert for what changed (alerts.py).

One pass, for users with alerts on and access (a pass, or the free taste):

1. Anyone whose list is older than `DISCOVER_EVERY` is searched again
   (`contributions.fetch`), which finds new pull requests and makes that
   user's alerts on the way.
2. Everyone else's open, counted, unmuted pull requests are read by node ID,
   100 per query (`pr_state.read`, about 5 GraphQL points per 100), and each
   row is brought up to date.
3. The waits ("past what's normal here", "the bot closes soon") are worked
   out from the stored times and each repository's report. No GitHub read.

Everything is read as the Holt GitHub App, with the same points as reports.
A pass stops reading GitHub when points fall under `HOLT_WARM_MIN_POINTS`, so
a person's report always wins; step 3 still runs. It runs in the API process
every `HOLT_PR_WATCH_MINUTES` under a Postgres advisory lock, and only when
`HOLT_PR_WATCH=1`.

    python -m holt_server.watch        # one pass now
"""

from __future__ import annotations

import asyncio
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select, text

from holt_server import alerts, contributions, pr_state
from holt_server.db import (
    Alert,
    AlertSettings,
    Contribution,
    ContributionSync,
    GitHubConnection,
    User,
    now,
    utc,
)
from holt_server.errors import ApiError
from holt_server.services import Services

log = logging.getLogger("holt_server.watch")

LOCK_ID = 7_406_113
# A watching user's list is searched again this often, to find new pull requests.
DISCOVER_EVERY = timedelta(hours=6)
# The search step checks GitHub points every this many users.
BUDGET_EVERY = 10
READ_TIMEOUT_S = 20.0


@dataclass
class Pass:
    users: int = 0
    # Users whose list was searched again, and pull requests read by node ID.
    searched: int = 0
    read: int = 0
    alerts: int = 0
    # Why GitHub reads ended early: off | low_points | rate_limited | github.
    stopped: str | None = None


async def _due(svc: Services, at: datetime) -> list[tuple[str, str, datetime | None]]:
    """(user id, login, when their list was last fetched) of everyone who
    gets alerts now."""
    async with svc.db.session() as s:
        rows = (await s.execute(
            select(User, GitHubConnection.login, ContributionSync.fetched_at)
            .select_from(User)
            .join(AlertSettings, AlertSettings.user_id == User.id)
            .join(GitHubConnection, GitHubConnection.user_id == User.id)
            .outerjoin(ContributionSync, ContributionSync.user_id == User.id)
            .where(AlertSettings.enabled.is_(True)).order_by(User.id))).all()
    return [(user.id, login, utc(fetched)) for user, login, fetched in rows
            if alerts.access_for(svc, user, at).on]


async def watched(s, user_ids: list[str]) -> list[Contribution]:
    """The open pull requests PR watch covers for these users: counted
    (not a repository they left out, or their own project) and not muted."""
    out: list[Contribution] = []
    for user_id in user_ids:
        rows = (await s.execute(select(Contribution).where(
            Contribution.user_id == user_id, Contribution.state == "open")
            .order_by(Contribution.repo_key, Contribution.number))).scalars().all()
        if not rows:
            continue
        skip = await alerts.muted(s, user_id)
        left = await contributions.left_out(s, user_id, {r.repo_key for r in rows})
        out += [r for r in rows
                if (r.repo_key, r.number) not in skip and r.repo_key not in left]
    return out


async def _points_low(svc: Services, out: Pass) -> bool:
    left = await svc.lookup.remaining()
    if left < svc.settings.warm_min_points:
        log.info("pr watch: stopping GitHub reads, points left %d", left)
        out.stopped = "low_points"
        return True
    return False


def _read(svc: Services, ids: list[str]) -> dict[str, dict[str, Any]]:
    return pr_state.read(svc.pool.transport(svc.http), ids, READ_TIMEOUT_S)


def _values(node: dict[str, Any], opened: datetime) -> dict[str, Any]:
    """A row's new values from its `pr_state.STATE` node."""
    state = contributions._state(node)
    out: dict[str, Any] = {
        "state": state, "draft": bool(node.get("isDraft")),
        "closed_at": contributions._when(node.get("closedAt")),
        "merged_at": contributions._when(node.get("mergedAt"))}
    if state == "open":
        out.update(pr_state.derive(node, opened).__dict__)
    return out


async def _store(svc: Services, user_id: str, rows: list[Contribution],
                 nodes: dict[str, dict[str, Any]], at: datetime) -> int:
    """Bring one user's rows up to date and store the alerts that gives."""
    made = 0
    async with svc.db.session() as s:
        # The same lock a contributions fetch takes: the two never interleave.
        conn = (await s.execute(select(GitHubConnection).where(
            GitHubConnection.user_id == user_id).with_for_update())).scalar_one_or_none()
        if conn is None or not await alerts.watching(s, svc, user_id, at):
            return 0
        for seen in rows:
            row = await s.get(Contribution, (user_id, seen.repo_key, seen.number))
            node = nodes.get(seen.node_id or "")
            if row is None or row.state != "open" or row.node_id != seen.node_id or not node:
                continue
            old = alerts.Pr.of(row)
            for name, value in _values(node, utc(row.created_at)).items():
                setattr(row, name, value)
            new = alerts.Pr.of(row)
            made += await alerts.record(s, user_id, new, alerts.events(old, new), at)
        await s.commit()
    return made


async def _waits(svc: Services, user_ids: list[str], at: datetime) -> int:
    """The time-based alerts, from the stored rows and each repository's report."""
    made = 0
    async with svc.db.session() as s:
        rows = await watched(s, user_ids)
        known = await contributions.verdicts(s, {r.repo_key for r in rows})
        for row in rows:
            verdict = known.get(row.repo_key)
            pr = alerts.Pr.of(row)
            found = alerts.overdue(pr, verdict.timing if verdict else None, at)
            if found:
                made += await alerts.record(s, row.user_id, pr, found, at)
        await alerts.prune(s, at)
        await s.commit()
    return made


async def check(svc: Services, at: datetime | None = None) -> Pass:
    """One pass over everyone who gets alerts."""
    out = Pass()
    if not svc.settings.pr_watch:
        out.stopped = "off"
        return out
    at = at or now()
    users = await _due(svc, at)
    out.users = len(users)
    if not users:
        return out
    async with svc.db.session() as s:
        last = (await s.execute(select(func.max(Alert.id)))).scalar() or 0

    searched: set[str] = set()
    stale = [(u, login) for u, login, fetched in users
             if fetched is None or fetched < at - DISCOVER_EVERY]
    for i, (user_id, login) in enumerate(stale):
        if i % BUDGET_EVERY == 0 and await _points_low(svc, out):
            break
        try:
            await contributions.fetch(svc, user_id, login)
            searched.add(user_id)
        except ApiError as err:
            log.warning("pr watch: searching a user's pull requests failed (%s)", err.code)
            if err.code == "rate_limited":
                out.stopped = "rate_limited"
                break
    out.searched = len(searched)

    if out.stopped is None:
        async with svc.db.session() as s:
            rows = [r for r in await watched(s, [u for u, _, _ in users if u not in searched])
                    if r.node_id]
        for i in range(0, len(rows), pr_state.BATCH):
            batch = rows[i:i + pr_state.BATCH]
            if await _points_low(svc, out):
                break
            try:
                nodes = await asyncio.to_thread(_read, svc, [r.node_id for r in batch])
            except Exception as exc:  # noqa: BLE001
                log.warning("pr watch: reading pull requests failed: %s",
                            getattr(exc, "code", type(exc).__name__))
                out.stopped = "github"
                break
            out.read += len(batch)
            by_user: dict[str, list[Contribution]] = {}
            for r in batch:
                by_user.setdefault(r.user_id, []).append(r)
            for user_id, mine in by_user.items():
                await _store(svc, user_id, mine, nodes, at)

    await _waits(svc, [u for u, _, _ in users], at)
    async with svc.db.session() as s:
        out.alerts = (await s.execute(select(func.count()).select_from(Alert)
                                      .where(Alert.id > last))).scalar_one()
    return out


async def check_once(svc: Services) -> Pass | None:
    """One pass; on Postgres only one process runs it (None if another does)."""
    if svc.db.engine.dialect.name != "postgresql":
        return await check(svc)
    async with svc.db.engine.connect() as conn:
        if not (await conn.execute(text("SELECT pg_try_advisory_lock(:id)"),
                                   {"id": LOCK_ID})).scalar():
            return None
        try:
            return await check(svc)
        finally:
            await conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})


async def schedule(svc: Services, first_delay_s: float = 120.0) -> None:
    """Every HOLT_PR_WATCH_MINUTES, in the API process, until cancelled."""
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            got = await check_once(svc)
            if got is not None:
                log.info("pr watch: %d users, %d searched, %d pull requests read, %d alerts%s",
                         got.users, got.searched, got.read, got.alerts,
                         f" (stopped: {got.stopped})" if got.stopped else "")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 -- try again next time
            log.exception("the pr watch pass failed")
        await asyncio.sleep(svc.settings.pr_watch_minutes * 60)


def main() -> int:
    from holt_server.settings import get_settings

    logging.basicConfig(level="INFO")

    async def go() -> Pass | None:
        svc = Services(get_settings())
        try:
            return await check_once(svc)
        finally:
            svc.http.close()
            await svc.db.dispose()

    got = asyncio.run(go())
    if got is None:
        print("another process is checking")
    elif got.stopped == "off":
        print("PR watch is off (HOLT_PR_WATCH isn't 1)")
    else:
        print(f"users {got.users}, searched {got.searched}, pull requests read {got.read}, "
              f"alerts {got.alerts}" + (f", stopped: {got.stopped}" if got.stopped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
