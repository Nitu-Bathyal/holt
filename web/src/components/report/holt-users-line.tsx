// Under a report's numbers: what Holt users' own pull requests here came to.
// Rendered only when the server sends the numbers (5+ people make them up).
import Link from "next/link";
import { holtUsersLine, windowLabel, type HoltUsers } from "@/lib/holt-users";

export function HoltUsersLine({ stats }: { stats: HoltUsers | null }) {
  if (!stats) return null;
  return (
    <div className="mt-4 border-l-2 border-line-strong pl-4">
      <p className="font-sans text-[0.95rem] text-ink">
        <span className="text-muted">Holt users who sent pull requests here: </span>
        {holtUsersLine(stats)}
      </p>
      <details className="group mt-1 text-[0.8rem] text-faint">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center hover:text-ink sm:min-h-0 [&::-webkit-details-marker]:hidden">
          what&apos;s this?
        </summary>
        <p className="mt-1 max-w-xl font-sans leading-relaxed text-muted">
          People who connected their GitHub account to Holt, counted without names, over {windowLabel(stats.window_days)}. We only show this when at least 5
          people make up the numbers, and never count anyone who chose to leave statistics out.{" "}
          <Link href="/privacy#connect-github" className="text-link">
            How we handle this
          </Link>
        </p>
      </details>
    </div>
  );
}
