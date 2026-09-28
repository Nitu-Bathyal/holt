// Under a report's numbers: what Holt users' own pull requests here came to.
// Rendered only when the server sends the numbers (5+ people make them up).
import Link from "next/link";
import { holtUsersLine, windowLabel, type HoltUsers } from "@/lib/holt-users";

export function HoltUsersLine({ stats }: { stats: HoltUsers | null }) {
  if (!stats) return null;
  return (
    <div className="mt-4 border-l-2 border-line-strong pl-4">
      <p className="font-sans text-[1rem] text-ink">
        <span className="text-muted">Holt users who sent PRs here: </span>
        {holtUsersLine(stats)}
      </p>
      <details className="group mt-1 text-[0.875rem] text-faint">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center hover:text-ink sm:min-h-0 [&::-webkit-details-marker]:hidden">
          what&apos;s this?
        </summary>
        <p className="mt-1 max-w-xl font-sans leading-relaxed text-muted">
          People who connected GitHub to Holt, counted without names, over {windowLabel(stats.window_days)}. Shown only when 5 or more
          people make up the numbers. Anyone who opted out of statistics is never counted.{" "}
          <Link href="/privacy#connect-github" className="text-link">
            How we handle this
          </Link>
        </p>
      </details>
    </div>
  );
}
