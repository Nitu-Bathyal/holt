// The merge plan: the paid AI report, in the free report's look (verdict card,
// numbered sections, stats grid, meters). Read top to bottom as what to do:
// the call, what the AI found in the threads, a first-PR timeline you can tick
// off, then the counted patterns behind it. Every claim shows its count and
// the pull requests it came from.
import { CatFace } from "@/components/cat-face";
import { Section } from "@/components/report/report-view";
import { TONE, TONE_MOOD } from "@/components/report/tone";
import { citedLinks, type MergePlan, type PlanClosing } from "@/lib/merge-plan";
import { AiFindings } from "./ai-findings";
import { Meter, PlanText, PrLinks, Sources } from "./plan-bits";
import { PlanSteps } from "./plan-steps";

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function MergePlanView({ plan, locked = false }: { plan: MergePlan; locked?: boolean }) {
  const cited = citedLinks(plan).length;
  const sections = [
    ...(plan.ai ? [["ai", "What the AI found"]] : []),
    ["first-pr", "Your first pull request"],
    ["merged", "What gets merged"],
    ["closed", "What gets closed"],
    ["reviewers", "Who reviews"],
  ] as [string, string][];
  const n = (id: string) => String(sections.findIndex(([s]) => s === id) + 1).padStart(2, "0");

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10" data-merge-plan>
      <div className="min-w-0 space-y-10">
        <PlanHero plan={plan} />

        {locked ? (
          <>
            <Section n={n("first-pr")} id="first-pr" title="Your first pull request" note="step by step">
              <PlanSteps repo={plan.repo} steps={plan.steps} show={1} />
            </Section>
            <LockedRest plan={plan} />
          </>
        ) : (
          <>
            {plan.ai && (
              <Section n={n("ai")} id="ai" title="What the AI found" note={`from ${plan.ai.threads} outside pull request threads`}>
                <AiFindings ai={plan.ai} />
              </Section>
            )}

            <Section n={n("first-pr")} id="first-pr" title="Your first pull request" note="step by step, tick them off">
              <PlanSteps repo={plan.repo} steps={plan.steps} />
            </Section>

            <Section n={n("merged")} id="merged" title="What gets merged" note={`${plan.sample.merged} merged pull requests`}>
              <ul className="grid gap-px overflow-hidden border border-line bg-line shadow-soft sm:grid-cols-3">
                {plan.merged.map((f) => (
                  <li key={f.label} className="flex flex-col bg-panel p-5">
                    <p className="flex items-baseline gap-1.5">
                      <span className="text-[1.6rem] font-semibold leading-tight tracking-tight tabular-nums text-ink">{f.value}</span>
                      <span className="text-[0.85rem] text-faint">{f.unit}</span>
                    </p>
                    <p className="mt-1 flex-1 font-sans text-[0.9rem] leading-snug text-muted">
                      <PlanText text={f.label} />
                    </p>
                    {f.unit.startsWith("of") && (
                      <div className="mt-3">
                        <Meter seen={f.seen} of={f.of} label={`${f.seen} of ${f.of}`} />
                      </div>
                    )}
                    <Sources sources={f.sources} linksOnly className="mt-3" />
                  </li>
                ))}
              </ul>
            </Section>

            <Section n={n("closed")} id="closed" title="What gets closed" note={`${plan.sample.closed_outside} closed outside pull requests`}>
              <ul className="border-t border-line-strong">
                {plan.closed.map((c) => (
                  <li key={c.reason} className="border-b border-line py-5">
                    <ClosingReason c={c} />
                  </li>
                ))}
              </ul>
            </Section>

            <Section n={n("reviewers")} id="reviewers" title="Who reviews" note="share of merged pull requests each reviewed">
              <ul className="space-y-4">
                {plan.reviewers.people.map((p) => (
                  <li key={p.login}>
                    <div className="flex items-baseline justify-between gap-4 text-[0.85rem]">
                      <a href={`https://github.com/${p.login}`} target="_blank" rel="noopener noreferrer" className="truncate text-ink hover:text-blue">
                        @{p.login}
                        {p.areas.length > 0 && <span className="text-faint"> · {p.areas.join(", ")}</span>}
                      </a>
                      <span className="shrink-0 font-sans text-muted">
                        <strong className="font-semibold text-blue">{p.reviewed}</strong> of {p.of} reviewed
                      </span>
                    </div>
                    <div className="mt-2">
                      <Meter seen={p.reviewed} of={p.of} tone="blue" label={`reviewed ${p.reviewed} of ${p.of}`} />
                    </div>
                  </li>
                ))}
              </ul>
              <Sources sources={plan.reviewers.sources} className="mt-4" />
            </Section>

            <p className="border-t border-dashed border-line-strong pt-4 font-sans text-[0.85rem] leading-relaxed text-faint">
              Counted from {plan.sample.merged} merged and {plan.sample.closed} closed pull requests since {dateLabel(plan.window.since)}
              {plan.ai && <>; {plan.ai.threads} threads read by {plan.ai.model}</>}. Written by {plan.model}, then every sentence was checked against the
              counts and anything that didn&apos;t match was cut. The rules picked the verdict, not the model. Cites {cited} pull requests.
              {plan.note && <> {plan.note}</>}
            </p>
          </>
        )}
      </div>

      <aside className="hidden lg:block" aria-label="In this plan">
        <div className="sticky top-24 space-y-4">
          <nav className="panel p-4" aria-label="Merge plan">
            <p className="mb-3 text-[0.8rem] uppercase tracking-[0.08em] text-faint">In this plan</p>
            <ol className="space-y-1 text-[0.88rem]">
              {sections
                .filter(([id]) => !locked || id === "first-pr")
                .map(([id, label]) => (
                  <li key={id}>
                    <a href={`#${id}`} className="flex gap-3 py-1 text-muted transition-colors hover:text-ink">
                      <span className="text-blue">{n(id)}</span>
                      {label}
                    </a>
                  </li>
                ))}
            </ol>
          </nav>
          <p className="px-1 text-[0.8rem] leading-relaxed text-faint">
            {plan.steps.length} steps · {plan.closed.length} closing reasons · {plan.reviewers.people.length} reviewers
            {!locked && <> · cites {cited} pull requests</>}
          </p>
        </div>
      </aside>
    </div>
  );
}

