// "Compare with another repo": the report's way into /compare. Someone reading
// one report is usually deciding between a few projects, so this puts the next
// step on the page: type a repo (a name or a GitHub link) and the compare page
// opens with both side by side, or take one of the one-tap matchups under it.
// A plain GET form, so it needs no script: /compare reads `repos` and folds
// `add` into it (app/compare/page.tsx).
import Link from "next/link";
import { compareHref, EXAMPLE_POOL, SUGGESTIONS } from "@/lib/compare";

const MATCHUPS = 3;

/** One-tap comparisons: the well-known matchups this repo is part of, else a few popular repos to set it against. */
function matchups(repo: string): { label: string; href: string }[] {
  const same = (a: string) => a.toLowerCase() === repo.toLowerCase();
  const known = SUGGESTIONS.filter((s) => s.repos.some(same)).map((s) => ({ label: s.label, href: compareHref(s.repos) }));
  if (known.length) return known.slice(0, MATCHUPS);
  return EXAMPLE_POOL.filter((r) => !same(r))
    .slice(0, MATCHUPS)
    .map((r) => ({ label: `vs ${r.split("/")[1]}`, href: compareHref([repo, r]) }));
}

export function CompareCard({ repo }: { repo: string }) {
  const options = matchups(repo);
  return (
    <section className="border border-line-strong bg-panel p-4" data-compare-card>
      <h2 className="text-[0.95rem] font-semibold tracking-tight">Compare with another repo</h2>
      <p className="mt-1 font-sans text-[0.85rem] leading-snug text-muted">
        Choosing between projects? See which one replies faster and merges more pull requests from newcomers.
      </p>
      <form action="/compare" method="get" className="mt-3 flex gap-2">
        <input type="hidden" name="repos" value={repo} />
        <label htmlFor="compare-with" className="sr-only">
          Another repository: its name, owner/name, or a GitHub link
        </label>
        <input
          id="compare-with"
          name="add"
          type="text"
          required
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name or owner/name"
          className="min-h-11 min-w-0 flex-1 border border-line-strong bg-bg px-3 font-mono text-[0.85rem] text-ink placeholder:text-faint focus:border-blue focus:outline-none"
        />
        <button type="submit" className="min-h-11 shrink-0 border border-ink bg-ink px-3.5 text-[0.85rem] text-bg transition-opacity hover:opacity-85">
          Compare
        </button>
      </form>
      {options.length > 0 && (
        <div className="mt-3">
          <p className="text-[0.8rem] text-faint">Or try</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {options.map((o) => (
              <li key={o.href}>
                <Link href={o.href} className="inline-flex min-h-8 items-center border border-line-strong px-2.5 text-[0.82rem] text-ink transition-colors hover:border-blue hover:text-blue">
                  {o.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
