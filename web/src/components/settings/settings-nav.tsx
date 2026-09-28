"use client";
// The settings sections: a row of tabs on phones, a side list from md up.
// Each is its own route, so the tab that's lit is the page you're on.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS } from "@/lib/settings";

export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="-mx-4 overflow-x-auto border-b border-line px-4 md:mx-0 md:overflow-visible md:border-0 md:px-0">
      <ul className="flex gap-1 md:sticky md:top-24 md:flex-col md:gap-0 md:border-l md:border-line">
        {SECTIONS.map((s) => {
          const on = path === s.href || path.startsWith(`${s.href}/`);
          return (
            <li key={s.id} className="shrink-0">
              <Link
                href={s.href}
                aria-current={on ? "page" : undefined}
                className={`-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-[0.875rem] transition-colors md:-ml-px md:mb-0 md:border-b-0 md:border-l-2 md:px-4 ${
                  on ? "border-blue text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
