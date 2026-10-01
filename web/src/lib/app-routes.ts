// First segments of the app's own two-segment routes (/me/repos,
// /discover/python, /settings/profile, /pricing/thanks, /alerts/unsubscribe,
// and /lab/* for prototypes), which /[owner]/[repo] must never claim: the proxy would probe
// GitHub for them and answer 404. Add a folder here when you add one under
// src/app with pages below it (app-routes.test.ts checks). No imports, so it
// runs under `node --test`.
const APP_ROUTES = new Set(["me", "discover", "pricing", "settings", "alerts", "lab"]);

/** Whether a path's first segment is one of the app's own routes rather than a GitHub owner. */
export function isAppRoute(first: string): boolean {
  return APP_ROUTES.has(first.toLowerCase());
}
