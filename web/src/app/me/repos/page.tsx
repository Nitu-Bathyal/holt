// Your repos (the dashboard plan): the repos you saved and the ones you
// checked, as one list with today's verdict on each. /me/saved and
// /me/history land here (lib/shell.ts, RETIRED).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorPanel } from "@/components/error-panel";
import { PageTransition } from "@/components/motion/page-transition";
import { AppPageHeader, EmptyState } from "@/components/shell/app-page";
import { RepoRows } from "@/components/your-repos/repo-rows";
import { history, savedRepos } from "@/lib/api";
import { currentUser } from "@/lib/session";
import { CHECK_HREF } from "@/lib/shell";
import { parseShow, reposTitle, shown, yourRepos, type Show } from "@/lib/your-repos";

export const metadata: Metadata = { title: "Your repos", robots: { index: false } };

const TABS: { show: Show; label: string }[] = [
  { show: "all", label: "all" },
  { show: "saved", label: "saved" },
  { show: "checked", label: "checked" },
];

const FIND = <Link href="/find" className="btn-primary">find a project →</Link>;

// One tab empty while the other has repos. With none at all, the head says so.
const EMPTY: Record<Exclude<Show, "all">, { line: string; action: React.ReactNode }> = {
  saved: { line: "Nothing saved yet.", action: FIND },
  checked: { line: "Nothing checked yet.", action: <Link href={CHECK_HREF} className="btn-primary">check a repo →</Link> },
};

export default async function YourReposPage({ searchParams }: PageProps<"/me/repos">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/me/repos");
  const show = parseShow((await searchParams).show);
  const [s, h] = await Promise.all([savedRepos(user.id), history(user.id)]);
  const all = yourRepos(s.ok ? s.data.saved : [], h.ok ? h.data.items : []);
  const rows = shown(all, show);
  const failed = !s.ok ? s.error : !h.ok ? h.error : null;

  return (
    <PageTransition>
      <div className="app-page">
        <AppPageHeader title={failed ? "Your repos" : reposTitle(all)} mood={failed ? undefined : all.length ? "ready" : "thinking"}>
          {!all.length && !failed && <div className="mt-7">{FIND}</div>}
        </AppPageHeader>
        {failed ? (
          <ErrorPanel error={failed} retryHref="/me/repos" />
        ) : (
          <>
            {all.length > 0 && (
              <nav aria-label="Show" className="app-tabs">
                {TABS.map((t) => (
                  <Link key={t.show} href={t.show === "all" ? "/me/repos" : `/me/repos?show=${t.show}`} aria-current={show === t.show ? "page" : undefined} className="app-tab">
                    {t.label}
                  </Link>
                ))}
              </nav>
            )}
            {rows.length >= 2 && <p className="mb-2 text-[0.8rem] text-faint">Tick two to four to compare them side by side.</p>}
            {rows.length ? (
              <RepoRows rows={rows} saved={s.ok ? s.data.saved.map((i) => i.repo) : []} />
            ) : (
              show !== "all" && all.length > 0 && <EmptyState title={EMPTY[show].line}>{EMPTY[show].action}</EmptyState>
            )}
          </>
        )}
      </div>
    </PageTransition>
  );
}
