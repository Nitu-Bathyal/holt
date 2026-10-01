// The alert settings. A change carries only the switches, the email mode and
// the browser's time zone; the address is the signed-in account's own, added
// here, and never one the browser sent (lib/alerts.ts, settingsBody).
import { NextResponse, type NextRequest } from "next/server";
import { alertSettings, saveAlertSettings } from "@/lib/api";
import { settingsBody } from "@/lib/alerts";
import { answer, signedIn, unreadable } from "@/lib/alerts-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await signedIn();
  if (user instanceof NextResponse) return user;
  return answer(await alertSettings(user.id));
}

export async function PUT(req: NextRequest) {
  const user = await signedIn();
  if (user instanceof NextResponse) return user;
  const body = settingsBody(await req.json().catch(() => null), user.email);
  if (!body) return unreadable();
  return answer(await saveAlertSettings(user.id, body));
}
