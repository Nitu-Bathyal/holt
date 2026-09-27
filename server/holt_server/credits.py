"""Credits: free ones (a welcome grant, a weekly claim) and purchased ones.

Every signed-in user gets `HOLT_SIGNUP_AI_CREDITS` once, the first time the
server sees them (users from before credits get theirs on their next visit).
After that they can claim one more whenever `HOLT_CLAIM_EVERY_DAYS` have
passed since the last claim; the welcome grant starts that clock. Claims do
not pile up while someone is away: there is only ever one to claim.

Two pools. Free credits are `users.ai_credits`. Purchased credits are
`credit_lots`, one per pack bought (or admin grant), which never expire or
expire when the pack says (pricing.json). A spend takes free credits first
(when the feature accepts them), then the soonest-expiring lot.

Balances change only through guarded `UPDATE`s, so two requests racing each
other can neither spend a credit twice nor claim twice. Each change writes a
`credit_events` row, saying which pool, in the same transaction. What a
feature costs and whether a plan covers it is `entitlements.py`.

Admin operations, against `$DATABASE_URL` (see server/README.md):

    python -m holt_server.credits show  --user U
    python -m holt_server.credits grant --user U --credits N --reason "..." [--pool purchased] [--expires-days D]
    python -m holt_server.credits take  --user U --credits N --reason "..." [--pool purchased]
    python -m holt_server.credits plan set --user U --plan pro [--days 30 | --until 2026-12-31] --reason "..."
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from holt_server import schema
from holt_server.db import CreditEvent, CreditLot, User, iso, now, utc
from holt_server.deps import Caller, caller, services, signed_in
from holt_server.errors import ApiError

if TYPE_CHECKING:
    from holt_server.services import Services
    from holt_server.settings import Settings

router = APIRouter(prefix="/v1/me/credits", responses={"default": {"model": schema.ErrorBody}})

Pool = Literal["free", "purchased"]


def claim_every(svc: Services) -> timedelta:
    return timedelta(days=svc.settings.claim_every_days)


def next_claim_at(svc: Services, user: User) -> datetime | None:
    last = utc(user.last_claim_at)
    return last + claim_every(svc) if last else None


@dataclass(frozen=True)
class Balances:
    free: int
    purchased: int

    @property
    def total(self) -> int:
        return self.free + self.purchased


def unexpired(at: datetime):
    return or_(CreditLot.expires_at.is_(None), CreditLot.expires_at > at)


def live(at: datetime):
    """Lots that can still be spent at `at`."""
    return (CreditLot.remaining > 0, unexpired(at))


async def balances(s: AsyncSession, user_id: str, at: datetime | None = None) -> Balances:
    at = at or now()
    free = (await s.execute(select(User.ai_credits).where(User.id == user_id))).scalar()
    purchased = (await s.execute(
        select(func.coalesce(func.sum(CreditLot.remaining), 0))
        .where(CreditLot.user_id == user_id, *live(at)))).scalar()
    return Balances(free=free or 0, purchased=int(purchased or 0))


async def credits_body(svc: Services, user: User) -> schema.Credits:
    at = next_claim_at(svc, user)
    async with svc.db.session() as s:
        have = await balances(s, user.id)
    return schema.Credits(
        balance=have.total,
        free=have.free,
        purchased=have.purchased,
        can_claim=at is not None and at <= now(),
        next_claim_at=iso(at),
        claim_every_days=svc.settings.claim_every_days,
        ai_available=svc.server_model_available(),
    )


async def ensure_user(svc: Services, user_id: str) -> User:
    """The user row, created (on the free plan, with no credits) if missing."""
    async with svc.db.session() as s:
        user = await s.get(User, user_id)
        if user is None:
            s.add(User(id=user_id, plan="free"))
            try:
                await s.commit()
            except IntegrityError:  # created concurrently by another request
                await s.rollback()
            user = await s.get(User, user_id)
    return user


async def get_user(svc: Services, user_id: str) -> User:
    """The user row, created the first time `web/` sends this id, with the
    welcome credits given on that first visit and expired lots written off."""
    user = await ensure_user(svc, user_id)
    if user.credits_granted_at is None:
        await grant_welcome(svc, user_id)
        async with svc.db.session() as s:
            user = await s.get(User, user_id)
    await expire_lots(svc, user_id)
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
            s.add(CreditEvent(user_id=user_id, kind="grant", source="free", amount=amount,
                              created_at=at))
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
        s.add(CreditEvent(user_id=user_id, kind="claim", source="free", amount=1, created_at=at))
        await s.commit()


# --- spending, inside the caller's transaction ---------------------------------------

# One part of a spend: `{"source": "free"|"purchased", "lot": id|None, "amount": n}`.
# A job keeps its draws in `params["charge"]` so a failure can put them back.
Draw = dict[str, Any]


async def take(s: AsyncSession, user_id: str, amount: int, *, allow_free: bool,
               kind: str = "spend", feature: str | None = None, job_id: str | None = None,
               reason: str | None = None, actor: str | None = None) -> list[Draw] | None:
    """Take `amount` credits: free first (if `allow_free`), then lots,
    soonest-expiring first. Writes the ledger rows. Returns the draws, or None
    when there aren't enough; the caller must then roll back, since some
    pools may already have been drawn on."""
    at = now()
    need = amount
    draws: list[Draw] = []
    if allow_free:
        free = (await s.execute(select(User.ai_credits).where(User.id == user_id))).scalar() or 0
        k = min(free, need)
        if k > 0:
            took = await s.execute(update(User).where(User.id == user_id, User.ai_credits >= k)
                                   .values(ai_credits=User.ai_credits - k))
            if took.rowcount == 1:
                draws.append({"source": "free", "lot": None, "amount": k})
                need -= k
    if need > 0:
        lots = (await s.execute(
            select(CreditLot.id, CreditLot.remaining)
            .where(CreditLot.user_id == user_id, *live(at))
            .order_by(CreditLot.expires_at.is_(None), CreditLot.expires_at, CreditLot.id)
        )).all()
        for lot_id, remaining in lots:
            k = min(remaining, need)
            took = await s.execute(
                update(CreditLot).where(CreditLot.id == lot_id, CreditLot.remaining >= k,
                                        unexpired(at))
                .values(remaining=CreditLot.remaining - k))
            if took.rowcount == 1:
                draws.append({"source": "purchased", "lot": lot_id, "amount": k})
                need -= k
            if need == 0:
                break
    if need > 0:
        return None
    for d in draws:
        s.add(CreditEvent(user_id=user_id, kind=kind, source=d["source"], lot_id=d["lot"],
                          amount=-d["amount"], feature=feature, job_id=job_id,
                          reason=reason, actor=actor, created_at=at))
    return draws


async def give_back(s: AsyncSession, user_id: str, draws: list[Draw], *,
                    feature: str | None = None, job_id: str | None = None) -> None:
    """Undo `take`'s draws as `refund`s, each to the pool it came from."""
    at = now()
    for d in draws:
        k = int(d["amount"])
        if d["source"] == "free":
            await s.execute(update(User).where(User.id == user_id)
                            .values(ai_credits=User.ai_credits + k))
        else:
            # Back to its lot even if that lot has expired since; the next
            # sweep writes it off again.
            await s.execute(update(CreditLot).where(CreditLot.id == d["lot"])
                            .values(remaining=CreditLot.remaining + k))
        s.add(CreditEvent(user_id=user_id, kind="refund", source=d["source"], lot_id=d["lot"],
                          amount=k, feature=feature, job_id=job_id, created_at=at))


