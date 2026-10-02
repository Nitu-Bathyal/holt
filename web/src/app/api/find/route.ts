import { NextResponse, type NextRequest } from "next/server";
import { cachedFind } from "@/lib/find-cached";
import { findQuery, picksFromQuery } from "@/lib/find-picks";
import { findGate } from "@/lib/gate";
import { caller } from "@/lib/session";

/**
 * The /find page refining in place: `{"q": <the page's query string>}` in, a
 * FindStart out. POST, as a search can spend the visitor's work limit. Goes through the same 10-minute cache as the page itself, so
 * tapping back to an earlier pick costs nothing upstream.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { q?: unknown } | null;
  const picks = typeof body?.q === "string" && body.q.length <= 2000 ? picksFromQuery(body.q) : null;
  if (!picks) {
    return NextResponse.json({ error: { code: "invalid_request", message: "That search didn't make sense. Reload the page and try again." } }, { status: 400 });
  }
  // Signed out, /find shows the shared default search; other filters need an account.
  const who = await caller();
  const refused = findGate(who.userId);
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
  const r = await cachedFind(findQuery(picks), who);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { headers: { "Cache-Control": "no-store" } });
}
