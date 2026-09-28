"""Monthly plans: Razorpay subscriptions, INR (API.md, "Plans (subscriptions)").

Off by default, and switched separately from credit packs: a plan is offered
and a subscription started only when `HOLT_SUBSCRIPTIONS_ENABLED=1`, the
Razorpay keys are set, and the plan is on sale in pricing.json with an INR
price and a `razorpay_plan_id` (a plan made in the Razorpay dashboard for the
same price). The price comes from that file, and is checked against the
Razorpay plan before anyone is asked to pay.

The flow:

1. `POST /v1/me/subscription {"plan"}` creates a Razorpay subscription and a
   `subscriptions` row, and returns what Razorpay Checkout needs.
2. The subscriber pays the first month in Checkout (it also sets up the
   mandate for the next ones). Checkout hands the page `razorpay_payment_id`,
   `razorpay_subscription_id` and `razorpay_signature`, which `web/` passes
   to `POST /v1/me/subscription/confirm`.
3. Razorpay sends webhooks for the rest of the subscription's life
   (`subscription.activated`, `.charged` every month, `.pending` when a
   renewal fails and it retries, `.halted` when the retries give up,
   `.cancelled`, `.completed`, ...), which arrive on the same route as the
   credit-pack ones (payments.py).

Nothing changes on the browser's word. Confirm checks the checkout signature
(HMAC-SHA256 of `payment_id|subscription_id` with the key secret; the reverse
of an order's) and then asks Razorpay for the subscription and the payment.
Webhooks are checked by payments.py (HMAC of the raw body).

What each event does to the plan (entitlements.write_plan, reference = the
Razorpay subscription id, so `plan_events` says which subscription gave it):

- activated / charged: the plan runs to the end of the period Razorpay says
  was paid for, plus `HOLT_SUBSCRIPTION_GRACE_DAYS`, so a renewal that fails
  and is retried doesn't cut anyone off. Each payment is one
  `subscription_charges` row (unique payment id): a replayed charge adds
  nothing, and a period never moves backwards.
- pending: nothing changes; the grace period is already in the expiry.
- halted / paused: the plan ends now.
- cancelled / completed: the plan runs to the end of the period paid for
  (no grace), or ends now if that has passed.

Events arrive late, twice and out of order. One about an older billing period
than the row holds is ignored; a cancelled, completed or expired subscription
never comes back. Only the subscription that gave the user their current plan
can take it away, so an admin grant is never undone by a webhook.

With the switch off, confirm, the webhook and cancel still work for
subscriptions that already exist: people who pay keep what they paid for, and
anyone can stop paying.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from holt_server import credits, entitlements, pricing, schema
from holt_server.db import PlanEvent, Subscription, SubscriptionCharge, User, iso, now, utc
from holt_server.deps import Caller, caller, internal, services, signed_in
from holt_server.errors import ApiError, upstream
from holt_server.payments import CURRENCY, MIN_AMOUNT, PAYMENT_ID, call

if TYPE_CHECKING:
    from holt_server.services import Services

log = logging.getLogger("holt_server.subscriptions")

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})

SUBSCRIPTION_ID = re.compile(r"^sub_[A-Za-z0-9]{1,40}$")
# Monthly charges a subscription runs for before Razorpay completes it (five
# years); subscribing again after that starts a new one.
BILLING_CYCLES = 60

LIVE = ("created", "authenticated", "active", "pending")
FINAL = {"cancelled", "completed", "expired"}
# Events about a subscription still going. One carrying an older billing period
# than the row holds was delivered late and changes nothing.
ONGOING = {"authenticated", "activated", "charged", "pending", "halted", "paused", "resumed"}
EVENTS = {f"subscription.{k}" for k in ONGOING | FINAL}

OFF = "Paid plans aren't on sale yet. Everything free in Holt keeps working."
UNCONFIRMED = ("We couldn't confirm that payment. If money left your account, your plan "
               "will start in a few minutes, or the payment will be refunded.")


# --- what is on sale -------------------------------------------------------------------


def subscriptions_on(svc: Services) -> bool:
    return svc.settings.subscriptions_enabled and svc.razorpay is not None


def price(plan: pricing.Plan) -> int | None:
    """The plan's monthly INR price when it can be subscribed to, else None."""
    amount = plan.price.inr_paise
    if not (plan.on_sale and plan.razorpay_plan_id) or amount is None or amount < MIN_AMOUNT:
        return None
    return amount


