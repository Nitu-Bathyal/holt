import assert from "node:assert/strict";
import { test } from "node:test";
import { creditsLabel, expiryLine, formatPrice, isOrderId, packToBuy } from "./payments.ts";

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
