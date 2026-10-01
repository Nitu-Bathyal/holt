// The unread count for the bell, asked every few minutes and when the tab
// comes back (components/alerts/bell.tsx). Cheap on the server.
import { NextResponse } from "next/server";
import { alertCount } from "@/lib/api";
import { answer, signedIn } from "@/lib/alerts-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await signedIn();
  if (user instanceof NextResponse) return user;
  return answer(await alertCount(user.id));
}
