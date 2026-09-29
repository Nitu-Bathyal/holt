// Settings: one address per section, as tabs under the page head. Reached
// from the account menu.
import { PageTransition } from "@/components/motion/page-transition";
import { SettingsNav } from "@/components/settings/settings-nav";
import { AppPageHeader } from "@/components/shell/app-page";
import { currentUser } from "@/lib/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <PageTransition>
      <div className="app-page">
        <AppPageHeader title="Settings" lead={user ? user.name || user.email : null} />
        <SettingsNav />
        <div className="min-w-0 max-w-3xl pt-6">{children}</div>
      </div>
    </PageTransition>
  );
}
