import { test } from "node:test";
import assert from "node:assert/strict";
import { pageBefore } from "./in-app-history.ts";

test("back from a report skips its own report and merge plan, however often they alternate", () => {
  const shown = ["/find?langs=go", "/o/r", "/o/r?mode=ai", "/O/R"];
  assert.equal(pageBefore("/o/r", shown), "/find?langs=go");
  assert.equal(pageBefore("/o/r", ["/o/r"]), null);
  assert.equal(pageBefore("/o/r", []), null);
  assert.equal(pageBefore("/x/y", ["/me", "/o/r", "/x/y"]), "/o/r");
});
