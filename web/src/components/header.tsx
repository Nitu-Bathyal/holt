// The two top bars (the signed-in home plan). The marketing header
// exposes the main product tasks; the app top bar is the logo, a
// repo box, the theme and your account, with the sidebar doing the rest.
import Link from "next/link";
import { signOut } from "@/auth";
import { HOME } from "@/lib/home";
import { EXAMPLES_PATH } from "@/lib/examples";
import type { SessionUser } from "@/lib/session";
import { CatFace } from "./cat-face";
import { PublicNav } from "./shell/public-nav";
import { LogoLink } from "./shell/logo-link";
import { Icon } from "./shell/icons";
import { QuickCheck } from "./shell/quick-check";
import { RailToggle } from "./shell/rail-toggle";
import { ThemeToggle } from "./theme-toggle";

export async function doSignOut() {
  "use server";
  await signOut({ redirectTo: "/" });
}

const LOGO = "cat-perk inline-flex min-h-11 shrink-0 items-center gap-3";

function LogoBody() {
  return (
    <>
      <CatFace className="text-[1.05rem]" perk />
      <span className="text-[0.95rem] font-semibold tracking-tight">holt<span className="sr-only"> home</span></span>
    </>
  );
}

function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className={LOGO}>
      <LogoBody />
    </Link>
  );
}

/** Your account: who you're signed in as, settings, sign out. */
export function AccountMenu({ user }: { user: SessionUser }) {
  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
  return (
    <>
      <button id="account-button" type="button" popoverTarget="account-menu" className="flex h-11 items-center gap-1 pl-2 pr-1" aria-label="Your account">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" width={28} height={28} className="size-7 rounded-full border border-line-strong" />
        ) : (
          <span className="grid size-7 place-items-center rounded-full bg-blue text-[0.82rem] font-bold text-on-accent">{initial}</span>
        )}
        <svg className="menu-chevron size-3.5 text-faint" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      <div id="account-menu" popover="auto" data-lenis-prevent className="menu w-60 text-[0.88rem]">
        <div className="px-3 py-2">
          <p className="truncate text-ink">{user.name || user.email}</p>
        </div>
        <Link href="/settings/profile" className="block px-3 py-2.5 transition-colors hover:bg-panel-2">Settings</Link>
        <Link href="/settings/plan" className="block px-3 py-2.5 transition-colors hover:bg-panel-2">Plan</Link>
        <Link href="/how-it-works" className="block px-3 py-2.5 transition-colors hover:bg-panel-2">How Holt works</Link>
        <form action={doSignOut}>
          <button type="submit" className="block w-full px-3 py-2.5 text-left text-muted transition-colors hover:bg-panel-2">Sign out</button>
        </form>
      </div>
    </>
  );
}

function MenuButton({ target, label }: { target: string; label: string }) {
  return (
    <button type="button" popoverTarget={target} className="grid size-11 place-items-center text-muted lg:hidden" aria-label={label}>
      <Icon name="menu" className="icon-open size-5" />
      <Icon name="close" className="icon-close size-5" />
    </button>
  );
}

/**
 * Pages that explain or sell Holt, and every page while signed out: the
 * core product tasks, an example to try, and sign in (or,
 * signed in, your account menu and a button into the app).
 */
export function MarketingHeader({ user }: { user: SessionUser | null }) {
  return (
    <header className="site-header sticky top-0 z-40 border-b border-line bg-header" style={{ viewTransitionName: "site-header" }}>
      <div className="wrap flex min-h-[60px] items-center gap-2 sm:gap-4">
        <span className="mr-auto">
          {/* Signed out, on the landing page it glides back to the hero (lib/shell.ts, logoAction). */}
          <LogoLink signedIn={!!user} className={LOGO}>
            <LogoBody />
          </LogoLink>
        </span>
        <PublicNav signedIn={!!user} className="hidden items-center gap-5 text-[0.84rem] text-muted lg:flex" />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {user ? (
            <>
              <Link href={HOME} className="btn-primary ml-1 min-h-11 whitespace-nowrap px-4 text-[0.84rem] sm:min-h-10">open Holt →</Link>
              <AccountMenu user={user} />
            </>
          ) : (
            <>
              <Link href={EXAMPLES_PATH} className="hidden min-h-11 items-center px-3 text-[0.86rem] text-ink transition-colors hover:text-blue sm:inline-flex">try an example</Link>
              <Link href="/signin" className="btn-primary ml-1 min-h-11 whitespace-nowrap px-4 text-[0.84rem] sm:min-h-10">sign in</Link>
            </>
          )}
          <MenuButton target="mobile-nav" label="Menu" />
          <nav id="mobile-nav" popover="auto" data-lenis-prevent aria-label="Mobile" className="sheet text-[0.95rem] lg:hidden">
            <PublicNav signedIn={!!user} item="block min-h-11 px-4 py-3 transition-colors hover:bg-panel-2 aria-[current]:font-semibold aria-[current]:text-blue" />
            {user ? (
              <Link href={HOME} className="block px-4 py-3 text-blue transition-colors hover:bg-panel-2">open Holt →</Link>
            ) : (
              <Link href={EXAMPLES_PATH} className="block px-4 py-3 transition-colors hover:bg-panel-2">try an example</Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

/** App pages, signed in: the sidebar holds the places and, on desktop, the logo, so this bar stays small. */
export function AppTopBar({ user, railCollapsed, drawer, bell }: { user: SessionUser; railCollapsed: boolean; drawer: React.ReactNode; /** PR watch's bell (components/alerts). */ bell?: React.ReactNode }) {
  return (
    <header className="site-header sticky top-0 z-40 border-b border-line bg-header" style={{ viewTransitionName: "site-header" }}>
      {/* On desktop the rail carries the logo, the bar starts with the rail's toggle, and the check box lines up with the page (.app-bar). */}
      <div className="app-bar">
        <MenuButton target="app-drawer" label="Menu" />
        <RailToggle initial={railCollapsed} />
        <span className="lg:hidden">
          <Logo href={HOME} />
        </span>
        <div className="app-bar-frame">
          <QuickCheck />
        </div>
        <div className="app-bar-end flex items-center gap-1">
          {bell}
          <ThemeToggle />
          <AccountMenu user={user} />
        </div>
      </div>
      {drawer}
    </header>
  );
}
