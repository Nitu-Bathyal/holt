"""Credit-pack checkout: Razorpay, INR, one-time payments (API.md, "Credit packs").

Off by default. Packs are offered and orders created only when
`HOLT_PAYMENTS_ENABLED=1`, the Razorpay keys are set, and the pack is on sale
with a price in pricing.json. Everything about an order (pack, credits, price)
comes from that file when the order is created, never from the browser.

The flow:

1. `POST /v1/me/orders {"pack"}` creates a Razorpay order for the pack's
   price and an `orders` row, and returns what Razorpay Checkout needs.
2. The buyer pays in Checkout. It hands the page `razorpay_order_id`,
   `razorpay_payment_id` and `razorpay_signature`, which `web/` passes to
   `POST /v1/me/orders/confirm`.
3. Razorpay also sends webhooks (`payment.authorized`, `payment.captured`,
   `order.paid`, `payment.failed`), which `web/` forwards, body untouched, to
   `POST /v1/payments/razorpay/webhook`.

Nothing is credited on the browser's word. The confirm call checks the
payment signature (HMAC-SHA256 of `order_id|payment_id` with the key
secret) and then asks Razorpay for the payment; the webhook checks its
signature (HMAC-SHA256 of the raw body with the webhook secret). Either
way, credits are added only for a captured payment whose amount and currency
match the order; an authorized one is captured first, and one that doesn't
match puts the order on `held` for a person to look at.

Crediting is one transaction: `UPDATE orders SET status='paid' WHERE status
IN ('created', 'failed')` and, only if that took, a `CreditLot` whose
`reference` is the payment id (unique). The confirm call and the webhook
both arrive, in either order, sometimes more than once, sometimes at the same
moment: exactly one of them credits.

With payments switched off, confirm and the webhook still settle orders that
already exist (someone may have paid just before the switch); no new order
can be made.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import uuid
from datetime import timedelta
from typing import TYPE_CHECKING, Any

import httpx
from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from holt_server import credits, entitlements, pricing, schema
from holt_server.db import Order, iso, now
from holt_server.deps import Caller, caller, internal, services, signed_in
from holt_server.errors import ApiError, upstream

if TYPE_CHECKING:
    from holt_server.services import Services
    from holt_server.settings import Settings

log = logging.getLogger("holt_server.payments")

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})

API = "https://api.razorpay.com/v1"
TIMEOUT_S = 20.0
CURRENCY = "INR"
# Razorpay's smallest INR charge (paise).
MIN_AMOUNT = 100
# Razorpay webhook bodies are a few KB.
MAX_WEBHOOK_BYTES = 256 * 1024

ORDER_ID = re.compile(r"^order_[A-Za-z0-9]{1,40}$")
PAYMENT_ID = re.compile(r"^pay_[A-Za-z0-9]{1,40}$")

OFF = "Credit packs aren't on sale yet. Everything free in Holt keeps working."
UNCONFIRMED = ("We couldn't confirm that payment. If money left your account, your "
               "credits will appear in a few minutes, or the payment will be refunded.")


# --- Razorpay -------------------------------------------------------------------------


class ProviderError(Exception):
    pass


def sign(secret: str, message: str | bytes) -> str:
    data = message.encode("utf-8") if isinstance(message, str) else message
    return hmac.new(secret.encode("utf-8"), data, hashlib.sha256).hexdigest()


def same(expected: str, given: str | None) -> bool:
    return bool(given) and hmac.compare_digest(expected.encode(), given.strip().encode())


class Razorpay:
    """The three Razorpay calls Holt makes, over HTTPS with basic auth (no SDK).
    Tests replace `svc.razorpay` with a fake that has the same methods."""

    name = "razorpay"

    def __init__(self, key_id: str, key_secret: str, webhook_secret: str,
                 client: httpx.Client | None = None) -> None:
        self.key_id = key_id
        self._secret = key_secret
        self._webhook_secret = webhook_secret
        self._client = client or httpx.Client(timeout=TIMEOUT_S)

    def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict:
        try:
            res = self._client.request(method, f"{API}{path}", json=body,
                                       auth=(self.key_id, self._secret))
        except httpx.HTTPError as exc:
            raise ProviderError(f"razorpay {path}: {type(exc).__name__}") from exc
        if res.status_code >= 400:
            try:
                detail = res.json().get("error", {}).get("description", "")
            except ValueError:
                detail = ""
            raise ProviderError(f"razorpay {path}: HTTP {res.status_code} {detail}")
        return res.json()

    def create_order(self, *, amount: int, currency: str, receipt: str,
                     notes: dict[str, str]) -> dict:
        return self._call("POST", "/orders", {"amount": amount, "currency": currency,
                                               "receipt": receipt[:40], "notes": notes})

    def fetch_payment(self, payment_id: str) -> dict:
        return self._call("GET", f"/payments/{payment_id}")

    def capture(self, payment_id: str, *, amount: int, currency: str) -> dict:
        return self._call("POST", f"/payments/{payment_id}/capture",
                          {"amount": amount, "currency": currency})

    def payment_signature_ok(self, order_id: str, payment_id: str, signature: str) -> bool:
        return same(sign(self._secret, f"{order_id}|{payment_id}"), signature)

    def webhook_signature_ok(self, body: bytes, signature: str | None) -> bool:
        return bool(self._webhook_secret) and same(sign(self._webhook_secret, body), signature)

    def close(self) -> None:
        self._client.close()


def build(settings: Settings) -> Razorpay | None:
    if not (settings.razorpay_key_id and settings.razorpay_key_secret):
        return None
    return Razorpay(settings.razorpay_key_id, settings.razorpay_key_secret,
                    settings.razorpay_webhook_secret)


async def call(fn, *args, **kwargs) -> dict:
    """A Razorpay call, off the event loop, its failure made plain."""
    try:
        return await asyncio.to_thread(fn, *args, **kwargs)
    except ProviderError as exc:
        log.warning("razorpay call failed: %s", exc)
        raise upstream("Razorpay") from exc


# --- what is on sale -----------------------------------------------------------------


def payments_on(svc: Services) -> bool:
    return svc.settings.payments_enabled and svc.razorpay is not None


def price(pack: pricing.Pack) -> int | None:
    """The pack's INR price when it is on sale, else None."""
    amount = pack.price.inr_paise
    if not pack.on_sale or amount is None or amount < MIN_AMOUNT:
        return None
    return amount


