import assert from "node:assert/strict";
import { test } from "node:test";
import { availability, DEFAULT_MODEL, initialModel, isKnownModel, MODELS } from "./models.ts";

const byId = (id: string) => MODELS.find((m) => m.id === id)!;

test("ids are unique and every model can be served", () => {
  assert.equal(new Set(MODELS.map((m) => m.id)).size, MODELS.length);
  for (const m of MODELS) assert.match(m.openrouter, /^[a-z0-9-]+\/[a-z0-9.-]+$/, m.id);
  assert.ok(isKnownModel(DEFAULT_MODEL));
});

test("free users get free models; pro models ask for an upgrade", () => {
  assert.deepEqual(availability(byId("gpt-5-mini"), { kind: "free" }), { ok: true });
  assert.deepEqual(availability(byId("claude-sonnet-5"), { kind: "free" }), { ok: false, reason: "upgrade" });
  assert.deepEqual(availability(byId("claude-sonnet-5"), { kind: "plan" }), { ok: true });
});

test("preselection", () => {
  assert.equal(initialModel({ kind: "free" }), DEFAULT_MODEL);
  assert.equal(initialModel({ kind: "free" }, "claude-opus-5-5"), DEFAULT_MODEL); // locked: ignored
  assert.equal(initialModel({ kind: "plan" }, "claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(isKnownModel("../../etc"), false);
});
