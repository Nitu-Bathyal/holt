import { fromFind } from "@/lib/repo-card";
import type { FindResult } from "@/lib/types";
import { CatFace } from "../cat-face";
import { RepoGrid } from "../repo-card/repo-grid";

/** Find results as compact cards; each opens into the focus view with its starter issues. */
export function FindResults({ results, days, saved }: { results: FindResult[]; days: number; saved?: string[] | null }) {
  if (!results.length) {
    return (
      <div className="border border-dashed border-line-strong p-8 text-center">
        <CatFace mood="thinking" className="text-[1.75rem]" />
        <p className="mt-4 text-[1.125rem] font-semibold">No welcoming repos matched all of that.</p>
        <p className="mt-2 font-sans text-muted">Try another language, or turn off the Hacktoberfest filter.</p>
      </div>
    );
  }
  return <RepoGrid repos={results.map(fromFind)} days={days} saved={saved} />;
}
