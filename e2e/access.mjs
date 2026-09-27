// Getting through Cloudflare Access to staging, for the smoke tests and Lighthouse.
//
// Staging can sit behind Cloudflare Access. With a service token in
// STAGING_CF_ACCESS_CLIENT_ID and STAGING_CF_ACCESS_CLIENT_SECRET, one request
// to the site sends the token's two headers and gets back Access's session
// cookie (CF_Authorization). The browser and the API client get only that
// cookie, set for the site's host alone, so nothing Access-related goes to any
// other origin: not to github.com, not to a redirect's target, not to fonts or
// images. The token itself never leaves this process except in that one
// request, which never follows a redirect.
//
// With neither variable set, accessToken() is null and nothing here runs.

export const ACCESS_COOKIE = "CF_Authorization";

/** The service token from the environment, or null when there isn't one. */
export function accessToken(env = process.env) {
  const id = env.STAGING_CF_ACCESS_CLIENT_ID || "";
  const secret = env.STAGING_CF_ACCESS_CLIENT_SECRET || "";
  if (!id && !secret) return null;
  if (!id || !secret) {
    throw new Error("STAGING_CF_ACCESS_CLIENT_ID and STAGING_CF_ACCESS_CLIENT_SECRET are needed together; only one is set");
  }
  return { id, secret };
}

/** Access's session cookie for `baseURL`, asked for with the service token. */
export async function accessCookie(baseURL, token) {
  const url = new URL("/", baseURL);
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "CF-Access-Client-Id": token.id, "CF-Access-Client-Secret": token.secret },
  });
  const cookie = res.headers.getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith(`${ACCESS_COOKIE}=`));
  if (!cookie) {
    throw new Error(
      `Cloudflare Access didn't hand back a ${ACCESS_COOKIE} cookie for ${url.origin} (status ${res.status}). ` +
      "Check that the service token is current and that the staging application's policy allows it (a Service Auth rule).",
    );
  }
  const value = cookie.slice(ACCESS_COOKIE.length + 1);

  // The cookie alone must get through; otherwise every test would fail on the login page.
  const check = await fetch(url, { redirect: "manual", headers: { Cookie: `${ACCESS_COOKIE}=${value}` } });
  const to = check.headers.get("location");
  if (check.status === 401 || check.status === 403 || (to && new URL(to, url).host !== url.host)) {
    throw new Error(`the ${ACCESS_COOKIE} cookie from the service token doesn't get through Access on ${url.origin} (status ${check.status})`);
  }
  return {
    name: ACCESS_COOKIE,
    value,
    domain: url.hostname,   // no leading dot: this host only, no subdomains
    path: "/",
    secure: url.protocol === "https:",
    httpOnly: true,
    sameSite: "Lax",
    expires: -1,
  };
}
