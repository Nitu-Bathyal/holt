// Your repos (docs/design/DASHBOARD.md): the repos you saved and the ones you
// checked, as one list with today's verdict on each. /me/saved and
// /me/history land here (lib/shell.ts, RETIRED).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CatFace } from "@/components/cat-face";
import { ErrorPanel } from "@/components/error-panel";
import { PageTransition } from "@/components/motion/page-transition";
import { AppPageHeader } from "@/components/shell/app-page";
import { RepoRows } from "@/components/your-repos/repo-rows";
import { history, savedRepos } from "@/lib/api";
import { currentUser } from "@/lib/session";
import { parseShow, reposTitle, shown, yourRepos, type Show } from "@/lib/your-repos";

export const metadata: Metadata = { title: "Your repos", robots: { index: false } };

const TABS: { show: Show; label: string }[] = [
  { show: "all", label: "all" },
  { show: "saved", label: "saved" },
  { show: "checked", label: "checked" },
];

const EMPTY: Record<Show, string> = {
  all: "Save a repo or check one and it shows up here.",
  saved: "Nothing saved yet.",
  checked: "Nothing checked yet.",
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
        <AppPageHeader title={reposTitle(all)} mood={all.length ? "ready" : "thinking"} />
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
            {rows.length ? (
              <RepoRows rows={rows} saved={s.ok ? s.data.saved.map((i) => i.repo) : []} />
            ) : (
              <div className="flex flex-col items-start gap-4 py-8">
                <CatFace mood="thinking" className="text-[1.5rem] text-amber" />
                <p className="font-sans text-muted">{EMPTY[show]}</p>
                <Link href="/find" className="bracket-link">[ find a project → ]</Link>
              </div>
            )}
          </>
        )}
      </div>
    </PageTransition>
  );
}
