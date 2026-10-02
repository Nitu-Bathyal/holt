import assert from "node:assert/strict";
import { test } from "node:test";
import { allPicksLabel, basisLine, cardReasons, emptyReason, excludedLine, languageName, listWords, noPicks, parseOffset, starterRows } from "./recommendations.ts";

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

test("the excluded line", () => {
  assert.equal(excludedLine(0), null);
  assert.match(excludedLine(1) ?? "", /the 1 repo you've/);
  assert.match(excludedLine(3) ?? "", /the 3 repos/);
});

test("starter issues are taken across the picks in turn", () => {
  const issue = (number: number) => ({ number }) as Parameters<typeof starterRows>[0][number]["issues"][number];
  const picks = [
    { repo: "a/a", issues: [issue(1), issue(2), issue(3)] },
    { repo: "b/b", issues: [] },
    { repo: "c/c", issues: [issue(4)] },
  ];
  assert.deepEqual(starterRows(picks, 3).map((r) => `${r.repo}#${r.issue.number}`), ["a/a#1", "c/c#4", "a/a#2"]);
  assert.deepEqual(starterRows([], 3), []);
});

test("the home links to every pick only when it doesn't show them all", () => {
  assert.equal(allPicksLabel(0), null);
  assert.equal(allPicksLabel(3), null);
  assert.equal(allPicksLabel(4), "all 4 picks");
  assert.equal(allPicksLabel(60), "all 60 picks");
});

test("a card says why only when the picks were matched on something", () => {
  assert.equal(cardReasons(basis()), false);
  assert.equal(cardReasons(basis({ languages: ["python"] })), true);
  assert.equal(cardReasons(basis({ history_languages: ["Rust"] })), true);
});

test("the offset of a part is a whole number from 0", () => {
  assert.equal(parseOffset(null), 0);
  assert.equal(parseOffset("0"), 0);
  assert.equal(parseOffset("24"), 24);
  for (const bad of ["", "-1", "1.5", "abc", "12345", " 3"]) assert.equal(parseOffset(bad), null, bad);
});

test("no picks: one line and the way to get some", () => {
  assert.deepEqual(noPicks(basis()), { line: "No picks yet.", actions: ["profile", "github"] });
  assert.deepEqual(noPicks(basis({ connected: true })), { line: "No picks yet.", actions: ["profile"] });
  assert.deepEqual(noPicks(basis({ languages: ["haskell"] })), { line: "Nothing fits your profile right now.", actions: ["profile", "github"] });
});
