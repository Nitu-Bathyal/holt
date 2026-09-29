import assert from "node:assert/strict";
import { test } from "node:test";
import { fromFind, langColor, languageLabel, neighbours, oddsSegments, oddsText, statPills, type CardStats } from "./repo-card.ts";

const stats = (over: Partial<CardStats> = {}): CardStats => ({ attempts: 71, merged: 57, noReply: 5, closedSilently: 8, stillOpen: 95, firstTimers: 3, replyHours: 46.9, ...over });

test("segments add up to the decided pull requests, then the recent ones", () => {
  const s = oddsSegments(stats())!;
  assert.deepEqual(s.map((x) => [x.key, x.n]), [["merged", 57], ["replied", 1], ["closed", 8], ["silent", 5], ["recent", 95]]);
  assert.equal(s.filter((x) => x.key !== "recent").reduce((a, x) => a + x.n, 0), 71);
});

test("segments never overflow when counts disagree, and empty ones are dropped", () => {
  const s = oddsSegments(stats({ attempts: 10, merged: 9, closedSilently: 5, noReply: 5, stillOpen: 0 }))!;
  assert.deepEqual(s.map((x) => [x.key, x.n]), [["merged", 9], ["closed", 1]]);
  assert.equal(oddsSegments(stats({ attempts: 0 })), null);
  assert.equal(oddsSegments(stats({ merged: null })), null);
});

test("find results (partial stats) still get a bar", () => {
  const s = oddsSegments(stats({ closedSilently: null, stillOpen: null }))!;
  assert.deepEqual(s.map((x) => [x.key, x.n]), [["merged", 57], ["other", 9], ["silent", 5]]);
});

test("the bar in words", () => {
  assert.equal(oddsText(stats()), "Of 71 outside pull requests, 57 merged, 1 got a reply but weren't merged, 8 closed without a word and 5 got no reply. 95 more are too recent to count.");
  assert.equal(oddsText(stats({ attempts: 1, merged: 1, stillOpen: 1 })), "Of 1 outside pull request, 1 merged. 1 more is too recent to count.");
  assert.equal(oddsText(stats({ attempts: 0 })), "No outside pull requests to count yet.");
});

test("stat pills", () => {
  assert.deepEqual(statPills(stats()), ["57 of 71 merged", "replies in 2 days", "3 first-timers merged"]);
  assert.deepEqual(statPills(stats({ replyHours: 30, firstTimers: 1 })), ["57 of 71 merged", "replies in about a day", "1 first-timer merged"]);
  assert.deepEqual(statPills(stats({ attempts: 0, replyHours: null, firstTimers: 0 })), []);
});

test("fromFind keeps what a find result has and leaves the rest empty", () => {
  const c = fromFind({ repo: "o/r", headline: "Worth your time", tone: "good", verdict: "viable", description: null, language: "Go", languages: [], stars: 5, stats: { outsider_attempts: 4, outsider_merged: 3 }, issues: [] });
  assert.equal(c.stats.attempts, 4);
  assert.equal(c.stats.noReply, null);
  assert.deepEqual(c.why, []);
});

test("language colours and neighbours", () => {
  assert.equal(langColor("TypeScript"), "#3178c6");
  assert.equal(langColor("Brainfuck"), null);
  assert.equal(langColor(null), null);
  assert.deepEqual(neighbours(["a/b", "c/d", "e/f"], "C/D"), { index: 1, prev: "a/b", next: "e/f" });
  assert.deepEqual(neighbours(["a/b"], "a/b"), { index: 0, prev: null, next: null });
  assert.equal(neighbours(["a/b"], "x/y"), null);
  assert.equal(neighbours(["a/b"], null), null);
});

test("a card names a second language when the server gives one", () => {
  assert.equal(languageLabel("Go", ["Go", "TypeScript"]), "Go · TypeScript");
  assert.equal(languageLabel("Python", ["Python"]), "Python");
  assert.equal(languageLabel("Python", undefined), "Python");
  assert.equal(languageLabel(null, []), null);
});
