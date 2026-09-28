// Small pieces the merge plan repeats: text with code spans, the "why"
// disclosure that shows a claim's counted source and its pull requests, and
// the seen-of meter. No hooks, so both server and client parts can use them.
import type { PlanSource } from "@/lib/merge-plan";
import { share } from "@/lib/merge-plan";
import { codeSpans, isGitHubLink, linkLabel } from "@/lib/playbook";

export function PlanText({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map(([piece, code], i) =>
        code ? (
          <code key={i} className="bg-panel-2 px-1 text-[0.92em]">
            {piece}
          </code>
        ) : (
          <span key={i}>{piece}</span>
        ),
      )}
    </>
  );
}

export function PrLinks({ links, max = 6 }: { links: string[]; max?: number }) {
  const safe = [...new Set(links)].filter(isGitHubLink);
  if (safe.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-2.5 gap-y-1">
      {safe.slice(0, max).map((u) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="text-link tabular-nums">
          {linkLabel(u)}
        </a>
      ))}
      {safe.length > max && <span className="text-faint">+{safe.length - max} more</span>}
    </span>
  );
}

/**
 * A claim's sources, always in view: each count with its own pull requests,
 * "38 of 50 PRs #3876 #3866 +5 more". `linksOnly` drops the counts where the
 * number is already on screen (the "what gets merged" tiles).
 */
export function Sources({ sources, className = "", linksOnly = false }: { sources: PlanSource[]; className?: string; linksOnly?: boolean }) {
  const parts = sources.filter((s) => s.links.length > 0 || (!linksOnly && s.seen != null && s.of != null));
  if (parts.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[0.875rem] text-faint ${className}`}>
      {parts.map((s, i) => (
        <p key={i} className="flex flex-wrap items-baseline gap-x-2.5" title={s.statement}>
          {!linksOnly && s.seen != null && s.of != null && (
            <span className="tabular-nums">
              {s.seen} of {s.of} PRs
            </span>
          )}
          <PrLinks links={s.links} max={linksOnly ? 3 : 4} />
        </p>
      ))}
    </div>
  );
}

export function Meter({ seen, of, tone = "green", label }: { seen: number | null; of: number | null; tone?: "green" | "orange" | "blue"; label: string }) {
  const fill = { green: "bg-green", orange: "bg-orange", blue: "bg-blue" }[tone];
  return (
    <div className="h-2 overflow-hidden rounded-full bg-panel-2" role="img" aria-label={label}>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${share(seen, of)}%` }} />
    </div>
  );
}
