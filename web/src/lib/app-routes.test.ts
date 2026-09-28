import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { isAppRoute } from "./app-routes.ts";

test("app routes are not owners", () => {
  for (const s of ["me", "discover", "pricing", "settings", "Settings", "lab"]) assert.ok(isAppRoute(s), s);
  for (const s of ["pallets", "NixOS", "home-assistant"]) assert.ok(!isAppRoute(s), s);
});

// A folder under src/app with pages below it (/settings/profile, /lab/expressive)
// would otherwise be probed on GitHub as owner/repo and 404 in production.
test("every two-segment app route is known", () => {
  const app = new URL("../app/", import.meta.url);
  for (const top of readdirSync(app, { withFileTypes: true })) {
    if (!top.isDirectory() || /^[[(_]/.test(top.name) || top.name === "api") continue;
    for (const sub of readdirSync(new URL(`${top.name}/`, app), { withFileTypes: true })) {
      if (sub.isDirectory() && existsSync(new URL(`${top.name}/${sub.name}/page.tsx`, app))) {
        assert.ok(isAppRoute(top.name), `/${top.name}/${sub.name}: add "${top.name}" to APP_ROUTES in app-routes.ts`);
      }
    }
  }
});
