import { expect, test, type Page } from "@playwright/test";

async function navigation(page: Page, phone: boolean) {
  if (phone) await page.getByRole("button", { name: "Menu", exact: true }).click();
  return page.getByRole("navigation", { name: phone ? "Mobile" : "Main", exact: true });
}

test("public navigation returns to the repo input and keeps discovery reachable", async ({ page }, testInfo) => {
  const phone = testInfo.project.name === "phone";
  await page.goto("/pallets/flask");
  let nav = await navigation(page, phone);
  await nav.getByRole("link", { name: "Check a repo", exact: true }).click();
  await expect(page).toHaveURL(/\/#check$/);
  await expect(page.getByLabel("GitHub repository or URL", { exact: true })).toBeFocused();
  nav = await navigation(page, phone);
  await expect(nav.getByRole("link", { name: "Find a project", exact: true })).toHaveCount(0);
  if (phone) await page.keyboard.press("Escape");
  await page.getByRole("main").getByRole("link", { name: /\[\s*find a project\s*→\s*\]/ }).click();
  await expect(page).toHaveURL(/\/find$/);
  await expect(page.locator("[popover]:popover-open")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Find a project", exact: true }).getByRole("link", { name: "Browse projects", exact: true }).click();
  await expect(page).toHaveURL(/\/discover$/);
  nav = await navigation(page, phone);
  await expect(nav.getByRole("link", { name: "Find a project", exact: true })).toHaveCount(0);
});
