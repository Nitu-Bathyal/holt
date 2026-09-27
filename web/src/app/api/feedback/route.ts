import { NextResponse, type NextRequest } from "next/server";
import { sendFeedback } from "@/lib/api";
import { parseFeedback } from "@/lib/feedback";
import { caller } from "@/lib/session";

// "Was this verdict right?" from a report page. The API server rate-limits
// (per IP when signed out) and keeps one answer per person per report version.
export async function POST(req: NextRequest) {
  const input = parseFeedback(await req.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: { code: "invalid_request", message: "We couldn't read that answer. Please try again." } }, { status: 400 });
  }
  const r = await sendFeedback(input, await caller());
  if (!r.ok) {
    const headers = r.error.retry_after ? { "Retry-After": String(r.error.retry_after) } : undefined;
    return NextResponse.json({ error: r.error }, { status: r.status, headers });
  }
  return NextResponse.json(r.data);
}
