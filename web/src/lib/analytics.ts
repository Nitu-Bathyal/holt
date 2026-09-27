// Cookieless page and event counts through the self-hosted Umami in the
// production stack (deploy/prod/README.md, "Analytics"). The script is served
// from our own origin at /stats/script.js (the edge proxies it and
// /stats/api/send to Umami), so it needs no extra CSP origin, sets no cookie
// and stores nothing in the browser.
//
// Only githolt.com loads it: staging and local builds send nothing unless
// NEXT_PUBLIC_UMAMI_SCRIPT points somewhere (a local check of Umami itself).

/** Fixed, so the site is created with this id (deploy/prod/umami.sh) and no build needs it. */
export const UMAMI_WEBSITE_ID = "2c77adc5-9260-4a3d-b240-fa6ffa8e8f10";

export function analyticsScript(
  host: string,
  override?: string,
  websiteId?: string,
): { src: string; websiteId: string } | null {
  const src = override || (host === "githolt.com" ? "/stats/script.js" : "");
  return src ? { src, websiteId: websiteId || UMAMI_WEBSITE_ID } : null;
}

export const ANALYTICS = analyticsScript(
  process.env.NEXT_PUBLIC_SITE_HOST || "",
  process.env.NEXT_PUBLIC_UMAMI_SCRIPT,
  process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
);

/** The events we count. Values are small and never personal: a repo name, a verdict. */
export type AnalyticsEvent = "paste-submit" | "report-view" | "starter-issue-click" | "find-run" | "sign-in";

type Umami = { track: (event: string, data?: Record<string, string | number>) => void };

/**
 * Count one event from client code. The script loads with `defer`, so an
 * event fired on mount may come before it: retry briefly, then drop it.
 * Links and buttons in server components use `data-umami-event` instead.
 */
export function track(event: AnalyticsEvent, data?: Record<string, string | number>, tries = 10): void {
  if (!ANALYTICS || typeof window === "undefined") return;
  const umami = (window as unknown as { umami?: Umami }).umami;
  if (umami) {
    try {
      umami.track(event, data);
    } catch {
      // Counting must never break the page.
    }
  } else if (tries > 0) {
    setTimeout(() => track(event, data, tries - 1), 500);
  }
}
