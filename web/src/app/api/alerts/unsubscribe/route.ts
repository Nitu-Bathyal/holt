// The email's unsubscribe link, for whoever holds it (API.md, "PR watch
// (alerts)"): no sign-in, the token is the key. A POST turns alert email off:
// the unsubscribe page sends one ({"token": …}), and so does a mail client's
// one-click button (RFC 8058: the `List-Unsubscribe` address, ?t=<token>).
// A GET changes nothing, because mail scanners and link previews fetch every
// link in an email; it goes to the page.
import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeToken } from "@/lib/alerts";
import { setEmailByToken } from "@/lib/alerts-route";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return setEmailByToken(req, false);
}

export function GET(req: NextRequest) {
  const page = new URL("/alerts/unsubscribe", req.url);
  const t = unsubscribeToken(req.nextUrl.searchParams.get("t"));
  if (t) page.searchParams.set("t", t);
  return NextResponse.redirect(page, 303);
}
