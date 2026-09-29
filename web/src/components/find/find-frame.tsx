// Find a project's one frame (docs/design/DASHBOARD.md): the page head, the
// tabs, then the tab. /find, /discover and /hacktoberfest each render it, so
// their public URLs stay and they read as one place.
import Link from "next/link";
import { findTabs, type FindTab } from "@/lib/find-tabs";
import type { CatMood } from "@/lib/cat";
import { hacktoberfest } from "@/lib/site";
import { AppPageHeader } from "../shell/app-page";
import { Skeleton } from "../skeleton";

export function FindFrame({ tab, title, mood = "ready", signedIn, children }: {
  tab: FindTab;
  title: React.ReactNode;
  mood?: CatMood;
  signedIn: boolean;
  children: React.ReactNode;
}) {
  const tabs = findTabs({ signedIn, season: hacktoberfest() !== null, current: tab });
  return (
    <div className="app-page">
      <AppPageHeader title={title} mood={mood} />
      <nav aria-label="Find a project" className="app-tabs">
        {tabs.map((t) => (
          <Link key={t.id} href={t.href} aria-current={t.id === tab ? "page" : undefined} className="app-tab">
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="pt-6">{children}</div>
    </div>
  );
}

/** The frame's skeleton, for each tab's loading.tsx. */
export function FindFrameSkeleton({ tabs = 3, children }: { tabs?: number; children: React.ReactNode }) {
  return (
    <div className="app-page">
      <div className="app-head">
        <span className="flex h-[clamp(2.09rem,3.96vw,3.3rem)] items-center">
          <Skeleton className="h-[62%] w-[min(30rem,90%)]" />
        </span>
      </div>
      <div className="app-tabs">
        {Array.from({ length: tabs }, (_, i) => (
          <span key={i} className="flex min-h-11 items-center px-3">
            <Skeleton className="h-3 w-16" />
          </span>
        ))}
      </div>
      <div className="pt-6">{children}</div>
    </div>
  );
}
