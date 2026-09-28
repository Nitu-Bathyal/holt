"""Monthly plans (subscriptions.py): starting one, the signed checkout, the
signed webhooks in any order and any number of times, cancelling, and the
switch that keeps it all off.

Razorpay is faked at the HTTP layer (`FakeRazorpay._call`), so the signature
checks are the real ones.
"""

from __future__ import annotations

import itertools
import json
import threading
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from holt_server import payments, subscriptions
from holt_server.db import PlanEvent, Subscription, SubscriptionCharge, User
from sqlalchemy import select

KEY_ID = "rzp_test_fake"
SECRET = "fake-key-secret"
HOOK_SECRET = "fake-webhook-secret"
PRICE = 19900
RZ_PLAN = "plan_Pro1"
GRACE = 7

CATALOGUE = {
    "tbd": False,
    "features": {
        "ai_report": {"name": "AI-written report", "credits": 1, "free_credits": True},
        "playbook": {"name": "Contribution playbook", "credits": 1},
        "recommendations": {"name": "Repository recommendations", "credits": None},
    },
    "plans": {
        "free": {"name": "Free", "features": {}},
        "pro": {"name": "Pro", "on_sale": True, "period_days": 30,
                "price": {"inr_paise": PRICE}, "razorpay_plan_id": RZ_PLAN,
                "features": {"playbook": {"per_month": 10},
                             "recommendations": {"unlimited": True}}},
        "team": {"name": "Team", "on_sale": True, "price": {"inr_paise": 99900},
                 "features": {}},
    },
    "packs": {},
}

DAY = 86400
T0 = int(datetime.now(UTC).timestamp()) - DAY


def ts(t: int) -> datetime:
    return datetime.fromtimestamp(t, UTC)


class FakeRazorpay(payments.Razorpay):
    """Razorpay's plans, subscriptions and payments, in memory. Only `_call` is fake."""

    def __init__(self) -> None:
        super().__init__(KEY_ID, SECRET, HOOK_SECRET)
        self.plans = {RZ_PLAN: {"id": RZ_PLAN, "period": "monthly", "interval": 1,
                                "item": {"amount": PRICE, "currency": "INR"}}}
        self.subs: dict[str, dict] = {}
        self.payments: dict[str, dict] = {}
        self.calls: list[tuple[str, str, Any]] = []
        self.fail = False
        self.lock = threading.Lock()
        self._ids = itertools.count(1)

    def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict:
        with self.lock:
            self.calls.append((method, path, body))
            if self.fail:
                raise payments.ProviderError(f"razorpay {path}: HTTP 500")
            parts = path.strip("/").split("/")
            if parts[0] == "plans":
                if parts[1] not in self.plans:
                    raise payments.ProviderError(f"razorpay {path}: HTTP 400")
                return dict(self.plans[parts[1]])
            if path == "/subscriptions":
                sid = f"sub_T{next(self._ids)}"
                self.subs[sid] = {"id": sid, "entity": "subscription", "plan_id": body["plan_id"],
                                  "status": "created", "total_count": body["total_count"],
                                  "notes": body["notes"], "current_start": None,
                                  "current_end": None, "charge_at": None}
                return dict(self.subs[sid])
            if parts[0] == "subscriptions":
                sub = self.subs[parts[1]]
                if path.endswith("/cancel"):
                    if not body["cancel_at_cycle_end"]:
                        sub["status"] = "cancelled"
                        sub["ended_at"] = T0 + 2 * DAY
                    sub["cancel_body"] = body
                return dict(sub)
            if parts[0] == "payments":
                return dict(self.payments[parts[1]])
            raise AssertionError(path)

    def pay(self, sid: str, *, start: int = T0, months: int = 1, status: str = "captured",
            amount: int = PRICE) -> dict:
        """The subscriber pays in Checkout: Razorpay activates the subscription.
        Returns what Checkout would hand the page."""
        pid = f"pay_S{next(self._ids)}"
        self.payments[pid] = {"id": pid, "entity": "payment", "status": status,
                              "amount": amount, "currency": "INR"}
        self.subs[sid].update(status="active", current_start=start,
                              current_end=start + 30 * DAY * months,
                              charge_at=start + 30 * DAY * months)
        return {"razorpay_payment_id": pid, "razorpay_subscription_id": sid,
                "razorpay_signature": payments.sign(SECRET, f"{pid}|{sid}")}


