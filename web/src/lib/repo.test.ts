import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { parseRepoInput, redirectTargetForPath, repoFromPath } from "./repo.ts";

test("parses the forms people paste", () => {
  const want = { owner: "pallets", repo: "flask" };
  for (const input of [
    "pallets/flask",
    " pallets/flask ",
    "https://github.com/pallets/flask",
    "http://github.com/pallets/flask/",
    "github.com/pallets/flask.git",
    "www.github.com/pallets/flask",
    "https://github.com/pallets/flask/tree/main/src",
    "https://github.com/pallets/flask?tab=readme-ov-file",
    "git@github.com:pallets/flask.git",
  ]) {
    assert.deepEqual(parseRepoInput(input), want, input);
  }
});

test("rejects things that are not repos", () => {
  for (const input of ["", "flask", "https://github.com/pallets", "a b/c", "-bad/repo", "o/.."]) {
    assert.equal(parseRepoInput(input), null, input);
  }
});

test("URL trick redirects", () => {
  assert.equal(redirectTargetForPath("/https://github.com/pallets/flask"), "/pallets/flask");
  assert.equal(redirectTargetForPath("/https:/github.com/pallets/flask"), "/pallets/flask");
  assert.equal(redirectTargetForPath("/github.com/pallets/flask"), "/pallets/flask");
  assert.equal(redirectTargetForPath("/github.com/pallets/flask/pulls"), "/pallets/flask");
  assert.equal(redirectTargetForPath("/pallets/flask/tree/main/src"), "/pallets/flask");
  assert.equal(redirectTargetForPath("/pallets/flask.git"), "/pallets/flask");
  assert.equal(redirectTargetForPath("/github.com/pallets"), "/");
});

test("leaves app routes alone", () => {
  for (const p of ["/", "/find", "/pallets/flask", "/me/history", "/api/analyses", "/pallets/flask/opengraph-image"]) {
    assert.equal(redirectTargetForPath(p), null, p);
  }
});

test("only report paths are checked against GitHub", () => {
  assert.equal(repoFromPath("/pallets/flask"), "pallets/flask");
  assert.equal(repoFromPath("/pallets/flask/"), "pallets/flask");
  for (const p of ["/lab/expressive", "/me/history", "/discover/python", "/settings/profile", "/pricing/thanks", "/Settings/privacy", "/find", "/", "/pallets/flask/pulls"]) {
    assert.equal(repoFromPath(p), null, p);
  }
});

// A new folder under src/app with pages below it (like /lab/expressive) would
// otherwise be probed on GitHub as owner/repo and 404 in production.
test("every two-segment app route is known", () => {
  const app = new URL("../app/", import.meta.url);
  for (const top of readdirSync(app, { withFileTypes: true })) {
    if (!top.isDirectory() || /^[[(_]/.test(top.name) || top.name === "api") continue;
    for (const sub of readdirSync(new URL(`${top.name}/`, app), { withFileTypes: true })) {
      if (!sub.isDirectory() || !existsSync(new URL(`${top.name}/${sub.name}/page.tsx`, app))) continue;
      const path = `/${top.name}/${sub.name.startsWith("[") ? "python" : sub.name}`;
      assert.equal(repoFromPath(path), null, `${path}: add "${top.name}" to APP_ROUTES in repo.ts`);
    }
  }
});