# --- lots: purchases, admin grants, expiry ------------------------------------------


async def expire_lots(svc: Services, user_id: str) -> int:
    """Write off what is left in this user's expired lots. Returns credits expired."""
    at = now()
    gone = 0
    async with svc.db.session() as s:
        due = (await s.execute(
            select(CreditLot.id, CreditLot.remaining)
            .where(CreditLot.user_id == user_id, CreditLot.remaining > 0,
                   CreditLot.expires_at.is_not(None), CreditLot.expires_at <= at))).all()
        if not due:
            return 0
        for lot_id, remaining in due:
            took = await s.execute(
                update(CreditLot).where(CreditLot.id == lot_id,
                                        CreditLot.remaining == remaining)
                .values(remaining=0))
            if took.rowcount == 1:
                s.add(CreditEvent(user_id=user_id, kind="expire", source="purchased",
                                  lot_id=lot_id, amount=-remaining, created_at=at))
                gone += remaining
        await s.commit()
    return gone


async def add_lot(s: AsyncSession, user_id: str, amount: int, *, origin: str, kind: str,
                  pack_id: str | None = None, reference: str | None = None,
                  expires_at: datetime | None = None, reason: str | None = None,
                  actor: str | None = None) -> CreditLot:
    at = now()
    lot = CreditLot(user_id=user_id, origin=origin, pack_id=pack_id, reference=reference,
                    granted=amount, remaining=amount, expires_at=expires_at, created_at=at)
    s.add(lot)
    await s.flush()
    s.add(CreditEvent(user_id=user_id, kind=kind, source="purchased", lot_id=lot.id,
                      amount=amount, reason=reason, actor=actor, created_at=at))
    return lot