@pytest.fixture
def pricing_file(tmp_path):
    path = tmp_path / "pricing.json"
    path.write_text(json.dumps(CATALOGUE), encoding="utf-8")
    return str(path)


@pytest.fixture
def make_hs(make_harness, pricing_file):
    def build(enabled: bool = True, keys: bool = True, **overrides):
        h = make_harness(HOLT_PRICING_FILE=pricing_file, HOLT_SUBSCRIPTIONS_ENABLED=enabled,
                         HOLT_SUBSCRIPTION_GRACE_DAYS=GRACE, **overrides)
        h.rz = FakeRazorpay() if keys else None
        h.svc.razorpay = h.rz
        return h
    return build


@pytest.fixture
def hs(make_hs):
    return make_hs()


def rows(h, model):
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(model))).scalars().all()
    return h.client.portal.call(q)


def user_row(h, user: str = "sub") -> User:
    async def q():
        async with h.svc.db.session() as s:
            return await s.get(User, user)
    return h.client.portal.call(q)


def plan_of(h, user: str = "sub") -> tuple[str, str | None]:
    me = h.get("/v1/me", user=user).json()
    return me["plan"], me["plan_expires_at"]


def iso(t: int, days: float = 0) -> str:
    return (ts(t) + timedelta(days=days)).isoformat().replace("+00:00", "Z")


def subscribe(h, user: str = "sub", plan: str = "pro") -> dict:
    r = h.post("/v1/me/subscription", {"plan": plan}, user=user)
    assert r.status_code == 200, r.text
    return r.json()


def confirm(h, cb: dict, user: str = "sub"):
    return h.post("/v1/me/subscription/confirm", cb, user=user)


def started(h, user: str = "sub") -> tuple[str, dict]:
    """Subscribe and pay the first month; returns the Razorpay id and the callback."""
    sid = subscribe(h, user)["provider_subscription_id"]
    cb = h.rz.pay(sid)
    assert confirm(h, cb, user).status_code == 200
    return sid, cb


def entity(h, sid: str, **changes) -> dict:
    return {**h.rz.subs[sid], **changes}


def hook_body(event: str, sub: dict, payment: dict | None = None) -> bytes:
    payload: dict[str, Any] = {"subscription": {"entity": sub}}
    if payment is not None:
        payload["payment"] = {"entity": payment}
    return json.dumps({"entity": "event", "event": event, "payload": payload}).encode()


def webhook(h, body: bytes, signature: str | None = "auto"):
    sig = payments.sign(HOOK_SECRET, body) if signature == "auto" else signature
    headers = {**h.headers(), "Content-Type": "application/json"}
    if sig is not None:
        headers["X-Razorpay-Signature"] = sig
    return h.client.post("/v1/payments/razorpay/webhook", content=body, headers=headers)


def hook(h, event: str, sub: dict, payment: dict | None = None) -> str:
    r = webhook(h, hook_body(event, sub, payment))
    assert r.status_code == 200, r.text
    return r.json()["result"]


def charge(h, sid: str, period: int, *, amount: int = PRICE) -> tuple[dict, dict]:
    """Razorpay takes the renewal for period `period` (0 = the first month)."""
    pid = f"pay_R{sid[-2:]}{period}{amount}"
    payment = {"id": pid, "entity": "payment", "status": "captured", "amount": amount,
               "currency": "INR"}
    start = T0 + 30 * DAY * period
    sub = entity(h, sid, status="active", current_start=start, current_end=start + 30 * DAY,
                 charge_at=start + 30 * DAY)
    return sub, payment


# --- what is on sale -----------------------------------------------------------------


def test_plans_on_sale_come_from_the_pricing_file(hs):
    body = hs.get("/v1/plans").json()
    # "team" has no Razorpay plan, so it can't be subscribed to.
    assert body == {"on_sale": True, "plans": [{
        "id": "pro", "name": "Pro", "amount": PRICE, "currency": "INR", "features": [
            {"id": "playbook", "name": "Contribution playbook", "per_month": 10,
             "unlimited": False},
            {"id": "recommendations", "name": "Repository recommendations",
             "per_month": None, "unlimited": True}]}]}