def plan_offer(cat: pricing.Catalogue, pid: str, plan: pricing.Plan,
               amount: int) -> schema.PlanOffer:
    return schema.PlanOffer(
        id=pid, name=plan.name, amount=amount, currency=CURRENCY,
        features=[schema.PlanOfferFeature(id=f, name=cat.features[f].name,
                                          per_month=a.per_month, unlimited=a.unlimited)
                  for f, a in plan.features.items()])


def plans_body(svc: Services) -> schema.Plans:
    if not subscriptions_on(svc):
        return schema.Plans(on_sale=False, plans=[])
    cat = entitlements.catalogue(svc)
    out = [plan_offer(cat, pid, p, amount) for pid, p in cat.plans.items()
           if pid != pricing.FREE and (amount := price(p)) is not None]
    return schema.Plans(on_sale=bool(out), plans=out)


def plan_name(svc: Services, plan_id: str) -> str:
    plan = entitlements.catalogue(svc).plans.get(plan_id)
    return plan.name if plan else plan_id.capitalize()


def subscription_body(svc: Services, sub: Subscription) -> schema.SubscriptionInfo:
    going = sub.status in ("authenticated", "active", "pending") and not sub.cancel_at_period_end
    return schema.SubscriptionInfo(
        id=sub.id, plan=sub.plan_id, name=plan_name(svc, sub.plan_id), status=sub.status,
        amount=sub.amount, currency=sub.currency, paid_until=iso(sub.current_end),
        next_charge_at=iso(sub.charge_at) if going else None,
        cancel_at_period_end=sub.cancel_at_period_end, created_at=iso(sub.created_at),
        ended_at=iso(sub.ended_at))


def charge_body(c: SubscriptionCharge) -> schema.SubscriptionChargeInfo:
    return schema.SubscriptionChargeInfo(
        id=c.provider_payment_id, amount=c.amount, currency=c.currency,
        period_start=iso(c.period_start), period_end=iso(c.period_end), status=c.status,
        paid_at=iso(c.created_at))


# --- Razorpay's entities -------------------------------------------------------------------


def when(value: Any) -> datetime | None:
    """A Razorpay timestamp (unix seconds) as UTC, or None."""
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return datetime.fromtimestamp(value, UTC)


def later(a: datetime | None, b: datetime | None) -> datetime | None:
    if a is None or b is None:
        return utc(a) or utc(b)
    return max(utc(a), utc(b))


def stale(sub: Subscription, kind: str, entity: dict[str, Any], new_payment: bool) -> bool:
    """An event about an older period than the row holds, or one that would
    revive a halted or paused subscription without a new payment."""
    if kind not in ONGOING:
        return False
    if sub.status in ("halted", "paused") and kind in ("activated", "pending") \
            and not new_payment:
        return True
    new, old = when(entity.get("current_end")), utc(sub.current_end)
    return new is not None and old is not None and new < old


# --- applying what Razorpay says -----------------------------------------------------------


async def gave_plan(s: AsyncSession, sub: Subscription) -> bool:
    """Whether this subscription is what put the user on their current plan."""
    ref = (await s.execute(select(PlanEvent.reference).where(PlanEvent.user_id == sub.user_id)
                            .order_by(PlanEvent.id.desc()).limit(1))).scalar()
    return ref == sub.provider_subscription_id


async def grant(s: AsyncSession, svc: Services, sub: Subscription, user: User,
                why: str) -> bool:
    """Give the plan until the end of the paid period plus the grace period.
    Never shortens what this subscription gave, never overrides a grant with
    no end, never shortens a later expiry from elsewhere."""
    if sub.current_end is None or sub.plan_id not in entitlements.catalogue(svc).plans:
        return False
    until = utc(sub.current_end) + timedelta(days=svc.settings.subscription_grace_days)
    if sub.granted_until is not None and until <= utc(sub.granted_until):
        return False
    sub.granted_until = until
    ours = await gave_plan(s, sub)
    if user.plan != pricing.FREE and user.plan_expires_at is None and not ours:
        log.warning("user %s has plan %r with no end, not from %s; left alone", user.id,
                    user.plan, sub.provider_subscription_id)
        return False
    if user.plan == sub.plan_id and not ours:
        until = later(until, user.plan_expires_at)
    await entitlements.write_plan(
        s, svc, user.id, sub.plan_id, expires_at=until,
        reason=f"subscription {why}: paid through {utc(sub.current_end):%Y-%m-%d}",
        actor="razorpay", reference=sub.provider_subscription_id)
    return True


