// POST /api/find/more {"q": <the page's query string>, "cursor": …}: the next
// part of what Holt's index has for a search, for Find's list as it is
// scrolled (components/find/find-list.tsx). Open like Find itself
// (lib/gate.ts): it never starts a GitHub search and spends none of the
// visitor's limit, because upstream it reads the index alone (API.md, POST
// /v1/find/index).
import { NextResponse, type NextRequest } from "next/server";
import { findIndex } from "@/lib/api";
import { findQuery, picksFromQuery } from "@/lib/find-picks";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { q?: unknown; cursor?: unknown } | null;
  const picks = typeof body?.q === "string" && body.q.length <= 2000 ? picksFromQuery(body.q) : null;
  const cursor = typeof body?.cursor === "string" && body.cursor.length <= 400 ? body.cursor : null;
  if (!picks || (body?.cursor != null && cursor === null)) {
    return NextResponse.json({ error: { code: "invalid_request", message: "That search didn't make sense. Reload the page and try again." } }, { status: 400 });
  }
  const { languages, topics, days, hacktoberfest } = findQuery(picks);
  const r = await findIndex({ languages, topics, days, hacktoberfest }, cursor || null);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ items: r.data.results, next: r.data.next, total: r.data.total }, { headers: { "Cache-Control": "private, no-store" } });
}
