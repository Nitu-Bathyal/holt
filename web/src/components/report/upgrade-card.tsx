import Link from "next/link";
import { EXAMPLE_PATH } from "@/lib/example-report";

/** What the merge plan holds, in the words the AI tab uses for its sections. */
const INSIDE = ["Your first pull request, step by step", "What gets merged here", "Why outside ones get closed"];

/**
 * The free report's way into the merge plan (the AI tab). A green card with a
 * soft glow in its corner and an accent bar down its edge: green is the site's
 * "this is for you" colour, where blue already means the AI tab itself.
 */
export function UpgradeCard({ repo, signedIn }: { repo: string; signedIn: boolean }) {
  const aiHref = `/${repo}?mode=ai`;
  const href = signedIn ? aiHref : `/signin?callbackUrl=${encodeURIComponent(aiHref)}`;
  return (
    <div className="relative overflow-hidden border border-green/40 bg-panel p-4 pl-5 shadow-soft" data-merge-plan-card>
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-green" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full"
        style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--green) 26%, transparent), transparent)" }}
      />
      <div className="relative">
        <p className="inline-flex items-center gap-1.5 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-green">
          <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-green/15">✦</span>
          Merge plan
        </p>
        <h3 className="mt-2 text-[1.05rem] font-semibold leading-snug tracking-tight">What to do here to get merged</h3>
        <ul className="mt-2.5 space-y-1 font-sans text-[0.88rem] text-muted">
          {INSIDE.map((t) => (
            <li key={t} className="flex gap-2">
              <span aria-hidden="true" className="text-green">✓</span>
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-2 font-sans text-[0.8rem] text-faint">In the maintainers&apos; own words.</p>
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={href} prefetch={false} className="btn-primary">
            get my merge plan <span aria-hidden="true">→</span>
          </Link>
          <Link href={EXAMPLE_PATH} className="text-link text-[0.85rem]">see an example</Link>
        </div>
      </div>
    </div>
  );
}
