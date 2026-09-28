// Smoke tests against a deployed Holt. BASE_URL defaults to staging
// (https://$STAGING_HOST, staging.githolt.com unless set).
// Uses the server's cached Chromium (~/.cache/ms-playwright) instead of
// downloading browsers: set CHROMIUM_PATH to point somewhere else.
//
// Behind Cloudflare Access: set STAGING_CF_ACCESS_CLIENT_ID and
// STAGING_CF_ACCESS_CLIENT_SECRET (a service token). global-setup.ts trades
// them for Access's cookie on BASE_URL's host, and every context starts with
// it. The token headers are never sent by the browser, so they can't reach
// github.com or anywhere else. Without the variables nothing changes.
import { defineConfig, devices } from "@playwright/test";
import { accessToken } from "./access.mjs";
import { chromiumPath } from "./chromium";
import { ACCESS_STATE } from "./global-setup";

const executablePath = chromiumPath();
const throughAccess = accessToken() !== null;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: process.env.BASE_URL || `https://${process.env.STAGING_HOST || "staging.githolt.com"}`,
    launchOptions: executablePath ? { executablePath } : {},
    trace: "off",
    screenshot: "only-on-failure",
    ...(throughAccess ? { storageState: ACCESS_STATE } : {}),
  },
  projects: [
    {
      name: "phone",
      use: { ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium", viewport: { width: 390, height: 844 } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
