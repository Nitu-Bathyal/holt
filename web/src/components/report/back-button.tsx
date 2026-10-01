"use client";
// The report's back arrow: to the page before this repo's report and merge
// plan on Holt (Find, Browse, Your repos, Compare...), skipping any going back
// and forth between those two (lib/in-app-history.ts). Opened as the first
// Holt page in the tab, it goes to `fallback` instead of leaving the site.
import { usePathname, useRouter } from "next/navigation";
import { pageBefore } from "@/lib/in-app-history";

export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <button
      type="button"
      onClick={() => router.push(pageBefore(pathname) ?? fallback)}
      aria-label="Back"
      title="Back"
      className="grid size-10 shrink-0 place-items-center self-start border border-line-strong text-muted transition-colors hover:border-ink hover:text-ink"
      data-report-back
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </svg>
    </button>
  );
}
