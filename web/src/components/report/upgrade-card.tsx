import Link from "next/link";
import { EXAMPLE_PATH } from "@/lib/example-report";

/** What the merge plan holds, in the words the AI tab uses for its sections. */
const INSIDE = ["Your first pull request, step by step", "What gets merged here", "Why outside ones get closed"];

/**
 * The free report's way into the merge plan (the AI tab). Dressed like the
 * sidebar's other cards: a quiet heading, plain text, one button.
 */
export function UpgradeCard({ repo, signedIn }: { repo: string; signedIn: boolean }) {
  const aiHref = `/${repo}?mode=ai`;
  const href = signedIn ? aiHref : `/signin?callbackUrl=${encodeURIComponent(aiHref)}`;
  return (
    <section className="rounded-lg border border-line-strong bg-panel p-4 sm:p-5" data-merge-plan-card>
      <h2 className="text-[0.85rem] font-semibold text-muted">Merge plan</h2>
      <p className="mt-3 text-[1rem] font-semibold leading-snug tracking-tight">What to do here to get merged</p>
      <ul className="mt-2.5 divide-y divide-line font-sans text-[0.88rem] text-muted">
        {INSIDE.map((t) => (
          <li key={t} className="py-1.5 first:pt-0">{t}</li>
        ))}
      </ul>
      <p className="mt-2 font-sans text-[0.8rem] text-faint">In the maintainers&apos; own words.</p>
      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={href} prefetch={false} className="btn-primary">
          get my merge plan
        </Link>
        <Link href={EXAMPLE_PATH} className="text-link text-[0.85rem]">see an example</Link>
      </div>
    </section>
  );
}
