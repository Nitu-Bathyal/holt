// GET /api/recent-checks: the footer's "recently checked" strip. Reads the
// report list (GET /v1/reports, cache only, no GitHub call) at most once per
// five minutes per server, and lets browsers and Cloudflare keep it as long.
// The footer asks for it only when it scrolls near, so pages never wait on it.
import { NextResponse } from "next/server";
import { listReports } from "@/lib/api";
import { recentChecks, REPORTS_CAP, type RecentChecks } from "@/lib/recent-checks";

export const dynamic = "force-dynamic";

const TTL_MS = 5 * 60_000;
let memo: { at: number; data: RecentChecks } | null = null;

export async function GET() {
  if (!memo || Date.now() - memo.at > TTL_MS) {
    const rows = await listReports(REPORTS_CAP); // never throws; [] when the API is down
    // Keep the last good list rather than replacing it with an empty one,
    // and wait the full TTL before asking again either way.
    memo = { at: Date.now(), data: rows.length || !memo ? recentChecks(rows) : memo.data };
  }
  return NextResponse.json(memo.data, { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
}