def packs_body(svc: Services) -> schema.Packs:
    if not payments_on(svc):
        return schema.Packs(on_sale=False, packs=[])
    out = [schema.PackOffer(id=pid, name=p.name, credits=p.credits, expires_days=p.expires_days,
                       amount=amount, currency=CURRENCY)
           for pid, p in entitlements.catalogue(svc).packs.items()
           if (amount := price(p)) is not None]
    return schema.Packs(on_sale=bool(out), packs=out)


def order_body(svc: Services, o: Order) -> schema.Order:
    pack = entitlements.catalogue(svc).packs.get(o.pack_id)
    return schema.Order(id=o.id, pack=o.pack_id,
                        name=pack.name if pack else f"{o.credits} credits",
                        credits=o.credits, amount=o.amount, currency=o.currency,
                        status=o.status, created_at=iso(o.created_at), paid_at=iso(o.paid_at))


# --- settling a payment ------------------------------------------------------------------


async def order_by_provider_id(svc: Services, provider_order_id: str | None) -> Order | None:
    if not provider_order_id:
        return None
    async with svc.db.session() as s:
        return (await s.execute(select(Order).where(
            Order.provider_order_id == provider_order_id))).scalar_one_or_none()


async def credit(svc: Services, order_id: str, payment_id: str) -> bool:
    """Mark the order paid by `payment_id` and add its credits, atomically.
    True if this call did it; False if the order was already paid (or the
    payment already paid another order, which is logged)."""
    at = now()
    async with svc.db.session() as s:
        order = await s.get(Order, order_id)
        try:
            took = await s.execute(
                update(Order).where(Order.id == order_id,
                                    Order.status.in_(("created", "failed")))
                .values(status="paid", provider_payment_id=payment_id, paid_at=at,
                        updated_at=at, note=None))
            if took.rowcount != 1:
                await s.rollback()
                return False
            expires = at + timedelta(days=order.expires_days) if order.expires_days else None
            lot = await credits.add_lot(s, order.user_id, order.credits, origin="pack",
                                        kind="purchase", pack_id=order.pack_id,
                                        reference=payment_id, expires_at=expires)
            await s.execute(update(Order).where(Order.id == order_id).values(lot_id=lot.id))
            await s.commit()
        except IntegrityError:
            await s.rollback()
            log.error("payment %s is already recorded against another order; order %s "
                      "not credited", payment_id, order_id)
            return False
    log.info("order %s paid by %s: %d credits to %s", order_id, payment_id, order.credits,
             order.user_id)
    return True


