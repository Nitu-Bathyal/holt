import Link from "next/link";
import { signOut } from "@/auth";
import { currentUser } from "@/lib/session";
import { GITHUB_REPO_URL } from "@/lib/site";
import { CatFace } from "./cat-face";
import { MenuAutoClose } from "./motion/menu-autoclose";
import { ThemeToggle } from "./theme-toggle";

// Every route is dynamic (the header reads the session), so a default prefetch
// stops at loading.tsx: a click showed the skeleton, which React then holds
// for at least 300ms even when the page arrives in 15ms. These pages are cheap
// to render with no query, so the nav prefetches them in full.
const NAV = [
  { href: "/find", label: "find a project" },
  { href: "/compare", label: "compare" },
  { href: "/how-it-works", label: "how it works" },
  { href: "/pricing", label: "pricing" },
];

function GitHubMark({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

async function doSignOut() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export async function Header() {
  const user = await currentUser();
  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <header className="site-header sticky top-0 z-40 border-b border-line bg-header" style={{ viewTransitionName: "site-header" }}>
      <MenuAutoClose />
      <div className="wrap flex min-h-[60px] items-center gap-4">
        <Link href="/" className="mr-auto inline-flex min-h-11 items-center gap-3">
          <CatFace className="text-[1.05rem]" />
          <span className="text-[0.95rem] font-semibold tracking-tight">holt<span className="sr-only"> home</span></span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-6 text-[0.85rem] text-muted lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} prefetch className="py-2 transition-colors hover:text-ink">
              {n.label}
            </Link>
          ))}
          {/* Ink with the GitHub mark, like the other links: dark green on paper read as dim. */}
          <a href={GITHUB_REPO_URL} className="inline-flex items-center gap-1.5 py-2 text-ink transition-colors hover:text-blue">
            <GitHubMark className="size-4" />
            github
          </a>
        </nav>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          {user ? (
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
              <div id="account-menu" popover="auto" className="menu w-56 text-[0.88rem]">
                <p className="truncate px-3 py-2 text-faint">{user.name || user.email}</p>
                <Link href="/me/history" className="block px-3 py-2.5 transition-colors hover:bg-panel-2">your history</Link>
                <Link href="/settings" className="block px-3 py-2.5 transition-colors hover:bg-panel-2">settings &amp; API key</Link>
                <Link href="/privacy" className="block px-3 py-2.5 transition-colors hover:bg-panel-2">privacy</Link>
                <form action={doSignOut}>
                  <button type="submit" className="block w-full px-3 py-2.5 text-left text-muted transition-colors hover:bg-panel-2">sign out</button>
                </form>
              </div>
            </>
          ) : (
            <Link href="/signin" className="hidden min-h-11 items-center px-3 text-[0.87rem] text-ink transition-colors hover:text-blue sm:inline-flex">
              sign in
            </Link>
          )}
          <button type="button" popoverTarget="mobile-nav" className="grid size-11 place-items-center text-muted lg:hidden" aria-label="Menu">
            <svg className="icon-open size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <svg className="icon-close size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <nav id="mobile-nav" popover="auto" aria-label="Mobile" className="sheet text-[0.95rem] lg:hidden">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} prefetch className="block px-4 py-3 transition-colors hover:bg-panel-2">{n.label}</Link>
            ))}
            {!user && <Link href="/signin" className="block px-4 py-3 transition-colors hover:bg-panel-2">sign in</Link>}
            <a href={GITHUB_REPO_URL} className="flex items-center gap-2 px-4 py-3 text-ink transition-colors hover:bg-panel-2"><GitHubMark className="size-4" />github</a>
          </nav>
        </div>
      </div>
    </header>
  );
}
