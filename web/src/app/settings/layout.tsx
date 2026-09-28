// Settings: one address per section, with the sections always in reach
// (tabs on phones, a side list on wider screens).
import { PageHead } from "@/components/page-head";
import { PageTransition } from "@/components/motion/page-transition";
import { SettingsNav } from "@/components/settings/settings-nav";
import { currentUser } from "@/lib/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <PageTransition>
      <>
        <PageHead compact className="max-md:border-b-0">
          <div>
            <h1 className="display text-[clamp(1.8rem,5vw,2.6rem)]">Settings</h1>
            {user && <p className="mt-1 truncate text-[0.89rem] text-faint">{user.name || user.email}</p>}
          </div>
        </PageHead>
        <div className="wrap pb-14 sm:pb-16 md:grid md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10 md:pt-10">
          <SettingsNav />
          <div className="min-w-0 max-w-3xl pt-6 md:pt-0">{children}</div>
        </div>
      </>
    </PageTransition>
  );
}
