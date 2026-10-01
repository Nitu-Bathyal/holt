import assert from "node:assert/strict";
import { test } from "node:test";
import { quietSkip, REACT_SKIP_MESSAGE } from "./view-transition.ts";

test("Chrome's longer hidden-tab message becomes the one React ignores", () => {
  const e = { name: "InvalidStateError", message: "Transition was aborted because of invalid state. Document hidden" };
  assert.deepEqual(quietSkip(e), { name: "InvalidStateError", message: REACT_SKIP_MESSAGE, cause: e });
});

test("other errors pass through untouched", () => {
  const exact = { name: "InvalidStateError", message: REACT_SKIP_MESSAGE };
  const other = { name: "InvalidStateError", message: "Something else" };
  const abort = { name: "AbortError", message: "Transition was aborted because of invalid state. Document hidden" };
  for (const e of [exact, other, abort, null, "x"]) assert.equal(quietSkip(e), e);
});
