// Settings: one address per section. On desktop the sections are the
// sidebar's sub-items under Settings; below that, a row of tabs here.
import { PageTransition } from "@/components/motion/page-transition";
import { SettingsNav } from "@/components/settings/settings-nav";
import { AppPageHeader } from "@/components/shell/app-page";
import { currentUser } from "@/lib/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <PageTransition>
      <div className="wrap max-w-3xl pb-14 sm:pb-16">
        <AppPageHeader title="Settings" lead={user ? user.name || user.email : null} />
        <SettingsNav />
        <div className="min-w-0 pt-6 lg:pt-2">{children}</div>
      </div>
    </PageTransition>
  );
}
