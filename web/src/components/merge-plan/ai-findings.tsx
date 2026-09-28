// "What the AI found": what the model read in the pull request threads, which
// counting alone can't say: how outside contributors are treated, whether the
// contributor guide is usable, what kind of project this is, and how each
// thread it read ended. The engine's own labels and values; the model never
// picks the verdict.
import { TONE } from "@/components/report/tone";
import { fieldLabel, outcomeLabel } from "@/lib/format";
import type { PlanAi } from "@/lib/merge-plan";
import { isGitHubLink } from "@/lib/playbook";

/** Good outcomes green, a way forward amber, a dead end orange, silence grey. */
const OUTCOME_FILL: Record<string, string> = {
  merged_after_review: "bg-green",
  merged_without_engagement: "bg-green/55",
  changes_requested: "bg-amber",
  closed_with_guidance: "bg-amber/60",
  closed_dismissive: "bg-orange",
  ignored: "bg-line-strong",
};

const card = "rounded-2xl border border-line bg-panel shadow-soft";

export function AiFindings({ ai }: { ai: PlanAi }) {
  const total = ai.outcomes.reduce((n, o) => n + o.count, 0);
  return (
    <div className="space-y-4">
      <ul className="grid gap-4 md:grid-cols-3">
        {ai.signals.map((s) => (
          <li key={s.kind} className={`flex flex-col p-5 ${card}`}>
            <p className="text-[0.92rem] text-muted">{fieldLabel(s.kind)}</p>
            <p className={`mt-1 font-serif text-[1.35rem] font-semibold leading-snug ${s.tone === "neutral" ? "text-ink" : TONE[s.tone].text}`}>{s.headline}</p>
            <p className="mt-2 flex-1 text-[0.95rem] leading-relaxed text-muted">{s.text}</p>
            {s.url && isGitHubLink(s.url) && (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-link mt-3 self-start text-[0.9rem]">
                What it read ↗
              </a>
            )}
          </li>
        ))}
      </ul>

      {total > 0 && (
        <div className={`p-5 sm:p-6 ${card}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[1.05rem] font-semibold text-ink">How the {total} threads it read ended</p>
            <p className="text-[0.9rem] text-faint">outside pull requests</p>
          </div>
          <div className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={ai.outcomes.map((o) => `${o.count} ${outcomeLabel(o.value).toLowerCase()}`).join(", ")}>
            {ai.outcomes.map((o) => (
              <span key={o.value} className={OUTCOME_FILL[o.value] ?? "bg-line-strong"} style={{ width: `${(o.count / total) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[0.95rem]">
            {ai.outcomes.map((o) => (
              <li key={o.value} className="flex items-center gap-2">
                <span aria-hidden="true" className={`size-2.5 rounded-full ${OUTCOME_FILL[o.value] ?? "bg-line-strong"}`} />
                <span className="font-semibold tabular-nums text-ink">{o.count}</span>
                <span className="text-muted">{outcomeLabel(o.value).toLowerCase()}</span>
              </li>
            ))}
          </ul>

          {ai.quotes.length > 0 && (
            <ul className="mt-6 space-y-5 border-t border-line pt-5">
              {ai.quotes.map((q) => (
                <li key={q.url}>
                  <figure>
                    <blockquote className="font-serif text-[1.12rem] leading-relaxed text-ink">&ldquo;{q.text}&rdquo;</blockquote>
                    <figcaption className="mt-1.5 text-[0.9rem] text-faint">
                      A maintainer on{" "}
                      <a href={q.url} target="_blank" rel="noopener noreferrer" className="text-link">
                        #{q.number}
                      </a>{" "}
                      · {outcomeLabel(q.outcome).toLowerCase()}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
