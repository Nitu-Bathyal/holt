"""Credit-pack checkout (payments.py): orders, the signed callback, the signed
webhook, and the switch that keeps it all off.

Razorpay is faked at the HTTP layer (`FakeRazorpay._call`), so the signature
checks are the real ones. Every test that credits ends on the ledger invariant:
purchased ledger rows sum to what the lots hold, and one lot per paid order.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from holt_server import payments
from holt_server.db import CreditEvent, CreditLot, Order
from sqlalchemy import select

KEY_ID = "rzp_test_fake"
SECRET = "fake-key-secret"
HOOK_SECRET = "fake-webhook-secret"
PRICE = 49900

CATALOGUE = {
    "tbd": False,
    "features": {"ai_report": {"name": "AI-written report", "credits": 1, "free_credits": True}},
    "plans": {"free": {"name": "Free", "features": {}}},
    "packs": {
        "credits_10": {"name": "10 credits", "credits": 10, "on_sale": True,
                       "price": {"inr_paise": PRICE, "usd_cents": None}},
        "credits_5_90d": {"name": "5 credits", "credits": 5, "on_sale": True,
                          "expires_days": 90, "price": {"inr_paise": 29900}},
        "not_yet": {"name": "50 credits", "credits": 50, "on_sale": False,
                    "price": {"inr_paise": 99900}},
        "no_price": {"name": "20 credits", "credits": 20, "on_sale": True},
    },
}


class FakeRazorpay(payments.Razorpay):
    """Razorpay's orders and payments, in memory. Only `_call` is fake."""

    def __init__(self) -> None:
        super().__init__(KEY_ID, SECRET, HOOK_SECRET)
        self.orders: dict[str, dict] = {}
        self.payments: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []
        self.fail = False
        self.lock = threading.Lock()
        self._ids = itertools.count(1)

    def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict:
        with self.lock:
            self.calls.append((method, path))
            if self.fail:
                raise payments.ProviderError(f"razorpay {path}: HTTP 500")
            if path == "/orders":
                oid = f"order_T{next(self._ids)}"
                self.orders[oid] = {"id": oid, "amount": body["amount"],
                                    "currency": body["currency"], "notes": body["notes"]}
                return dict(self.orders[oid])
            pid = path.split("/")[2]
            if pid not in self.payments:
                raise payments.ProviderError(f"razorpay {path}: HTTP 400 no such payment")
            p = self.payments[pid]
            if path.endswith("/capture"):
                if p["status"] != "authorized":
                    raise payments.ProviderError(f"razorpay {path}: HTTP 400 already captured")
                p["status"] = "captured"
            return dict(p)

    def pay(self, order_id: str, *, status: str = "captured", amount: int | None = None,
            currency: str = "INR") -> dict:
        """What Checkout would hand the page after a payment on `order_id`."""
        pid = f"pay_T{next(self._ids)}"
        self.payments[pid] = {
            "id": pid, "entity": "payment", "order_id": order_id, "status": status,
            "amount": self.orders[order_id]["amount"] if amount is None else amount,
            "currency": currency,
        }
        return {"razorpay_order_id": order_id, "razorpay_payment_id": pid,
                "razorpay_signature": payments.sign(SECRET, f"{order_id}|{pid}")}


@pytest.fixture
def pricing_file(tmp_path):
    path = tmp_path / "pricing.json"
    path.write_text(json.dumps(CATALOGUE), encoding="utf-8")
    return str(path)


@pytest.fixture
def make_hp(make_harness, pricing_file):
    def build(enabled: bool = True, keys: bool = True, **overrides):
        h = make_harness(HOLT_PRICING_FILE=pricing_file, HOLT_PAYMENTS_ENABLED=enabled,
                         **overrides)
        h.rz = FakeRazorpay() if keys else None
        h.svc.razorpay = h.rz
        return h
    return build


@pytest.fixture
def hp(make_hp):
    return make_hp()


def rows(h, model):
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(model))).scalars().all()
    return h.client.portal.call(q)


def purchased(h, user: str) -> int:
    return h.get("/v1/me/credits", user=user).json()["purchased"]


