import { NextResponse, type NextRequest } from "next/server";
import { forwardRazorpayWebhook } from "@/lib/api";

// Razorpay's webhook URL. The body goes to the server exactly as received,
// because the signature covers those bytes; the server checks it before
// reading anything. Razorpay retries on anything but 2xx.
const MAX_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-razorpay-signature");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (!signature || declared > MAX_BYTES) {
    return NextResponse.json({ error: { code: "invalid_request", message: "Not a Razorpay webhook." } }, { status: 400 });
  }
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: { code: "invalid_request", message: "Not a Razorpay webhook." } }, { status: 400 });
  }
  const r = await forwardRazorpayWebhook(body, signature);
  return NextResponse.json(r.body, { status: r.status });
}
