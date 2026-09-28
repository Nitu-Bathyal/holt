import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { RouteFallback } from "@/components/motion/route-fallback";
import { themeScript } from "@/components/theme-toggle";
import { ANALYTICS } from "@/lib/analytics";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  // greek: the ω in the header cat is on every page; preloading it with latin
  // saves a second font swap (and re-layout) right after first paint.
  subsets: ["latin", "greek"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Holt — will this repo merge your PR?",
    template: "%s · Holt",
  },
  description:
    "Paste any GitHub repo. Holt reads its recent pull requests and tells you, in plain English, whether outside contributors get replies, get merged, and where their work lands.",
  openGraph: {
    siteName: "Holt",
    type: "website",
    title: "Holt — check whether a repo actually merges outsiders' PRs",
    description: "See how a project treats outside contributors before you spend your week on it. Swap hub for holt in any GitHub link.",
  },
  twitter: { card: "summary_large_image" },
  // Staging and previews: keep search engines out (robots.txt disallows too).
  ...(process.env.ROBOTS_NOINDEX === "1" ? { robots: { index: false, follow: false } } : {}),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#121312" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={mono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {ANALYTICS && <script defer src={ANALYTICS.src} data-website-id={ANALYTICS.websiteId} />}
      </head>
      {/* Extensions such as Grammarly add attributes to <body> before React
          hydrates. This only silences attribute mismatches on <body> itself. */}
      <body className="flex min-h-dvh flex-col" suppressHydrationWarning>
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <Header />
        <main id="content" className="flex-1">
          {children}
          <RouteFallback />
        </main>
        <Footer />
      </body>
    </html>
  );
}
