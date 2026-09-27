"""Read-only admin view of credits and plans: `/v1/admin/*`.

Needs the internal key and an `X-Holt-User` listed in `HOLT_ADMIN_USERS`;
anyone else gets 404, as if nothing were here. Changes go through the CLI
(`python -m holt_server.credits`), never through HTTP. There is no admin UI.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select

from holt_server import credits, entitlements, pricing, schema
from holt_server.db import CreditEvent, CreditLot, PlanEvent, PlanUsage, User, iso, now
from holt_server.deps import Caller, caller, services
from holt_server.errors import ApiError

if TYPE_CHECKING:
    from holt_server.services import Services


async def admin(request: Request, who: Caller = Depends(caller)) -> str:
    if not who.user_id or who.user_id not in services(request).settings.admin_user_ids:
        raise ApiError("not_found", "There is nothing at this address.")
    return who.user_id


router = APIRouter(prefix="/v1/admin", dependencies=[Depends(admin)],
                   responses={"default": {"model": schema.ErrorBody}})


def summary(cat: pricing.Catalogue, user: User, have: credits.Balances) -> dict:
    return {"id": user.id, "plan": user.plan or pricing.FREE,
            "effective_plan": entitlements.effective_plan(cat, user),
            "plan_expires_at": iso(user.plan_expires_at),
            "free": have.free, "purchased": have.purchased,
            "created_at": iso(user.created_at)}


async def user_view(svc: Services, user_id: str, ledger_limit: int = 200) -> schema.AdminUser | None:
    cat = entitlements.catalogue(svc)
    async with svc.db.session() as s:
        user = await s.get(User, user_id)
        if user is None:
            return None
        have = await credits.balances(s, user_id)
        lots = (await s.execute(select(CreditLot).where(CreditLot.user_id == user_id)
                                .order_by(CreditLot.id))).scalars().all()
        ledger = (await s.execute(select(CreditEvent).where(CreditEvent.user_id == user_id)
                                  .order_by(CreditEvent.id.desc()).limit(ledger_limit)
                                  )).scalars().all()
        plans = (await s.execute(select(PlanEvent).where(PlanEvent.user_id == user_id)
                                 .order_by(PlanEvent.id.desc()))).scalars().all()
        usage = (await s.execute(select(PlanUsage).where(PlanUsage.user_id == user_id)
                                 .order_by(PlanUsage.period.desc(), PlanUsage.feature)
                                 )).scalars().all()
    access = [await entitlements.check(svc, user_id, f) for f in cat.features]
    return schema.AdminUser.model_validate({
        **summary(cat, user, have),
        "lots": [{"id": x.id, "origin": x.origin, "pack_id": x.pack_id,
                  "reference": x.reference, "granted": x.granted, "remaining": x.remaining,
                  "expires_at": iso(x.expires_at), "created_at": iso(x.created_at)}
                 for x in lots],
        "ledger": [{"id": e.id, "kind": e.kind, "source": e.source, "amount": e.amount,
                    "lot_id": e.lot_id, "feature": e.feature, "job_id": e.job_id,
                    "reason": e.reason, "actor": e.actor, "created_at": iso(e.created_at)}
                   for e in ledger],
        "plan_history": [{"id": p.id, "plan": p.plan, "expires_at": iso(p.expires_at),
                          "reason": p.reason, "actor": p.actor, "reference": p.reference,
                          "created_at": iso(p.created_at)} for p in plans],
        "plan_usage": [{"feature": u.feature, "period": u.period, "used": u.used}
                       for u in usage],
        "access": [a.__dict__ for a in access],
    })


@router.get("/users")
async def list_users(request: Request, limit: int = Query(100, ge=1, le=1000),
                     plan: str | None = Query(None, max_length=40)) -> schema.AdminUsers:
    """Newest users first, with balances. `plan` filters on the stored plan."""
    svc = services(request)
    cat = entitlements.catalogue(svc)
    at = now()
    purchased = (select(CreditLot.user_id, func.sum(CreditLot.remaining).label("n"))
                 .where(*credits.live(at)).group_by(CreditLot.user_id).subquery())
    q = (select(User, func.coalesce(purchased.c.n, 0))
         .outerjoin(purchased, purchased.c.user_id == User.id)
         .order_by(User.created_at.desc(), User.id).limit(limit))
    if plan:
        q = q.where(User.plan == plan)
    async with svc.db.session() as s:
        rows = (await s.execute(q)).all()
    return schema.AdminUsers.model_validate({"users": [
        summary(cat, user, credits.Balances(free=user.ai_credits or 0, purchased=int(n)))
        for user, n in rows]})


@router.get("/users/{user_id}")
async def get_user(user_id: str, request: Request,
                   ledger_limit: int = Query(200, ge=1, le=5000)) -> schema.AdminUser:
    view = await user_view(services(request), user_id[:200], ledger_limit)
    if view is None:
        raise ApiError("not_found", "There's no user with that id.")
    return view


@router.get("/pricing")
async def get_pricing(request: Request) -> pricing.Catalogue:
    """The features, plans and packs this server loaded (prices in minor units)."""
    return entitlements.catalogue(services(request))
