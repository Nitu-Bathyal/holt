// The bell's list (API.md, "PR watch (alerts)"): the latest alerts, who gets
// them, and the unread count. Signed in only.
import { NextResponse } from "next/server";
import { alertList } from "@/lib/api";
import { answer, signedIn } from "@/lib/alerts-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await signedIn();
  if (user instanceof NextResponse) return user;
  return answer(await alertList(user.id));
}
