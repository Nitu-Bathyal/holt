// GET /api/picks?offset=N: the next part of /me/picks (API.md,
// "Recommendations for you"), for the list to load as the reader nears its
// end. Signed in only, never cached: the picks are one person's.
import { NextResponse, type NextRequest } from "next/server";
import { recommendations } from "@/lib/api";
import { parseOffset, PICKS_PART } from "@/lib/recommendations";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" };

function refuse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: PRIVATE });
}

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return refuse(401, "unauthorized", "Sign in to see your picks.");
  const offset = parseOffset(req.nextUrl.searchParams.get("offset"));
  if (offset === null) return refuse(400, "invalid_request", "We couldn't read that. Please try again.");
  const r = await recommendations(user.id, PICKS_PART, offset);
  if (!r.ok) return refuse(r.status, r.error.code, r.error.message);
  return NextResponse.json({ picks: r.data.picks, next: r.data.next }, { headers: PRIVATE });
}
