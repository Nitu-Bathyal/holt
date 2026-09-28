// The URL trick: /https://github.com/o/r, /github.com/o/r and deep GitHub
// paths like /o/r/pulls all land on the report page /o/r.
// A repo that doesn't exist on GitHub gets the 404 page with a 404 status.
import { NextResponse, type NextRequest } from "next/server";
import { isAppRoute } from "@/lib/app-routes";
import { HOME_REDIRECT_CACHE, landingRedirect } from "@/lib/home";
import { hasLiveSession } from "@/lib/live-session";
import { isMockNotFound } from "@/lib/mock/fixtures";
import { isValidRepo, redirectTargetForPath } from "@/lib/repo";
import { retiredRedirect } from "@/lib/shell";
import { probeGitHub, repoExistsChecker } from "@/lib/repo-exists";

const repoExists = repoExistsChecker({
  probe: process.env.MOCK_API === "1" ? async (r) => (isMockNotFound(r) ? "missing" : "exists") : probeGitHub,
});

export async function proxy(req: NextRequest) {
  const target = redirectTargetForPath(req.nextUrl.pathname, req.nextUrl.search);
  if (target) return NextResponse.redirect(new URL(target, req.url), 308);

  // Pages that were merged into others (lib/shell.ts).
  const retired = retiredRedirect(req.nextUrl.pathname);
  if (retired) return NextResponse.redirect(new URL(retired, req.url), 308);

  // Signed in, "/" is your home (/me); /?landing=1 still shows the landing page.
  // Only a request carrying a session cookie costs a database lookup.
  if (req.nextUrl.pathname === "/") {
    const home = landingRedirect(await hasLiveSession(req), req.nextUrl.searchParams.get("landing") ?? undefined);
    if (home) return NextResponse.redirect(new URL(home, req.url), { status: 307, headers: { "Cache-Control": HOME_REDIRECT_CACHE } });
  }

  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  if (parts.length === 2 && !isAppRoute(parts[0]) && isValidRepo(parts[0], parts[1])) {
    if (!(await repoExists(`${parts[0]}/${parts[1]}`))) {
      return NextResponse.rewrite(new URL("/_not-found", req.url), { status: 404 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|api/|badge/|favicon.ico|icon.svg|icon-192.png|icon-512.png|icon-maskable-512.png|apple-icon|manifest.webmanifest|robots.txt|sitemap.xml).*)"],
};
