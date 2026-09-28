import { NextResponse, type NextRequest } from "next/server";
import { subscribe } from "@/lib/api";
import { currentUser } from "@/lib/session";

// Start a monthly plan. Only the plan's id goes to the server: the price and
// the Razorpay plan come from its catalogue.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized", message: "Please sign in first." } }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { plan?: unknown } | null;
  const plan = typeof body?.plan === "string" && /^[a-z0-9_]{1,40}$/.test(body.plan) ? body.plan : null;
  if (!plan) {
    return NextResponse.json({ error: { code: "invalid_request", message: "That plan isn't on sale." } }, { status: 400 });
  }
  const r = await subscribe(user.id, plan);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data);
}