@pytest.mark.parametrize("enabled,keys", [(False, True), (True, False), (False, False)])
def test_switched_off_offers_nothing_and_refuses_to_subscribe(make_hs, enabled, keys):
    h = make_hs(enabled=enabled, keys=keys)
    assert h.get("/v1/plans").json() == {"on_sale": False, "plans": []}
    r = h.post("/v1/me/subscription", {"plan": "pro"}, user="sub")
    assert r.status_code == 403 and r.json()["error"]["code"] == "payments_off"
    assert rows(h, Subscription) == []
    if h.rz is not None:
        assert h.rz.calls == []


def test_the_payments_switch_does_not_turn_plans_on(make_hs):
    h = make_hs(enabled=False, HOLT_PAYMENTS_ENABLED=True)
    assert h.get("/v1/plans").json()["on_sale"] is False
    assert h.post("/v1/me/subscription", {"plan": "pro"}, user="sub").status_code == 403


def test_subscriptions_are_off_by_default(tmp_path):
    from conftest import make_settings

    assert make_settings(tmp_path).subscriptions_enabled is False


def test_the_packaged_pricing_file_offers_no_plan(make_harness):
    h = make_harness(HOLT_SUBSCRIPTIONS_ENABLED=True)
    h.svc.razorpay = FakeRazorpay()
    assert h.get("/v1/plans").json() == {"on_sale": False, "plans": []}
    assert h.post("/v1/me/subscription", {"plan": "pro"}, user="u").status_code == 400


def test_plans_need_the_internal_key(hs):
    assert hs.client.get("/v1/plans").status_code == 401


@pytest.mark.parametrize("plan", ["free", "team", "nope"])
def test_only_a_plan_on_sale_can_be_subscribed_to(hs, plan):
    r = hs.post("/v1/me/subscription", {"plan": plan}, user="sub")
    assert r.status_code == 400
    assert hs.rz.calls == []


def test_subscribing_needs_sign_in(hs):
    assert hs.post("/v1/me/subscription", {"plan": "pro"}).status_code == 401


# --- starting a subscription -----------------------------------------------------------


def test_subscribe_creates_a_razorpay_subscription_for_the_catalogue_plan(hs):
    body = subscribe(hs)
    sid = body["provider_subscription_id"]
    assert body["amount"] == PRICE and body["currency"] == "INR" and body["key_id"] == KEY_ID
    assert body["plan"] == "pro" and body["provider"] == "razorpay"
    made = [c for c in hs.rz.calls if c[1] == "/subscriptions"]
    assert made[0][2]["plan_id"] == RZ_PLAN
    assert made[0][2]["notes"]["holt_subscription"] == body["subscription_id"]
    (row,) = rows(hs, Subscription)
    assert (row.status, row.provider_subscription_id, row.amount) == ("created", sid, PRICE)
    # Nothing is given before a payment.
    assert plan_of(hs) == ("free", None)


def test_a_razorpay_plan_charging_another_price_is_refused(hs):
    hs.rz.plans[RZ_PLAN]["item"]["amount"] = PRICE + 100
    r = hs.post("/v1/me/subscription", {"plan": "pro"}, user="sub")
    assert r.status_code == 502
    assert rows(hs, Subscription) == []
    assert not any(c[1] == "/subscriptions" for c in hs.rz.calls)


def test_reopening_checkout_reuses_the_unpaid_subscription(hs):
    first = subscribe(hs)
    again = subscribe(hs)
    assert again["provider_subscription_id"] == first["provider_subscription_id"]
    assert len(rows(hs, Subscription)) == 1


def test_cannot_subscribe_twice(hs):
    started(hs)
    r = hs.post("/v1/me/subscription", {"plan": "pro"}, user="sub")
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_subscribed"


def test_razorpay_down_when_subscribing(hs):
    hs.rz.fail = True
    r = hs.post("/v1/me/subscription", {"plan": "pro"}, user="sub")
    assert r.status_code == 502 and rows(hs, Subscription) == []


# --- the signed checkout -----------------------------------------------------------------


