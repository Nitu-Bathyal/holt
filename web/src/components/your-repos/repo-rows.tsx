"use client";
// Your repos as rows: tick two to four to compare them; save or unsave in place.
// `compact` (the home) leaves out the ticks.
import Link from "next/link";
import { useState } from "react";
import { RepoAvatar } from "@/components/repo-card/repo-avatar";
import { VerdictPill } from "@/components/report/verdict-pill";
import { SaveButton } from "@/components/save-button";
import { humanHours, timeAgo } from "@/lib/format";
import { compareHref, type YourRepo } from "@/lib/your-repos";

function Meta({ r }: { r: YourRepo }) {
  const parts: React.ReactNode[] = [];
  if (r.savedAt) parts.push(<>saved <time dateTime={r.savedAt}>{timeAgo(r.savedAt)}</time></>);
  if (r.checkedAt) parts.push(<>{r.ai ? "AI report" : "checked"} <time dateTime={r.checkedAt}>{timeAgo(r.checkedAt)}</time></>);
  if (r.stats?.outsider_attempts) parts.push(`${r.stats.outsider_merged} of ${r.stats.outsider_attempts} merged`);
  if (r.stats?.median_first_response_hours != null) parts.push(`replies in ${humanHours(r.stats.median_first_response_hours)}`);
  return (
    <p className="text-[0.78rem] text-faint">
      {parts.map((p, i) => <span key={i}>{i > 0 && " · "}{p}</span>)}
    </p>
  );
}

export function RepoRows({ rows, saved, compact = false }: { rows: YourRepo[]; saved: string[]; compact?: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const href = compareHref(picked);
  const savedSet = new Set(saved.map((s) => s.toLowerCase()));
  return (
    <>
      <ul>
        {rows.map((r) => {
          const on = picked.includes(r.repo);
          const [owner, name] = r.repo.split("/");
          return (
            <li key={r.repo} data-stack className={`app-row ${compact ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto]"}`}>
              {!compact && (
                <label className="relative z-10 -m-3.5 grid size-11 cursor-pointer place-items-center">
                  <input
                    type="checkbox"
                    aria-label={`Compare ${r.repo}`}
                    checked={on}
                    onChange={() => setPicked(on ? picked.filter((x) => x !== r.repo) : [...picked, r.repo].slice(-4))}
                    className="size-4 accent-blue"
                  />
                </label>
              )}
              <div className="flex min-w-0 items-center gap-3">
                <RepoAvatar repo={r.repo} size={32} />
                <div className="min-w-0">
                  <Link href={`/${r.repo}${r.ai ? "?mode=ai" : ""}`} className="block truncate font-semibold tracking-tight after:absolute after:inset-0 hover:text-blue">
                    <span className="font-normal text-muted">{owner}/</span>{name}
                  </Link>
                  <Meta r={r} />
                </div>
              </div>
              <div className="relative z-10 flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">
                {r.headline && r.tone ? (
                  <VerdictPill headline={r.headline} tone={r.tone} className="px-1.5 py-0.5 text-[0.74rem]" />
                ) : (
                  <Link href={`/${r.repo}`} className="inline-flex min-h-11 items-center text-[0.82rem] text-green hover:underline sm:min-h-0">check it →</Link>
                )}
                <SaveButton repo={r.repo} saved={savedSet.has(r.repo.toLowerCase())} compact />
              </div>
            </li>
          );
        })}
      </ul>
      {href && (
        <div className="app-appear sticky bottom-4 mt-6 flex justify-end">
          <Link href={href} className="btn-primary shadow-soft">compare {picked.length} →</Link>
        </div>
      )}
    </>
  );
}
