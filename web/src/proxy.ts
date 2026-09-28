// The URL trick: /https://github.com/o/r, /github.com/o/r and deep GitHub
// paths like /o/r/pulls all land on the report page /o/r.
// A repo that doesn't exist on GitHub gets the 404 page with a 404 status.
import { NextResponse, type NextRequest } from "next/server";
import { isMockNotFound } from "@/lib/mock/fixtures";
import { isValidRepo, redirectTargetForPath } from "@/lib/repo";
import { probeGitHub, repoExistsChecker } from "@/lib/repo-exists";

const repoExists = repoExistsChecker({
  probe: process.env.MOCK_API === "1" ? async (r) => (isMockNotFound(r) ? "missing" : "exists") : probeGitHub,
});

// Two-segment app routes that /[owner]/[repo] must not claim.
const APP_ROUTES = new Set(["me", "discover", "pricing"]);

export async function proxy(req: NextRequest) {
  const target = redirectTargetForPath(req.nextUrl.pathname, req.nextUrl.search);
  if (target) return NextResponse.redirect(new URL(target, req.url), 308);

  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  if (parts.length === 2 && !APP_ROUTES.has(parts[0].toLowerCase()) && isValidRepo(parts[0], parts[1])) {
    if (!(await repoExists(`${parts[0]}/${parts[1]}`))) {
      return NextResponse.rewrite(new URL("/_not-found", req.url), { status: 404 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|api/|badge/|favicon.ico|icon.svg|icon-192.png|icon-512.png|icon-maskable-512.png|apple-icon|manifest.webmanifest|robots.txt|sitemap.xml).*)"],
};
