import assert from "node:assert/strict";
import { test } from "node:test";
import { leftLabel, planOffer } from "./merge-plan-offer.ts";

const access = { feature: "merge_plan", name: "Merge plan", allowed: true, via: "plan" as const, cost: 0, left_this_month: null, code: null, message: null, left: 3 };

test("off when merge plans can't be made here, or signed out", () => {
  assert.deepEqual(planOffer({ available: false, access: null }), { kind: "off" });
  assert.deepEqual(planOffer({ available: false, access }), { kind: "off" });
  assert.deepEqual(planOffer({ available: true, access: null }), { kind: "off" });
});

test("make, with what is left of the allowance", () => {
  assert.deepEqual(planOffer({ available: true, access }), { kind: "make", left: 3 });
  assert.deepEqual(planOffer({ available: true, access: { ...access, left: null } }), { kind: "make", left: null });
});

test("locked with the server's reason", () => {
  const locked = { ...access, allowed: false, via: null, left: 0, code: "quota_exceeded", message: "You've used your free merge plans." };
  assert.deepEqual(planOffer({ available: true, access: locked }), { kind: "locked", message: "You've used your free merge plans." });
});

test("left labels", () => {
  assert.equal(leftLabel(3), "3 left");
  assert.equal(leftLabel(null), null);
});
