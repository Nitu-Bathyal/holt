import assert from "node:assert/strict";
import { test } from "node:test";
import { areaHistoryHref, areaHref, areaLabel } from "./landing.ts";

const REPO = "pallets/flask";

test("a folder is written with a slash, a file and the root without", () => {
  assert.equal(areaLabel({ path: "docs" }), "docs/");
  assert.equal(areaLabel({ path: "src/flask/app.py", is_file: true }), "src/flask/app.py");
  assert.equal(areaLabel({ path: "(root)" }), "(root)");
});

test("a folder links to its tree, a file to its blob, the root to the repository", () => {
  assert.equal(areaHref(REPO, { path: "src/flask" }), "https://github.com/pallets/flask/tree/HEAD/src/flask");
  assert.equal(areaHref(REPO, { path: "src/flask/app.py", is_file: true }), "https://github.com/pallets/flask/blob/HEAD/src/flask/app.py");
  assert.equal(areaHref(REPO, { path: "(root)" }), "https://github.com/pallets/flask");
});

test("history links to the commits of that place", () => {
  assert.equal(areaHistoryHref(REPO, { path: "docs" }), "https://github.com/pallets/flask/commits/HEAD/docs");
  assert.equal(areaHistoryHref(REPO, { path: "(root)" }), "https://github.com/pallets/flask/commits/HEAD");
});

test("odd characters in a path are encoded, and a stray slash is dropped", () => {
  assert.equal(areaHref(REPO, { path: "/docs/a b#c/" }), "https://github.com/pallets/flask/tree/HEAD/docs/a%20b%23c");
  assert.equal(areaHref(REPO, { path: "" }), "https://github.com/pallets/flask");
  assert.ok(!areaHref(REPO, { path: "x?y=1" }).includes("?"));
});