async def end_plan(s: AsyncSession, svc: Services, sub: Subscription, why: str, *,
                   at: datetime | None) -> None:
    """End the plan this subscription gave: at `at` if that is still ahead,
    else now. A plan that came from somewhere else is left alone."""
    if not await gave_plan(s, sub):
        return
    at = utc(at)
    user = await s.get(User, sub.user_id)
    if at is not None and at > now():
        if user.plan_expires_at is not None and utc(user.plan_expires_at) <= at:
            return
        await entitlements.write_plan(s, svc, sub.user_id, sub.plan_id, expires_at=at,
                                      reason=f"subscription {why}: ends with the paid period",
                                      actor="razorpay", reference=sub.provider_subscription_id)
    elif user.plan != pricing.FREE:
        await entitlements.write_plan(s, svc, sub.user_id, pricing.FREE, expires_at=None,
                                      reason=f"subscription {why}", actor="razorpay",
                                      reference=sub.provider_subscription_id)
    sub.granted_until = at if at is not None and at > now() else now()


async def record_charge(s: AsyncSession, sub: Subscription, payment: dict[str, Any],
                        entity: dict[str, Any]) -> str:
    """One payment for this subscription: `new`, `seen` (already recorded) or
    `held` (the amount doesn't match: recorded, nothing given)."""
    pid = str(payment.get("id") or "")
    seen = (await s.execute(select(SubscriptionCharge.id).where(
        SubscriptionCharge.provider_payment_id == pid))).scalar()
    if seen is not None:
        return "seen"
    amount, currency = payment.get("amount"), str(payment.get("currency") or "").upper()
    ok = amount == sub.amount and currency == sub.currency
    s.add(SubscriptionCharge(
        subscription_id=sub.id, user_id=sub.user_id, provider_payment_id=pid,
        amount=amount if isinstance(amount, int) else 0, currency=currency[:3],
        period_start=when(entity.get("current_start")), period_end=when(entity.get("current_end")),
        status="paid" if ok else "held", created_at=now()))
    await s.flush()
    if not ok:
        sub.note = (f"payment {pid} was {amount} {currency}; the plan is "
                    f"{sub.amount} {sub.currency}")
        log.error("subscription %s held: %s", sub.provider_subscription_id, sub.note)
        return "held"
    return "new"


async def apply(svc: Services, kind: str, entity: dict[str, Any],
                payment: dict[str, Any] | None = None) -> str:
    """Apply one thing Razorpay vouched for: an event kind (`charged`,
    `halted`, ...), the subscription entity it came with, and the payment for
    a charge. Safe to repeat and to reorder. Returns what happened, for the
    log and the tests."""
    rid = str(entity.get("id") or "")
    if not SUBSCRIPTION_ID.match(rid):
        return "ignored"
    if payment is not None and not (PAYMENT_ID.match(str(payment.get("id") or ""))
                                    and payment.get("status") == "captured"):
        payment = None
    async with svc.db.session() as s:
        try:
            result = await _apply(s, svc, kind, rid, entity, payment)
            await s.commit()
        except IntegrityError:
            # The same payment, recorded a moment ago by the other path.
            await s.rollback()
            return "already_charged"
    return result


