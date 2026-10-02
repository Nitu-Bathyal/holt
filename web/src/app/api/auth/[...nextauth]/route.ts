import { NextResponse, type NextRequest } from "next/server";
import { handlers } from "@/auth";
import { authSecret } from "@/lib/auth-secret";
import { confirmedGitHub, MERGE_COOKIE, MERGE_COOKIE_PATH, PENDING_COOKIE, PENDING_COOKIE_PATH } from "@/lib/github-account";
import { connectErrorFor, MERGE_WINDOW_S, mergeProof } from "@/lib/github-connect";
import { currentUser } from "@/lib/session";
import { connectFailed } from "@/lib/settings";

export const { POST } = handlers;

// Connect GitHub (Settings → Accounts) comes back through here. A link that
// fails would go to /signin?error=…, which sends a signed-in person on to /me
// with no message; send them back to the connect form with the reason instead.
//
// "taken" means the GitHub account is another Holt account's sign-in. GitHub
// has just confirmed it belongs to the person in this browser, so they may
// merge the two: leave the proof of that (who is signed in, which GitHub
// account, until when) in a signed cookie for the Accounts page.
export async function GET(req: NextRequest) {
  const confirmed: { id?: string } = {};
  const res = await confirmedGitHub.run(confirmed, () => handlers.GET(req));
  const pending = req.cookies.get(PENDING_COOKIE)?.value;
  if (pending === undefined) return res;
  const location = res.headers.get("location");
  const error = connectErrorFor(location);
  if (!error || !location) return res;

  // Auth.js's own headers stay: they clear its sign-in cookies.
  const headers = new Headers(res.headers);
  headers.set("location", new URL(connectFailed(error), new URL(location, req.url)).toString());
  const back = new NextResponse(null, { status: 303, headers });
  back.cookies.delete({ name: PENDING_COOKIE, path: PENDING_COOKIE_PATH });

  const secret = authSecret(process.env);
  const user = error === "taken" && confirmed.id && secret && (pending === "opt-out" || pending === "include") ? await currentUser() : null;
  if (user && confirmed.id && secret) {
    back.cookies.set(MERGE_COOKIE, mergeProof({ githubId: confirmed.id, userId: user.id, optOut: pending === "opt-out" }, secret), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: MERGE_COOKIE_PATH,
      maxAge: MERGE_WINDOW_S,
    });
  }
  return back;
}
