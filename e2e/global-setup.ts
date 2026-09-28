// With a Cloudflare Access service token set (access.mjs), trade it for Access's
// session cookie once, before any test, and save it where playwright.config.ts
// points `storageState`. Every browser context and API request context the
// tests make starts with that cookie, for the staging host only. The file is
// removed when the run ends.
import fs from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { accessCookie, accessToken } from "./access.mjs";

export const ACCESS_STATE = path.join(__dirname, ".access", "state.json");

export default async function globalSetup(config: FullConfig) {
  const token = accessToken();
  if (!token) return;
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("no baseURL to get a Cloudflare Access cookie for");
  const cookie = await accessCookie(baseURL, token);
  fs.mkdirSync(path.dirname(ACCESS_STATE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(ACCESS_STATE, JSON.stringify({ cookies: [cookie], origins: [] }), { encoding: "utf-8", mode: 0o600 });
  console.log(`Cloudflare Access: signed in to ${new URL(baseURL).host} with the service token`);
  return () => fs.rmSync(ACCESS_STATE, { force: true });
}