def test_confirm_starts_the_plan_until_the_paid_period_ends_plus_grace(hs):
    sid = subscribe(hs)["provider_subscription_id"]
    cb = hs.rz.pay(sid)
    r = confirm(hs, cb)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plan"] == "pro"
    assert body["plan_expires_at"] == iso(T0 + 30 * DAY, GRACE)
    assert body["subscription"]["status"] == "active"
    assert body["subscription"]["paid_until"] == iso(T0 + 30 * DAY)
    assert body["subscription"]["next_charge_at"] == iso(T0 + 30 * DAY)
    assert plan_of(hs) == ("pro", iso(T0 + 30 * DAY, GRACE))
    (c,) = rows(hs, SubscriptionCharge)
    assert (c.provider_payment_id, c.amount, c.status) == (cb["razorpay_payment_id"], PRICE,
                                                           "paid")
    (ev,) = rows(hs, PlanEvent)
    assert (ev.plan, ev.actor, ev.reference) == ("pro", "razorpay", sid)
    # The plan unlocks the plan-only feature.
    ent = {f["feature"]: f for f in hs.get("/v1/me/entitlements", user="sub").json()["features"]}
    assert ent["recommendations"]["allowed"] is True


@pytest.mark.parametrize("bad", [
    lambda cb: {**cb, "razorpay_signature": "0" * 64},
    lambda cb: {**cb, "razorpay_signature": ""},
    # An order's signature order (subscription|payment) is not a subscription's.
    lambda cb: {**cb, "razorpay_signature": payments.sign(
        SECRET, f"{cb['razorpay_subscription_id']}|{cb['razorpay_payment_id']}")},
    lambda cb: {**cb, "razorpay_signature": payments.sign(
        "another-secret", f"{cb['razorpay_payment_id']}|{cb['razorpay_subscription_id']}")},
    lambda cb: {**cb, "razorpay_subscription_id": "sub_Other"},
])
def test_confirm_with_a_bad_signature_gives_nothing(hs, bad):
    sid = subscribe(hs)["provider_subscription_id"]
    cb = hs.rz.pay(sid)
    calls = len(hs.rz.calls)
    r = confirm(hs, bad(cb))
    assert r.status_code == 400 and r.json()["error"]["code"] == "payment_unconfirmed"
    assert plan_of(hs) == ("free", None)
    assert rows(hs, SubscriptionCharge) == []
    # Refused before asking Razorpay anything.
    assert len(hs.rz.calls) == calls


def test_confirm_for_someone_elses_subscription(hs):
    sid = subscribe(hs, "alice")["provider_subscription_id"]
    cb = hs.rz.pay(sid)
    r = confirm(hs, cb, user="mallory")
    assert r.status_code == 404
    assert plan_of(hs, "mallory") == ("free", None) and plan_of(hs, "alice") == ("free", None)


def test_confirm_replayed_changes_nothing(hs):
    sid, cb = started(hs)
    before = plan_of(hs)
    for _ in range(3):
        assert confirm(hs, cb).status_code == 200
    assert plan_of(hs) == before
    assert len(rows(hs, SubscriptionCharge)) == 1
    assert len(rows(hs, PlanEvent)) == 1


def test_confirm_before_razorpay_activates_waits_for_the_webhook(hs):
    sid = subscribe(hs)["provider_subscription_id"]
    cb = hs.rz.pay(sid)
    hs.rz.subs[sid].update(status="authenticated", current_start=None, current_end=None)
    assert confirm(hs, cb).json()["subscription"]["status"] == "authenticated"
    assert plan_of(hs) == ("free", None)
    sub, payment = charge(hs, sid, 0)
    payment["id"] = cb["razorpay_payment_id"]
    assert hook(hs, "subscription.charged", sub, payment) == "charged"
    assert plan_of(hs)[0] == "pro"


def test_confirm_then_the_charged_webhook_for_the_same_payment(hs):
    sid, cb = started(hs)
    sub, payment = charge(hs, sid, 0)
    payment["id"] = cb["razorpay_payment_id"]
    assert hook(hs, "subscription.charged", sub, payment) == "already_charged"
    assert hook(hs, "subscription.activated", sub) == "unchanged"
    assert len(rows(hs, SubscriptionCharge)) == 1 and len(rows(hs, PlanEvent)) == 1


# --- webhooks ------------------------------------------------------------------------------


