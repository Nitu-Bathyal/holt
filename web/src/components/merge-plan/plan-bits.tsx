// Small pieces the merge plan repeats, in the report page's style: text with
// code spans, a claim's sources (its count and the pull requests behind it)
// and the meter bar. No hooks, so server and client parts can both use them.
import type { PlanSource } from "@/lib/merge-plan";
import { share } from "@/lib/merge-plan";
import { codeSpans, isGitHubLink, linkLabel } from "@/lib/playbook";

export function PlanText({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map(([piece, code], i) =>
        code ? (
          <code key={i} className="bg-panel-2 px-1 font-mono text-[0.92em]">
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
      {safe.length > max && <span className="text-faint">+{safe.length - max}</span>}
    </span>
  );
}

/**
 * A claim's sources, always in view: "38 of 50 PRs · #3876 #3866 +5". The
 * count says how often it held; the links are the pull requests. `linksOnly`
 * drops the count where the number is already on screen.
 */
export function Sources({ sources, className = "", linksOnly = false }: { sources: PlanSource[]; className?: string; linksOnly?: boolean }) {
  const parts = sources.filter((s) => s.links.length > 0 || (!linksOnly && s.seen != null && s.of != null));
  if (parts.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[0.8rem] text-faint ${className}`}>
      {parts.map((s, i) => (
        <p key={i} className="flex flex-wrap items-baseline gap-x-2" title={s.statement}>
          {!linksOnly && s.seen != null && s.of != null && (
            <span className="tabular-nums">
              {s.seen} of {s.of} PRs
            </span>
          )}
          {!linksOnly && s.seen != null && s.links.length > 0 && <span aria-hidden="true">·</span>}
          <PrLinks links={s.links} max={linksOnly ? 3 : 4} />
        </p>
      ))}
    </div>
  );
}

const FILL = { green: "bg-green", orange: "bg-orange", blue: "bg-blue", amber: "bg-amber" } as const;

/** The report's meter (globals.css `.meter`): a thin bar that grows in. */
export function Meter({ seen, of, tone = "green", label }: { seen: number | null; of: number | null; tone?: keyof typeof FILL; label: string }) {
  return (
    <div className="meter" role="img" aria-label={label}>
      <span className={FILL[tone]} style={{ width: `${Math.max(2, share(seen, of))}%` }} />
    </div>
  );
}
