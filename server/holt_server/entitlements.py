"""Entitlements: can this user use this feature now, and what does it cost?

`check` answers without changing anything; `charge` answers and pays, inside
the caller's transaction, so a use is paid for exactly when the work it pays
for is recorded. Every paid route goes through `charge` (and the job runner
through `refund_job` when that work fails). Nothing is ever taken from the
client's word: the plan, the allowance and the balances are all read here.

The order, per feature (the catalogue is pricing.py):

1. The user's plan (lapsed back to free at `plan_expires_at`) covers it:
   unlimited, or a monthly allowance with uses left this UTC month. Free.
2. Otherwise it costs the feature's `credits`: free credits first when the
   feature takes them, then purchased ones (credits.py).
3. A feature with no credit price needs a plan that covers it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import select, update
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession

from holt_server import credits, pricing
from holt_server.db import Job, PlanEvent, PlanUsage, User, now, utc
from holt_server.errors import ApiError

if TYPE_CHECKING:
    from holt_server.services import Services

log = logging.getLogger("holt_server.entitlements")


def catalogue(svc: Services) -> pricing.Catalogue:
    return pricing.cached(svc.settings.pricing_file)


def period(at: datetime) -> str:
    return f"{at:%Y-%m}"


def effective_plan(cat: pricing.Catalogue, user: User | None,
                   at: datetime | None = None) -> str:
    """The plan in force: free when none is set, it has lapsed, or the
    catalogue no longer has it."""
    if user is None or not user.plan or user.plan == pricing.FREE:
        return pricing.FREE
    expires = utc(user.plan_expires_at)
    if expires is not None and expires <= (at or now()):
        return pricing.FREE
    if user.plan not in cat.plans:
        log.warning("user %s is on plan %r, which the pricing file doesn't have; "
                    "treating it as free", user.id, user.plan)
        return pricing.FREE
    return user.plan


@dataclass(frozen=True)
class Access:
    feature: str
    name: str
    allowed: bool
    # How a use would be paid for now: the plan, or credits. None when not allowed.
    via: Literal["plan", "credits"] | None
    # Credits one use takes now (0 when the plan covers it). When not allowed,
    # the price it would take (0 when credits can't pay for it at all).
    cost: int
    # Uses of the plan's monthly allowance left; None when unlimited or none.
    left_this_month: int | None
    # When not allowed: the error code and the message a person reads.
    code: str | None = None
    message: str | None = None

    def error(self) -> ApiError:
        return ApiError(self.code or "quota_exceeded", self.message or "")


def refusal(feature: str, spec: pricing.Feature, allowance: pricing.PlanFeature | None,
            ) -> tuple[str, str]:
    """(code, message) for a use that can't be paid for."""
    if spec.credits is None:
        if allowance is not None:
            return ("quota_exceeded", f"You've used this month's {spec.name.lower()} "
                    "allowance on your plan. It resets on the 1st.")
        return "needs_plan", f"{spec.name} comes with a paid plan."
    if feature == "ai_report":
        return ("quota_exceeded", "You've used your free AI reports. You can claim another "
                "one in your settings once a week. The quick report is always free.")
    each = "1 credit" if spec.credits == 1 else f"{spec.credits} credits"
    if not spec.free_credits:
        return ("quota_exceeded", f"{spec.name} costs {each}, and free credits can't be "
                "used for it. You don't have enough purchased credits.")
    return "quota_exceeded", f"{spec.name} costs {each}, and you don't have enough credits."


async def _used(s: AsyncSession, user_id: str, feature: str, at: datetime) -> int:
    got = (await s.execute(select(PlanUsage.used).where(
        PlanUsage.user_id == user_id, PlanUsage.feature == feature,
        PlanUsage.period == period(at)))).scalar()
    return got or 0


async def check(svc: Services, user_id: str, feature: str) -> Access:
    """Whether `user_id` can use `feature` now and how it would be paid for.
    Changes nothing; `charge` decides for real."""
    cat = catalogue(svc)
    spec = cat.features[feature]
    at = now()
    async with svc.db.session() as s:
        user = await s.get(User, user_id)
        plan = cat.plans[effective_plan(cat, user, at)]
        allowance = plan.features.get(feature)
        left = None
        if allowance is not None:
            if allowance.unlimited:
                return Access(feature, spec.name, True, "plan", 0, None)
            left = max(allowance.per_month - await _used(s, user_id, feature, at), 0)
            if left > 0:
                return Access(feature, spec.name, True, "plan", 0, left)
        if spec.credits is not None:
            have = await credits.balances(s, user_id, at)
            usable = have.total if spec.free_credits else have.purchased
            if usable >= spec.credits:
                return Access(feature, spec.name, True, "credits", spec.credits, left)
    code, message = refusal(feature, spec, allowance)
    return Access(feature, spec.name, False, None, spec.credits or 0, left, code, message)


