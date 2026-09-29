"use client";
// The settings sections as tabs, at every size (the sidebar holds only the
// five places). Each is its own route, so the lit tab is the page you're on.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS } from "@/lib/settings";

export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="app-tabs">
      {SECTIONS.map((s) => {
        const on = path === s.href || path.startsWith(`${s.href}/`);
        return (
          <Link key={s.id} href={s.href} aria-current={on ? "page" : undefined} className="app-tab">
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
