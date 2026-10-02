import { expect, test } from "@playwright/test";

test("sign-in: the example caption stays below the decorative report sheet", async ({ page }, testInfo) => {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Sign in to Holt", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try an example report →", exact: true })).toBeVisible();
  const figure = page.locator("main figure");
  if (testInfo.project.name === "phone") {
    await expect(figure).toBeHidden();
    return;
  }
  const caption = figure.locator("figcaption");
  const sheet = figure.locator('[aria-hidden="true"]').first();
  await expect(caption).toBeVisible();
  const sheetBottom = await sheet.evaluate((el) => el.getBoundingClientRect().bottom);
  const captionTop = await caption.evaluate((el) => el.getBoundingClientRect().top);
  expect(captionTop).toBeGreaterThan(sheetBottom);
  const link = caption.getByRole("link", { name: "Read the full example", exact: true });
  await link.scrollIntoViewIfNeeded();
  await expect.poll(() => link.evaluate((el) => {
    const r = el.getClientRects()[0];
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  })).toBe(true);
  await link.click();
  await expect(page).toHaveURL(/\/example-merge-plan$/);
});
