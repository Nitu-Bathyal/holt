// GET /api/picks?cursor=N: the next part of /me/picks (API.md,
// "Recommendations for you"), for the list as it is scrolled
// (app/me/picks/picks-list.tsx), in the shape every part route answers with
// (lib/parts.ts). The cursor is the server's `next`, an offset. Signed in
// only, never cached: the picks are one person's.
import { NextResponse, type NextRequest } from "next/server";
import { recommendations } from "@/lib/api";
import { signedInGate } from "@/lib/gate";
import { parseOffset, pickCursor, PICKS_PART } from "@/lib/recommendations";
import { currentUser } from "@/lib/session";
import type { ApiError } from "@/lib/types";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" };
const refuse = (status: number, error: ApiError) => NextResponse.json({ error }, { status, headers: PRIVATE });

export async function GET(req: NextRequest) {
  const user = await currentUser();
  const refused = signedInGate(user?.id);
  if (refused || !user) return refuse(401, refused?.error ?? { code: "unauthorized", message: "Sign in first." });
  const offset = parseOffset(req.nextUrl.searchParams.get("cursor"));
  if (offset === null) return refuse(400, { code: "invalid_request", message: "We couldn't read that. Please try again." });
  const r = await recommendations(user.id, PICKS_PART, offset);
  if (!r.ok) return refuse(r.status, r.error);
  return NextResponse.json({ items: r.data.picks, next: pickCursor(r.data.next), total: r.data.total }, { headers: PRIVATE });
}
