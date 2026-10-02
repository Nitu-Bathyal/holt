"""Merging two Holt accounts: `POST /v1/me/merge` (API.md, "Merging accounts").

A person who signed in with GitHub once and with Google later has two
accounts. When they connect GitHub from the second, `web/` finds the GitHub
account is the first one's sign-in; once GitHub has confirmed it is theirs,
they can merge. Everything the first account (`src`) has moves into the one
they are signed in to (`dst`), in one transaction: all of it, or nothing.

`web/` decides who `src` is (the owner of the GitHub sign-in it just saw
proven) and moves the sign-in itself. Nothing here comes from user input.

What a merge does with each table:

- rows with their own id (orders, credit lots and the ledger, plan events,
  jobs, pre-flights, sent alert emails, old subscriptions) all change owner;
- lists (saved repos, viewed repos, pull requests and their choices, mutes,
  merge plans, playbooks, the sent-log of account emails, feedback) become
  the union, and where both accounts have the same thing `dst`'s stays;
- settings (profile, alert settings, account-mail settings) are `dst`'s;
  `src`'s only come along where `dst` has none;
- the account itself: the plan that runs longer, credit balances added up,
  and for anything free the more-used value (allowance counters, the alerts
  taste, the weekly claim clock), so a merge never hands a free thing back.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, exists, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from holt_server import account_mail, alerts, credits, pricing, repo_stats, schema
from holt_server.db import (
    AccountEmail,
    AccountMail,
    Alert,
    AlertEmail,
    AlertSettings,
    Contribution,
    ContributionChoice,
    ContributionSync,
    CreditEvent,
    CreditLot,
    Feedback,
    GitHubConnection,
    Job,
    MergePlan,
    Order,
    PlanEvent,
    PlanUsage,
    PlaybookUnlock,
    Preflight,
    Profile,
    RepoView,
    SavedRepo,
    Subscription,
    SubscriptionCharge,
    User,
    WatchMute,
    now,
    utc,
)
from holt_server.deps import Caller, caller, services, signed_in
from holt_server.errors import ApiError
from holt_server.services import Services

log = logging.getLogger("holt_server.account_merge")

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})


class MergeIn(BaseModel):
    from_user: str = Field(min_length=1, max_length=200)
    github_id: int = Field(gt=0, lt=2**53)


def refused() -> ApiError:
    return ApiError("invalid_request", "Those two accounts can't be merged.", status=409)


# One row per user and these columns (none: one row per user).
KEYED = (
    (SavedRepo, "repo_key"), (RepoView, "repo_key"), (ContributionChoice, "repo_key"),
    (Contribution, "repo_key", "number"), (WatchMute, "repo_key", "number"),
    (MergePlan, "repo_key"), (PlaybookUnlock, "repo_key"), (AccountEmail, "key"),
    (Profile,), (ContributionSync,), (GitHubConnection,),
)
# Rows with an id of their own.
OWNED = (CreditEvent, CreditLot, Order, PlanEvent, Job, AlertEmail, Preflight,
         SubscriptionCharge, Subscription)
# Alerts that fire once per pull request: their key has no time in it.
ONCE = frozenset({"late_reply", "late_merge"})

_QUIET = {"synchronize_session": False}


async def _give(s: AsyncSession, table, src: str, dst: str, **also) -> None:
    await s.execute(update(table).where(table.user_id == src).values(user_id=dst, **also)
                    .execution_options(**_QUIET))


async def _move(s: AsyncSession, table, src: str, dst: str, *keys: str) -> None:
    """Give `src`'s rows to `dst`. A row `dst` already has (the same `keys`;
    with none, any row at all) is dropped: the kept account's wins."""
    mine = aliased(table)
    held = exists().where(mine.user_id == dst,
                          *(getattr(mine, k) == getattr(table, k) for k in keys))
    await s.execute(delete(table).where(table.user_id == src, held).execution_options(**_QUIET))
    await _give(s, table, src, dst)


async def _feedback(s: AsyncSession, src: str, dst: str) -> None:
    """One answer per person per report: where both answered, `dst`'s stays."""
    mine = aliased(Feedback)
    held = exists().where(mine.voter == f"user:{dst}", mine.report_id == Feedback.report_id)
    await s.execute(delete(Feedback).where(Feedback.user_id == src, held)
                    .execution_options(**_QUIET))
    await _give(s, Feedback, src, dst, voter=f"user:{dst}")


async def _mail_settings(s: AsyncSession, svc: Services, src: str, dst: str) -> None:
    """Alert settings and account-mail settings. An unsubscribe token is made
    from the user id, so a row that changes owner gets a new one."""
    secret = svc.settings.secret_key
    for table, token in ((AlertSettings, alerts.unsubscribe_token),
                         (AccountMail, account_mail.unsubscribe_token)):
        if await s.get(table, dst) is not None:
            await s.execute(delete(table).where(table.user_id == src))
            continue
        nonce = alerts.new_nonce()
        await _give(s, table, src, dst, unsubscribe_nonce=nonce,
                    unsubscribe_hash=alerts.token_hash(token(secret, dst, nonce)))


