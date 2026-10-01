// The unsubscribe page's "undo": alert email back on, with the same token
// ({"token": …}). POST only.
import type { NextRequest } from "next/server";
import { setEmailByToken } from "@/lib/alerts-route";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return setEmailByToken(req, true);
}
