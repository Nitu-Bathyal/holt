import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CompareTable, Issues, IssuesSkeleton, type Column } from "@/components/compare/compare-table";
import { PageTransition } from "@/components/motion/page-transition";
import { AppPageHeader, EmptyState } from "@/components/shell/app-page";
import { SignInToCheck } from "@/components/sign-in-to-check";
import { getReport, starterIssues } from "@/lib/api";
import { compareHref as href, compareTitle, EXAMPLE_POOL, leaders, MAX, parseList, SUGGESTIONS } from "@/lib/compare";
import { caller, currentUser, type SessionUser } from "@/lib/session";
import type { Report } from "@/lib/types";

export const metadata: Metadata = {
  title: "Compare repositories",
  description: "Put up to four repos side by side and see which one reviews and merges outside pull requests.",
};

const short = (list: string[]) => list.map((r) => r.split("/")[1]).join(" vs ");

async function IssuesSlot({ repo, user }: { repo: string; user: SessionUser | null }) {
  const r = await starterIssues(repo, 2, await caller(user));
  return <Issues issues={r.ok ? r.data.issues : null} />;
}

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const sp = await searchParams;
  const repos = parseList(sp.repos);
  const extra = parseList(sp.add);
  const all = [...repos, ...extra.filter((e) => !repos.some((r) => r.toLowerCase() === e.toLowerCase()))].slice(0, MAX);
  // Keep the URL shareable: fold ?add= into ?repos=.
  if (sp.add !== undefined) redirect(href(all));
  const [reports, user] = await Promise.all([Promise.all(all.map((r) => getReport(r))), currentUser()]);

  // Nothing picked yet: an example from reports already cached (reading the
  // cache costs nothing and starts no checks), so the page shows an answer.
  let example: { repo: string; report: Report }[] = [];
  if (!all.length) {
    const cached = await Promise.all(EXAMPLE_POOL.map((r) => getReport(r)));
    example = cached.flatMap((r) => (r.ok ? [{ repo: r.data.repo, report: r.data }] : [])).slice(0, 3);
  }
  const shown = all.length ? all.map((repo, i) => ({ repo, r: reports[i] })) : example.map((e) => ({ repo: e.repo, r: { ok: true as const, data: e.report } }));
  const list = shown.map((s) => s.repo);
  const lead = leaders(shown.map(({ r }) => (r.ok ? r.data.stats : null)));
  const title = compareTitle(all.length > 0, shown.map(({ r, repo }) => (r.ok ? r.data.repo : repo)), lead);

  const columns: Column[] = shown.map(({ repo, r }) => {
    const removeHref = href(list.filter((x) => x !== repo));
    if (r.ok) return { repo, removeHref, kind: "report", report: r.data };
    // Cached reports compare for anyone; a new check needs an account.
    if (r.error.code === "not_found") return user ? { repo, removeHref, kind: "live" } : { repo, removeHref, kind: "note", note: <SignInToCheck back={href(list)} className="" /> };
    return { repo, removeHref, kind: "note", note: <p className="font-sans text-[0.86rem] text-orange">{r.error.message}</p> };
  });
  const issues = columns.map((c) =>
    c.kind === "report" ? (
      <Suspense key={c.repo} fallback={<IssuesSkeleton />}>
        <IssuesSlot repo={c.repo} user={user} />
      </Suspense>
    ) : null,
  );

  const full = all.length >= MAX;
  return (
    <PageTransition>
      <div className="app-page">
        <AppPageHeader title={title} mood={shown.length ? "ready" : "thinking"}>
          <form action="/compare" method="get" className="mt-6 flex max-w-xl items-center border border-line-strong bg-panel transition-colors focus-within:border-blue">
            <input type="hidden" name="repos" value={all.join(",")} />
            <label htmlFor="add" className="sr-only">{all.length ? "Add a repo" : "Repos to compare"}</label>
            <span aria-hidden="true" className="pl-3 text-amber">+</span>
            <input
              id="add"
              name="add"
              placeholder={full ? "remove one to add another" : all.length ? "add a repo: owner/name" : "owner/name, owner/name"}
              disabled={full}
              autoFocus={!all.length}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent px-2 py-3 text-[0.92rem] outline-none placeholder:text-faint disabled:cursor-not-allowed"
            />
            <button type="submit" disabled={full} className="self-stretch border-l border-line-strong px-4 text-[0.85rem] text-muted transition-colors hover:text-ink disabled:opacity-50">
              {all.length ? "add" : "compare"}
            </button>
          </form>
          {!all.length && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-[0.82rem] text-faint">
              <span>or try</span>
              {SUGGESTIONS.map((s) => (
                <Link key={s.label} href={href(s.repos)} className="border border-line px-2 py-1 text-muted transition-colors hover:border-blue hover:text-ink">
                  {s.label}
                </Link>
              ))}
            </p>
          )}
        </AppPageHeader>

        {shown.length === 0 ? (
          <EmptyState title="Nothing to compare yet.">
            <Link href="/me/repos" className="btn-primary">pick from your repos →</Link>
          </EmptyState>
        ) : (
          <>
            {!all.length && (
              <p className="mb-3 text-[0.82rem] text-faint">
                Example: <Link href={href(list)} className="text-link">{short(list)}</Link>
              </p>
            )}
            <CompareTable columns={columns} issues={issues} label={all.length ? `Comparing ${short(list)}` : `Example: ${short(list)}`} />
          </>
        )}
      </div>
    </PageTransition>
  );
}
