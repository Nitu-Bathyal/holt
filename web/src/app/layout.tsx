import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Footer } from "@/components/footer";
import { MarketingHeader } from "@/components/header";
import { MenuAutoClose } from "@/components/motion/menu-autoclose";
import { RouteFallback } from "@/components/motion/route-fallback";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { appShell, creditsLine } from "@/components/shell/app-shell";
import { CheckLinks } from "@/components/shell/check-focus";
import { ShellFrame } from "@/components/shell/shell-frame";
import { themeScript } from "@/components/theme-toggle";
import { ANALYTICS } from "@/lib/analytics";
import { currentUser } from "@/lib/session";
import { SITE_URL } from "@/lib/site";
import "lenis/dist/lenis.css";
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
    default: "Holt · will this repo merge your PR?",
    template: "%s · Holt",
  },
  description:
    "Paste any GitHub repo. Holt reads its recent pull requests and tells you, in plain English, whether outside contributors get replies, get merged, and where their work lands.",
  openGraph: {
    siteName: "Holt",
    type: "website",
    title: "Holt · check whether a repo actually merges outsiders' PRs",
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Signed in: the app shell's sidebar and top bar, used on app pages (lib/shell.ts).
  const user = await currentUser();
  const credits = await creditsLine(user);
  const app = user ? await appShell(user, credits) : null;
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
        <ShellFrame marketingHeader={<MarketingHeader user={user} credits={credits} />} footer={<Footer />} topBar={app?.topBar ?? null} rail={app?.rail ?? null}>
          {children}
          <RouteFallback />
        </ShellFrame>
        <MenuAutoClose />
        <CheckLinks />
        <SmoothScroll />
      </body>
    </html>
  );
}