async def _apply(s: AsyncSession, svc: Services, kind: str, rid: str, entity: dict[str, Any],
                 payment: dict[str, Any] | None) -> str:
    sub = (await s.execute(select(Subscription).where(
        Subscription.provider_subscription_id == rid).with_for_update())).scalar_one_or_none()
    if sub is None:
        return "unknown_subscription"
    user = await s.get(User, sub.user_id)
    at = now()
    charge = None
    if kind == "charged":
        if payment is None:
            return "ignored"
        charge = await record_charge(s, sub, payment, entity)
        if charge == "seen":
            return "already_charged"
        if charge == "held":
            sub.updated_at = at
            return "held"
    if stale(sub, kind, entity, new_payment=charge == "new"):
        log.info("stale subscription.%s for %s ignored", kind, rid)
        return "stale"
    if sub.status in FINAL and kind not in FINAL:
        # Over: a late event, or a trailing charge, gives nothing back.
        if charge == "new":
            log.error("subscription %s charged after it ended: refund payment %s", rid,
                      payment.get("id"))
        return "ended"
    charge_at = when(entity.get("charge_at"))
    if charge_at is not None:
        sub.charge_at = charge_at
    result = kind
    if kind in ("activated", "charged", "resumed"):
        sub.status = "active"
        sub.current_start = later(sub.current_start, when(entity.get("current_start")))
        sub.current_end = later(sub.current_end, when(entity.get("current_end")))
        if not await grant(s, svc, sub, user, kind) and kind != "charged":
            result = "unchanged"
    elif kind == "authenticated":
        if sub.status == "created":
            sub.status = "authenticated"
    elif kind == "pending":
        # A renewal failed and Razorpay is retrying: the plan runs on through
        # the grace period already in its expiry.
        sub.status = "pending"
    elif kind in ("halted", "paused"):
        sub.status = kind
        await end_plan(s, svc, sub, kind, at=None)
    elif kind in FINAL:
        if sub.status in FINAL:
            return "already_ended"
        sub.status = kind
        sub.ended_at = when(entity.get("ended_at")) or at
        await end_plan(s, svc, sub, kind, at=None if kind == "expired" else sub.current_end)
    else:
        return "ignored"
    sub.updated_at = at
    return result


async def by_provider_id(svc: Services, rid: str) -> Subscription | None:
    async with svc.db.session() as s:
        return (await s.execute(select(Subscription).where(
            Subscription.provider_subscription_id == rid))).scalar_one_or_none()


async def live(svc: Services, user_id: str) -> Subscription | None:
    async with svc.db.session() as s:
        return (await s.execute(select(Subscription).where(
            Subscription.user_id == user_id, Subscription.status.in_(LIVE)))).scalar_one_or_none()


async def close_locally(svc: Services, sub_id: str, status: str, note: str) -> None:
    async with svc.db.session() as s:
        row = await s.get(Subscription, sub_id)
        if row is not None and row.status not in FINAL:
            row.status, row.note, row.ended_at, row.updated_at = status, note, now(), now()
            await s.commit()


async def cancel_remote(svc: Services, rid: str, *, at_cycle_end: bool) -> dict | None:
    """Ask Razorpay to cancel; None (logged) if it refused or is down."""
    try:
        return await call(svc.razorpay.cancel_subscription, rid, at_cycle_end=at_cycle_end)
    except ApiError:
        return None


async def webhook_event(svc: Services, event: str, data: dict[str, Any]) -> str:
    """A signed `subscription.*` webhook (payments.razorpay_webhook)."""
    payload = data.get("payload") or {}
    entity = (payload.get("subscription") or {}).get("entity")
    payment = (payload.get("payment") or {}).get("entity")
    if not isinstance(entity, dict):
        return "ignored"
    return await apply(svc, event.removeprefix("subscription."), entity,
                       payment if isinstance(payment, dict) else None)


# --- routes ----------------------------------------------------------------------------


class SubscribeIn(BaseModel):
    plan: str = Field(min_length=1, max_length=40)


class ConfirmIn(BaseModel):
    """What Razorpay Checkout hands the page on success, passed on unchanged."""

    razorpay_payment_id: str = Field(max_length=60)
    razorpay_subscription_id: str = Field(max_length=60)
    razorpay_signature: str = Field(max_length=200)


@router.get("/plans", dependencies=[Depends(internal)])
async def get_plans(request: Request) -> schema.Plans:
    return plans_body(services(request))


def checkout_body(svc: Services, sub: Subscription) -> schema.SubscriptionCheckout:
    return schema.SubscriptionCheckout(
        subscription_id=sub.id, provider="razorpay", key_id=svc.razorpay.key_id,
        provider_subscription_id=sub.provider_subscription_id, plan=sub.plan_id, name="Holt",
        description=f"{plan_name(svc, sub.plan_id)}, monthly", amount=sub.amount,
        currency=sub.currency)


