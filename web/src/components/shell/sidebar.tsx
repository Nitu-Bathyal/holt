"use client";
// The app shell's sidebar: the five places a signed-in person goes
// (the dashboard plan). A full-height rail on desktop with Holt's cat at
// the top and you at the foot, and the same list in a drawer on phones and
// tablets. The rail folds to icons (rail-toggle.tsx); folded, each label
// becomes its item's tooltip (so it stays the link's name) and badges become
// dots.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HOME } from "@/lib/home";
import { activeItem, type NavGroup, type NavItem } from "@/lib/shell";
import { GITHUB_REPO_URL } from "@/lib/site";
import { CatFace } from "../cat-face";
import { Icon } from "./icons";

export interface SidebarProps {
  groups: NavGroup[];
  /** By item id: a count or mark the server fills in (app-shell.tsx). */
  badges?: Record<string, React.ReactNode>;
  /** Who's signed in, for the foot. */
  user: { name: string; image: string | null };
}

function Item({ item, on, path, badge }: { item: NavItem; on: boolean; path: string; badge?: React.ReactNode }) {
  const open = on && item.children;
  return (
    <li>
      <Link href={item.href} aria-current={on ? "page" : undefined} className="side-item">
        <span className="side-icon">
          <Icon name={item.icon} className="size-[18px]" />
        </span>
        <span className="side-label">{item.label}</span>
        {badge}
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

function Nav({ groups, badges = {} }: Pick<SidebarProps, "groups" | "badges">) {
  const path = usePathname();
  const active = activeItem(groups, path);
  return (
    <nav aria-label="Holt" className="flex flex-col gap-5">
      {groups.map((g, i) => (
        <div key={g.label ?? i}>
          {g.label && <p className="side-group-label">{g.label}</p>}
          <ul className="flex flex-col gap-1">
            {g.items.map((item) => <Item key={item.id} item={item} on={item.id === active} path={path} badge={badges[item.id]} />)}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Foot({ user }: Pick<SidebarProps, "user">) {
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="side-foot">
      <Link href="/settings/profile" className="side-item side-you">
        <span className="side-icon">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" width={24} height={24} className="size-6 rounded-full border border-line-strong" />
          ) : (
            <span className="grid size-6 place-items-center rounded-full bg-blue text-[0.72rem] font-bold text-on-accent">{initial}</span>
          )}
        </span>
        <span className="side-label">{user.name}</span>
      </Link>
      <p className="side-legal">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <a href={GITHUB_REPO_URL}>GitHub ↗</a>
      </p>
    </div>
  );
}

/** Holt's cat and name. Folded, the cat alone, drawn to fit the icon column. */
function Brand() {
  return (
    <div className="rail-brand">
      <Link href={HOME} className="rail-logo cat-perk">
        <CatFace className="rail-cat" perk />
        <svg className="rail-mark" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 17C5 22 4 27 4 32s1 10 5 15M55 17c4 5 5 10 5 15s-1 10-5 15" />
          <path className="rail-mark-ears" d="m14 29 5-10 6 10m14 0 6-10 5 10" />
          <path d="M27 36c0 5 5 6 5 0 0 6 5 5 5 0" />
          <circle cx="25.5" cy="31" r="2.4" fill="currentColor" stroke="none" />
          <circle cx="38.5" cy="31" r="2.4" fill="currentColor" stroke="none" />
        </svg>
        <span className="rail-word">holt<span className="sr-only"> home</span></span>
      </Link>
    </div>
  );
}

/** The desktop rail. */
export function Sidebar(props: SidebarProps) {
  return (
    <aside id="app-rail" data-lenis-prevent className="app-rail">
      <div className="rail-panel">
        <Brand />
        <div className="rail-body">
          <Nav groups={props.groups} badges={props.badges} />
          <Foot user={props.user} />
        </div>
      </div>
    </aside>
  );
}

/** Phones and tablets: the same list in a drawer, opened from the top bar. */
export function Drawer(props: SidebarProps) {
  return (
    <div id="app-drawer" popover="auto" data-lenis-prevent className="drawer">
      <Nav groups={props.groups} badges={props.badges} />
      <Foot user={props.user} />
    </div>
  );
}