def test_webhook_with_a_bad_signature_is_refused(hs):
    sid = subscribe(hs)["provider_subscription_id"]
    sub, payment = charge(hs, sid, 0)
    body = hook_body("subscription.charged", sub, payment)
    assert webhook(hs, body, signature=None).status_code == 400
    assert webhook(hs, body, signature=payments.sign("nope", body)).status_code == 400
    # Signed, then changed.
    sig = payments.sign(HOOK_SECRET, body)
    assert webhook(hs, body.replace(b"19900", b"99"), signature=sig).status_code == 400
    assert plan_of(hs) == ("free", None) and rows(hs, SubscriptionCharge) == []


def test_each_renewal_extends_the_plan_once(hs):
    sid, _ = started(hs)
    for period in (1, 2):
        sub, payment = charge(hs, sid, period)
        assert hook(hs, "subscription.charged", sub, payment) == "charged"
        # Replays (Razorpay retries deliveries) change nothing.
        assert hook(hs, "subscription.charged", sub, payment) == "already_charged"
        assert plan_of(hs) == ("pro", iso(T0 + 30 * DAY * (period + 1), GRACE))
    assert len(rows(hs, SubscriptionCharge)) == 3
    assert len(rows(hs, PlanEvent)) == 3
    history = hs.get("/v1/me/subscription", user="sub").json()
    assert [c["period_end"] for c in history["charges"]] == [
        iso(T0 + 90 * DAY), iso(T0 + 60 * DAY), iso(T0 + 30 * DAY)]
    assert history["subscription"]["paid_until"] == iso(T0 + 90 * DAY)


def test_charges_out_of_order_never_move_the_plan_back(hs):
    sid = subscribe(hs)["provider_subscription_id"]
    late = charge(hs, sid, 0)
    newer = charge(hs, sid, 1)
    assert hook(hs, "subscription.charged", *newer) == "charged"
    assert hook(hs, "subscription.charged", *late) == "stale"
    assert hook(hs, "subscription.activated", late[0]) == "stale"
    assert plan_of(hs) == ("pro", iso(T0 + 60 * DAY, GRACE))
    # The late payment still shows in the history.
    assert len(rows(hs, SubscriptionCharge)) == 2


def test_a_charge_for_the_wrong_amount_is_held(hs):
    sid = subscribe(hs)["provider_subscription_id"]
    sub, payment = charge(hs, sid, 0, amount=100)
    assert hook(hs, "subscription.charged", sub, payment) == "held"
    assert plan_of(hs) == ("free", None)
    (c,) = rows(hs, SubscriptionCharge)
    assert c.status == "held"


def test_a_failed_renewal_keeps_the_plan_through_the_grace_period_then_halts(hs):
    sid, _ = started(hs)
    pending = entity(hs, sid, status="pending", current_start=T0 + 30 * DAY,
                     current_end=T0 + 60 * DAY)
    assert hook(hs, "subscription.pending", pending) == "pending"
    # Unpaid: the new period isn't given, the grace period stands.
    assert plan_of(hs) == ("pro", iso(T0 + 30 * DAY, GRACE))
    assert hook(hs, "subscription.halted", {**pending, "status": "halted"}) == "halted"
    assert plan_of(hs) == ("free", None)
    info = hs.get("/v1/me/subscription", user="sub").json()["subscription"]
    assert info["status"] == "halted" and info["next_charge_at"] is None
    # A late "pending" for the same period doesn't bring it back.
    assert hook(hs, "subscription.pending", pending) == "stale"
    assert plan_of(hs) == ("free", None)


def test_a_retry_that_succeeds_after_pending_extends_the_plan(hs):
    sid, _ = started(hs)
    pending = entity(hs, sid, status="pending", current_start=T0 + 30 * DAY,
                     current_end=T0 + 60 * DAY)
    hook(hs, "subscription.pending", pending)
    assert hook(hs, "subscription.charged", *charge(hs, sid, 1)) == "charged"
    assert plan_of(hs) == ("pro", iso(T0 + 60 * DAY, GRACE))


def test_subscribing_again_after_a_halt_ends_the_old_one(hs):
    sid, _ = started(hs)
    hook(hs, "subscription.halted", entity(hs, sid, status="halted"))
    new = subscribe(hs)["provider_subscription_id"]
    assert new != sid
    assert hs.rz.subs[sid]["status"] == "cancelled"
    old = next(r for r in rows(hs, Subscription) if r.provider_subscription_id == sid)
    assert old.status == "cancelled"
    # A late payment on the old one gives nothing and doesn't block the new one.
    assert hook(hs, "subscription.charged", *charge(hs, sid, 1)) == "ended"


