// The two top bars (docs/design/SIGNED-IN-HOME.md). The marketing header
// jumps between the landing page's sections; the app top bar is the logo, a
// repo box, the theme and your account, with the sidebar doing the rest.
import Link from "next/link";
import { signOut } from "@/auth";
import { HOME } from "@/lib/home";
import { EXAMPLE_HREF } from "@/lib/shell";
import type { SessionUser } from "@/lib/session";
import { CatFace } from "./cat-face";
import { JumpNav } from "./shell/jump-nav";
import { Icon } from "./shell/icons";
import { QuickCheck } from "./shell/quick-check";
import { ThemeToggle } from "./theme-toggle";

export async function doSignOut() {
  "use server";
  await signOut({ redirectTo: "/" });
}

function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="cat-perk inline-flex min-h-11 shrink-0 items-center gap-3">
      <CatFace className="text-[1.05rem]" perk />
      <span className="text-[0.95rem] font-semibold tracking-tight">holt<span className="sr-only"> home</span></span>
    </Link>
  );
}

/** Your account: who you're signed in as, AI reports left, settings, sign out. */
export function AccountMenu({ user, credits }: { user: SessionUser; credits: string | null }) {
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
          {credits && <p className="mt-0.5 text-[0.82rem] text-faint">{credits}</p>}
        </div>
        <Link href={HOME} className="block px-3 py-2.5 transition-colors hover:bg-panel-2">Home</Link>
        <Link href="/settings/ai-reports" className="block px-3 py-2.5 transition-colors hover:bg-panel-2">AI reports</Link>
        <Link href="/settings/profile" className="block px-3 py-2.5 transition-colors hover:bg-panel-2">Settings</Link>
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
 * landing page's sections to jump to, an example to try, and sign in (or,
 * signed in, the way back to your home).
 */
export function MarketingHeader({ user, credits }: { user: SessionUser | null; credits: string | null }) {
  return (
    <header className="site-header sticky top-0 z-40 border-b border-line bg-header" style={{ viewTransitionName: "site-header" }}>
      <div className="wrap flex min-h-[60px] items-center gap-4">
        <span className="mr-auto"><Logo href={user ? HOME : "/"} /></span>
        <JumpNav signedIn={!!user} className="hidden items-center gap-6 text-[0.84rem] text-muted lg:flex" />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {user ? (
            <>
              <Link href={HOME} className="hidden min-h-11 items-center px-3 text-[0.86rem] text-blue hover:underline sm:inline-flex">your home →</Link>
              <AccountMenu user={user} credits={credits} />
            </>
          ) : (
            <>
              <Link href={EXAMPLE_HREF} className="hidden min-h-11 items-center px-3 text-[0.86rem] text-ink transition-colors hover:text-blue sm:inline-flex">try an example</Link>
              <Link href="/signin" className="btn-primary ml-1 min-h-10 px-4 text-[0.84rem]">sign in</Link>
            </>
          )}
          <MenuButton target="mobile-nav" label="Menu" />
          <nav id="mobile-nav" popover="auto" data-lenis-prevent aria-label="Mobile" className="sheet text-[0.95rem] lg:hidden">
            <JumpNav signedIn={!!user} item="block px-4 py-3 transition-colors hover:bg-panel-2" />
            {user ? (
              <Link href={HOME} className="block px-4 py-3 text-blue transition-colors hover:bg-panel-2">your home →</Link>
            ) : (
              <Link href={EXAMPLE_HREF} className="block px-4 py-3 transition-colors hover:bg-panel-2">try an example</Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

/** App pages, signed in: the sidebar holds the places, so this bar stays small. */
export function AppTopBar({ user, credits, drawer }: { user: SessionUser; credits: string | null; drawer: React.ReactNode }) {
  return (
    <header className="site-header sticky top-0 z-40 border-b border-line bg-header" style={{ viewTransitionName: "site-header" }}>
      <div className="flex min-h-[60px] items-center gap-3 px-4 lg:px-5">
        <MenuButton target="app-drawer" label="Menu" />
        <Logo href={HOME} />
        <div className="flex flex-1 justify-center px-2">
          <QuickCheck />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu user={user} credits={credits} />
        </div>
      </div>
      {drawer}
    </header>
  );
}
