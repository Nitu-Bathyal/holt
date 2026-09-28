import type { Metadata } from "next";
import { CompareBody, CompareShell } from "@/components/compare/compare-card";
import { CompareLive } from "@/components/compare/compare-live";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getReport } from "@/lib/api";
import { compareHref as href, EXAMPLE_POOL, leaders, MAX, parseList, SUGGESTIONS, type Lead } from "@/lib/compare";
import type { Report } from "@/lib/types";
import { PageHead } from "@/components/page-head";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = {
  title: "Compare repositories",
  description: "Put a few repositories side by side and see which one will actually review your first pull request.",
};

const short = (list: string[]) => list.map((r) => r.split("/")[1]).join(" vs ");

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const sp = await searchParams;
  const repos = parseList(sp.repos);
  const extra = parseList(sp.add);
  const all = [...repos, ...extra.filter((e) => !repos.some((r) => r.toLowerCase() === e.toLowerCase()))].slice(0, MAX);
  // Keep the URL shareable: fold ?add= into ?repos=.
  if (sp.add !== undefined) redirect(href(all));
  const reports = await Promise.all(all.map((r) => getReport(r)));

  // Nothing picked yet: an example from reports already cached (reading the
  // cache costs nothing and starts no checks), so the page shows an answer.
  let example: { repo: string; report: Report }[] = [];
  if (!all.length) {
    const cached = await Promise.all(EXAMPLE_POOL.map((r) => getReport(r)));
    example = cached.flatMap((r) => (r.ok ? [{ repo: r.data.repo, report: r.data }] : [])).slice(0, 3);
  }
  const shown = all.length ? all.map((repo, i) => ({ repo, r: reports[i] })) : example.map((e) => ({ repo: e.repo, r: { ok: true as const, data: e.report } }));
  const lead = leaders(shown.map(({ r }) => (r.ok ? r.data.stats : null)));
  const leadsFor = (i: number) => (Object.keys(lead) as Lead[]).filter((k) => lead[k].includes(i));
  const list = shown.map((s) => s.repo);

  return (
    <PageTransition>
      <>
      <PageHead compact>
        <h1 className="text-[clamp(1.45rem,3.4vw,2.1rem)] font-semibold leading-tight tracking-tight">Which one will review your pull request?</h1>
        <p className="mt-2 hidden max-w-2xl font-sans text-[0.95rem] text-muted sm:block">Up to {MAX} repositories, the same rules and numbers for each, side by side.</p>

        <form action="/compare" method="get" className="mt-5 grid max-w-2xl grid-cols-[1fr_auto] border border-line-strong bg-panel shadow-soft focus-within:border-blue">
          <input type="hidden" name="repos" value={all.join(",")} />
          <label htmlFor="add" className="sr-only">Add repositories</label>
          <input
            id="add"
            name="add"
            placeholder={all.length >= MAX ? "remove one to add another" : all.length ? "add another: owner/name or URL" : "owner/name, owner/name… or GitHub URLs"}
            disabled={all.length >= MAX}
            autoFocus={!all.length}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="h-12 min-w-0 bg-transparent px-4 text-ink outline-none placeholder:text-faint"
          />
          <button type="submit" disabled={all.length >= MAX} className="btn-primary m-1 min-h-10">{all.length ? "add" : "compare"}</button>
        </form>
        {!all.length && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[0.78rem] text-faint">
            <span>or try</span>
            {SUGGESTIONS.map((s) => (
              <Link key={s.label} href={href(s.repos)} className="border border-line-strong px-2.5 py-1 text-muted hover:border-blue hover:text-ink">
                {s.label}
              </Link>
            ))}
          </p>
        )}
      </PageHead>

      <div className="wrap py-6 sm:py-8">
        {shown.length > 0 && (
          <p className="mb-4 text-[0.8rem] text-faint">
            {all.length
              ? <>▲ marks the best of these on each number.{all.length < MAX && " Add another above."}</>
              : <>Example: <Link href={href(list)} className="text-link">{short(list)}</Link>. ▲ marks the best of these on each number.</>}
          </p>
        )}
        {shown.length === 0 ? (
          <div className="border border-dashed border-line-strong p-8 font-sans text-muted">
            Type two or more repositories above, separated by commas or spaces, to see them side by side.
          </div>
        ) : (
          <ul className={`grid gap-4 sm:grid-cols-2 ${shown.length >= 3 ? "lg:grid-cols-3" : ""} ${shown.length === 4 ? "xl:grid-cols-4" : ""}`}>
            {shown.map(({ repo, r }, i) => {
              const name = r.ok ? r.data.repo : repo;
              return (
                <CompareShell key={repo} repo={name} removeHref={href(list.filter((x) => x !== repo))}>
                  {r.ok ? <CompareBody report={r.data} leads={leadsFor(i)} /> : r.error.code === "not_found" ? <CompareLive repo={repo} /> : (
                    <p className="p-4 font-sans text-[0.88rem] text-orange">{r.error.message}</p>
                  )}
                </CompareShell>
              );
            })}
          </ul>
        )}
      </div>
      </>
    </PageTransition>
  );
}