async def set_status(svc: Services, order_id: str, status: str, note: str) -> None:
    """`failed` or `held`, from an unpaid order only: a paid one stays paid."""
    async with svc.db.session() as s:
        await s.execute(update(Order).where(Order.id == order_id,
                                            Order.status.in_(("created", "failed")))
                        .values(status=status, note=note, updated_at=now()))
        await s.commit()


async def settle(svc: Services, payment: dict[str, Any]) -> str:
    """Act on a payment Razorpay vouched for (a signed webhook, or a fetch after
    a signed callback). Returns what happened, for the log and the tests."""
    order = await order_by_provider_id(svc, payment.get("order_id"))
    pid = str(payment.get("id") or "")
    if order is None:
        return "unknown_order"
    if not PAYMENT_ID.match(pid):
        return "ignored"
    if order.status == "paid":
        if order.provider_payment_id != pid and payment.get("status") == "captured":
            log.error("order %s was paid twice (%s, then %s): refund the second",
                      order.id, order.provider_payment_id, pid)
        return "already_paid"
    if payment.get("status") == "failed":
        await set_status(svc, order.id, "failed", str(payment.get("error_description") or ""))
        return "failed"
    amount, currency = payment.get("amount"), str(payment.get("currency") or "").upper()
    if amount != order.amount or currency != order.currency:
        note = f"payment {pid} was {amount} {currency}; the order is {order.amount} {order.currency}"
        log.error("order %s held: %s", order.id, note)
        await set_status(svc, order.id, "held", note)
        return "held"
    status = payment.get("status")
    if status == "authorized":
        rz = svc.razorpay
        if rz is None:
            return "pending"
        try:
            captured = await asyncio.to_thread(rz.capture, pid, amount=order.amount,
                                               currency=order.currency)
        except ProviderError as exc:
            # Often: captured already (by the other path, or automatically).
            log.info("capture of %s: %s; checking", pid, exc)
            captured = await call(rz.fetch_payment, pid)
        status = captured.get("status")
    if status == "captured":
        return "paid" if await credit(svc, order.id, pid) else "already_paid"
    return "pending"


# --- routes ----------------------------------------------------------------------------


class OrderIn(BaseModel):
    pack: str = Field(min_length=1, max_length=40)


class ConfirmIn(BaseModel):
    """What Razorpay Checkout hands the page on success, passed on unchanged."""

    razorpay_order_id: str = Field(max_length=60)
    razorpay_payment_id: str = Field(max_length=60)
    razorpay_signature: str = Field(max_length=200)


@router.get("/packs", dependencies=[Depends(internal)])
async def get_packs(request: Request) -> schema.Packs:
    return packs_body(services(request))


@router.post("/me/orders")
async def create_order(body: OrderIn, request: Request,
                       who: Caller = Depends(caller)) -> schema.Checkout:
    svc = services(request)
    user_id = signed_in(who)
    if not payments_on(svc):
        raise ApiError("payments_off", OFF)
    pack = entitlements.catalogue(svc).packs.get(body.pack)
    amount = price(pack) if pack else None
    if pack is None or amount is None:
        raise ApiError("invalid_request", "That credit pack isn't on sale.")
    svc.limiter.hit(who.rate_key, who.limit(svc))
    await credits.ensure_user(svc, user_id)
    row = Order(id=uuid.uuid4().hex, user_id=user_id, pack_id=body.pack, credits=pack.credits,
                expires_days=pack.expires_days, amount=amount, currency=CURRENCY,
                provider="razorpay", status="created")
    rz = svc.razorpay
    made = await call(rz.create_order, amount=amount, currency=CURRENCY, receipt=row.id,
                      notes={"holt_order": row.id, "pack": body.pack})
    if made.get("amount") != amount or not ORDER_ID.match(str(made.get("id") or "")):
        log.error("razorpay order for %s came back as %r", row.id,
                  {k: made.get(k) for k in ("id", "amount", "currency")})
        raise upstream("Razorpay")
    row.provider_order_id = made["id"]
    at = now()
    row.created_at = row.updated_at = at
    async with svc.db.session() as s:
        s.add(row)
        await s.commit()
    return schema.Checkout(order_id=row.id, provider="razorpay", key_id=rz.key_id,
                           provider_order_id=row.provider_order_id, amount=amount,
                           currency=CURRENCY, name="Holt", description=pack.name,
                           pack=body.pack, credits=pack.credits)


