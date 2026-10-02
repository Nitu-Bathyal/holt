// Connect GitHub goes through GitHub's sign-in page. When Auth.js can't link
// the account it sends the browser to /signin?error=<code>, and /signin sends
// anyone signed in on to /me: the failure vanished. This reads where Auth.js
// is redirecting, so the Auth.js route can send a failed link back to the
// connect form with the reason. Pure, so it runs under `node --test`.
import type { ConnectError } from "./settings";

/** Where Auth.js sends a failed sign-in: its own error page or ours. */
const FAILED = new Set(["/signin", "/api/auth/error", "/api/auth/signin"]);

/** The connect form's error for an Auth.js redirect, or null when it isn't a failure. */
export function connectErrorFor(location: string | null): ConnectError | null {
  if (!location) return null;
  let url: URL;
  try {
    url = new URL(location, "http://holt.invalid");
  } catch {
    return null;
  }
  const code = url.searchParams.get("error");
  if (!code || !FAILED.has(url.pathname)) return null;
  // The GitHub account is already another Holt user's sign-in.
  return code === "OAuthAccountNotLinked" ? "taken" : "link";
}