async def purchase_pack(svc: Services, user_id: str, pack_id: str,
                        reference: str) -> tuple[CreditLot, bool]:
    """Add a bought pack's credits. For the payment code, once a payment is
    confirmed; `reference` is the payment's id, so a repeated confirmation
    adds nothing. Returns (lot, added)."""
    from holt_server.entitlements import catalogue

    pack = catalogue(svc).packs.get(pack_id)
    if pack is None:
        raise ValueError(f"no pack {pack_id!r} in the pricing file")
    if not reference:
        raise ValueError("a purchase needs the payment's reference")
    await ensure_user(svc, user_id)
    expires = now() + timedelta(days=pack.expires_days) if pack.expires_days else None
    async with svc.db.session() as s:
        try:
            lot = await add_lot(s, user_id, pack.credits, origin="pack", kind="purchase",
                                pack_id=pack_id, reference=reference, expires_at=expires)
            await s.commit()
            return lot, True
        except IntegrityError:  # this payment was already added
            await s.rollback()
    async with svc.db.session() as s:
        lot = (await s.execute(
            select(CreditLot).where(CreditLot.reference == reference))).scalar_one()
    if lot.user_id != user_id or lot.pack_id != pack_id:
        raise ValueError(f"payment {reference!r} was already used for another purchase")
    return lot, False


async def grant(svc: Services, user_id: str, amount: int, *, pool: Pool, reason: str,
                actor: str, expires_days: int | None = None) -> None:
    """An admin gift. `free` adds to the free balance (any feature that takes
    free credits); `purchased` adds a lot, spendable like a bought pack."""
    if amount <= 0:
        raise ValueError("the number of credits must be positive")
    if not reason.strip():
        raise ValueError("say why (--reason)")
    await ensure_user(svc, user_id)
    async with svc.db.session() as s:
        if pool == "free":
            if expires_days:
                raise ValueError("free credits don't expire; use --pool purchased")
            await s.execute(update(User).where(User.id == user_id)
                            .values(ai_credits=User.ai_credits + amount))
            s.add(CreditEvent(user_id=user_id, kind="adjust", source="free", amount=amount,
                              reason=reason, actor=actor, created_at=now()))
        else:
            expires = now() + timedelta(days=expires_days) if expires_days else None
            await add_lot(s, user_id, amount, origin="admin", kind="adjust",
                          expires_at=expires, reason=reason, actor=actor)
        await s.commit()


