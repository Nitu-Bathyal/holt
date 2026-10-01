// An alert email's "Stop these emails" link: /alerts/unsubscribe?t=<token>.
// This page only hands the token to the browser. It must never talk to the
// Holt API itself: mail scanners and link previews fetch every link in an
// email, and a fetch alone must not unsubscribe anyone (API.md, "PR watch
// (alerts)"; lib/alerts.test.ts checks). components/alerts/unsubscribe.tsx
// sends the request once a browser has the page open.
import type { Metadata } from "next";
import { Unsubscribe } from "@/components/alerts/unsubscribe";
import { PageTransition } from "@/components/motion/page-transition";
import { unsubscribeToken } from "@/lib/alerts";

export const metadata: Metadata = { title: "Alert emails", robots: { index: false }, referrer: "no-referrer" };

export default async function UnsubscribePage({ searchParams }: PageProps<"/alerts/unsubscribe">) {
  const { t } = await searchParams;
  return (
    <PageTransition>
      <Unsubscribe token={unsubscribeToken(t)} />
    </PageTransition>
  );
}