def assert_ledger_matches(h, user: str) -> None:
    lots = [lot for lot in rows(h, CreditLot) if lot.user_id == user]
    events = [e for e in rows(h, CreditEvent) if e.user_id == user and e.source == "purchased"]
    assert sum(e.amount for e in events) == sum(lot.remaining for lot in lots)
    paid = [o for o in rows(h, Order) if o.user_id == user and o.status == "paid"]
    assert sorted(o.lot_id for o in paid) == sorted(lot.id for lot in lots)


def checkout(h, user: str = "buyer", pack: str = "credits_10") -> dict:
    r = h.post("/v1/me/orders", {"pack": pack}, user=user)
    assert r.status_code == 200, r.text
    return r.json()


def confirm(h, cb: dict, user: str = "buyer"):
    return h.post("/v1/me/orders/confirm", cb, user=user)


def hook_body(event: str, payment: dict) -> bytes:
    return json.dumps({"entity": "event", "event": event, "contains": ["payment"],
                       "payload": {"payment": {"entity": payment}}}).encode()


def webhook(h, body: bytes, signature: str | None = "auto"):
    sig = payments.sign(HOOK_SECRET, body) if signature == "auto" else signature
    headers = {**h.headers(), "Content-Type": "application/json"}
    if sig is not None:
        headers["X-Razorpay-Signature"] = sig
    return h.client.post("/v1/payments/razorpay/webhook", content=body, headers=headers)


# --- what is on sale ---------------------------------------------------------------


def test_packs_on_sale_come_from_the_pricing_file(hp):
    body = hp.get("/v1/packs").json()
    assert body["on_sale"] is True
    assert body["packs"] == [
        {"id": "credits_10", "name": "10 credits", "credits": 10, "expires_days": None,
         "amount": PRICE, "currency": "INR"},
        {"id": "credits_5_90d", "name": "5 credits", "credits": 5, "expires_days": 90,
         "amount": 29900, "currency": "INR"},
    ]


def test_the_packaged_pricing_file_sells_nothing(make_harness):
    h = make_harness(HOLT_PAYMENTS_ENABLED=True)
    h.svc.razorpay = FakeRazorpay()
    assert h.get("/v1/packs").json() == {"on_sale": False, "packs": []}
    assert h.post("/v1/me/orders", {"pack": "credits_10"}, user="u").status_code == 400


@pytest.mark.parametrize("enabled,keys", [(False, True), (True, False), (False, False)])
def test_switched_off_offers_nothing_and_refuses_orders(make_hp, enabled, keys):
    h = make_hp(enabled=enabled, keys=keys)
    assert h.get("/v1/packs").json() == {"on_sale": False, "packs": []}
    r = h.post("/v1/me/orders", {"pack": "credits_10"}, user="buyer")
    assert r.status_code == 403 and r.json()["error"]["code"] == "payments_off"
    assert rows(h, Order) == []
    if h.rz is not None:
        assert h.rz.calls == []


def test_payments_are_off_by_default(tmp_path):
    from conftest import make_settings

    s = make_settings(tmp_path)
    assert s.payments_enabled is False
    assert payments.build(s) is None


def test_packs_need_the_internal_key(hp):
    assert hp.client.get("/v1/packs").status_code == 401


# --- creating an order -----------------------------------------------------------------


def test_an_order_takes_its_price_from_the_server(hp):
    out = checkout(hp)
    assert out["provider"] == "razorpay" and out["key_id"] == KEY_ID
    assert out["amount"] == PRICE and out["currency"] == "INR" and out["credits"] == 10
    rz_order = hp.rz.orders[out["provider_order_id"]]
    assert rz_order["amount"] == PRICE and rz_order["notes"]["holt_order"] == out["order_id"]
    (order,) = rows(hp, Order)
    assert (order.user_id, order.status, order.amount, order.credits) == ("buyer", "created",
                                                                         PRICE, 10)


def test_the_client_cannot_set_the_amount(hp):
    r = hp.post("/v1/me/orders", {"pack": "credits_10", "amount": 100, "credits": 999},
                user="buyer")
    assert r.status_code == 200
    assert r.json()["amount"] == PRICE and r.json()["credits"] == 10
    assert rows(hp, Order)[0].amount == PRICE


