import assert from "node:assert/strict";
import { test } from "node:test";
import { aboutNumbers, compactCount, flags, readmeShown, share, siteLabel } from "./repo-about.ts";
import type { RepoAbout } from "./repo-about.ts";

const base: RepoAbout = {
  description: "The Python micro framework",
  readme_line: "Flask is a lightweight WSGI web application framework.",
  homepage: "https://flask.palletsprojects.com/",
  stars: 69_800,
  forks: 16_300,
  open_issues: 1,
  license: "BSD-3-Clause",
  topics: ["wsgi"],
  languages: [{ name: "Python", share: 0.995 }, { name: "HTML", share: 0.004 }],
  created_at: "2010-04-06T00:00:00Z",
  pushed_at: "2026-09-27T00:00:00Z",
  default_branch: "main",
  archived: false,
  fork: false,
  fork_of: null,
  fetched_at: "2026-09-29T00:00:00Z",
};

test("compact counts", () => {
  assert.equal(compactCount(0), "0");
  assert.equal(compactCount(999), "999");
  assert.equal(compactCount(1000), "1k");
  assert.equal(compactCount(1234), "1.2k");
  assert.equal(compactCount(91_234), "91k");
  assert.equal(compactCount(999_999), "1M");
  assert.equal(compactCount(1_250_000), "1.3M");
});

test("the numbers, singular when one, and only the known ones", () => {
  assert.deepEqual(aboutNumbers(base), [
    { value: "70k", label: "stars" },
    { value: "16k", label: "forks" },
    { value: "1", label: "open issue" },
  ]);
  assert.deepEqual(aboutNumbers({ ...base, stars: 1, forks: null, open_issues: null }), [{ value: "1", label: "star" }]);
});

test("language shares", () => {
  assert.equal(share(0.995), "100%");
  assert.equal(share(0.42), "42%");
  assert.equal(share(0.004), "<1%");
});

test("homepage as a short label", () => {
  assert.equal(siteLabel("https://flask.palletsprojects.com/"), "flask.palletsprojects.com");
  assert.equal(siteLabel("https://www.example.org/docs/"), "example.org/docs");
  assert.equal(siteLabel("not a url"), "not a url");
});

test("the README line only when it adds something", () => {
  assert.equal(readmeShown(base), base.readme_line);
  assert.equal(readmeShown({ ...base, readme_line: "The Python micro framework." }), null);
  assert.equal(readmeShown({ ...base, readme_line: null }), null);
});

test("archived and fork flags", () => {
  assert.deepEqual(flags(base), []);
  assert.deepEqual(flags({ ...base, archived: true, fork: true, fork_of: "orig/flask" }), [
    { kind: "archived", text: "Archived" },
    { kind: "fork", text: "Fork of orig/flask", repo: "orig/flask" },
  ]);
  assert.deepEqual(flags({ ...base, fork: true }), [{ kind: "fork", text: "A fork" }]);
});
