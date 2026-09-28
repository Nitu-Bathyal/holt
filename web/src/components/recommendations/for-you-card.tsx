import Link from "next/link";
import type { Recommendations } from "@/lib/types";

/** A short "Picked for you" teaser (My Contributions): the top picks and a link to the page. */
export function ForYouCard({ data }: { data: Recommendations }) {
  const top = data.picks.slice(0, 2);
  if (top.length === 0) return null;
  return (
    <section aria-labelledby="for-you-card" className="mt-8 border border-green/40 bg-green/[0.05] p-5 sm:p-6">
      <p className="text-[0.8rem] uppercase tracking-[0.08em] text-green">Picked for you</p>
      <h2 id="for-you-card" className="mt-1 text-[1.1rem] font-semibold tracking-tight">Where to send your next pull request</h2>
      <ul className="mt-3 space-y-3">
        {top.map((p) => (
          <li key={p.repo} className="min-w-0">
            <Link href={`/${p.repo}`} className="font-semibold [overflow-wrap:anywhere] hover:text-blue">{p.repo}</Link>
            {p.why[0] && <p className="font-sans text-[0.89rem] text-muted">{p.why[0]}</p>}
          </li>
        ))}
      </ul>
      <Link href="/me#picks" className="mt-4 inline-block text-[0.89rem] text-green hover:underline">
        [ see why, and issues to start with → ]
      </Link>
    </section>
  );
}
