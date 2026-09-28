import type { NextConfig } from "next";

// The policy pages (/terms, /privacy, /refunds, /contact) render these, and
// they are prerendered at build time. A production build must not bake in
// the placeholders that src/lib/site.ts falls back to. Local builds without
// the real values: HOLT_ALLOW_PLACEHOLDER_CONTACT=1.
if (process.env.NODE_ENV === "production" && process.env.HOLT_ALLOW_PLACEHOLDER_CONTACT !== "1") {
  for (const k of ["CONTACT_EMAIL", "CONTACT_CITY"]) {
    const v = process.env[`NEXT_PUBLIC_${k}`];
    if (!v || v === k) {
      throw new Error(
        `NEXT_PUBLIC_${k} is unset or the placeholder "${k}": the policy pages would ship it. Set it for the build, or HOLT_ALLOW_PLACEHOLDER_CONTACT=1 for a local build.`,
      );
    }
  }
}

const dev = process.env.NODE_ENV !== "production";

// Every source the site loads from. Scripts and styles need 'unsafe-inline':
// Next inlines its RSC payload and the theme script, and React sets style
// attributes; nonces would force every page to render per request. Fonts are
// self-hosted by next/font. Images: GitHub avatars (github.com/o.png redirects
// to avatars.githubusercontent.com) and Google profile pictures.
// form-action: signing in without JS posts, then redirects to the provider.
// Razorpay Checkout (credit packs): its script from checkout.razorpay.com,
// which loads Razorpay's fraud check from cdn.razorpay.com, opens the payment
// window in a frame from api.razorpay.com, and calls that API and its error
// reporting (lumberjack) from our page.
const razorpay = {
  script: "https://checkout.razorpay.com https://cdn.razorpay.com",
  connect: "https://api.razorpay.com https://lumberjack.razorpay.com",
  frame: "https://api.razorpay.com",
};
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${razorpay.script}${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://github.com https://avatars.githubusercontent.com https://*.googleusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self' ${razorpay.connect}${dev ? " ws:" : ""}`,
  `frame-src ${razorpay.frame}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://github.com https://accounts.google.com",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The staging/production Docker image runs .next/standalone.
  output: "standalone",
  // OG images read these fonts from disk at runtime.
  outputFileTracingIncludes: {
    "/opengraph-image": ["./assets/fonts/**/*"],
    "/[owner]/[repo]/opengraph-image": ["./assets/fonts/**/*"],
  },
  devIndicators: false,
  poweredByHeader: false,
};

export default nextConfig;