@router.post("/me/orders/confirm")
async def confirm_order(body: ConfirmIn, request: Request,
                        who: Caller = Depends(caller)) -> schema.OrderConfirmed:
    svc = services(request)
    user_id = signed_in(who)
    rz = svc.razorpay
    if rz is None:
        raise ApiError("payments_off", OFF)
    oid, pid = body.razorpay_order_id, body.razorpay_payment_id
    if not (ORDER_ID.match(oid) and PAYMENT_ID.match(pid)
            and rz.payment_signature_ok(oid, pid, body.razorpay_signature)):
        log.warning("confirm for %s with a bad signature (user %s)", oid[:60], user_id)
        raise ApiError("payment_unconfirmed", UNCONFIRMED)
    order = await order_by_provider_id(svc, oid)
    if order is None or order.user_id != user_id:
        raise ApiError("not_found", "We couldn't find that order.")
    if order.status != "paid":
        payment = await call(rz.fetch_payment, pid)
        if payment.get("order_id") != oid or payment.get("id") != pid:
            log.error("payment %s is not for order %s", pid, oid)
            raise ApiError("payment_unconfirmed", UNCONFIRMED)
        result = await settle(svc, payment)
        log.info("confirm %s %s -> %s", oid, pid, result)
    async with svc.db.session() as s:
        order = await s.get(Order, order.id)
    return schema.OrderConfirmed(order=order_body(svc, order),
                                 credits=await credits.credits_body(
                                     svc, await credits.get_user(svc, user_id)))


@router.get("/me/orders")
async def list_orders(request: Request, who: Caller = Depends(caller),
                      limit: int = Query(50, ge=1, le=200)) -> schema.Orders:
    """The user's purchases, newest first. Checkouts never finished are left out."""
    svc = services(request)
    user_id = signed_in(who)
    async with svc.db.session() as s:
        rows = (await s.execute(
            select(Order).where(Order.user_id == user_id, Order.status != "created")
            .order_by(Order.created_at.desc()).limit(limit))).scalars().all()
    return schema.Orders(orders=[order_body(svc, o) for o in rows])


async def bounded_body(request: Request, limit: int = MAX_WEBHOOK_BYTES) -> bytes:
    too_big = ApiError("invalid_request", "Request body too large.", status=413)
    declared = request.headers.get("content-length")
    if declared is not None and (not declared.isdigit() or int(declared) > limit):
        raise too_big
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise too_big
        chunks.append(chunk)
    return b"".join(chunks)


PAYMENT_EVENTS = {"payment.authorized", "payment.captured", "payment.failed", "order.paid"}


@router.post("/payments/razorpay/webhook", dependencies=[Depends(internal)])
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str | None = Header(default=None),
) -> dict[str, Any]:
    """Razorpay's webhook, forwarded by `web/` with the body byte for byte.
    Answers 200 for anything signed, even events it ignores, so Razorpay
    doesn't retry them; 400 for anything not signed."""
    svc = services(request)
    rz = svc.razorpay
    if rz is None:
        raise ApiError("payments_off", OFF)
    body = await bounded_body(request)
    if not rz.webhook_signature_ok(body, x_razorpay_signature):
        log.warning("razorpay webhook with a bad signature refused")
        raise ApiError("payment_unconfirmed", "Bad webhook signature.")
    try:
        data = json.loads(body)
        event = str(data.get("event") or "")
        payment = ((data.get("payload") or {}).get("payment") or {}).get("entity")
    except (ValueError, AttributeError) as exc:
        raise ApiError("invalid_request", "Malformed webhook body.") from exc
    if event not in PAYMENT_EVENTS or not isinstance(payment, dict):
        return {"ok": True, "result": "ignored"}
    result = await settle(svc, payment)
    log.info("razorpay webhook %s %s -> %s", event, payment.get("id"), result)
    return {"ok": True, "result": result}