@router.post("/me/subscription")
async def subscribe(body: SubscribeIn, request: Request,
                    who: Caller = Depends(caller)) -> schema.SubscriptionCheckout:
    svc = services(request)
    user_id = signed_in(who)
    if not subscriptions_on(svc):
        raise ApiError("payments_off", OFF)
    plan = entitlements.catalogue(svc).plans.get(body.plan)
    amount = price(plan) if plan and body.plan != pricing.FREE else None
    if plan is None or amount is None:
        raise ApiError("invalid_request", "That plan isn't on sale.")
    svc.limiter.hit(who.rate_key, who.limit(svc))
    await credits.ensure_user(svc, user_id)
    rz = svc.razorpay

    current = await live(svc, user_id)
    if current is not None and current.status != "created":
        raise ApiError("already_subscribed", "You already have a plan. You can manage it in "
                       "your settings.")
    if current is not None:
        if current.plan_id == body.plan and current.amount == amount:
            # Checkout was opened and closed: open the same subscription again.
            return checkout_body(svc, current)
        await cancel_remote(svc, current.provider_subscription_id, at_cycle_end=False)
        await close_locally(svc, current.id, "cancelled", "replaced before it was paid")
    # A halted or paused one could still be paid later and come back to life
    # next to the new one: end it at Razorpay first.
    async with svc.db.session() as s:
        stuck = (await s.execute(select(Subscription).where(
            Subscription.user_id == user_id,
            Subscription.status.in_(("halted", "paused"))))).scalars().all()
    for old in stuck:
        await cancel_remote(svc, old.provider_subscription_id, at_cycle_end=False)
        await close_locally(svc, old.id, "cancelled", "replaced by a new subscription")

    # The Razorpay plan must charge what the pricing file says, or nobody pays.
    rplan = await call(rz.fetch_plan, plan.razorpay_plan_id)
    item = rplan.get("item") or {}
    if item.get("amount") != amount or str(item.get("currency") or "").upper() != CURRENCY:
        log.error("razorpay plan %s charges %r %r; pricing.json says %d %s",
                  plan.razorpay_plan_id, item.get("amount"), item.get("currency"), amount,
                  CURRENCY)
        raise upstream("Razorpay")

    row = Subscription(id=uuid.uuid4().hex, user_id=user_id, plan_id=body.plan,
                       provider="razorpay", provider_plan_id=plan.razorpay_plan_id,
                       amount=amount, currency=CURRENCY, status="created",
                       cancel_at_period_end=False)
    made = await call(rz.create_subscription, plan_id=plan.razorpay_plan_id,
                      total_count=BILLING_CYCLES,
                      notes={"holt_subscription": row.id, "plan": body.plan})
    if not SUBSCRIPTION_ID.match(str(made.get("id") or "")) \
            or made.get("plan_id") != plan.razorpay_plan_id:
        log.error("razorpay subscription for %s came back as %r", row.id,
                  {k: made.get(k) for k in ("id", "plan_id", "status")})
        raise upstream("Razorpay")
    row.provider_subscription_id = made["id"]
    row.created_at = row.updated_at = now()
    try:
        async with svc.db.session() as s:
            s.add(row)
            await s.commit()
    except IntegrityError:
        # Another tab started one at the same moment: keep that one.
        await cancel_remote(svc, made["id"], at_cycle_end=False)
        raise ApiError("already_subscribed", "You already started a plan in another tab. "
                       "Reload the page to see it.") from None
    return checkout_body(svc, row)


