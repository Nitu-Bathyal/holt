import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AlertSettingsForm } from "@/components/alerts/alert-settings";
import { ErrorPanel } from "@/components/error-panel";
import { SectionHead } from "@/components/settings/section-head";
import { alertSettings } from "@/lib/api";
import { currentUser } from "@/lib/session";
import { ALERT_SETTINGS } from "@/lib/settings";

export const metadata: Metadata = { title: "Alerts · Settings", robots: { index: false } };

// PR watch's settings (API.md, "PR watch (alerts)"). The alert emails link here.
export default async function AlertSettingsPage() {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${ALERT_SETTINGS}`);
  const r = await alertSettings(user.id);
  // Switched off on this server: the tab isn't listed either (settings/layout.tsx).
  if (r.ok && r.data.access.state === "unavailable") notFound();

  return (
    <section aria-labelledby="alerts-h">
      <SectionHead id="alerts" />
      {r.ok ? <AlertSettingsForm initial={r.data} accountEmail={user.email} /> : <ErrorPanel error={r.error} retryHref={ALERT_SETTINGS} />}
    </section>
  );
}
