// Settings: one address per section, as tabs under the page head. Reached
// from the account menu.
import { PageTransition } from "@/components/motion/page-transition";
import { SettingsNav } from "@/components/settings/settings-nav";
import { AppPageHeader } from "@/components/shell/app-page";
import { alertList } from "@/lib/api";
import { currentUser } from "@/lib/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // The Alerts tab only where PR watch is switched on (the same read the bell makes).
  const user = await currentUser();
  const alerts = user ? await alertList(user.id) : null;
  return (
    <PageTransition>
      <div className="app-page">
        <AppPageHeader title="Settings" />
        <SettingsNav alerts={Boolean(alerts?.ok && alerts.data.access.state !== "unavailable")} />
        <div className="min-w-0 max-w-3xl pt-8">{children}</div>
      </div>
    </PageTransition>
  );
}