@router.post("/me/subscription/confirm")
async def confirm(body: ConfirmIn, request: Request,
                  who: Caller = Depends(caller)) -> schema.SubscriptionConfirmed:
    svc = services(request)
    user_id = signed_in(who)
    rz = svc.razorpay
    if rz is None:
        raise ApiError("payments_off", OFF)
    rid, pid = body.razorpay_subscription_id, body.razorpay_payment_id
    if not (SUBSCRIPTION_ID.match(rid) and PAYMENT_ID.match(pid)
            and rz.subscription_signature_ok(pid, rid, body.razorpay_signature)):
        log.warning("subscription confirm for %s with a bad signature (user %s)", rid[:60],
                    user_id)
        raise ApiError("payment_unconfirmed", UNCONFIRMED)
    sub = await by_provider_id(svc, rid)
    if sub is None or sub.user_id != user_id:
        raise ApiError("not_found", "We couldn't find that subscription.")
    entity = await call(rz.fetch_subscription, rid)
    if entity.get("id") != rid or entity.get("plan_id") != sub.provider_plan_id:
        log.error("razorpay subscription %s came back as %r", rid,
                  {k: entity.get(k) for k in ("id", "plan_id", "status")})
        raise ApiError("payment_unconfirmed", UNCONFIRMED)
    status = entity.get("status")
    if status == "active":
        payment = await call(rz.fetch_payment, pid)
        result = await apply(svc, "charged" if payment.get("status") == "captured" else
                             "activated", entity, payment)
    elif status in ("authenticated", "pending", "halted", "paused", *FINAL):
        result = await apply(svc, status, entity)
    else:
        result = "pending"
    log.info("subscription confirm %s %s -> %s", rid, pid, result)
    return await me_body(svc, user_id, await by_provider_id(svc, rid))


async def me_body(svc: Services, user_id: str,
                  sub: Subscription | None) -> schema.SubscriptionConfirmed:
    user = await credits.get_user(svc, user_id)
    cat = entitlements.catalogue(svc)
    plan = entitlements.effective_plan(cat, user)
    return schema.SubscriptionConfirmed(
        subscription=subscription_body(svc, sub) if sub else None, plan=plan,
        plan_expires_at=iso(user.plan_expires_at) if user and plan != pricing.FREE else None)


@router.get("/me/subscription")
async def my_subscription(request: Request, who: Caller = Depends(caller),
                          limit: int = Query(50, ge=1, le=200)) -> schema.MySubscription:
    """The latest subscription (checkouts never paid are left out) and every
    charge, newest first."""
    svc = services(request)
    user_id = signed_in(who)
    async with svc.db.session() as s:
        sub = (await s.execute(
            select(Subscription).where(Subscription.user_id == user_id,
                                       Subscription.status != "created")
            .order_by(Subscription.created_at.desc()).limit(1))).scalar_one_or_none()
        charges = (await s.execute(
            select(SubscriptionCharge).where(SubscriptionCharge.user_id == user_id)
            .order_by(SubscriptionCharge.created_at.desc(), SubscriptionCharge.id.desc())
            .limit(limit))).scalars().all()
    return schema.MySubscription(subscription=subscription_body(svc, sub) if sub else None,
                                 charges=[charge_body(c) for c in charges])


@router.post("/me/subscription/cancel")
async def cancel(request: Request, who: Caller = Depends(caller)) -> schema.SubscriptionConfirmed:
    """Stop renewing. A paid plan runs to the end of the period paid for; one
    never paid for, or whose renewal is failing, stops now."""
    svc = services(request)
    user_id = signed_in(who)
    if svc.razorpay is None:
        raise ApiError("payments_off", OFF)
    sub = await live(svc, user_id)
    if sub is None:
        raise ApiError("not_found", "You don't have a plan to cancel.")
    rid = sub.provider_subscription_id
    if sub.status == "active":
        if not sub.cancel_at_period_end:
            await call(svc.razorpay.cancel_subscription, rid, at_cycle_end=True)
            async with svc.db.session() as s:
                row = await s.get(Subscription, sub.id)
                row.cancel_at_period_end = True
                row.updated_at = now()
                # No grace after a cancel: the plan ends with the paid period.
                await end_plan(s, svc, row, "cancelled by the user", at=row.current_end)
                await s.commit()
            log.info("subscription %s cancels at the end of the period", rid)
    else:
        # Nothing paid for this period (created, authenticated), or a renewal
        # is failing (pending): stop now so Razorpay stops retrying.
        entity = await call(svc.razorpay.cancel_subscription, rid, at_cycle_end=False)
        entity = {**entity, "id": rid}
        if await apply(svc, "cancelled", entity) == "unknown_subscription":
            await close_locally(svc, sub.id, "cancelled", "cancelled by the user")
        log.info("subscription %s cancelled now (%s)", rid, sub.status)
    return await me_body(svc, user_id, await by_provider_id(svc, rid))
