import { NextResponse, type NextRequest } from "next/server";
import { anonymousStart } from "@/lib/anon-check";
import { startAnalysis } from "@/lib/api";
import { authSecret } from "@/lib/auth-secret";
import { startGate } from "@/lib/gate";
import { parseRepoInput } from "@/lib/repo";
import { caller } from "@/lib/session";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { repo?: string; mode?: string; days?: number; refresh?: boolean; ticket?: string } | null;
  const ref = parseRepoInput(String(body?.repo ?? ""));
  if (!ref) {
    return NextResponse.json(
      { error: { code: "invalid_repo", message: "That doesn't look like a GitHub repository. Try something like pallets/flask." } },
      { status: 400 },
    );
  }
  const mode = body?.mode === "ai" ? "ai" : "rules";
  const days = clampDays(body?.days);
  const who = await caller();
  if (mode === "ai" && !who.userId) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in to get an AI report." } }, { status: 401 });
  }
  const repo = `${ref.owner}/${ref.repo}`;
  // Checks are for signed-in people, and for anyone opening a report with no
  // result yet: the report page hands them a ticket (lib/anon-check.ts).
  const anonymous = !who.userId && anonymousStart({
    secret: authSecret(process.env),
    ticket: body?.ticket,
    ua: req.headers.get("user-agent"),
    repo,
    mode,
    days,
    refresh: Boolean(body?.refresh),
  });
  const refused = startGate(who.userId, anonymous);
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
  // The model is server configuration: nothing from the browser picks it.
  const r = await startAnalysis(repo, mode, days, Boolean(body?.refresh), who);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: r.data.status === "queued" ? 202 : 200 });
}

function clampDays(d: unknown): number {
  const n = Math.round(Number(d));
  return Number.isFinite(n) && n >= 1 && n <= 90 ? n : 7;
}
