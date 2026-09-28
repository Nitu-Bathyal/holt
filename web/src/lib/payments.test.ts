import assert from "node:assert/strict";
import { test } from "node:test";
import { canCancel, creditsLabel, expiryLine, formatPrice, isOrderId, packToBuy, planFeatureLine, subscriptionLabel, subscriptionLine } from "./payments.ts";

test("prices are shown in rupees from paise", () => {
  assert.equal(formatPrice(49900, "INR"), "₹499");
  assert.equal(formatPrice(49950, "INR"), "₹499.50");
  assert.equal(formatPrice(150000, "INR"), "₹1,500");
});

test("credits and expiry in words", () => {
  assert.equal(creditsLabel(1), "1 credit");
  assert.equal(creditsLabel(10), "10 credits");
  assert.equal(expiryLine({ expires_days: null }), "Credits never expire");
  assert.equal(expiryLine({ expires_days: 365 }), "Credits last 1 year");
  assert.equal(expiryLine({ expires_days: 90 }), "Credits last 3 months");
  assert.equal(expiryLine({ expires_days: 45 }), "Credits last 45 days");
});

test("order ids and the pack to buy are checked", () => {
  assert.equal(isOrderId("0123456789abcdef0123456789abcdef"), true);
  assert.equal(isOrderId("../x"), false);
  assert.equal(isOrderId(undefined), false);
  const packs = [{ id: "credits_10", name: "10 credits", credits: 10, expires_days: null, amount: 49900, currency: "INR" }];
  assert.equal(packToBuy("credits_10", packs), "credits_10");
  assert.equal(packToBuy("credits_99", packs), null);
  assert.equal(packToBuy(["credits_10"], packs), null);
});

const SUB = {
  id: "s1", plan: "pro", name: "Pro", status: "active" as const, amount: 19900, currency: "INR",
  paid_until: "2026-10-28T10:00:00Z", next_charge_at: "2026-10-28T10:00:00Z",
  cancel_at_period_end: false, created_at: "2026-09-28T10:00:00Z", ended_at: null,
};

test("a subscription's state in one sentence", () => {
  assert.equal(subscriptionLine(SUB, "2026-11-04T10:00:00Z"), "Next charge: ₹199 on 28 Oct 2026.");
  assert.equal(subscriptionLabel(SUB), "Active");
  const cancelled = { ...SUB, cancel_at_period_end: true, next_charge_at: null };
  assert.equal(subscriptionLabel(cancelled), "Cancelled");
  assert.equal(subscriptionLine(cancelled, "2026-10-28T10:00:00Z"), "You won't be charged again. Your plan stays until 28 Oct 2026.");
  assert.match(subscriptionLine({ ...SUB, status: "pending" }, "2026-11-04T10:00:00Z"), /try again, and your plan keeps working until 4 Nov 2026/);
  assert.equal(subscriptionLine({ ...SUB, status: "cancelled" }, null), "No more charges. You're on the free plan.");
  assert.equal(canCancel(SUB), true);
  assert.equal(canCancel(cancelled), false);
  assert.equal(canCancel({ ...SUB, status: "halted" }), false);
});

test("plan features in words", () => {
  assert.equal(planFeatureLine({ id: "playbook", name: "Contribution playbook", per_month: 10, unlimited: false }), "Contribution playbook, 10 a month");
  assert.equal(planFeatureLine({ id: "r", name: "Repository recommendations", per_month: null, unlimited: true }), "Repository recommendations, unlimited");
});
