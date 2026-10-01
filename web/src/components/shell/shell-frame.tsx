"use client";
// Picks the shell for the page you're on (lib/shell.ts). The root layout stays
// mounted across client navigations, so this decides from the live pathname,
// not from the request that first rendered the layout.
import { usePathname } from "next/navigation";
import { shellFor } from "@/lib/shell";
import styles from "./shell-frame.module.css";

export function ShellFrame({ marketingHeader, footer, topBar, rail, children }: {
  marketingHeader: React.ReactNode;
  footer: React.ReactNode;
  /** Only when signed in. */
  topBar: React.ReactNode | null;
  rail: React.ReactNode | null;
  children: React.ReactNode;
}) {
  const kind = shellFor(usePathname(), topBar !== null);
  if (kind === "app") {
    return (
      // The rail runs the full height on desktop; the top bar and the page
      // share the column beside it (which rail-toggle.tsx slides as one).
      <div className="flex flex-1 items-start overflow-x-clip">
        {rail}
        <div id="app-column" className={`${styles.column} flex min-w-0 flex-1 flex-col self-stretch`}>
          {topBar}
          <main id="content" className="min-w-0 flex-1 pb-16">{children}</main>
        </div>
      </div>
    );
  }
  return (
    <>
      {marketingHeader}
      <main id="content" data-shell="marketing" className="flex-1">{children}</main>
      {footer}
    </>
  );
}