/** The verdict card, as on the free report, with the call as its one line. */
function PlanHero({ plan }: { plan: MergePlan }) {
  const v = plan.verdict;
  const t = TONE[v.tone];
  return (
    <div className="relative overflow-hidden border border-line-strong bg-panel shadow-card" data-verdict-hero>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${t.bg}`} />
      <div className="p-5 pl-6 sm:p-8 sm:pl-10">
        <div className="flex items-center justify-between gap-4 text-[0.8rem] uppercase tracking-[0.08em] text-faint">
          <span className="flex items-center gap-2">
            <span className="bg-ink px-1.5 py-0.5 font-semibold tracking-[0.12em] text-bg">pro</span>
            merge plan · {v.headline.toLowerCase()}
          </span>
          <CatFace mood={TONE_MOOD[v.tone]} blink className="text-[1.1rem] normal-case tracking-normal sm:text-[1.5rem]" />
        </div>
        <h1 className="mt-4 text-[1.5rem] font-semibold leading-[1.25] tracking-tight text-ink [text-wrap:balance] sm:text-[1.85rem]">
          <PlanText text={plan.call.text} />
        </h1>
        <Sources sources={plan.call.sources} className="mt-3" />

        <dl className="mt-6 grid max-w-2xl grid-cols-3 border-t border-dashed border-line-strong pt-4">
          {v.numbers.map((x) => (
            <div key={x.label} className="flex min-w-0 flex-col-reverse justify-end">
              <dt className="mt-1 font-sans text-[0.82rem] leading-snug text-faint">{x.label}</dt>
              <dd className={`text-[1.25rem] font-semibold tabular-nums tracking-tight ${t.text}`}>{x.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-[0.82rem] text-faint">
          {plan.sample.merged + plan.sample.closed} pull requests since {dateLabel(plan.window.since)} · written {dateLabel(plan.generated_at)}
        </p>
      </div>
    </div>
  );
}

const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s.trim());

function ClosingReason({ c }: { c: PlanClosing }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[1rem] font-semibold tracking-tight text-ink">{c.reason}</p>
        <p className="shrink-0 font-sans text-[0.85rem] text-muted">
          <strong className="font-semibold text-orange">{c.seen}</strong> of {c.of} closed
        </p>
      </div>
      <div className="mt-2">
        <Meter seen={c.seen} of={c.of} tone="orange" label={`${c.seen} of ${c.of} closed outside pull requests`} />
      </div>
      {c.quote && (
        <div className="mt-4">
          {isUrl(c.quote.text) ? (
            <p className="border-l-2 border-line-strong pl-3 font-sans text-[0.95rem] text-ink">
              Closed with a link to the project&apos;s policy:{" "}
              <a href={c.quote.text} target="_blank" rel="noopener noreferrer" className="text-link [overflow-wrap:anywhere]">
                {c.quote.text.replace(/^https?:\/\//, "")}
              </a>
            </p>
          ) : (
            <blockquote className="border-l-2 border-line-strong pl-3 font-sans text-[0.95rem] italic text-ink">&ldquo;{c.quote.text}&rdquo;</blockquote>
          )}
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 pl-3.5 text-[0.8rem] text-faint">
            <span>
              @{c.quote.who} on{" "}
              <a href={c.quote.url} target="_blank" rel="noopener noreferrer" className="text-link">
                #{c.quote.number}
              </a>
            </span>
            {c.examples.length > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span>also</span>
                <PrLinks links={c.examples.filter((e) => e.url !== c.quote?.url).map((e) => e.url)} max={4} />
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function LockedRest({ plan }: { plan: MergePlan }) {
  const rows = [
    ...(plan.ai ? [["What the AI found", `How maintainers treat newcomers, whether the guide is usable, and how ${plan.ai.threads} threads ended`]] : []),
    [`${plan.steps.length - 1} more steps`, plan.steps.slice(1).map((s) => s.title.replace(/`/g, "")).join(" · ")],
    ["What gets merged", `${plan.merged.length} patterns from ${plan.sample.merged} merged pull requests`],
    ["What gets closed", `${plan.closed.length} reasons, in the maintainers' words`],
    ["Who reviews", `${plan.reviewers.people.length} reviewers and what they review`],
  ];
  return (
    <section aria-label="The rest of the plan" className="border border-line-strong bg-panel p-6 shadow-card sm:p-8">
      <p className="text-[1.25rem] font-semibold tracking-tight">The rest of the plan</p>
      <ul className="mt-5 grid gap-px border border-line bg-line sm:grid-cols-2">
        {rows.map(([title, body], i) => (
          <li key={title} className="bg-panel-2/60 p-4">
            <p className="flex items-baseline gap-2 text-[0.95rem] font-semibold">
              <span className="text-[0.8rem] text-blue">{String(i + 1).padStart(2, "0")}</span>
              {title}
            </p>
            <p className="mt-1 font-sans text-[0.88rem] leading-snug text-muted">{body}</p>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button type="button" className="btn-primary">
          unlock the merge plan <span aria-hidden="true">→</span>
        </button>
        <span className="font-sans text-[0.88rem] text-faint">1 credit for this repo · yours to keep · a plan that fails costs nothing</span>
      </div>
    </section>
  );
}
