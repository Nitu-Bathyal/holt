import { NextResponse } from "next/server";
import { signedInGate } from "@/lib/gate";
import { currentUser } from "@/lib/session";
import { proxyJobEvents } from "@/lib/sse-proxy";

export const dynamic = "force-dynamic";

// Only signed-in people start these jobs, so only they follow one.
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const refused = signedInGate((await currentUser())?.id);
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
  const { job } = await params;
  return proxyJobEvents("preflight-jobs", job, req.signal);
}
