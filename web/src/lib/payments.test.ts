import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPrice, isOrderId, passFeatureLine, passToBuy, perMonth } from "./payments.ts";

test("prices are shown in rupees from paise", () => {
  assert.equal(formatPrice(9900, "INR"), "₹99");
  assert.equal(formatPrice(49950, "INR"), "₹499.50");
  assert.equal(formatPrice(150000, "INR"), "₹1,500");
});

test("order ids and the pass to buy are checked", () => {
  assert.equal(isOrderId("0123456789abcdef0123456789abcdef"), true);
  assert.equal(isOrderId("../x"), false);
  assert.equal(isOrderId(undefined), false);
  const passes = [{ id: "pro_3m", name: "3 months", days: 90, amount: 24900, currency: "INR" }];
  assert.equal(passToBuy("pro_3m", passes), "pro_3m");
  assert.equal(passToBuy("pro_99m", passes), null);
  assert.equal(passToBuy(["pro_3m"], passes), null);
});

test("a longer pass says what it comes to a month", () => {
  assert.equal(perMonth(9900, 30, "INR"), null);
  assert.equal(perMonth(24900, 90, "INR"), "₹83 a month");
  assert.equal(perMonth(79900, 365, "INR"), "₹67 a month");
});

test("Pro features in words", () => {
  assert.equal(passFeatureLine({ id: "merge_plan", name: "Merge plan", per_month: 30, unlimited: false }), "Merge plan: 30 a month");
  assert.equal(passFeatureLine({ id: "pr_watch", name: "PR watch", per_month: null, unlimited: true }), "PR watch");
});
