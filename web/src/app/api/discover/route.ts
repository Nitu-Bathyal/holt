// GET /api/discover?sort=&language=&topic=&cursor=: the next part of a board,
// for Browse's list as it is scrolled (components/discover/board-list.tsx).
// Open like Browse itself (lib/gate.ts). Reads only Holt's database upstream
// (API.md, GET /v1/discover).
import { NextResponse, type NextRequest } from "next/server";
import { discover } from "@/lib/api";
import { BOARD_PART, parseSort } from "@/lib/discover";

export const dynamic = "force-dynamic";

const one = (v: string | null, max = 80) => v?.trim().slice(0, max) || null;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const r = await discover(parseSort(p.get("sort") ?? undefined), one(p.get("language")), one(p.get("topic"))?.toLowerCase() ?? null, BOARD_PART, false, one(p.get("cursor"), 400));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const { repos, next, total } = r.data;
  return NextResponse.json({ items: repos, next: next ?? null, total: total ?? repos.length }, { headers: { "Cache-Control": "private, no-store" } });
}
