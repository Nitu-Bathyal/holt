// GET /api/discover?sort=&language=&topic=&cursor=: the next part of a board,
// for Browse's list as it is scrolled (components/discover/board-list.tsx).
// Browse is for signed-in people (lib/gate.ts), and so are its parts. Reads
// only Holt's database upstream (API.md, GET /v1/discover).
import { NextResponse, type NextRequest } from "next/server";
import { discover } from "@/lib/api";
import { BOARD_PART, parseSort } from "@/lib/discover";
import { signedInGate } from "@/lib/gate";
import { caller } from "@/lib/session";

export const dynamic = "force-dynamic";

const one = (v: string | null, max = 80) => v?.trim().slice(0, max) || null;

export async function GET(req: NextRequest) {
  const who = await caller();
  const refused = signedInGate(who.userId);
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
  const p = req.nextUrl.searchParams;
  const r = await discover(parseSort(p.get("sort") ?? undefined), one(p.get("language")), one(p.get("topic"))?.toLowerCase() ?? null, BOARD_PART, false, one(p.get("cursor"), 400));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const { repos, next, total } = r.data;
  return NextResponse.json({ items: repos, next: next ?? null, total: total ?? repos.length }, { headers: { "Cache-Control": "private, no-store" } });
}
