// The two shells (docs/design/SIGNED-IN-HOME.md): the marketing shell (a top
// nav that jumps between the landing page's sections) and the app shell (a
// sidebar with everything a signed-in person can do). Pure, so it runs under
// `node --test`.
import { SECTIONS } from "./settings.ts";

export type ShellKind = "marketing" | "app";

/** Pages that explain or sell Holt. Everything else is the app, once you're signed in. */
const MARKETING = ["/", "/how-it-works", "/pricing", "/privacy", "/terms", "/refunds", "/contact", "/badge", "/signin"];

/** Signed out, every page wears the marketing shell. Signed in, only the pages that explain or sell Holt do. */
export function shellFor(pathname: string, signedIn: boolean): ShellKind {
  if (!signedIn) return "marketing";
  const p = pathname.replace(/\/+$/, "") || "/";
  return MARKETING.some((m) => p === m || (m !== "/" && p.startsWith(`${m}/`))) ? "marketing" : "app";
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
 * Lenis glides there; anywhere else it goes to the landing page first. A
 * signed-in "/" redirects home, so they get the landing page at /?landing=1.
 */
export function jumpHref(pathname: string, signedIn: boolean, id: LandingSection): string {
  if (pathname === "/") return `#${id}`;
  return signedIn ? `/?landing=1#${id}` : `/#${id}`;
}

/** Try Holt without an account: a full example report. */
export const EXAMPLE_HREF = "/example-ai-report";

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
 * Everything a signed-in person can do, grouped: doing things with repos, the
 * things that are yours, your account. Hacktoberfest shows in October;
 * "Check your PR" only when this server runs pre-flight.
 */
export function sidebarGroups(opts: { hacktoberfest: boolean; preflight: boolean }): NavGroup[] {
  const tools: NavItem[] = [
    { id: "home", label: "Home", href: "/me", icon: "home" },
    { id: "check", label: "Check a repo", href: CHECK_HREF, icon: "check" },
    { id: "find", label: "Find a project", href: "/find", icon: "find" },
    { id: "browse", label: "Browse repos", href: "/discover", icon: "browse" },
    { id: "compare", label: "Compare repos", href: "/compare", icon: "compare" },
  ];
  if (opts.hacktoberfest) tools.push({ id: "hacktoberfest", label: "Hacktoberfest", href: "/hacktoberfest", icon: "leaf" });
  const yours: NavItem[] = [
    { id: "prs", label: "Your pull requests", href: "/me/contributions", icon: "pr" },
    { id: "saved", label: "Saved repos", href: "/me/saved", icon: "saved" },
    { id: "checked", label: "Repos you checked", href: "/me/history", icon: "history" },
  ];
  if (opts.preflight) yours.push({ id: "preflight", label: "Check your PR", href: "/preflight", icon: "pr-check" });
  return [
    { label: null, items: tools },
    { label: "Yours", items: yours },
    {
      label: "Account",
      items: [
        {
          id: "settings", label: "Settings", href: SECTIONS[0].href, icon: "settings",
          children: SECTIONS.map((s) => ({ id: s.id, label: s.label, href: s.href })),
          also: ["/connect"],
        },
        { id: "help", label: "How Holt works", href: "/how-it-works", icon: "help" },
      ],
    },
  ];
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

/** The sidebar starts folded to icons when this cookie says so (desktop only). */
export const SIDEBAR_COOKIE = "holt_sidebar";

/** Old addresses and where they went. */
export const RETIRED: Record<string, string> = {
  "/for-you": "/me#picks",
};

/** Where an old address now lives, or null. A trailing slash doesn't matter. */
export function retiredRedirect(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "");
  return Object.hasOwn(RETIRED, p) ? RETIRED[p] : null;
}
