import assert from "node:assert/strict";
import { test } from "node:test";
import { areaLabel } from "./landing.ts";

test("a folder gets a trailing slash", () => {
  assert.equal(areaLabel({ path: "pkgs/by-name", is_file: false }), "pkgs/by-name/");
  // Reports cached before `is_file` existed are read as folders.
  assert.equal(areaLabel({ path: "docs" }), "docs/");
});

test("one file, or the root, doesn't", () => {
  assert.equal(areaLabel({ path: "tests/conftest.py", is_file: true }), "tests/conftest.py");
  assert.equal(areaLabel({ path: "(root)", is_file: false }), "(root)");
});
