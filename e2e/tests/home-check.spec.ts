import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`homepage navigation: Check a repo returns to the hero and focuses the highlighted input (${reducedMotion})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    const phone = testInfo.project.name === "phone";
    const nav = page.getByRole("navigation", { name: phone ? "Mobile" : "Main", exact: true });
    const input = page.getByLabel("GitHub repository or URL", { exact: true });
    const form = page.locator("form").filter({ has: input });
    const check = nav.getByRole("link", { name: "Check a repo", exact: true });

    async function clickCheck() {
      if (phone) await page.getByRole("button", { name: "Menu", exact: true }).click();
      await expect(nav.getByRole("link", { name: "Find a project", exact: true })).toHaveCount(0);
      await check.click();
      await expect(input).toBeFocused();
      if (phone) await expect(nav).toBeHidden();
      await expect(form).toHaveClass(/check-flash/);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
      const headerBottom = await page.locator("header.site-header").evaluate((el) => el.getBoundingClientRect().bottom);
      const inputTop = await input.evaluate((el) => el.getBoundingClientRect().top);
      expect(inputTop).toBeGreaterThan(headerBottom);
      await expect(page).toHaveURL(/\/$/);
    }

    // Also ensures the navigation has hydrated before testing a scrolled click.
    await clickCheck();
    await input.fill("pallets/");
    await input.blur();
    await page.evaluate(() => window.scrollTo({ top: 1100, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await clickCheck();
    await page.keyboard.type("flask");
    await expect(input).toHaveValue("pallets/flask");

    // Only the homepage hides the discovery link.
    await page.goto("/pricing");
    if (phone) await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("navigation", { name: phone ? "Mobile" : "Main", exact: true })
      .getByRole("link", { name: "Find a project", exact: true })).toBeVisible();
  });
}