def test_halted_arriving_late_after_a_newer_charge_is_ignored(hs):
    sid, _ = started(hs)
    halted = entity(hs, sid, status="halted")
    assert hook(hs, "subscription.charged", *charge(hs, sid, 1)) == "charged"
    assert hook(hs, "subscription.halted", halted) == "stale"
    assert plan_of(hs)[0] == "pro"


def test_cancelled_ends_the_plan_with_the_paid_period(hs):
    sid, _ = started(hs)
    ended = entity(hs, sid, status="cancelled", ended_at=T0 + 2 * DAY)
    assert hook(hs, "subscription.cancelled", ended) == "cancelled"
    # No grace after a cancel.
    assert plan_of(hs) == ("pro", iso(T0 + 30 * DAY))
    assert hook(hs, "subscription.cancelled", ended) == "already_ended"
    # Nothing brings it back: not a late activated, not a late charge.
    assert hook(hs, "subscription.activated", entity(hs, sid)) == "ended"
    assert hook(hs, "subscription.charged", *charge(hs, sid, 1)) == "ended"
    assert plan_of(hs) == ("pro", iso(T0 + 30 * DAY))


def test_cancelled_after_the_paid_period_downgrades_now(hs):
    sid = subscribe(hs)["provider_subscription_id"]
    old = T0 - 33 * DAY
    sub = entity(hs, sid, status="active", current_start=old, current_end=old + 30 * DAY)
    payment = {"id": "pay_Old1", "status": "captured", "amount": PRICE, "currency": "INR"}
    hook(hs, "subscription.charged", sub, payment)
    assert plan_of(hs)[0] == "pro"  # still inside the grace period
    assert hook(hs, "subscription.cancelled", {**sub, "status": "cancelled"}) == "cancelled"
    assert plan_of(hs) == ("free", None)


def test_completed_ends_the_plan_with_the_paid_period(hs):
    sid, _ = started(hs)
    assert hook(hs, "subscription.completed", entity(hs, sid, status="completed")) == "completed"
    assert plan_of(hs) == ("pro", iso(T0 + 30 * DAY))


def test_cancelled_before_activated_is_never_revived(hs):
    sid = subscribe(hs)["provider_subscription_id"]
    assert hook(hs, "subscription.cancelled", entity(hs, sid, status="cancelled")) == "cancelled"
    sub, payment = charge(hs, sid, 0)
    assert hook(hs, "subscription.activated", sub) == "ended"
    assert hook(hs, "subscription.charged", sub, payment) == "ended"
    assert plan_of(hs) == ("free", None)


def test_webhook_for_an_unknown_subscription_is_acknowledged(hs):
    sub = {"id": "sub_Nobody", "status": "active", "current_end": T0 + 30 * DAY}
    assert hook(hs, "subscription.activated", sub) == "unknown_subscription"
    assert hook(hs, "subscription.updated", sub) == "ignored"


def test_a_webhook_never_takes_away_an_admin_grant(hs):
    from holt_server import entitlements

    sid, _ = started(hs)
    hs.client.portal.call(lambda: entitlements.set_plan(
        hs.svc, "sub", "pro", expires_at=None, reason="gift", actor="admin"))
    assert hook(hs, "subscription.halted", entity(hs, sid, status="halted")) == "halted"
    assert plan_of(hs) == ("pro", None)


def test_webhooks_still_settle_existing_subscriptions_with_the_switch_off(make_hs):
    h = make_hs()
    sid, _ = started(h)
    h.svc.settings.subscriptions_enabled = False
    assert hook(h, "subscription.charged", *charge(h, sid, 1)) == "charged"
    assert plan_of(h) == ("pro", iso(T0 + 60 * DAY, GRACE))


