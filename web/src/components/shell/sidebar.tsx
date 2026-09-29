"use client";
// The app shell's sidebar: the five places a signed-in person goes
// (docs/design/DASHBOARD.md). A slim rail on desktop, and the same list in a
// drawer on phones and tablets. It doesn't fold: five places don't need the room.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeItem, type NavGroup, type NavItem } from "@/lib/shell";
import { GITHUB_REPO_URL } from "@/lib/site";
import { Icon } from "./icons";

export interface SidebarProps {
  groups: NavGroup[];
}

function Item({ item, on, path }: { item: NavItem; on: boolean; path: string }) {
  const open = on && item.children;
  return (
    <li>
      <Link href={item.href} aria-current={on ? "page" : undefined} className="side-item">
        <Icon name={item.icon} />
        <span className="side-label">{item.label}</span>
      </Link>
      {open && (
        <ul className="side-sub">
          {item.children!.map((c) => (
            <li key={c.id}>
              <Link href={c.href} aria-current={path === c.href || path.startsWith(`${c.href}/`) ? "page" : undefined} className="side-subitem">
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Nav({ groups }: SidebarProps) {
  const path = usePathname();
  const active = activeItem(groups, path);
  return (
    <>
      <nav aria-label="Holt" className="flex flex-col gap-5">
        {groups.map((g, i) => (
          <div key={g.label ?? i}>
            {g.label && <p className="side-group-label">{g.label}</p>}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((item) => <Item key={item.id} item={item} on={item.id === active} path={path} />)}
            </ul>
          </div>
        ))}
      </nav>
      <div className="side-foot mt-auto pt-6">
        <p className="flex flex-wrap gap-x-3 text-[0.78rem] text-faint">
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <a href={GITHUB_REPO_URL} className="hover:text-ink">GitHub ↗</a>
        </p>
      </div>
    </>
  );
}

/** The desktop rail. */
export function Sidebar(props: SidebarProps) {
  return (
    <aside data-lenis-prevent className="app-rail">
      <Nav {...props} />
    </aside>
  );
}

/** Phones and tablets: the same list in a drawer, opened from the top bar. */
export function Drawer(props: SidebarProps) {
  return (
    <div id="app-drawer" popover="auto" data-lenis-prevent className="drawer">
      <Nav {...props} />
    </div>
  );
}
