// Smoke tests for a deployed Holt. Rules mode only: nothing here may start an
// AI report or spend quota.
import { expect, test, type Page } from "@playwright/test";

const VERDICT = /Worth your time|Not worth your time|Not enough evidence/;

// The test machine's network blipping is not a bug in the page.
const NOT_THE_APP = /net::ERR_NETWORK_CHANGED|net::ERR_INTERNET_DISCONNECTED/;

/** Collects console errors and uncaught exceptions for the page's lifetime. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !NOT_THE_APP.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test("landing: pasting an example's GitHub URL ends on the report with a verdict", async ({ page }) => {
  await page.goto("/");
  const box = page.getByLabel("GitHub repository or URL");
  // pallets/flask is one of the examples (web/src/lib/examples.ts), readable signed out.
  await box.fill("https://github.com/pallets/flask");
  // The landing page has a second paste box at the bottom; click the one we filled.
  await page.locator("form").filter({ has: box }).getByRole("button", { name: /check/i }).click();
  await expect(page).toHaveURL(/\/pallets\/flask$/);
  // A cached report renders at once; otherwise the rules check runs first.
  await expect(page.getByText(VERDICT).first()).toBeVisible({ timeout: 180_000 });
});

test("landing, signed out: pasting any other repo goes to sign-in, then back to its report", async ({ page }) => {
  await page.goto("/");
  const box = page.getByLabel("GitHub repository or URL");
  await box.fill("octocat/Hello-World");
  await page.locator("form").filter({ has: box }).getByRole("button", { name: /check this repo/i }).click();
  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Foctocat%2FHello-World$/);
});

test("URL trick: /github.com/owner/repo redirects to the report", async ({ page, request }) => {
  const res = await request.get("/github.com/pallets/flask", { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(res.status());
  expect(res.headers()["location"]).toMatch(/\/pallets\/flask$/);

  await page.goto("/https://github.com/pallets/flask/pulls");
  await expect(page).toHaveURL(/\/pallets\/flask$/);
});

// Find, Browse, Compare and pre-flight are for signed-in people (web/src/lib/gate.ts).
for (const path of ["/discover", "/discover/python", "/discover?sort=stars", "/find", "/find?go=1&lang=python", "/compare?repos=pallets/flask,psf/requests", "/preflight"]) {
  test(`signed out, ${path} goes to sign-in and sends no data`, async ({ page, request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const to = new URL(res.headers()["location"], "https://holt.test");
    expect(to.pathname).toBe("/signin");
    expect(decodeURIComponent(to.searchParams.get("callbackUrl") ?? "")).toBe(path);
    expect(await res.text()).not.toContain("github.com");
    // What a client-side navigation or prefetch asks for.
    const rsc = await request.get(path, { maxRedirects: 0, headers: { RSC: "1" } });
    expect(rsc.status()).toBe(307);

    await page.goto(path);
    await expect(page).toHaveURL(/\/signin\?callbackUrl=/);
  });
}

test("signed out, the data routes behind those pages answer 401", async ({ request }) => {
  for (const path of ["/api/preflight", "/api/preflight-jobs/x/events", "/api/merge-plan-jobs/x/events", "/api/playbook-jobs/x/events"]) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
  expect((await request.post("/api/find", { data: { q: "lang=python" } })).status()).toBe(401);
});

test("Hacktoberfest pill: × hides it, and it stays hidden after a reload", async ({ page }, testInfo) => {
  await page.goto("/");
  const pill = page.locator(".hf-pill");
  test.skip((await pill.count()) === 0, "no Hacktoberfest pill outside the season");
  await expect(pill).toBeVisible();
  const close = page.getByRole("button", { name: "Hide the Hacktoberfest notice" });
  if (testInfo.project.name === "phone") {
    const box = await close.boundingBox();
    // 43.5: layout can land a hair under 44px at fractional device pixel ratios.
    expect(box?.height ?? 0, "the × is a comfortable tap target").toBeGreaterThanOrEqual(43.5);
  }
  await close.click();
  await expect(page).toHaveURL(/\/$/); // dismissing must not navigate
  await expect(pill).toBeHidden();
  await page.reload();
  await expect(pill).toBeHidden();
});

test("theme toggle persists across a reload", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  expect(before).toMatch(/^(light|dark)$/);
  await page.getByRole("button", { name: /switch between light and dark theme/i }).first().click();
  const after = before === "dark" ? "light" : "dark";
  await expect(html).toHaveAttribute("data-theme", after);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", after);
  expect(await page.evaluate(() => localStorage.getItem("holt-theme"))).toBe(after);
});

test("pricing renders the plans", async ({ page }) => {
  // Plans and prices change (Pro passes come from /v1/passes and show only
  // while on sale), so check the shape: a heading, a priced plan, and a way
  // to act on one.
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const prices = page.locator("main").getByText(/^\s*(\$|₹|€|£)\s?\d/);
  await expect(prices.first()).toBeVisible();
  const cta = page.locator("main").locator("a[href], button").filter({ hasText: /\S/ })
    .filter({ hasText: /sign in|start|get|choose|buy|upgrade|subscribe|add a key|check a repo|→/i });
  await expect(cta.first()).toBeVisible();
});

test("public extension endpoints answer with CORS headers", async ({ request }) => {
  const origin = "chrome-extension://holt-smoke-test";
  for (const path of ["/api/public/report/pallets/flask", "/api/public/starter-issues/pallets/flask"]) {
    const pre = await request.fetch(path, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    });
    expect(pre.status(), `${path} preflight`).toBeLessThan(300);
    expect(pre.headers()["access-control-allow-methods"]).toContain("GET");

    const res = await request.get(path, { headers: { Origin: origin } });
    // 429 is a fair answer too (the API's per-IP limit); it must still carry CORS.
    expect([200, 404, 429], `${path} status`).toContain(res.status());
    expect(["*", origin]).toContain(res.headers()["access-control-allow-origin"]);
    expect(res.headers()["content-type"]).toContain("application/json");
    await res.json();
  }
});

test("/__build is valid JSON describing what's live", async ({ request }) => {
  const res = await request.get("/__build");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.live?.main?.sha).toMatch(/^[0-9a-f]{40}$/);
  expect(Array.isArray(body.live?.included)).toBe(true);
  expect(body.live?.built_at).toBeTruthy();
});

for (const path of ["/", "/pallets/flask", "/examples", "/pricing", "/how-it-works"]) {
  test(`no console errors on ${path}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path, { waitUntil: "networkidle" });
    if (path === "/pallets/flask") await expect(page.getByText(VERDICT).first()).toBeVisible({ timeout: 180_000 });
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
}