def test_concurrent_deliveries_of_one_charge_record_it_once(hs):
    import asyncio

    sid = subscribe(hs)["provider_subscription_id"]
    sub, payment = charge(hs, sid, 0)

    async def many():
        return await asyncio.gather(*[
            subscriptions.apply(hs.svc, k, sub, payment if k == "charged" else None)
            for k in ("charged", "activated", "charged", "charged", "activated")])

    results = hs.client.portal.call(many)
    assert results.count("charged") == 1
    assert len(rows(hs, SubscriptionCharge)) == 1
    assert plan_of(hs) == ("pro", iso(T0 + 30 * DAY, GRACE))


# --- cancelling from settings ------------------------------------------------------------------


def test_cancel_stops_renewing_and_keeps_the_plan_to_the_period_end(hs):
    sid, _ = started(hs)
    r = hs.post("/v1/me/subscription/cancel", {}, user="sub")
    assert r.status_code == 200, r.text
    body = r.json()
    assert hs.rz.subs[sid]["cancel_body"] == {"cancel_at_cycle_end": 1}
    assert body["subscription"]["cancel_at_period_end"] is True
    assert body["subscription"]["next_charge_at"] is None
    assert body["plan"] == "pro" and body["plan_expires_at"] == iso(T0 + 30 * DAY)
    # Again: nothing more happens.
    calls = len(hs.rz.calls)
    assert hs.post("/v1/me/subscription/cancel", {}, user="sub").status_code == 200
    assert len(hs.rz.calls) == calls
    # Razorpay says so at the end of the period.
    ended = entity(hs, sid, status="cancelled")
    assert hook(hs, "subscription.cancelled", ended) == "cancelled"
    assert plan_of(hs) == ("pro", iso(T0 + 30 * DAY))


def test_cancel_while_a_renewal_is_failing_stops_now(hs):
    sid, _ = started(hs)
    hook(hs, "subscription.pending", entity(hs, sid, status="pending"))
    body = hs.post("/v1/me/subscription/cancel", {}, user="sub").json()
    assert hs.rz.subs[sid]["cancel_body"] == {"cancel_at_cycle_end": 0}
    assert body["subscription"]["status"] == "cancelled"
    # The paid period (T0 .. T0+30d) is still running: the plan runs to its end.
    assert plan_of(hs) == ("pro", iso(T0 + 30 * DAY))


def test_cancel_an_unpaid_checkout(hs):
    sid = subscribe(hs)["provider_subscription_id"]
    body = hs.post("/v1/me/subscription/cancel", {}, user="sub").json()
    assert body["subscription"]["status"] == "cancelled"
    assert plan_of(hs) == ("free", None)
    # And a new one can be started.
    assert subscribe(hs)["provider_subscription_id"] != sid


def test_cancel_works_with_the_switch_off(make_hs):
    h = make_hs()
    started(h)
    h.svc.settings.subscriptions_enabled = False
    assert h.post("/v1/me/subscription/cancel", {}, user="sub").status_code == 200


def test_cancel_with_nothing_to_cancel(hs):
    assert hs.post("/v1/me/subscription/cancel", {}, user="sub").status_code == 404


def test_cancel_when_razorpay_is_down_changes_nothing(hs):
    started(hs)
    before = plan_of(hs)
    hs.rz.fail = True
    assert hs.post("/v1/me/subscription/cancel", {}, user="sub").status_code == 502
    assert plan_of(hs) == before
    assert rows(hs, Subscription)[0].cancel_at_period_end is False


# --- what settings shows ---------------------------------------------------------------------


def test_my_subscription_leaves_out_unpaid_checkouts(hs):
    assert hs.get("/v1/me/subscription", user="sub").json() == {"subscription": None,
                                                                "charges": []}
    subscribe(hs)
    assert hs.get("/v1/me/subscription", user="sub").json()["subscription"] is None


def test_my_subscription_is_only_mine(hs):
    started(hs, "alice")
    assert hs.get("/v1/me/subscription", user="bob").json() == {"subscription": None,
                                                              "charges": []}
    assert hs.get("/v1/me/subscription").status_code == 401


def test_plan_lapses_when_the_grace_period_passes_without_a_charge(hs):
    sid, _ = started(hs)
    u = user_row(hs)
    assert u.plan == "pro"

    async def expire():
        async with hs.svc.db.session() as s:
            row = await s.get(User, "sub")
            row.plan_expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await s.commit()

    hs.client.portal.call(expire)
    assert plan_of(hs)[0] == "free"
