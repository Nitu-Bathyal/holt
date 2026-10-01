// What the /api/alerts route handlers share: who is asking, passing the
// server's answer on, and the unsubscribe link. Private answers are never cached.
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeStep, unsubscribeToken } from "./alerts";
import { setAlertEmailByToken } from "./api";
import { clientIpFrom } from "./client-ip";
import { rateLimit } from "./rate-limit";
import { currentUser, type SessionUser } from "./session";
import type { Result } from "./types";

const PRIVATE = { "Cache-Control": "private, no-store" };

function refuse(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { ...PRIVATE, ...headers } });
}

export const unreadable = () => refuse(400, "invalid_request", "We couldn't read that. Please try again.");

/** The signed-in user, or the 401 to answer with. */
export async function signedIn(): Promise<SessionUser | NextResponse> {
  return (await currentUser()) ?? refuse(401, "unauthorized", "Sign in to get alerts.");
}

/** The server's answer as this route's: its data, or its error and status. A 204 stays a 204. */
export function answer<T>(r: Result<T>): NextResponse {
  if (!r.ok) return refuse(r.status, r.error.code, r.error.message, r.error.retry_after ? { "Retry-After": String(r.error.retry_after) } : {});
  if (r.data === undefined) return new NextResponse(null, { status: 204, headers: PRIVATE });
  return NextResponse.json(r.data, { headers: PRIVATE });
}

/** The token: in the address for a mail client's one-click, in the body from the page. */
async function tokenFrom(req: NextRequest): Promise<string | null> {
  const fromQuery = unsubscribeToken(req.nextUrl.searchParams.get("t"));
  if (fromQuery) return fromQuery;
  if (!req.headers.get("content-type")?.includes("application/json")) return null;
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  return unsubscribeToken(body?.token);
}

/**
 * Alert email off (the unsubscribe link) or back on (its undo), for whoever
 * holds the token: no sign-in. Only ever from a POST (lib/alerts.ts,
 * unsubscribeStep). 200 with {"email_on"}; a link that isn't current is 404.
 */
export async function setEmailByToken(req: NextRequest, on: boolean): Promise<NextResponse> {
  const limited = rateLimit(`unsubscribe:${clientIpFrom(req.headers) ?? "unknown"}`, 30);
  if (!limited.ok) return refuse(429, "rate_limited", "Too many tries. Wait a minute.", { "Retry-After": String(limited.retryAfter) });
  const token = await tokenFrom(req);
  if (!token || unsubscribeStep(req.method, token) !== "unsubscribe") return refuse(400, "invalid_request", "That link doesn't work any more.");
  return answer(await setAlertEmailByToken(token, on));
}
