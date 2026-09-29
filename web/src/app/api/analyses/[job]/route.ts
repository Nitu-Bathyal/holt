// GET /api/analyses/{job}: where a check you walked away from is, for the
// check watcher (components/check-watch.tsx). Only what it shows: the status
// and, once done, the verdict line; the report itself is read on its page.
import { NextResponse } from "next/server";
import { jobStatus } from "@/lib/api";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: { code: "unauthorized", message: "Sign in first." } }, { status: 401 });
  const { job } = await params;
  const r = await jobStatus(job);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const { status, report, error } = r.data;
  return NextResponse.json({ status, headline: report?.headline ?? null, tone: report?.tone ?? null, error });
}
