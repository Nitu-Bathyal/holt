// "How to get merged here" (API.md, Playbook). GET: the teaser, or the whole
// playbook once this user unlocked it. POST: unlock it; the server checks and
// charges, so nothing the browser sends decides what it costs.
import { NextResponse } from "next/server";
import { playbookState, unlockPlaybook } from "@/lib/api";
import { isValidRepo } from "@/lib/repo";
import { caller } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ owner: string; repo: string }> };

const BAD = { error: { code: "invalid_repo", message: "That doesn't look like a GitHub repository." } };

export async function GET(_req: Request, { params }: Ctx) {
  const { owner, repo } = await params;
  if (!isValidRepo(owner, repo)) return NextResponse.json(BAD, { status: 400 });
  const r = await playbookState(`${owner}/${repo}`, await caller());
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(_req: Request, { params }: Ctx) {
  const { owner, repo } = await params;
  if (!isValidRepo(owner, repo)) return NextResponse.json(BAD, { status: 400 });
  const who = await caller();
  if (!who.userId) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in to unlock the playbook." } }, { status: 401 });
  }
  const r = await unlockPlaybook(`${owner}/${repo}`, who.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: r.data.status === "queued" ? 202 : 200 });
}
