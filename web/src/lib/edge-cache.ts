// Which pages a shared cache in front of the site (Cloudflare) may keep.
//
// A page is the same for every signed-out visitor, and that is most of the
// traffic in a spike, so the proxy marks those responses as cacheable for a
// minute. Everything else keeps Next's own header for a page rendered per
// request (private, no-store).
//
// A response is cacheable only when all of this holds:
//   - GET or HEAD;
//   - the request carries no cookie this app could read. Signed in, a
//     sign-in half done, a saved display setting, last Find picks: any of
//     them, or a cookie this file doesn't know, and the page is rendered for
//     that visitor alone. Only Cloudflare's own cookies are let through;
//   - no Authorization header;
//   - the path is one of the public pages below, or a report page (the proxy
//     then asks whether the report exists: a page that offers to run the
//     check carries a short-lived ticket, and is never kept).
//
// A cache in front must do its half: skip the cache whenever the request has
// a cookie whose name contains "authjs" or "holt" (a hit is served without
// asking this app).
//
// The proxy can't tell a page load from a client-side navigation or prefetch
// (Next takes those headers and the `_rsc` parameter off before it runs), so
// their answers carry the same headers. They are other addresses to a cache
// (`?_rsc=...`), the same for every signed-out visitor, and the browser is
// told to keep nothing, so nothing signed-out is shown after signing in.
// No runtime imports beyond lib, so it runs under `node --test`.
import { isAppRoute } from "./app-routes.ts";
import { isValidRepo } from "./repo.ts";

/**
 * Cache-Control: a minute in a shared cache, nothing in the browser (it asks
 * again on every load, so signing in, a deploy or a new report shows at once).
 */
export const EDGE_CACHE = "public, max-age=0, must-revalidate, s-maxage=60";
/**
 * CDN-Cache-Control, which only the edge reads (Cloudflare puts it before
 * Cache-Control): the same minute, then up to five more while it fetches a
 * fresh copy behind the visitor it answers.
 */
export const EDGE_CACHE_CDN = "public, s-maxage=60, stale-while-revalidate=300";

// Exact paths. /find and /hacktoberfest are left out: they can carry a search
// that is still running, with its job id.
const PAGES = new Set(["/", "/discover", "/examples", "/example-ai-report", "/pricing", "/how-it-works", "/terms", "/privacy", "/refunds", "/contact"]);

// First segments that are never a GitHub owner and that the proxy never sees (its matcher leaves them out); refused here too.
const NOT_PAGES = new Set(["api", "badge", "_next"]);

// Cloudflare's own cookies (bot management, challenges, load balancing). The app never reads them.
const EDGE_COOKIE = /^(__cf|_cf|cf_)/;

export interface CacheQuestion {
  method: string;
  pathname: string;
  /** With its "?", or "". */
  search: string;
  /** Names of every cookie on the request. */
  cookies: string[];
  /** A request header, by lower-case name. */
  header: (name: string) => string | null;
}

/** "page": cacheable as it is. "report": cacheable if the repo's report exists. null: never. */
export function edgeCacheKind(q: CacheQuestion): "page" | "report" | null {
  if (q.method !== "GET" && q.method !== "HEAD") return null;
  if (!q.cookies.every((name) => EDGE_COOKIE.test(name))) return null;
  if (q.header("authorization")) return null;

  const path = q.pathname.length > 1 ? q.pathname.replace(/\/$/, "") : q.pathname;
  if (PAGES.has(path)) return "page";
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  // A language board: /discover/python.
  if (parts[0] === "discover") return "page";
  // A report at its plain address. Another time budget or the AI tab (?days=, ?mode=) is asked for rarely, and each would need its own check.
  if (!isAppRoute(parts[0]) && !NOT_PAGES.has(parts[0].toLowerCase()) && isValidRepo(parts[0], parts[1]) && q.search === "") return "report";
  return null;
}
