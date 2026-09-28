// "What the AI found": what the model read in the pull request threads, which
// counting alone can't say: how outside contributors are treated, whether the
// contributor guide is usable, what kind of project this is, and how each
// thread it read ended. The engine's own labels and values; the model never
// picks the verdict. Styled like the report's stats grid and evidence list.
import { TONE } from "@/components/report/tone";
import { fieldLabel, outcomeLabel } from "@/lib/format";
import type { PlanAi } from "@/lib/merge-plan";
import { isGitHubLink } from "@/lib/playbook";

/** Good outcomes green, a way forward amber, a dead end orange, silence grey. */
const OUTCOME_FILL: Record<string, string> = {
  merged_after_review: "bg-green",
  merged_without_engagement: "bg-green/50",
  changes_requested: "bg-amber",
  closed_with_guidance: "bg-amber/60",
  closed_dismissive: "bg-orange",
  ignored: "bg-line-strong",
};

export function AiFindings({ ai }: { ai: PlanAi }) {
  const total = ai.outcomes.reduce((n, o) => n + o.count, 0);
  return (
    <div className="space-y-6">
      <ul className="grid gap-px overflow-hidden border border-line bg-line shadow-soft md:grid-cols-3">
        {ai.signals.map((s) => (
          <li key={s.kind} className="flex flex-col bg-panel p-5">
            <p className="text-[0.75rem] uppercase tracking-[0.08em] text-faint">{fieldLabel(s.kind)}</p>
            <p className={`mt-2 text-[1.3rem] font-semibold leading-tight tracking-tight ${s.tone === "neutral" ? "text-ink" : TONE[s.tone].text}`}>{s.headline}</p>
            <p className="mt-2 flex-1 font-sans text-[0.9rem] leading-relaxed text-muted">{s.text}</p>
            {s.url && isGitHubLink(s.url) && (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-link mt-3 self-start text-[0.82rem]">
                what it read ↗
              </a>
            )}
          </li>
        ))}
      </ul>

      {total > 0 && (
        <div className="border border-line-strong bg-panel p-5 shadow-soft sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[0.8rem] uppercase tracking-[0.08em] text-faint">
            <span>how the {total} threads it read ended</span>
            <span>outside pull requests</span>
          </div>
          <div className="mt-4 flex h-2.5 gap-px overflow-hidden bg-panel-2" role="img" aria-label={ai.outcomes.map((o) => `${o.count} ${outcomeLabel(o.value).toLowerCase()}`).join(", ")}>
            {ai.outcomes.map((o) => (
              <span key={o.value} className={OUTCOME_FILL[o.value] ?? "bg-line-strong"} style={{ width: `${(o.count / total) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[0.88rem]">
            {ai.outcomes.map((o) => (
              <li key={o.value} className="flex items-center gap-2">
                <span aria-hidden="true" className={`size-2.5 ${OUTCOME_FILL[o.value] ?? "bg-line-strong"}`} />
                <span className="font-semibold tabular-nums text-ink">{o.count}</span>
                <span className="font-sans text-muted">{outcomeLabel(o.value).toLowerCase()}</span>
              </li>
            ))}
          </ul>

          {ai.quotes.length > 0 && (
            <ul className="mt-5 space-y-4 border-t border-dashed border-line-strong pt-5">
              {ai.quotes.map((q) => (
                <li key={q.url}>
                  <blockquote className="border-l-2 border-line-strong pl-3 font-sans text-[0.95rem] italic text-ink">&ldquo;{q.text}&rdquo;</blockquote>
                  <p className="mt-1 pl-3.5 text-[0.8rem] text-faint">
                    a maintainer on{" "}
                    <a href={q.url} target="_blank" rel="noopener noreferrer" className="text-link">
                      #{q.number}
                    </a>{" "}
                    · {outcomeLabel(q.outcome).toLowerCase()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
