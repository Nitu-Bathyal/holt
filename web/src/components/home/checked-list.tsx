// Repos you checked, newest first: the home shows a few; /me/repos has them all.
import Link from "next/link";
import { RepoAvatar } from "@/components/repo-card/repo-avatar";
import { VerdictPill } from "@/components/report/verdict-pill";
import { timeAgo } from "@/lib/format";
import type { HistoryItem } from "@/lib/types";

export function CheckedList({ items }: { items: HistoryItem[] }) {
  return (
    <ul className="divide-y divide-line border border-line-strong bg-panel shadow-soft">
      {items.map((h) => (
        <li key={h.job_id}>
          <Link
            href={`/${h.repo}${h.mode === "ai" ? "?mode=ai" : ""}`}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 px-4 py-3 transition-colors hover:bg-panel-2"
          >
            <RepoAvatar repo={h.repo} size={28} />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{h.repo}</span>
              <span className="text-[0.8rem] text-faint">
                {h.mode === "ai" ? "AI report" : "free report"} · <time dateTime={h.created_at}>{timeAgo(h.created_at)}</time>
              </span>
            </span>
            {h.headline && h.tone ? (
              <VerdictPill headline={h.headline} tone={h.tone} className="px-1.5 py-0.5 text-[0.76rem]" />
            ) : (
              <span className={`text-[0.8rem] ${h.status === "error" ? "text-orange" : "text-faint"}`}>
                {h.status === "error" ? "didn't finish" : "still running"}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