async def _alerts(s: AsyncSession, src: str, dst: str) -> None:
    """Alerts change owner. An alert's key has the user id in it, and the
    waits (no reply yet, going stale) are found again on every read: those
    get `dst`'s key, so the next read doesn't tell them a second time. Run
    after the pull requests have moved."""
    quiet = {(key, number): at for key, number, at in await s.execute(
        select(Contribution.repo_key, Contribution.number, Contribution.last_activity_at)
        .where(Contribution.user_id == dst))}
    for row in (await s.execute(select(Alert).where(Alert.user_id == src))).scalars().all():
        # A warning that it is going stale is keyed by the last activity.
        at = None if row.kind in ONCE else utc(quiet.get((row.repo_key, row.number)))
        if row.kind in ONCE or (row.kind == "stale_soon" and at is not None):
            key = alerts.dedupe_key(dst, row, alerts.Found(row.kind, {}, at))
            if (await s.execute(select(Alert.id).where(Alert.dedupe_key == key))).first():
                await s.delete(row)
                continue
            row.dedupe_key = key
        row.user_id = dst


async def _usage(s: AsyncSession, src: str, dst: str) -> None:
    """Allowance counters: the more-used count per feature and period."""
    theirs = (await s.execute(select(PlanUsage).where(PlanUsage.user_id == src))).scalars()
    for row in theirs.all():
        mine = await s.get(PlanUsage, (dst, row.feature, row.period))
        if mine is None:
            s.add(PlanUsage(user_id=dst, feature=row.feature, period=row.period, used=row.used))
        else:
            mine.used = max(mine.used, row.used)
        await s.delete(row)


def _first(*times: datetime | None) -> datetime | None:
    return min((utc(t) for t in times if t is not None), default=None)


def _last(*times: datetime | None) -> datetime | None:
    return max((utc(t) for t in times if t is not None), default=None)


def _runs_until(user: User, at: datetime) -> datetime | None:
    """When a paid plan still running at `at` ends (`datetime.max`: it has no
    end), or None when there is none."""
    if not user.plan or user.plan == pricing.FREE:
        return None
    ends = utc(user.plan_expires_at) or datetime.max.replace(tzinfo=at.tzinfo)
    return ends if ends > at else None


async def _account(s: AsyncSession, src: str, dst: str, at: datetime) -> None:
    """The `users` rows: balances add up, the plan that runs longer stays,
    and nothing free starts over. Then `src`'s row goes."""
    old = await s.get(User, src)
    if old is None:
        return
    kept = await s.get(User, dst)
    theirs, mine = _runs_until(old, at), _runs_until(kept, at)
    if theirs is not None and (mine is None or theirs > mine):
        kept.plan, kept.plan_expires_at = old.plan, old.plan_expires_at
        s.add(PlanEvent(user_id=dst, plan=old.plan, expires_at=old.plan_expires_at,
                        reason="accounts merged", actor="merge", created_at=at))
    # With `src`'s ledger rows, `dst`'s still sum to its balance.
    kept.ai_credits = (kept.ai_credits or 0) + (old.ai_credits or 0)
    # The welcome was given once; the next weekly claim is no sooner than
    # either account's; the alerts taste that is further along is the one used.
    kept.credits_granted_at = _first(kept.credits_granted_at, old.credits_granted_at)
    kept.last_claim_at = _last(kept.last_claim_at, old.last_claim_at)
    kept.alerts_trial_ends_at = _first(kept.alerts_trial_ends_at, old.alerts_trial_ends_at)
    await s.delete(old)


async def _check(s: AsyncSession, src: str, dst: str, github_id: int) -> None:
    """The GitHub account `web/` saw proven is the only one either account may
    be connected to, and nobody else may be connected to it."""
    owner = (await s.execute(select(GitHubConnection.user_id).where(
        GitHubConnection.github_id == github_id))).scalar()
    if owner not in (None, src, dst):
        raise refused()
    for user in (src, dst):
        conn = await s.get(GitHubConnection, user)
        if conn is not None and conn.github_id != github_id:
            raise refused()


async def move(s: AsyncSession, svc: Services, src: str, dst: str, at: datetime) -> None:
    """Everything `src` has becomes `dst`'s. Caller commits."""
    counted = await repo_stats.user_repos(s, src) | await repo_stats.user_repos(s, dst)
    for table, *keys in KEYED:
        await _move(s, table, src, dst, *keys)
    await _alerts(s, src, dst)
    await _feedback(s, src, dst)
    await _mail_settings(s, svc, src, dst)
    await _usage(s, src, dst)
    await _account(s, src, dst, at)
    for table in OWNED:
        await _give(s, table, src, dst)
    await repo_stats.rebuild(s, counted)


@router.post("/me/merge", status_code=204, response_class=Response)
async def merge(data: MergeIn, request: Request, who: Caller = Depends(caller)) -> Response:
    """Merge `from_user` into the caller. Asked again after it worked, there
    is nothing left to move and nothing changes."""
    svc = services(request)
    dst, src = signed_in(who), data.from_user.strip()
    if src == dst:
        raise ApiError("invalid_request", "That is the account you're signed in to.")
    await credits.ensure_user(svc, dst)
    async with svc.db.session() as s:
        # Two merges into one account wait for each other here.
        await s.execute(select(User.id).where(User.id.in_((src, dst))).with_for_update())
        await _check(s, src, dst, data.github_id)
        try:
            await move(s, svc, src, dst, now())
            await s.commit()
        except IntegrityError as exc:
            await s.rollback()
            log.warning("merging accounts failed, nothing moved: %s", type(exc.orig).__name__)
            raise refused() from exc
    return Response(status_code=204)
