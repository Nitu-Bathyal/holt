import Link from "next/link";
import { EXAMPLE_PATH } from "@/lib/example-report";

export function UpgradeCard({ repo, signedIn }: { repo: string; signedIn: boolean }) {
  const aiHref = `/${repo}?mode=ai`;
  const href = signedIn ? aiHref : `/signin?callbackUrl=${encodeURIComponent(aiHref)}`;
  return (
    <div className="relative overflow-hidden border border-blue/50 bg-blue/[0.06] p-5 sm:p-6">
      <p className="text-[0.8rem] uppercase tracking-[0.08em] text-blue">Merge plan ✦</p>
      <h3 className="mt-1 text-[1.15rem] font-semibold tracking-tight">What to do here to get merged</h3>
      <p className="mt-2 font-sans text-[0.92rem] text-muted">
        Your first pull request as steps, what gets merged, and why outside ones get closed, in the maintainers&apos; words.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href={href} prefetch={false} className="btn-primary bg-blue">
          get my merge plan <span aria-hidden="true">→</span>
        </Link>
        <Link href={EXAMPLE_PATH} className="text-link text-[0.89rem]">see an example</Link>
      </div>
    </div>
  );
}
