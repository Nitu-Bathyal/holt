// Where the load goes, and what a browser behind Cloudflare would send.
//
// Two ways in, both to staging:
//   the local edge (default)  http://127.0.0.1:9110, on the server itself:
//                             measures the stack, with no tunnel in the way
//   the public URL            https://staging.githolt.com, through Cloudflare's
//                             tunnel and Access: measures what a visitor gets
//
// Production is refused, by name and by what the target's /__build says.
import http from "k6/http";
import { fail } from "k6";

export const BASE = (__ENV.BASE_URL || "http://127.0.0.1:9110").replace(/\/+$/, "");
export const SITE_HOST = __ENV.SITE_HOST || "staging.githolt.com";
export const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE);

const PRODUCTION = /^(www\.)?githolt\.com$/i;
const ACCESS_COOKIE = "CF_Authorization";
// The signed-out check is for browsers (web/src/lib/anon-check.ts), and so is
// this load: a browser's user agent, with a tail that names it in the logs.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 holt-loadtest";

function hostOf(url) {
  return url.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0];
}

/** Headers for every request. On the local edge, the ones the tunnel would add. */
function headers(extra) {
  const h = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    // As a browser, and as Cloudflare asks the origin. ENCODING=identity asks for no compression.
    "Accept-Encoding": __ENV.ENCODING || "gzip, br",
    "Accept-Language": "en-US,en;q=0.9",
    ...extra,
  };
  if (LOCAL) {
    h.Host = SITE_HOST;
    // One address for the whole run, so the API's per-IP limits count it as
    // one visitor, as they would a single machine anywhere else.
    h["X-Forwarded-For"] = __ENV.CLIENT_IP || "127.0.0.1";
    h["X-Forwarded-Proto"] = "https";
  }
  return h;
}

/** Cloudflare Access's session cookie, from the service token (as e2e/access.mjs does). */
function accessCookie() {
  const id = __ENV.STAGING_CF_ACCESS_CLIENT_ID || "";
  const secret = __ENV.STAGING_CF_ACCESS_CLIENT_SECRET || "";
  if (!id && !secret) return null;
  if (!id || !secret) fail("STAGING_CF_ACCESS_CLIENT_ID and STAGING_CF_ACCESS_CLIENT_SECRET are needed together");
  const res = http.get(`${BASE}/`, {
    redirects: 0,
    headers: { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret },
    tags: { step: "setup", page: "setup" },
  });
  const cookie = res.cookies[ACCESS_COOKIE];
  if (!cookie || !cookie.length) {
    fail(`Cloudflare Access gave no ${ACCESS_COOKIE} cookie for ${BASE} (status ${res.status}); is the service token current?`);
  }
  return cookie[0].value;
}

/**
 * Run once, before any load: refuse production, refuse a staging that is
 * building, and get through Access. Returns what each virtual user needs.
 */
export function openTarget() {
  if (PRODUCTION.test(hostOf(BASE)) || PRODUCTION.test(SITE_HOST)) {
    fail("this is production. Load tests run against staging only.");
  }
  const target = { access: LOCAL ? null : accessCookie() };
  const res = get("/__build", target, { step: "setup", page: "setup" });
  let build = null;
  try {
    build = res.json();
  } catch {
    // Not JSON: Access's login page, or not a Holt edge.
  }
  if (res.status !== 200 || !build || !build.site) {
    fail(`${BASE}/__build didn't answer as a Holt staging edge (status ${res.status}). Behind Cloudflare Access, set the service token.`);
  }
  if (hostOf(build.site) !== SITE_HOST || PRODUCTION.test(hostOf(build.site))) {
    fail(`${BASE} says it is ${build.site}, not ${SITE_HOST}. Load tests run against staging only.`);
  }
  const state = build.now && build.now.state;
  if (state !== "live") {
    fail(`staging is "${state}" (${build.now && build.now.message}); run when it is live, not while it builds or runs its smoke tests.`);
  }
  target.live = (build.live && build.live.preview_sha) || null;
  return target;
}

function params(target, tags, extra) {
  const p = { ...extra, tags, headers: headers(extra.headers) };
  if (target && target.access) p.cookies = { [ACCESS_COOKIE]: target.access };
  return p;
}

export function get(path, target, tags, extra = {}) {
  return http.get(`${BASE}${path}`, params(target, tags, extra));
}

export function postJson(path, body, target, tags, extra = {}) {
  const h = { "Content-Type": "application/json", Accept: "application/json", Origin: `https://${SITE_HOST}`, ...extra.headers };
  return http.post(`${BASE}${path}`, JSON.stringify(body), params(target, tags, { ...extra, headers: h }));
}
