import type { Metadata } from "next";
import { Bookmark } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CompareTable, Issues, IssuesSkeleton, type Column } from "@/components/compare/compare-table";
import { PageTransition } from "@/components/motion/page-transition";
import { AppPageHeader, EmptyState } from "@/components/shell/app-page";
import { SignInToCheck } from "@/components/sign-in-to-check";
import { getReport, savedNames, searchRepos, starterIssues } from "@/lib/api";
import { bareNames, compareHref as href, compareTitle, EXAMPLE_POOL, MAX, parseList, pickRepo, savedToAdd, SUGGESTIONS } from "@/lib/compare";
import { clock } from "@/lib/home";
import { caller, currentUser, type SessionUser } from "@/lib/session";
import type { Report } from "@/lib/types";

export const metadata: Metadata = {
  title: "Compare repositories",
  description: "Put up to four repos side by side and see which one reviews and merges outside pull requests.",
};

const short = (list: string[]) => list.map((r) => r.split("/")[1]).join(" vs ");
const CHIP = "border border-line px-2 py-1 text-muted transition-colors hover:border-blue hover:text-ink";

async function IssuesSlot({ repo, user }: { repo: string; user: SessionUser | null }) {
  const r = await starterIssues(repo, 2, await caller(user));
  return <Issues issues={r.ok ? r.data.issues : null} />;
}

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const sp = await searchParams;
  const user = await currentUser();
  // A word with no owner ("excalidraw") is looked up on GitHub: the most starred repo with that name. At most three lookups a visit.
  const who = await caller(user);
  const names = [...new Set([...bareNames(sp.repos), ...bareNames(sp.add)])].slice(0, 3);
  const looked = await Promise.all(
    names.map(async (name) => {
      const r = await searchRepos(name, who);
      return { name, repo: r.ok ? pickRepo(name, r.data.results) : null, failed: !r.ok };
    }),
  );
  const named = (v: string | string[] | undefined) => bareNames(v).flatMap((n) => looked.find((l) => l.name === n)?.repo ?? []);
  const problems = looked.filter((l) => !l.repo);
  const repos = parseList([...parseList(sp.repos), ...named(sp.repos)]);
  const extra = parseList([...parseList(sp.add), ...named(sp.add)]);
  const all = [...repos, ...extra.filter((e) => !repos.some((r) => r.toLowerCase() === e.toLowerCase()))].slice(0, MAX);
  // Keep the URL shareable: fold ?add= into ?repos=. Not when something couldn't be found: the redirect would drop the note saying so.
  if (sp.add !== undefined && !problems.length) redirect(href(all));
  const reports = await Promise.all(all.map((r) => getReport(r)));
  // The way in from a shortlist: your saved repos, one tap each.
  const saved = (await savedNames(user?.id)) ?? [];
  const fromSaved = savedToAdd(saved, all);

  // Nothing picked yet: an example from reports already cached (reading the
  // cache costs nothing and starts no checks), so the page shows an answer.
  let example: { repo: string; report: Report }[] = [];
  if (!all.length) {
    const cached = await Promise.all(EXAMPLE_POOL.map((r) => getReport(r)));
    example = cached.flatMap((r) => (r.ok ? [{ repo: r.data.repo, report: r.data }] : [])).slice(0, 3);
  }
  const shown = all.length ? all.map((repo, i) => ({ repo, r: reports[i] })) : example.map((e) => ({ repo: e.repo, r: { ok: true as const, data: e.report } }));
  const list = shown.map((s) => s.repo);
  const title = compareTitle(all.length > 0, shown.map(({ r }) => (r.ok ? r.data : null)));

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

  return (
    <PageTransition>
      <div className="app-page">
        <AppPageHeader sentence title={title} mood={shown.length ? "ready" : "thinking"}>
          {problems.length > 0 && (
            <p role="status" className="mt-3 max-w-xl font-sans text-[0.86rem] leading-snug text-orange">
              {problems.map((l) => (
                <span key={l.name} className="block">
                  {l.failed ? `Couldn't look up “${l.name}” just now.` : `No repository named “${l.name}”.`} Try owner/name, like psf/requests.
                </span>
              ))}
            </p>
          )}
          {fromSaved.length > 0 && (
            <section aria-labelledby="from-saved" className="mt-6 max-w-2xl">
              <h2 id="from-saved" className="flex items-center gap-2 text-[0.78rem] uppercase tracking-[0.08em] text-faint">
                <Bookmark aria-hidden="true" strokeWidth={1.8} className="size-3.5 fill-current text-hf" />
                {all.length ? "Add one you saved" : "Start from your saved repos"}
              </h2>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {!all.length && saved.length >= 2 && (
                  <Link href={href(saved.slice(0, MAX))} className="inline-flex min-h-9 items-center gap-1.5 bg-blue px-3 text-[0.84rem] font-medium text-bg transition-opacity hover:opacity-90">
                    Compare {saved.length > MAX ? `newest ${MAX}` : `all ${saved.length}`}
                    <span aria-hidden="true">→</span>
                  </Link>
                )}
                {fromSaved.map((s) => {
                  const [owner, name] = s.split("/");
                  return (
                    <Link key={s} href={href([...all, s])} className="group inline-flex min-h-9 items-center gap-2 border border-line-strong bg-panel px-3 text-[0.84rem] transition-colors hover:border-blue">
                      <span>
                        <span className="text-faint">{owner}/</span>
                        <span className="text-ink">{name}</span>
                      </span>
                      <span aria-hidden="true" className="text-faint transition-colors group-hover:text-blue">+</span>
                      <span className="sr-only"> (add to the comparison)</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
          {!all.length && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-[0.82rem] text-faint">
              <span>or try</span>
              {SUGGESTIONS.map((s) => (
                <Link key={s.label} href={href(s.repos)} className={CHIP}>
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
            {shown.length > 2 && (
              <p aria-hidden="true" className="mb-2 text-[0.8rem] text-faint sm:hidden">
                Swipe sideways to see all {shown.length} repos →
              </p>
            )}
            <CompareTable columns={columns} issues={issues} now={clock()} label={all.length ? `Comparing ${short(list)}` : `Example: ${short(list)}`} />
            {/* The table's key: each mark in its own column, its meaning beside it. */}
            <dl className="mt-5 grid max-w-2xl grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-2 border-t border-line pt-4 font-sans text-[0.8rem] leading-snug text-faint">
              {shown.length > 1 && (
                <>
                  <dt className="text-center font-mono text-green"><span className="sr-only">Triangle</span><span aria-hidden="true">▲</span></dt>
                  <dd>
                    Best number in the row, among the repos rated Worth your time or Long shot. One good number doesn&apos;t make up for a poor verdict.
                  </dd>
                </>
              )}
              <dt className="text-center font-mono text-muted"><span className="sr-only">Dash</span><span aria-hidden="true">–</span></dt>
              <dd>No number: the repo hasn&apos;t been checked yet, no one outside its team has opened a pull request to count, or GitHub didn&apos;t say.</dd>
            </dl>
          </>
        )}
      </div>
    </PageTransition>
  );
}
