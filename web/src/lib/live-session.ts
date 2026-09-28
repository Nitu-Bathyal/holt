// Is this request's Auth.js session cookie a live session? For the proxy,
// which runs before any page. Never throws: a down database means "signed out".
import { and, eq, gt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { sessions } from "@/db/schema";

// Auth.js prefixes the cookie with __Secure- on https.
const COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];

export async function hasLiveSession(req: NextRequest): Promise<boolean> {
  const token = COOKIES.map((c) => req.cookies.get(c)?.value).find(Boolean);
  if (!token) return false;
  try {
    const [s] = await db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.sessionToken, token), gt(sessions.expires, new Date())))
      .limit(1);
    return !!s;
  } catch (e) {
    console.error("[holt] session check failed:", (e as Error).message);
    return false;
  }
}
