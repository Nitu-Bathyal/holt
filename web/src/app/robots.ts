import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Read ROBOTS_NOINDEX at request time, not at build.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (process.env.ROBOTS_NOINDEX === "1") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: [
        "/api/", "/signin",
        // Account pages (lib/gate.ts): signed out, each is a redirect to sign-in.
        // The "$" keeps repos whose owner starts the same way (/finder/x) crawlable.
        "/me/", "/settings", "/discover$", "/discover/", "/discover?", "/find$", "/find?", "/compare$", "/compare?", "/preflight$", "/preflight?",
        "/hacktoberfest?",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
