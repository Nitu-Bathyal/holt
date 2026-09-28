import assert from "node:assert/strict";
import { test } from "node:test";
import { basisLine, emptyReason, excludedLine, languageName, listWords, lockedLine } from "./recommendations.ts";

const basis = (over: Partial<Parameters<typeof basisLine>[0]> = {}) => ({
  languages: [], topics: [], level: "newcomer" as const, contributions: [], history_languages: [],
  already_contributing: 0, has_profile: false, connected: false, ...over,
});

test("language names as people write them", () => {
  assert.equal(languageName("python"), "Python");
  assert.equal(languageName("c++"), "C++");
  assert.equal(languageName("haskell"), "haskell");
});

test("lists read as English", () => {
  assert.equal(listWords([]), "");
  assert.equal(listWords(["a"]), "a");
  assert.equal(listWords(["a", "b", "c"]), "a, b and c");
});

test("the basis line says what the picks were matched on", () => {
  assert.equal(basisLine(basis()), null);
  assert.equal(basisLine(basis({ languages: ["python"], topics: ["cli"] })), "Matched on Python and cli from your profile.");
  assert.equal(
    basisLine(basis({ languages: ["go"], history_languages: ["Rust"] })),
    "Matched on Go from your profile, and Rust from the pull requests you've had merged.",
  );
});

test("empty lists say whether there was anything to go on", () => {
  assert.equal(emptyReason(basis()), "nothing-to-match");
  assert.equal(emptyReason(basis({ history_languages: ["Rust"] })), "no-match");
});

test("excluded and locked lines", () => {
  assert.equal(excludedLine(0), null);
  assert.match(excludedLine(1) ?? "", /the 1 repo you've/);
  assert.match(excludedLine(3) ?? "", /the 3 repos/);
  assert.equal(lockedLine(1), "1 more pick is ready for you.");
  assert.equal(lockedLine(4), "4 more picks are ready for you.");
});
