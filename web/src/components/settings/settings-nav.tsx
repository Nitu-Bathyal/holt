"use client";
// The settings sections as tabs, below lg. From lg up the sidebar lists them
// under Settings, so this hides. Each is its own route, so the lit tab is the
// page you're on.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS } from "@/lib/settings";

export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="-mx-4 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0 lg:hidden">
      <ul className="flex gap-1">
        {SECTIONS.map((s) => {
          const on = path === s.href || path.startsWith(`${s.href}/`);
          return (
            <li key={s.id} className="shrink-0">
              <Link
                href={s.href}
                aria-current={on ? "page" : undefined}
                className={`-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-[0.89rem] transition-colors ${
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
