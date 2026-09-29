// The URL trick: /https://github.com/o/r, /github.com/o/r and deep GitHub
// paths like /o/r/pulls all land on the report page /o/r.
// A repo that doesn't exist on GitHub gets the 404 page with a 404 status.
import { NextResponse, type NextRequest } from "next/server";
import { isAppRoute } from "@/lib/app-routes";
import { isValidRepo, redirectTargetForPath } from "@/lib/repo";
import { retiredRedirect } from "@/lib/shell";
import { repoExists } from "@/lib/repo-exists-check";

export async function proxy(req: NextRequest) {
  const target = redirectTargetForPath(req.nextUrl.pathname, req.nextUrl.search);
  if (target) return NextResponse.redirect(new URL(target, req.url), 308);

  // Pages that were merged into others (lib/shell.ts).
  const retired = retiredRedirect(req.nextUrl.pathname);
  if (retired) return NextResponse.redirect(new URL(retired, req.url), 308);

  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  if (parts.length === 2 && !isAppRoute(parts[0]) && isValidRepo(parts[0], parts[1])) {
    const found = await repoExists(`${parts[0]}/${parts[1]}`);
    if (!found.exists) {
      return NextResponse.rewrite(new URL("/_not-found", req.url), { status: 404 });
    }
    // Renamed on GitHub: the report lives under the new name.
    if (found.renamed && !isAppRoute(found.renamed.split("/")[0])) {
      return NextResponse.redirect(new URL(`/${found.renamed}${req.nextUrl.search}`, req.url), 308);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|api/|badge/|favicon.ico|icon.svg|icon-192.png|icon-512.png|icon-maskable-512.png|apple-icon|manifest.webmanifest|robots.txt|sitemap.xml).*)"],
};
