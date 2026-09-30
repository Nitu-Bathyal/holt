// Find a project's one frame (docs/design/DASHBOARD.md): the tabs, then the
// tab. /find, /discover and /hacktoberfest each render it, so their public
// URLs stay and they read as one place. There's no visible page head: the tab
// row and each tab's filter tray (.find-tray) continue the top bar as one band
// (globals.css), so the results start near the top of a page used every day.
// Signed in, the top bar's repo box moves into the tab row, on the right
// before Hacktoberfest.
import Link from "next/link";
import { findTabs, type FindTab } from "@/lib/find-tabs";
import { hacktoberfest } from "@/lib/site";
import { QuickCheck } from "../shell/quick-check";
import { Skeleton } from "../skeleton";

export function FindFrame({ tab, title, signedIn, children }: {
  tab: FindTab;
  /** The page's name for screen readers and the outline; not shown. */
  title: React.ReactNode;
  signedIn: boolean;
  children: React.ReactNode;
}) {
  const tabs = findTabs({ signedIn, season: hacktoberfest() !== null, current: tab });
  const link = (t: (typeof tabs)[number]) => (
    <Link key={t.id} href={t.href} aria-current={t.id === tab ? "page" : undefined} className="find-tab" data-tab={t.id}>
      {t.label}
    </Link>
  );
  const main = tabs.filter((t) => t.id !== "hacktoberfest");
  const hf = tabs.find((t) => t.id === "hacktoberfest");
  return (
    <div className="app-page" data-frame="wide">
      <div className="find-band">
        <h1 className="sr-only">{title}</h1>
        <nav aria-label="Find a project" className="find-tabs">
          {main.map(link)}
          <span className="find-tabs-end">
            {signedIn && <QuickCheck variant="band" className="w-72 lg:w-96" />}
            {hf && link(hf)}
          </span>
        </nav>
      </div>
      {children}
    </div>
  );
}

/** The frame's skeleton, for each tab's loading.tsx. */
export function FindFrameSkeleton({ tabs = 3, children }: { tabs?: number; children: React.ReactNode }) {
  return (
    <div className="app-page" data-frame="wide">
      <div className="find-band">
        <div className="find-tabs">
          {Array.from({ length: tabs }, (_, i) => (
            <span key={i} className={`flex min-h-9 items-center px-3 ${i === tabs - 1 && tabs > 2 ? "ml-auto" : ""}`}>
              <Skeleton className="h-3 w-16" />
            </span>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