async def take_back(svc: Services, user_id: str, amount: int, *, pool: Pool, reason: str,
                    actor: str) -> None:
    """An admin correction: remove credits from one pool, never below zero."""
    if amount <= 0:
        raise ValueError("the number of credits must be positive")
    if not reason.strip():
        raise ValueError("say why (--reason)")
    async with svc.db.session() as s:
        if pool == "free":
            took = await s.execute(update(User).where(User.id == user_id,
                                                      User.ai_credits >= amount)
                                   .values(ai_credits=User.ai_credits - amount))
            ok = took.rowcount == 1
            if ok:
                s.add(CreditEvent(user_id=user_id, kind="adjust", source="free",
                                  amount=-amount, reason=reason, actor=actor,
                                  created_at=now()))
        else:
            ok = await take(s, user_id, amount, allow_free=False, kind="adjust",
                            reason=reason, actor=actor) is not None
        if not ok:
            await s.rollback()
            raise ValueError(f"{user_id} doesn't have {amount} {pool} credits")
        await s.commit()


# --- routes -----------------------------------------------------------------------


@router.get("")
async def get_credits(request: Request, who: Caller = Depends(caller)) -> schema.Credits:
    svc = services(request)
    return await credits_body(svc, await get_user(svc, signed_in(who)))


@router.post("/claim")
async def post_claim(request: Request, who: Caller = Depends(caller)) -> schema.Credits:
    svc = services(request)
    user_id = signed_in(who)
    await get_user(svc, user_id)
    await claim(svc, user_id)
    return await credits_body(svc, await get_user(svc, user_id))


# --- admin CLI ----------------------------------------------------------------------


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m holt_server.credits",
                                description="Look at and change a user's credits and plan.")
    sub = p.add_subparsers(dest="cmd", required=True)
    show = sub.add_parser("show", help="balances, plan, lots and recent ledger")
    show.add_argument("--user", required=True)
    for name, text in (("grant", "give credits"), ("take", "remove credits")):
        c = sub.add_parser(name, help=text)
        c.add_argument("--user", required=True)
        c.add_argument("--credits", type=int, required=True)
        c.add_argument("--reason", required=True)
        c.add_argument("--pool", choices=("free", "purchased"), default="free")
        if name == "grant":
            c.add_argument("--expires-days", type=int, default=None)
    plan = sub.add_parser("plan", help="change a user's plan")
    plan_sub = plan.add_subparsers(dest="plan_cmd", required=True)
    ps = plan_sub.add_parser("set", help="set the plan (free ends a paid plan)")
    ps.add_argument("--user", required=True)
    ps.add_argument("--plan", required=True)
    ps.add_argument("--reason", required=True)
    until = ps.add_mutually_exclusive_group()
    until.add_argument("--days", type=int, help="the plan lapses after this many days")
    until.add_argument("--until", help="the plan lapses at the start of this UTC date")
    return p


async def _cli(args: argparse.Namespace, svc: Services) -> dict[str, Any]:
    from holt_server import admin, entitlements

    actor = "cli"
    if args.cmd == "grant":
        await grant(svc, args.user, args.credits, pool=args.pool, reason=args.reason,
                    actor=actor, expires_days=args.expires_days)
    elif args.cmd == "take":
        await take_back(svc, args.user, args.credits, pool=args.pool, reason=args.reason,
                        actor=actor)
    elif args.cmd == "plan":
        expires = None
        if args.days:
            expires = now() + timedelta(days=args.days)
        elif args.until:
            expires = datetime.fromisoformat(args.until).replace(tzinfo=UTC)
        await entitlements.set_plan(svc, args.user, args.plan, expires_at=expires,
                                    reason=args.reason, actor=actor)
    view = await admin.user_view(svc, args.user, ledger_limit=20)
    if view is None:
        raise ValueError(f"no user {args.user!r}")
    return view.model_dump(mode="json")


def main(argv: list[str] | None = None, settings: Settings | None = None) -> int:
    args = _parser().parse_args(argv)

    async def go() -> dict[str, Any]:
        from holt_server.services import Services
        from holt_server.settings import get_settings

        svc = Services(settings or get_settings())
        try:
            return await _cli(args, svc)
        finally:
            await svc.db.dispose()
            svc.http.close()

    try:
        out = asyncio.run(go())
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
