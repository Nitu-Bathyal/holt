// PR pre-flight (API.md). GET: whether it's on, what a check costs this user,
// and their latest check of ?pr= (or ?repo=&branch=&base=). POST: start a
// check; the server validates, checks and charges, so nothing the browser
// sends decides what it costs.
import { NextResponse, type NextRequest } from "next/server";
import { preflightState, startPreflight } from "@/lib/api";
import { caller } from "@/lib/session";

export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const r = await preflightState({ pr: p.get("pr"), repo: p.get("repo"), branch: p.get("branch"), base: p.get("base") }, await caller());
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const who = await caller();
  if (!who.userId) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in to check a pull request." } }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const pr = str(body?.pr_url, 500);
  const target = pr ? { pr_url: pr } : { repo: str(body?.repo, 500), branch: str(body?.branch, 250), base: str(body?.base, 250) };
  const r = await startPreflight({ ...target, summary: body?.summary === true }, who);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 202 });
}
