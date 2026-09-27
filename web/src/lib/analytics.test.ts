import assert from "node:assert/strict";
import { test } from "node:test";
import { analyticsScript, UMAMI_WEBSITE_ID } from "./analytics.ts";

test("production loads the script from its own origin", () => {
  assert.deepEqual(analyticsScript("githolt.com"), { src: "/stats/script.js", websiteId: UMAMI_WEBSITE_ID });
});

test("staging, previews and local builds send nothing", () => {
  assert.equal(analyticsScript("staging.githolt.com"), null);
  assert.equal(analyticsScript("localhost:3000"), null);
  assert.equal(analyticsScript(""), null);
});

test("an explicit script and site id win (a local check of Umami)", () => {
  assert.deepEqual(analyticsScript("localhost:3000", "http://127.0.0.1:8311/script.js", "abc"), {
    src: "http://127.0.0.1:8311/script.js",
    websiteId: "abc",
  });
});
