// Save a repo for later (PUT) or unsave it (DELETE), from the save button
// (API.md, "Saved repos"). Signed in only; the server rate-limits and makes
// both idempotent, so a double click or a retry is harmless.
import { NextResponse } from "next/server";
import { setSaved } from "@/lib/api";
import { isValidRepo } from "@/lib/repo";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ owner: string; repo: string }> };

const BAD = { error: { code: "invalid_repo", message: "That doesn't look like a GitHub repository." } };

async function change({ params }: Ctx, saved: boolean) {
  const { owner, repo } = await params;
  if (!isValidRepo(owner, repo)) return NextResponse.json(BAD, { status: 400 });
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in to save repos." } }, { status: 401 });
  }
  const r = await setSaved(user.id, `${owner}/${repo}`, saved);
  if (!r.ok) {
    const headers = r.error.retry_after ? { "Retry-After": String(r.error.retry_after) } : undefined;
    return NextResponse.json({ error: r.error }, { status: r.status, headers });
  }
  return NextResponse.json(r.data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(_req: Request, ctx: Ctx) {
  return change(ctx, true);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return change(ctx, false);
}