def _insert(s: AsyncSession):
    return (postgresql.insert if s.bind.dialect.name == "postgresql" else sqlite.insert)


async def charge(s: AsyncSession, svc: Services, user_id: str, feature: str, *,
                 job_id: str | None = None) -> dict[str, Any]:
    """Pay for one use of `feature`, in the caller's transaction: it commits
    with the caller's work or rolls back with it. Returns what was taken
    (keep it for `refund`). Rolls back and raises the refusal when it can't
    be paid for."""
    cat = catalogue(svc)
    spec = cat.features[feature]
    at = now()
    user = (await s.execute(select(User).where(User.id == user_id))).scalar()
    plan_name = effective_plan(cat, user, at)
    allowance = cat.plans[plan_name].features.get(feature)
    if allowance is not None:
        if allowance.unlimited:
            return {"feature": feature, "via": "plan", "plan": plan_name}
        month = period(at)
        await s.execute(_insert(s)(PlanUsage).values(
            user_id=user_id, feature=feature, period=month, used=0).on_conflict_do_nothing())
        took = await s.execute(
            update(PlanUsage).where(PlanUsage.user_id == user_id, PlanUsage.feature == feature,
                                    PlanUsage.period == month,
                                    PlanUsage.used < allowance.per_month)
            .values(used=PlanUsage.used + 1))
        if took.rowcount == 1:
            return {"feature": feature, "via": "plan", "plan": plan_name, "period": month}
    if spec.credits is not None:
        draws = await credits.take(s, user_id, spec.credits, allow_free=spec.free_credits,
                                   feature=feature, job_id=job_id)
        if draws is not None:
            return {"feature": feature, "via": "credits", "draws": draws}
    await s.rollback()
    code, message = refusal(feature, spec, allowance)
    raise ApiError(code, message)


async def refund(s: AsyncSession, user_id: str, paid: dict[str, Any],
                 job_id: str | None = None) -> None:
    """Undo a `charge`, in the caller's transaction."""
    feature = paid.get("feature")
    if paid.get("via") == "credits":
        await credits.give_back(s, user_id, paid.get("draws") or [], feature=feature,
                                job_id=job_id)
    elif paid.get("via") == "plan" and paid.get("period"):
        await s.execute(
            update(PlanUsage).where(PlanUsage.user_id == user_id, PlanUsage.feature == feature,
                                    PlanUsage.period == paid["period"], PlanUsage.used > 0)
            .values(used=PlanUsage.used - 1))


async def refund_job(s: AsyncSession, job: Job) -> None:
    """Give back what a failed job was charged, in the transaction that marks
    it failed (which happens once)."""
    if not (job.charged and job.user_id):
        return
    params = job.params or {}
    if "charge" in params:
        await refund(s, job.user_id, params["charge"], job.id)
    elif params.get("paid_with") == "credit":
        # Queued by the release before entitlements: one free AI-report credit.
        await refund(s, job.user_id, {"feature": "ai_report", "via": "credits", "draws": [
            {"source": "free", "lot": None, "amount": 1}]}, job.id)


async def set_plan(svc: Services, user_id: str, plan: str, *, expires_at: datetime | None,
                   reason: str, actor: str, reference: str | None = None) -> None:
    """Put a user on `plan` until `expires_at` (None: until changed). For the
    admin CLI; the subscription code uses `write_plan` inside its own
    transaction."""
    _check_plan(svc, plan, reason)
    await credits.ensure_user(svc, user_id)
    async with svc.db.session() as s:
        await write_plan(s, svc, user_id, plan, expires_at=expires_at, reason=reason,
                         actor=actor, reference=reference)
        await s.commit()


async def write_plan(s: AsyncSession, svc: Services, user_id: str, plan: str, *,
                     expires_at: datetime | None, reason: str, actor: str,
                     reference: str | None = None) -> None:
    """`set_plan` in the caller's transaction (the user row must exist): the
    plan change and its `PlanEvent` commit with the caller's work."""
    _check_plan(svc, plan, reason)
    if plan == pricing.FREE:
        expires_at = None
    await s.execute(update(User).where(User.id == user_id)
                    .values(plan=plan, plan_expires_at=expires_at))
    s.add(PlanEvent(user_id=user_id, plan=plan, expires_at=expires_at, reason=reason,
                    actor=actor, reference=reference, created_at=now()))


def _check_plan(svc: Services, plan: str, reason: str) -> None:
    cat = catalogue(svc)
    if plan not in cat.plans:
        raise ValueError(f"no plan {plan!r} in the pricing file (have {sorted(cat.plans)})")
    if not reason.strip():
        raise ValueError("say why (--reason)")
