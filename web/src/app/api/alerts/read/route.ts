// Mark alerts read: {"ids": [41, 40]} or {"all": true}. Only the caller's own change.
import { NextResponse, type NextRequest } from "next/server";
import { readAlerts } from "@/lib/api";
import { answer, signedIn, unreadable } from "@/lib/alerts-route";

const MAX_ID = 2 ** 31 - 1;

export async function POST(req: NextRequest) {
  const user = await signedIn();
  if (user instanceof NextResponse) return user;
  const body = (await req.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null;
  if (body?.all === true) return answer(await readAlerts(user.id, { all: true }));
  const ids = Array.isArray(body?.ids) ? body.ids.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= MAX_ID).slice(0, 200) : [];
  if (!ids.length) return unreadable();
  return answer(await readAlerts(user.id, { ids }));
}
