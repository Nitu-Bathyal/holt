"use client";
// The app shell's sidebar: the five places a signed-in person goes
// (docs/design/DASHBOARD.md). A rail on desktop that folds to icons
// (remembered in a cookie), and the same list in a drawer on phones and tablets.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { activeItem, SIDEBAR_COOKIE, type NavGroup, type NavItem } from "@/lib/shell";
import { GITHUB_REPO_URL } from "@/lib/site";
import { Icon } from "./icons";

export interface SidebarProps {
  groups: NavGroup[];
}

function Item({ item, on, folded, path }: { item: NavItem; on: boolean; folded: boolean; path: string }) {
  const open = on && !folded && item.children;
  return (
    <li>
      <Link href={item.href} aria-current={on ? "page" : undefined} title={folded ? item.label : undefined} className="side-item">
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

function Nav({ groups, folded }: SidebarProps & { folded: boolean }) {
  const path = usePathname();
  const active = activeItem(groups, path);
  return (
    <>
      <nav aria-label="Holt" className="flex flex-col gap-5">
        {groups.map((g, i) => (
          <div key={g.label ?? i}>
            {g.label && <p className="side-group-label">{g.label}</p>}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((item) => <Item key={item.id} item={item} on={item.id === active} folded={folded} path={path} />)}
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
export function Sidebar({ initialFolded, ...props }: SidebarProps & { initialFolded: boolean }) {
  const [folded, setFolded] = useState(initialFolded);
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "folded" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <aside data-folded={folded || undefined} data-lenis-prevent className="app-rail">
      <Nav {...props} folded={folded} />
      <button type="button" onClick={toggle} aria-expanded={!folded} className="side-item mt-3 text-faint" title={folded ? "Show labels" : undefined}>
        <Icon name="fold" className={`size-4 transition-transform ${folded ? "rotate-180" : ""}`} />
        <span className="side-label">Fold the sidebar</span>
      </button>
    </aside>
  );
}

/** Phones and tablets: the same list in a drawer, opened from the top bar. */
export function Drawer(props: SidebarProps) {
  return (
    <div id="app-drawer" popover="auto" data-lenis-prevent className="drawer">
      <Nav {...props} folded={false} />
    </div>
  );
}
