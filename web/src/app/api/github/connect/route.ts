// Back from GitHub's sign-in page (Connect GitHub, for people who sign in with
// Google): Auth.js has linked the GitHub account to this user; save the
// connection with the choices from the connect form (Settings → Accounts), which the connect action left in
// a short-lived cookie. Without that cookie nothing is connected, so a link to
// this URL can't connect anyone; the form says it didn't work.
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { connectGitHub } from "@/lib/api";
import { linkedGitHubId, PENDING_COOKIE, PENDING_COOKIE_PATH } from "@/lib/github-account";
import { currentUser } from "@/lib/session";
import { ACCOUNT_SETTINGS, connectFailed, CONNECT_GITHUB } from "@/lib/settings";

export async function GET(req: NextRequest) {
  const go = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  const user = await currentUser();
  if (!user) return go(`/signin?callbackUrl=${encodeURIComponent(CONNECT_GITHUB)}`);
  const jar = await cookies();
  const pending = jar.get(PENDING_COOKIE)?.value;
  jar.delete({ name: PENDING_COOKIE, path: PENDING_COOKIE_PATH });
  if (pending !== "opt-out" && pending !== "include") return go(connectFailed("link"));

  const githubId = await linkedGitHubId(user.id);
  if (!githubId) return go(connectFailed("link"));
  const r = await connectGitHub(user.id, githubId, pending === "opt-out");
  if (!r.ok) return go(connectFailed(r.status === 409 ? "taken" : "save"));
  return go(`${ACCOUNT_SETTINGS}?github=connected`);
}
