import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetFrom, reportHref } from "./budget.ts";

test("reads the budget from the query, defaulting to a week", () => {
  assert.equal(budgetFrom("14"), 14);
  assert.equal(budgetFrom(["30", "7"]), 30);
  assert.equal(budgetFrom(undefined), 7);
  assert.equal(budgetFrom("0"), 7);
  assert.equal(budgetFrom("365"), 7);
  assert.equal(budgetFrom("abc"), 7);
});

test("links keep the budget and the tab, and drop the default", () => {
  assert.equal(reportHref("pallets/flask", 7), "/pallets/flask");
  assert.equal(reportHref("pallets/flask", 14), "/pallets/flask?days=14");
  assert.equal(reportHref("pallets/flask", 30, "ai"), "/pallets/flask?mode=ai&days=30");
});
