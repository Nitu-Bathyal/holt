// The merge plan (API.md, Merge plan). GET: whether one can be made, and this
// user's latest. POST: make one; the server checks and charges, so nothing the
// browser sends decides what it costs.
import { NextResponse } from "next/server";
import { mergePlanState, startMergePlan } from "@/lib/api";
import { isValidRepo } from "@/lib/repo";
import { caller } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ owner: string; repo: string }> };

const BAD = { error: { code: "invalid_repo", message: "That doesn't look like a GitHub repository." } };

export async function GET(_req: Request, { params }: Ctx) {
  const { owner, repo } = await params;
  if (!isValidRepo(owner, repo)) return NextResponse.json(BAD, { status: 400 });
  const r = await mergePlanState(`${owner}/${repo}`, await caller());
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(_req: Request, { params }: Ctx) {
  const { owner, repo } = await params;
  if (!isValidRepo(owner, repo)) return NextResponse.json(BAD, { status: 400 });
  const who = await caller();
  if (!who.userId) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in to make a merge plan." } }, { status: 401 });
  }
  const r = await startMergePlan(`${owner}/${repo}`, who.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 202 });
}
