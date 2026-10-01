"use client";
// Your repos as rows: tick two to four to compare them; save or unsave in place.
// Each row shows the numbers behind the verdict, not the verdict: the report has that.
// `compact` (the home) leaves out the ticks.
import Link from "next/link";
import { useState } from "react";
import { RepoAvatar } from "@/components/repo-card/repo-avatar";
import { SaveButton } from "@/components/save-button";
import { timeAgo } from "@/lib/format";
import { compactCount } from "@/lib/repo-about";
import { compareHref, repoNumbers, type YourRepo } from "@/lib/your-repos";

function Meta({ r }: { r: YourRepo }) {
  const parts: React.ReactNode[] = [];
  if (r.checking) parts.push(<span className="text-blue">checking now</span>);
  if (r.savedAt) parts.push(<>saved <time dateTime={r.savedAt}>{timeAgo(r.savedAt)}</time></>);
  else if (r.checkedAt) parts.push(<>{r.ai ? "AI report" : "checked"} <time dateTime={r.checkedAt}>{timeAgo(r.checkedAt)}</time></>);
  return (
    <p className="mt-0.5 text-[0.72rem] text-faint">
      {parts.map((p, i) => <span key={i}>{i > 0 && " · "}{p}</span>)}
    </p>
  );
}

function Numbers({ r }: { r: YourRepo }) {
  if (!r.stats) return null;
  const n = repoNumbers(r.stats);
  return (
    <p className="text-[0.78rem] leading-snug tabular-nums sm:text-right">
      <span className="block text-ink">{n.merged}</span>
      {n.reply && <span className="block text-faint">{n.reply}</span>}
    </p>
  );
}

/** `iconSave`: the save control as the bookmark alone (the home page). */
export function RepoRows({ rows, saved, compact = false, iconSave = false }: { rows: YourRepo[]; saved: string[]; compact?: boolean; iconSave?: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const href = compareHref(picked);
  const savedSet = new Set(saved.map((s) => s.toLowerCase()));
  return (
    <>
      <ul className={compact ? "home-list" : undefined}>
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
                <RepoAvatar repo={r.repo} size={compact ? 28 : 32} />
                <div className="min-w-0">
                  <Link href={`/${r.repo}${r.ai ? "?mode=ai" : ""}`} className={`block truncate font-semibold tracking-tight after:absolute after:inset-0 hover:text-blue ${compact ? "text-[0.88rem]" : ""}`}>
                    <span className="font-normal text-muted">{owner}/</span>{name}
                  </Link>
                  <Meta r={r} />
                </div>
              </div>
              <div className="relative z-10 flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">
                {r.stats ? (
                  <Numbers r={r} />
                ) : r.checking ? (
                  <Link href={`/${r.repo}`} className="text-[0.8rem] text-blue hover:underline">Watch</Link>
                ) : (
                  <Link href={`/${r.repo}`} className="inline-flex min-h-11 items-center text-[0.8rem] text-blue hover:underline sm:min-h-0">Check it</Link>
                )}
                {r.stars != null && (
                  <span className="whitespace-nowrap text-[0.78rem] tabular-nums text-muted">
                    <span aria-hidden="true" className="text-[#e0a526]">★</span> {compactCount(r.stars)}<span className="sr-only"> stars</span>
                  </span>
                )}
                <SaveButton repo={r.repo} saved={savedSet.has(r.repo.toLowerCase())} compact icon={iconSave} />
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
