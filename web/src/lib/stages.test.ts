import assert from "node:assert/strict";
import { test } from "node:test";
import { eta, friendlyStage, logStage, stageTime } from "./stages.ts";

test("every engine and queue stage gets a friendly line", () => {
  assert.equal(friendlyStage(undefined).title, "Starting");
  assert.equal(friendlyStage("Waiting to start").title, "Getting in line");
  assert.equal(friendlyStage("Getting in line").title, "Getting in line");
  assert.deepEqual(friendlyStage("In the queue: 2 checks ahead of yours"), { title: "Getting in line", detail: "2 checks ahead of yours." });
  assert.equal(friendlyStage("Counting replies and merges").title, "Counting replies and merges");
  assert.notEqual(friendlyStage("Counting replies and merges").detail, "");
  assert.equal(friendlyStage("Applying the rules").title, "Applying the rules");
  assert.equal(friendlyStage("Writing the report").title, "Writing the report");
  assert.deepEqual(friendlyStage("Something new"), { title: "Something new", detail: "" });
});

test("the log prints each new stage once, in order", () => {
  let log = logStage([], undefined, 0);
  assert.deepEqual(log.map((l) => l.title), ["Starting"]);
  log = logStage(log, "Getting in line", 1);
  log = logStage(log, "Starting", 2); // the server's own "Starting" comes late
  log = logStage(log, "Fetching pull requests", 3);
  log = logStage(log, "Counting replies and merges", 9);
  assert.deepEqual(log.map((l) => [l.title, l.at]), [["Starting", 0], ["Getting in line", 1], ["Fetching pull requests", 3], ["Counting replies and merges", 9]]);
});

test("the same stage rewrites its detail, and nothing else changes the log", () => {
  const a = logStage([], "In the queue: 3 checks ahead of yours", 0);
  const b = logStage(a, "In the queue: yours is next", 4);
  assert.equal(b.length, 1);
  assert.equal(b[0].detail, "Yours is next.");
  assert.equal(b[0].at, 0);
  assert.equal(logStage(b, "In the queue: yours is next", 5), b);
});

test("stage times read like a stopwatch", () => {
  assert.equal(stageTime(0), "0s");
  assert.equal(stageTime(4.4), "4s");
  assert.equal(stageTime(65), "1m 05s");
});

test("the ETA counts down from a typical free check, and gives up honestly", () => {
  assert.equal(eta({ mode: "rules", elapsed: 0 }), "about 20s left");
  assert.equal(eta({ mode: "rules", elapsed: 7 }), "about 15s left");
  assert.equal(eta({ mode: "rules", elapsed: 16 }), "almost done");
  assert.equal(eta({ mode: "rules", elapsed: 30 }), "almost done");
  assert.equal(eta({ mode: "rules", elapsed: 45 }), null);
  assert.equal(eta({ mode: "rules", elapsed: 0, ahead: 3 }), "about 1 min left");
  assert.equal(eta({ mode: "ai", elapsed: 0 }), null);
});
