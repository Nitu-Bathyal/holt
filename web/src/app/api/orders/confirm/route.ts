import { NextResponse, type NextRequest } from "next/server";
import { confirmOrder } from "@/lib/api";
import { currentUser } from "@/lib/session";

// What Razorpay Checkout handed the page after a payment. The server checks
// the signature and asks Razorpay before adding any credits.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized", message: "Please sign in first." } }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const field = (k: string) => (typeof b?.[k] === "string" && (b[k] as string).length <= 200 ? (b[k] as string) : null);
  const [o, p, s] = [field("razorpay_order_id"), field("razorpay_payment_id"), field("razorpay_signature")];
  if (!o || !p || !s) {
    return NextResponse.json({ error: { code: "invalid_request", message: "We couldn't read the payment details." } }, { status: 400 });
  }
  const r = await confirmOrder(user.id, { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: s });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data);
}