@pytest.mark.parametrize("pack", ["not_yet", "no_price", "nope"])
def test_packs_not_on_sale_cannot_be_ordered(hp, pack):
    r = hp.post("/v1/me/orders", {"pack": pack}, user="buyer")
    assert r.status_code == 400 and "isn't on sale" in r.json()["error"]["message"]
    assert hp.rz.calls == []


def test_ordering_needs_a_signed_in_user(hp):
    assert hp.post("/v1/me/orders", {"pack": "credits_10"}).status_code == 401


def test_razorpay_failing_creates_no_order(hp):
    hp.rz.fail = True
    r = hp.post("/v1/me/orders", {"pack": "credits_10"}, user="buyer")
    assert r.status_code == 502 and "Razorpay" in r.json()["error"]["message"]
    assert rows(hp, Order) == []


# --- the client callback ------------------------------------------------------------------


def test_a_signed_callback_credits_the_pack_once(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"])
    r = confirm(hp, cb)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["order"]["status"] == "paid" and body["order"]["name"] == "10 credits"
    assert body["credits"]["purchased"] == 10 and body["credits"]["free"] == 3
    # Replayed: same answer, nothing more.
    assert confirm(hp, cb).json()["order"]["status"] == "paid"
    assert purchased(hp, "buyer") == 10
    (lot,) = rows(hp, CreditLot)
    assert (lot.reference, lot.pack_id, lot.granted, lot.expires_at) == (
        cb["razorpay_payment_id"], "credits_10", 10, None)
    assert_ledger_matches(hp, "buyer")


def test_pack_expiry_starts_when_paid(hp):
    out = checkout(hp, pack="credits_5_90d")
    confirm(hp, hp.rz.pay(out["provider_order_id"]))
    (lot,) = rows(hp, CreditLot)
    assert lot.expires_at is not None
    assert purchased(hp, "buyer") == 5


@pytest.mark.parametrize("change", ["signature", "payment", "order"])
def test_a_bad_signature_credits_nothing(hp, change):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"])
    other = hp.rz.pay(checkout(hp)["provider_order_id"])
    if change == "signature":
        cb["razorpay_signature"] = payments.sign("not-the-secret", "x")
    elif change == "payment":  # someone else's payment id under this order's signature
        cb["razorpay_payment_id"] = other["razorpay_payment_id"]
    else:
        cb["razorpay_order_id"] = other["razorpay_order_id"]
    r = confirm(hp, cb)
    assert r.status_code == 400 and r.json()["error"]["code"] == "payment_unconfirmed"
    assert purchased(hp, "buyer") == 0 and rows(hp, CreditLot) == []


def test_malformed_ids_are_refused_before_any_call(hp):
    checkout(hp)
    before = list(hp.rz.calls)
    cb = {"razorpay_order_id": "order_T1", "razorpay_payment_id": "pay_../../orders",
          "razorpay_signature": payments.sign(SECRET, "order_T1|pay_../../orders")}
    assert confirm(hp, cb).status_code == 400
    assert hp.rz.calls == before


def test_someone_elses_order_is_not_found(hp):
    out = checkout(hp, user="buyer")
    r = confirm(hp, hp.rz.pay(out["provider_order_id"]), user="thief")
    assert r.status_code == 404
    assert rows(hp, CreditLot) == []


def test_a_tampered_amount_is_held_not_credited(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"], amount=100)
    r = confirm(hp, cb)
    assert r.status_code == 200 and r.json()["order"]["status"] == "held"
    assert purchased(hp, "buyer") == 0 and rows(hp, CreditLot) == []
    assert "was 100 INR" in rows(hp, Order)[0].note


def test_a_wrong_currency_is_held(hp):
    out = checkout(hp)
    r = confirm(hp, hp.rz.pay(out["provider_order_id"], currency="USD"))
    assert r.json()["order"]["status"] == "held"
    assert rows(hp, CreditLot) == []


def test_an_authorized_payment_is_captured_then_credited(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"], status="authorized")
    assert confirm(hp, cb).json()["order"]["status"] == "paid"
    assert hp.rz.payments[cb["razorpay_payment_id"]]["status"] == "captured"
    assert ("POST", f"/payments/{cb['razorpay_payment_id']}/capture") in hp.rz.calls
    assert purchased(hp, "buyer") == 10


def test_a_payment_still_processing_leaves_the_order_open(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"], status="created")
    assert confirm(hp, cb).json()["order"]["status"] == "created"
    assert purchased(hp, "buyer") == 0


def test_razorpay_down_during_confirm_credits_nothing_yet(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"])
    hp.rz.fail = True
    assert confirm(hp, cb).status_code == 502
    hp.rz.fail = False
    assert confirm(hp, cb).json()["order"]["status"] == "paid"
    assert purchased(hp, "buyer") == 10


# --- the webhook ---------------------------------------------------------------------------


def test_a_signed_webhook_credits_and_a_replay_does_not(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"])
    body = hook_body("payment.captured", hp.rz.payments[cb["razorpay_payment_id"]])
    r = webhook(hp, body)
    assert r.status_code == 200 and r.json()["result"] == "paid"
    assert webhook(hp, body).json()["result"] == "already_paid"
    # order.paid for the same payment, and the late client callback: nothing more.
    assert webhook(hp, hook_body("order.paid", hp.rz.payments[cb["razorpay_payment_id"]])
                   ).json()["result"] == "already_paid"
    assert confirm(hp, cb).json()["order"]["status"] == "paid"
    assert purchased(hp, "buyer") == 10
    assert len(rows(hp, CreditLot)) == 1
    assert_ledger_matches(hp, "buyer")


@pytest.mark.parametrize("signature", [None, "", "deadbeef",
                                       payments.sign(SECRET, b"x")])
def test_an_unsigned_or_badly_signed_webhook_is_refused(hp, signature):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"])
    body = hook_body("payment.captured", hp.rz.payments[cb["razorpay_payment_id"]])
    r = webhook(hp, body, signature=signature)
    assert r.status_code == 400
    assert rows(hp, CreditLot) == [] and rows(hp, Order)[0].status == "created"


def test_a_webhook_body_changed_after_signing_is_refused(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"], amount=100)
    real = hook_body("payment.captured", hp.rz.payments[cb["razorpay_payment_id"]])
    forged = real.replace(b'"amount": 100', f'"amount": {PRICE}'.encode())
    assert forged != real
    r = webhook(hp, forged, signature=payments.sign(HOOK_SECRET, real))
    assert r.status_code == 400
    assert rows(hp, CreditLot) == []


def test_a_signed_webhook_with_the_wrong_amount_is_held(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"], amount=PRICE - 1)
    body = hook_body("payment.captured", hp.rz.payments[cb["razorpay_payment_id"]])
    assert webhook(hp, body).json()["result"] == "held"
    assert rows(hp, CreditLot) == [] and rows(hp, Order)[0].status == "held"


def test_webhooks_are_refused_without_a_webhook_secret(make_hp):
    h = make_hp()
    h.rz._webhook_secret = ""
    body = hook_body("payment.captured", {"id": "pay_X", "order_id": "order_X"})
    assert webhook(h, body).status_code == 400


def test_webhooks_need_the_internal_key(hp):
    body = hook_body("payment.captured", {})
    r = hp.client.post("/v1/payments/razorpay/webhook", content=body,
                       headers={"X-Razorpay-Signature": payments.sign(HOOK_SECRET, body)})
    assert r.status_code == 401


def test_unknown_orders_and_other_events_are_acknowledged_and_ignored(hp):
    body = hook_body("payment.captured", {"id": "pay_Z", "order_id": "order_Z",
                                          "amount": PRICE, "currency": "INR",
                                          "status": "captured"})
    assert webhook(hp, body).json() == {"ok": True, "result": "unknown_order"}
    refund = json.dumps({"event": "refund.processed", "payload": {}}).encode()
    assert webhook(hp, refund).json() == {"ok": True, "result": "ignored"}
    assert rows(hp, CreditLot) == []


def test_a_failed_attempt_then_a_good_one_credits_once(hp):
    out = checkout(hp)
    oid = out["provider_order_id"]
    bad = hp.rz.pay(oid, status="failed")
    failed = hook_body("payment.failed", hp.rz.payments[bad["razorpay_payment_id"]])
    assert webhook(hp, failed).json()["result"] == "failed"
    assert rows(hp, Order)[0].status == "failed"
    good = hp.rz.pay(oid)
    assert confirm(hp, good).json()["order"]["status"] == "paid"
    # A late replay of the failure doesn't undo the payment.
    assert webhook(hp, failed).json()["result"] == "already_paid"
    assert rows(hp, Order)[0].status == "paid"
    assert purchased(hp, "buyer") == 10


def test_an_authorized_webhook_captures(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"], status="authorized")
    body = hook_body("payment.authorized", hp.rz.payments[cb["razorpay_payment_id"]])
    assert webhook(hp, body).json()["result"] == "paid"
    assert purchased(hp, "buyer") == 10


def test_one_payment_cannot_pay_two_orders(hp):
    a, b = checkout(hp), checkout(hp)
    cb = hp.rz.pay(a["provider_order_id"])
    confirm(hp, cb)
    # A (signed) event claiming the same payment paid order b.
    p = {**hp.rz.payments[cb["razorpay_payment_id"]], "order_id": b["provider_order_id"]}
    assert webhook(hp, hook_body("payment.captured", p)).json()["result"] == "already_paid"
    assert purchased(hp, "buyer") == 10
    assert {o.status for o in rows(hp, Order)} == {"paid", "created"}
    assert_ledger_matches(hp, "buyer")


def test_switching_payments_off_still_settles_orders_already_paid(make_hp, pricing_file):
    h = make_hp()
    out = checkout(h)
    cb = h.rz.pay(out["provider_order_id"])
    h.svc.settings.payments_enabled = False
    assert h.get("/v1/packs").json()["on_sale"] is False
    assert h.post("/v1/me/orders", {"pack": "credits_10"}, user="buyer").status_code == 403
    assert confirm(h, cb).json()["order"]["status"] == "paid"
    assert purchased(h, "buyer") == 10


# --- concurrency -------------------------------------------------------------------------


def test_callback_and_webhooks_racing_credit_once(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"])
    body = hook_body("payment.captured", hp.rz.payments[cb["razorpay_payment_id"]])
    jobs = [lambda: confirm(hp, cb)] * 4 + [lambda: webhook(hp, body)] * 4
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda f: f(), jobs))
    assert {r.status_code for r in results} == {200}
    assert purchased(hp, "buyer") == 10
    assert len(rows(hp, CreditLot)) == 1
    assert_ledger_matches(hp, "buyer")


def test_concurrent_credit_calls_add_one_lot(hp):
    out = checkout(hp)
    cb = hp.rz.pay(out["provider_order_id"])
    order_id, pid = out["order_id"], cb["razorpay_payment_id"]

    async def race():
        return await asyncio.gather(*(payments.credit(hp.svc, order_id, pid)
                                      for _ in range(8)))

    assert sorted(hp.client.portal.call(race)) == [False] * 7 + [True]
    assert purchased(hp, "buyer") == 10
    assert_ledger_matches(hp, "buyer")


# --- purchase history ---------------------------------------------------------------------


def test_purchase_history_lists_finished_orders_newest_first(hp):
    first = checkout(hp)
    confirm(hp, hp.rz.pay(first["provider_order_id"]))
    checkout(hp)  # opened, never paid: not a purchase
    third = checkout(hp, pack="credits_5_90d")
    confirm(hp, hp.rz.pay(third["provider_order_id"], amount=1))
    checkout(hp, user="someone-else")
    orders = hp.get("/v1/me/orders", user="buyer").json()["orders"]
    assert [(o["id"], o["status"]) for o in orders] == [
        (third["order_id"], "held"), (first["order_id"], "paid")]
    assert orders[1]["paid_at"] and orders[1]["name"] == "10 credits"
    assert hp.get("/v1/me/orders").status_code == 401
