import { test } from "node:test";
import assert from "node:assert/strict";
import { contributingFileUrl } from "./contributing.ts";

test("contributing guide: GitHub's link to the contents API, only in this repo", () => {
  assert.equal(contributingFileUrl("https://github.com/o/r/blob/main/CONTRIBUTING.md", "o/r"), "https://api.github.com/repos/o/r/contents/CONTRIBUTING.md?ref=main");
  assert.equal(contributingFileUrl("https://github.com/O/R/blob/dev/.github/CONTRIBUTING.md", "o/r"), "https://api.github.com/repos/O/R/contents/.github/CONTRIBUTING.md?ref=dev");
  assert.equal(contributingFileUrl("https://github.com/o/r/blob/main/CONTRIBUTING", "o/r"), "https://api.github.com/repos/o/r/contents/CONTRIBUTING?ref=main");
  assert.equal(contributingFileUrl("https://github.com/x/y/blob/main/CONTRIBUTING.md", "o/r"), null);
  assert.equal(contributingFileUrl("https://example.org/contributing", "o/r"), null);
  assert.equal(contributingFileUrl("https://github.com/o/r/blob/main/docs/contributing.rst", "o/r"), null);
  assert.equal(contributingFileUrl("not a url", "o/r"), null);
});
