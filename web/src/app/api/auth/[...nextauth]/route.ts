import { NextResponse, type NextRequest } from "next/server";
import { handlers } from "@/auth";
import { PENDING_COOKIE, PENDING_COOKIE_PATH } from "@/lib/github-account";
import { connectErrorFor } from "@/lib/github-connect";
import { connectFailed } from "@/lib/settings";

export const { POST } = handlers;

// Connect GitHub (Settings → Accounts) comes back through here. A link that
// fails would go to /signin?error=…, which sends a signed-in person on to /me
// with no message; send them back to the connect form with the reason instead.
export async function GET(req: NextRequest) {
  const res = await handlers.GET(req);
  if (!req.cookies.has(PENDING_COOKIE)) return res;
  const location = res.headers.get("location");
  const error = connectErrorFor(location);
  if (!error || !location) return res;

  // Auth.js's own headers stay: they clear its sign-in cookies.
  const headers = new Headers(res.headers);
  headers.set("location", new URL(connectFailed(error), new URL(location, req.url)).toString());
  const back = new NextResponse(null, { status: 303, headers });
  back.cookies.delete({ name: PENDING_COOKIE, path: PENDING_COOKIE_PATH });
  return back;
}
