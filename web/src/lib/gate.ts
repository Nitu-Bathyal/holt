// Who sees what without signing in. Signed out, a visitor can read the
// curated example reports (examples.ts) in full and a teaser of any other
// report: the verdict and its reason, with the rest behind sign-in. Starting a
// check or a search needs an account. The browser extension's public API
// (/api/public/*) reads the cache and stays open. No runtime imports, so it
// runs under `node --test` and in the browser.
import { isExample } from "./examples.ts";
import type { ApiError } from "./types.ts";

export type Access = "full" | "teaser";

export function reportAccess(repo: string, signedIn: boolean): Access {
  return signedIn || isExample(repo) ? "full" : "teaser";
}

/** Sign-in, then back to `path` (a path on this site, with its query). */
export function signInHref(path: string): string {
  return `/signin?callbackUrl=${encodeURIComponent(path)}`;
}

/** Where the paste box sends a repo: its report, through sign-in when signed out (examples need none). */
export function pasteHref(repo: string, signedIn: boolean): string {
  const report = `/${repo}`;
  return reportAccess(repo, signedIn) === "full" ? report : signInHref(report);
}

type Refusal = { status: 401; error: ApiError };

const refuse = (message: string): Refusal => ({ status: 401, error: { code: "unauthorized", message } });

/** POST /api/analyses: null when this caller may start a check. */
export function startGate(userId: string | null | undefined): Refusal | null {
  return userId ? null : refuse("Sign in to check this repo.");
}

/** POST /api/find: null when this caller may run a search. */
export function findGate(userId: string | null | undefined): Refusal | null {
  return userId ? null : refuse("Sign in to search with your own filters.");
}
