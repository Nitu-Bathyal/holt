// Back from GitHub's sign-in page (Connect GitHub, for people who sign in with
// Google): Auth.js has linked the GitHub account to this user; save the
// connection with the choices from /connect, which the connect action left in
// a short-lived cookie. Without that cookie nothing happens, so a link to this
// URL can't connect anyone.
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { connectGitHub } from "@/lib/api";
import { linkedGitHubId, PENDING_COOKIE } from "@/lib/github-account";
import { currentUser } from "@/lib/session";

export async function GET(req: NextRequest) {
  const go = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  const user = await currentUser();
  if (!user) return go("/signin?callbackUrl=/connect");
  const jar = await cookies();
  const pending = jar.get(PENDING_COOKIE)?.value;
  jar.delete({ name: PENDING_COOKIE, path: "/api/github/connect" });
  if (pending !== "opt-out" && pending !== "include") return go("/connect");

  const githubId = await linkedGitHubId(user.id);
  if (!githubId) return go("/connect?error=link");
  const r = await connectGitHub(user.id, githubId, pending === "opt-out");
  if (!r.ok) return go(`/connect?error=${r.status === 409 ? "taken" : "save"}`);
  return go("/settings?github=connected#github");
}
