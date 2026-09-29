// Settings: one address per section, as tabs under the page head. Reached
// from the account menu.
import { PageTransition } from "@/components/motion/page-transition";
import { SettingsNav } from "@/components/settings/settings-nav";
import { AppPageHeader } from "@/components/shell/app-page";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageTransition>
      <div className="app-page">
        <AppPageHeader title="Settings" />
        <SettingsNav />
        <div className="min-w-0 max-w-3xl pt-8">{children}</div>
      </div>
    </PageTransition>
  );
}
