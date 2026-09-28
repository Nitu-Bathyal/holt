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

/** "why · seen in 38 of 50": opens to the counted statement and the pull requests behind it. */
export function Why({ sources }: { sources: PlanSource[] }) {
  if (sources.length === 0) return null;
  const first = sources.find((s) => s.seen != null && s.of != null);
  return (
    <details className="group text-[0.85rem]">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-faint hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span>
        why{first && <span className="tabular-nums"> · {first.seen} of {first.of}</span>}
      </summary>
      <ul className="mt-2 space-y-3 border-l border-line-strong pl-3">
        {sources.map((s, i) => (
          <li key={i}>
            <p className="font-sans text-[0.9rem] leading-relaxed text-muted">{s.statement}</p>
            {s.links.length > 0 && (
              <p className="mt-1">
                <PrLinks links={s.links} />
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Meter({ seen, of, tone = "green", label }: { seen: number | null; of: number | null; tone?: "green" | "orange" | "blue"; label: string }) {
  const fill = { green: "bg-green", orange: "bg-orange", blue: "bg-blue" }[tone];
  return (
    <div className="h-1.5 bg-panel-2" role="img" aria-label={label}>
      <div className={`h-full ${fill}`} style={{ width: `${share(seen, of)}%` }} />
    </div>
  );
}
