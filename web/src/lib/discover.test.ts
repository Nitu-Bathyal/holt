import assert from "node:assert/strict";
import { test } from "node:test";
import { boardHref, boardTitle, emptyText, languageFromSlug, languageSlug, parseSort, widenBoard } from "./discover.ts";

test("language slugs are readable and round-trip", () => {
  const names = ["Python", "C++", "C#", "Jupyter Notebook", "Objective-C", "Go"];
  assert.equal(languageSlug("C++"), "cpp");
  assert.equal(languageSlug("Jupyter Notebook"), "jupyter-notebook");
  for (const n of names) assert.equal(languageFromSlug(languageSlug(n), names), n);
  assert.equal(languageFromSlug("PYTHON", names), "Python");
  assert.equal(languageFromSlug("cobol", names), null);
});

test("sort falls back to the welcoming board", () => {
  assert.equal(parseSort("stars"), "stars");
  assert.equal(parseSort("people"), "welcoming");
  assert.equal(parseSort(undefined), "welcoming");
});

test("board titles and links", () => {
  assert.equal(boardTitle("welcoming", "Rust"), "Most welcoming Rust repos");
  assert.equal(boardTitle("welcoming", null), "Most welcoming repos");
  assert.equal(boardHref({ language: "C++" }), "/discover/cpp");
  assert.equal(boardHref({ sort: "stars", topic: "cli" }), "/discover?sort=stars&topic=cli");
  assert.match(emptyText("trending", null, null, 5), /5 or more people/);
});

test("an empty board offers the widest step first, and a repo to check when nothing is left to drop", () => {
  assert.deepEqual(widenBoard({ sort: "trending", language: "Rust", topic: "cli" }).map((w) => w.label), ["all topics", "any language", "most welcoming"]);
  assert.equal(widenBoard({ sort: "stars", language: "Rust", topic: "cli" })[0].href, "/discover/rust?sort=stars");
  assert.deepEqual(widenBoard({ sort: "welcoming", language: null, topic: null }), [{ href: "/", label: "check a repo" }]);
});
