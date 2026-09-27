"""Free AI credits: a welcome grant, a weekly claim, a spend per AI report.

Every signed-in user gets `HOLT_SIGNUP_AI_CREDITS` once, the first time the
server sees them (users from before credits get theirs on their next visit).
After that they can claim one more whenever `HOLT_CLAIM_EVERY_DAYS` have
passed since the last claim; the welcome grant starts that clock. Claims do
not pile up while someone is away: there is only ever one to claim.

The balance is `users.ai_credits`, changed only by guarded `UPDATE`s, so two
requests racing each other can neither spend a credit twice nor claim twice.
Each change writes a `credit_events` row in the same transaction.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from holt_server.db import CreditEvent, Job, User, iso, now, utc
from holt_server.deps import Caller, caller, services, signed_in
from holt_server.errors import ApiError

if TYPE_CHECKING:
    from holt_server.services import Services

router = APIRouter(prefix="/v1/me/credits")


def claim_every(svc: Services) -> timedelta:
    return timedelta(days=svc.settings.claim_every_days)


def next_claim_at(svc: Services, user: User) -> datetime | None:
    last = utc(user.last_claim_at)
    return last + claim_every(svc) if last else None


def credits_body(svc: Services, user: User) -> dict[str, Any]:
    at = next_claim_at(svc, user)
    return {
        "balance": user.ai_credits or 0,
        "can_claim": at is not None and at <= now(),
        "next_claim_at": iso(at),
        "claim_every_days": svc.settings.claim_every_days,
        # False while the server has no model key: AI reports can't run at all.
        "ai_available": svc.server_model_available(),
    }


async def get_user(svc: Services, user_id: str) -> User:
    """The user row, created the first time `web/` sends this id, with the
    welcome credits given on that first visit."""
    async with svc.db.session() as s:
        user = await s.get(User, user_id)
        if user is None:
            s.add(User(id=user_id, plan="free"))
            try:
                await s.commit()
            except Exception:  # created concurrently by another request
                await s.rollback()
            user = await s.get(User, user_id)
    if user.credits_granted_at is None:
        await grant_welcome(svc, user_id)
        async with svc.db.session() as s:
            user = await s.get(User, user_id)
    return user


async def grant_welcome(svc: Services, user_id: str) -> None:
    """The one-off welcome credits. Safe to call on every request: the
    `credits_granted_at IS NULL` guard makes only the first call count."""
    amount = svc.settings.signup_ai_credits
    at = now()
    async with svc.db.session() as s:
        took = await s.execute(
            update(User).where(User.id == user_id, User.credits_granted_at.is_(None))
            .values(ai_credits=User.ai_credits + amount, credits_granted_at=at,
                    last_claim_at=at))
        if took.rowcount == 1:
            s.add(CreditEvent(user_id=user_id, kind="grant", amount=amount, created_at=at))
        await s.commit()


async def claim(svc: Services, user_id: str) -> None:
    at = now()
    async with svc.db.session() as s:
        took = await s.execute(
            update(User).where(User.id == user_id, User.last_claim_at.is_not(None),
                               User.last_claim_at <= at - claim_every(svc))
            .values(ai_credits=User.ai_credits + 1, last_claim_at=at))
        if took.rowcount != 1:
            await s.rollback()
            user = await s.get(User, user_id)
            when = next_claim_at(svc, user) if user else None
            raise ApiError(
                "claim_not_ready",
                f"Your next free AI report can be claimed on {when:%-d %B}."
                if when else "There's no free AI report to claim yet.",
            )
        s.add(CreditEvent(user_id=user_id, kind="claim", amount=1, created_at=at))
        await s.commit()


async def spend(s: AsyncSession, user_id: str, job: Job) -> None:
    """Take one credit for `job`, inside the caller's transaction (the job
    insert), so a lost dedupe race puts the credit back with the rollback."""
    took = await s.execute(
        update(User).where(User.id == user_id, User.ai_credits > 0)
        .values(ai_credits=User.ai_credits - 1))
    if took.rowcount != 1:
        await s.rollback()
        raise ApiError(
            "quota_exceeded",
            "You've used your free AI reports. You can claim another one in your "
            "settings once a week. The quick report is always free.",
        )
    s.add(CreditEvent(user_id=user_id, kind="spend", amount=-1, job_id=job.id))


async def refund(s: AsyncSession, job: Job) -> None:
    """Give back the credit a failed job spent, in the caller's transaction."""
    if not (job.charged and job.user_id and (job.params or {}).get("paid_with") == "credit"):
        return
    await s.execute(update(User).where(User.id == job.user_id)
                    .values(ai_credits=User.ai_credits + 1))
    s.add(CreditEvent(user_id=job.user_id, kind="refund", amount=1, job_id=job.id))


# --- routes -----------------------------------------------------------------------


@router.get("")
async def get_credits(request: Request, who: Caller = Depends(caller)) -> dict[str, Any]:
    svc = services(request)
    return credits_body(svc, await get_user(svc, signed_in(who)))


@router.post("/claim")
async def post_claim(request: Request, who: Caller = Depends(caller)) -> dict[str, Any]:
    svc = services(request)
    user_id = signed_in(who)
    await get_user(svc, user_id)
    await claim(svc, user_id)
    return credits_body(svc, await get_user(svc, user_id))
