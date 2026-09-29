// The two shells (docs/design/SIGNED-IN-HOME.md): the marketing shell (a top
// nav that jumps between the landing page's sections) and the app shell (a
// sidebar with everything a signed-in person can do). Pure, so it runs under
// `node --test`.

export type ShellKind = "marketing" | "app";

/** Pages that explain or sell Holt. Everything else is the app, once you're signed in. */
const MARKETING = ["/", "/how-it-works", "/pricing", "/privacy", "/terms", "/refunds", "/contact", "/badge", "/signin"];

/** Signed out, every page wears the marketing shell. Signed in, only the pages that explain or sell Holt do. */
export function shellFor(pathname: string, signedIn: boolean): ShellKind {
  if (!signedIn) return "marketing";
  const p = pathname.replace(/\/+$/, "") || "/";
  return MARKETING.some((m) => p === m || (m !== "/" && p.startsWith(`${m}/`))) ? "marketing" : "app";
}

/** The header logo: signed in it goes to your home on every page, the landing included; signed out, to the landing page. */
export function logoHref(signedIn: boolean): string {
  return signedIn ? "/me" : "/";
}

/** The landing page's sections, in page order: the marketing nav jumps to these. */
export const LANDING_SECTIONS = [
  { id: "answer", label: "the answer" },
  { id: "what-it-checks", label: "what it checks" },
  { id: "verdicts", label: "the verdicts" },
  { id: "open-source", label: "open source" },
] as const;

export type LandingSection = (typeof LANDING_SECTIONS)[number]["id"];

/**
 * A jump link to a landing section. On the landing page it's a plain hash, so
 * Lenis glides there; anywhere else it goes to the landing page first.
 */
export function jumpHref(pathname: string, id: LandingSection): string {
  return pathname === "/" ? `#${id}` : `/#${id}`;
}

/**
 * What the header logo does: `logoHref`, except that signed out, on the
 * landing page, it glides back to the hero (a link to the page you're on
 * does nothing).
 */
export function logoAction(pathname: string, signedIn: boolean): { hero: true } | { href: string } {
  if (!signedIn && (pathname.replace(/\/+$/, "") || "/") === "/") return { hero: true };
  return { href: logoHref(signedIn) };
}

export type IconName =
  | "home" | "check" | "find" | "browse" | "compare" | "leaf" | "pr" | "pr-check"
  | "saved" | "history" | "settings" | "help" | "signout";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  /** Sub-pages shown under the item while you're in its section. */
  children?: { id: string; label: string; href: string }[];
  /** Other paths that light this item up. */
  also?: string[];
}

export interface NavGroup {
  /** Null for the first group, which needs no heading. */
  label: string | null;
  items: NavItem[];
}

/** "Check a repo" goes here, and the page focuses the box (see focusCheck). */
export const CHECK_HREF = "/me#check";

/**
 * The five places a signed-in person goes (docs/design/DASHBOARD.md). The
 * check box lives in the top bar, account things in the avatar menu.
 * Hacktoberfest shows in October until it becomes a tab of Find a project.
 */
export function sidebarGroups(opts: { hacktoberfest: boolean }): NavGroup[] {
  const items: NavItem[] = [
    { id: "home", label: "Home", href: "/me", icon: "home" },
    { id: "find", label: "Find a project", href: "/find", icon: "find", also: ["/discover"] },
    { id: "prs", label: "Your pull requests", href: "/me/contributions", icon: "pr" },
    { id: "repos", label: "Your repos", href: "/me/saved", icon: "saved", also: ["/me/history"] },
    { id: "compare", label: "Compare", href: "/compare", icon: "compare" },
  ];
  if (opts.hacktoberfest) items.splice(2, 0, { id: "hacktoberfest", label: "Hacktoberfest", href: "/hacktoberfest", icon: "leaf" });
  return [{ label: null, items }];
}

const clean = (p: string) => p.split(/[?#]/)[0].replace(/\/+$/, "") || "/";

/** The one sidebar item for this page, if any: the longest matching href wins, so /me/saved isn't also Home. */
export function activeItem(groups: NavGroup[], pathname: string): string | null {
  const p = clean(pathname);
  let best: { id: string; len: number } | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    if (item.href.includes("#")) continue; // an action, never a place
    const bases = [clean(item.href), ...(item.children ?? []).map((c) => c.href), ...(item.also ?? [])];
    // Settings lights up for all of /settings, not only its first section.
    if (item.children) bases.push(item.children[0].href.replace(/\/[^/]+$/, ""));
    for (const b of bases) {
      const hit = p === b || (b !== "/" && p.startsWith(`${b}/`));
      if (hit && (!best || b.length > best.len)) best = { id: item.id, len: b.length };
    }
  }
  return best?.id ?? null;
}

/** Old addresses and where they went. */
export const RETIRED: Record<string, string> = {
  "/for-you": "/me#picks",
};

/** Where an old address now lives, or null. A trailing slash doesn't matter. */
export function retiredRedirect(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "");
  return Object.hasOwn(RETIRED, p) ? RETIRED[p] : null;
}
