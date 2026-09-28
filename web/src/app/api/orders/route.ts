import { NextResponse, type NextRequest } from "next/server";
import { createOrder, orders } from "@/lib/api";
import { currentUser } from "@/lib/session";

const SIGN_IN = { error: { code: "unauthorized", message: "Please sign in first." } };

// Start a credit-pack checkout. Only the pack's id goes to the server: the
// price and the credits come from its catalogue.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json(SIGN_IN, { status: 401 });
  const body = (await req.json().catch(() => null)) as { pack?: unknown } | null;
  const pack = typeof body?.pack === "string" && /^[a-z0-9_]{1,40}$/.test(body.pack) ? body.pack : null;
  if (!pack) {
    return NextResponse.json({ error: { code: "invalid_request", message: "That credit pack isn't on sale." } }, { status: 400 });
  }
  const r = await createOrder(user.id, pack);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data);
}

// The purchase history, for the thank-you page while a payment is confirmed.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json(SIGN_IN, { status: 401 });
  const r = await orders(user.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { headers: { "Cache-Control": "no-store" } });
}
