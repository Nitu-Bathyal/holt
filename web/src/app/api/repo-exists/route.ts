// GET /api/repo-exists?repo=owner/name → { exists, renamed? }. The paste boxes ask it
// before sending a signed-out visitor to sign in, so a typo lands on the
// not-found page instead of a sign-in wall. Same cached probe as the proxy
// (lib/repo-exists-check.ts): only a plain 404 from GitHub counts as missing.
import { NextResponse, type NextRequest } from "next/server";
import { clientIpFrom } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { isValidRepo } from "@/lib/repo";
import { repoExists } from "@/lib/repo-exists-check";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const [owner = "", repo = "", ...rest] = (req.nextUrl.searchParams.get("repo") ?? "").split("/");
  if (rest.length || !isValidRepo(owner, repo)) return NextResponse.json({ error: { code: "bad_request", message: "Expected owner/name." } }, { status: 400 });
  const limited = rateLimit(`repo-exists:${clientIpFrom(req.headers) ?? "unknown"}`, 30);
  if (!limited.ok) return NextResponse.json({ error: { code: "rate_limited", message: "Too many checks. Try again in a minute." } }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  const found = await repoExists(`${owner}/${repo}`);
  return NextResponse.json(found, { headers: { "Cache-Control": "private, max-age=600" } });
}
