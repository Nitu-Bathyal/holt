// No alerts for one pull request (PUT), or watch it again (DELETE), from its
// row on My PRs. Both are idempotent, so a double click is harmless.
import { NextResponse } from "next/server";
import { setAlertMute } from "@/lib/api";
import { answer, signedIn } from "@/lib/alerts-route";
import { isValidRepo } from "@/lib/repo";

type Ctx = { params: Promise<{ owner: string; repo: string; number: string }> };

const BAD = { error: { code: "invalid_request", message: "That isn't one of your pull requests." } };

async function change({ params }: Ctx, muted: boolean) {
  const { owner, repo, number } = await params;
  if (!isValidRepo(owner, repo) || !/^[1-9]\d{0,9}$/.test(number)) return NextResponse.json(BAD, { status: 400 });
  const user = await signedIn();
  if (user instanceof NextResponse) return user;
  return answer(await setAlertMute(user.id, `${owner}/${repo}`, Number(number), muted));
}

export async function PUT(_req: Request, ctx: Ctx) {
  return change(ctx, true);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return change(ctx, false);
}
