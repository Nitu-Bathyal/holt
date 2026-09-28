// The merge plan: the paid AI report. One plan per repository, read top to
// bottom as what to do: the call, a first-PR plan you can tick off, then the
// counted patterns behind it (what gets merged, what gets closed, who
// reviews). Every claim opens to its count and the pull requests it came from.
import Link from "next/link";
import { TONE } from "@/components/report/tone";
import { VerdictPill } from "@/components/report/verdict-pill";
import { citedLinks, type MergePlan, type PlanClosing } from "@/lib/merge-plan";
import { Meter, PlanText, PrLinks, Sources } from "./plan-bits";
import { PlanSteps } from "./plan-steps";

const SECTIONS = [
  ["first-pr", "Your first pull request"],
  ["merged", "What gets merged"],
  ["closed", "What gets closed"],
  ["reviewers", "Who reviews"],
  ["how", "How this was made"],
] as const;

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function MergePlanView({ plan, locked = false }: { plan: MergePlan; locked?: boolean }) {
  const cited = citedLinks(plan).length;
  return (
    <article className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-14" data-merge-plan>
      <div className="min-w-0">
        <PlanHeader plan={plan} />
        <VerdictStrip plan={plan} />

        <section aria-labelledby="the-call" className="mt-9">
          <h2 id="the-call" className="sr-only">The call</h2>
          <p className="text-[0.8rem] uppercase tracking-[0.08em] text-faint">The call</p>
          <p className="mt-2 max-w-[38ch] font-sans text-[1.45rem] font-semibold leading-[1.3] tracking-[-0.01em] text-ink [text-wrap:balance] sm:text-[1.8rem]">
            <PlanText text={plan.call.text} />
          </p>
          <Sources sources={plan.call.sources} className="mt-3" />
        </section>

        <PlanSection id="first-pr" title="Your first pull request">
          <PlanSteps repo={plan.repo} steps={plan.steps} show={locked ? 1 : plan.steps.length} />
        </PlanSection>

        {locked ? (
          <LockedRest plan={plan} />
        ) : (
          <>
            <PlanSection id="merged" title="What gets merged" note={`${plan.sample.merged} merged pull requests`}>
              <ul className="grid gap-px border border-line bg-line sm:grid-cols-3">
                {plan.merged.map((f) => (
                  <li key={f.label} className="flex flex-col bg-panel p-5">
                    <p className="flex items-baseline gap-1.5">
                      <span className="text-[2.1rem] font-semibold leading-none tracking-[-0.04em] tabular-nums text-ink">{f.value}</span>
                      <span className="text-[0.9rem] text-muted">{f.unit}</span>
                    </p>
                    <p className="mt-2 flex-1 font-sans text-[0.95rem] leading-snug text-muted">
                      <PlanText text={f.label} />
                    </p>
                    {f.unit.startsWith("of") && (
                      <div className="mt-4">
                        <Meter seen={f.seen} of={f.of} label={`${f.seen} of ${f.of}`} />
                      </div>
                    )}
                    <Sources sources={f.sources} linksOnly className="mt-3" />
                  </li>
                ))}
              </ul>
            </PlanSection>

            <PlanSection id="closed" title="What gets closed" note={`${plan.sample.closed_outside} closed outside pull requests, in the maintainers' words`}>
              <ul className="space-y-8">
                {plan.closed.map((c) => (
                  <li key={c.reason}>
                    <ClosingReason c={c} />
                  </li>
                ))}
              </ul>
            </PlanSection>

            <PlanSection id="reviewers" title="Who reviews" note="share of merged pull requests each one reviewed">
              <ul className="space-y-4">
                {plan.reviewers.people.map((p) => (
                  <li key={p.login} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[12rem_minmax(0,1fr)_4.5rem]">
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <a href={`https://github.com/${p.login}`} target="_blank" rel="noopener noreferrer" className="block truncate font-sans font-semibold text-ink hover:text-blue">
                        @{p.login}
                      </a>
                      {p.areas.length > 0 && <p className="truncate text-[0.82rem] text-faint">{p.areas.join(", ")}</p>}
                    </div>
                    <Meter seen={p.reviewed} of={p.of} tone="blue" label={`reviewed ${p.reviewed} of ${p.of}`} />
                    <p className="text-right text-[0.85rem] tabular-nums text-faint">
                      {p.reviewed} of {p.of}
                    </p>
                  </li>
                ))}
              </ul>
              <Sources sources={plan.reviewers.sources} className="mt-4" />
            </PlanSection>

            <PlanSection id="how" title="How this was made">
              <div className="max-w-[68ch] space-y-3 font-sans text-[0.95rem] leading-relaxed text-muted">
                <p>
                  Counted from {plan.sample.merged} merged and {plan.sample.closed} closed pull requests since {dateLabel(plan.window.since)}, plus
                  Holt&apos;s free report. Written by <code className="bg-panel-2 px-1 text-[0.9em]">{plan.model}</code>, then every sentence was checked
                  against those counts and anything that didn&apos;t match was cut. The rules picked the verdict, not the model.
                </p>
                {plan.note && <p className="border border-dashed border-line-strong px-3 py-2">{plan.note}</p>}
                <p className="text-[0.85rem] text-faint">
                  Cites {cited} pull requests · written {dateLabel(plan.generated_at)}
                </p>
              </div>
            </PlanSection>
          </>
        )}
      </div>

      <aside className="hidden lg:block">
        <nav aria-label="Merge plan" className="sticky top-24 border-l border-line pl-5">
          <p className="text-[0.78rem] uppercase tracking-[0.08em] text-faint">In this plan</p>
          <ol className="mt-3 space-y-1 text-[0.88rem]">
            {SECTIONS.filter(([id]) => !locked || id === "first-pr").map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block py-1 text-muted transition-colors hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ol>
          <div className="mt-6 border-t border-line pt-4 text-[0.82rem] leading-relaxed text-faint">
            <p className="tabular-nums">
              {plan.steps.length} steps · {plan.closed.length} closing reasons · {plan.reviewers.people.length} reviewers
            </p>
            {!locked && <p className="mt-1 tabular-nums">cites {cited} pull requests</p>}
          </div>
        </nav>
      </aside>
    </article>
  );
}

function PlanHeader({ plan }: { plan: MergePlan }) {
  const [owner, name] = plan.repo.split("/");
  return (
    <header className="border-b border-ink pb-5">
      <p className="flex items-center gap-2.5 text-[0.8rem] uppercase tracking-[0.1em] text-muted">
        <span className="bg-ink px-1.5 py-0.5 font-semibold tracking-[0.14em] text-bg">Pro</span>
        Merge plan
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h1 className="text-[1.6rem] font-semibold tracking-[-0.03em] [overflow-wrap:anywhere] sm:text-[2rem]">
          <span className="text-muted">{owner}/</span>
          {name}
        </h1>
        <a href={`https://github.com/${plan.repo}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center text-[0.85rem] text-faint hover:text-blue">
          github.com/{plan.repo} ↗
        </a>
      </div>
      <p className="mt-2 font-sans text-[0.92rem] text-muted">
        Built from {plan.sample.merged} merged and {plan.sample.closed} closed pull requests since {dateLabel(plan.window.since)} · written {dateLabel(plan.generated_at)}
      </p>
    </header>
  );
}

function VerdictStrip({ plan }: { plan: MergePlan }) {
  const v = plan.verdict;
  return (
    <div className={`mt-6 grid gap-4 border ${TONE[v.tone].border} bg-panel p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-6 sm:p-5`}>
      <VerdictPill headline={v.headline} tone={v.tone} className="justify-self-start" />
      <dl className="grid grid-cols-3 gap-3 sm:gap-6">
        {v.numbers.map((n) => (
          <div key={n.label} className="flex min-w-0 flex-col-reverse justify-end">
            <dt className="text-[0.8rem] leading-snug text-faint">{n.label}</dt>
            <dd className="text-[1.1rem] font-semibold tabular-nums tracking-tight text-ink sm:text-[1.25rem]">{n.value}</dd>
          </div>
        ))}
      </dl>
      <p className="font-sans text-[0.92rem] leading-relaxed text-muted sm:col-span-2">
        {v.line}{" "}
        <Link href={`/${plan.repo}`} className="text-link whitespace-nowrap">
          free report
        </Link>
      </p>
    </div>
  );
}

function PlanSection({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-14 scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-[1.25rem] font-semibold tracking-tight sm:text-[1.45rem]">
          {title}
        </h2>
        {note && <p className="text-[0.85rem] text-faint">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s.trim());

function ClosingReason({ c }: { c: PlanClosing }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-sans text-[1.08rem] font-semibold text-ink">{c.reason}</p>
        <p className="shrink-0 text-[0.9rem] tabular-nums text-orange">
          {c.seen} <span className="text-faint">of {c.of}</span>
        </p>
      </div>
      <div className="mt-2">
        <Meter seen={c.seen} of={c.of} tone="orange" label={`${c.seen} of ${c.of} closed outside pull requests`} />
      </div>
      {c.quote && (
        <figure className="mt-4 border border-line bg-panel px-4 py-3">
          {isUrl(c.quote.text) ? (
            <blockquote className="font-sans text-[0.98rem] leading-relaxed text-ink">
              Closed with a link to the project&apos;s policy:{" "}
              <a href={c.quote.text} target="_blank" rel="noopener noreferrer" className="text-link [overflow-wrap:anywhere]">
                {c.quote.text.replace(/^https?:\/\//, "")}
              </a>
            </blockquote>
          ) : (
            <blockquote className="font-sans text-[1.02rem] leading-relaxed text-ink">&ldquo;{c.quote.text}&rdquo;</blockquote>
          )}
          <figcaption className="mt-2 text-[0.82rem] text-faint">
            @{c.quote.who}, a maintainer, on{" "}
            <a href={c.quote.url} target="_blank" rel="noopener noreferrer" className="text-link">
              #{c.quote.number}
            </a>
          </figcaption>
        </figure>
      )}
      {c.examples.length > 1 && (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[0.85rem] text-faint">
          <span>also</span>
          <PrLinks links={c.examples.filter((e) => e.url !== c.quote?.url).map((e) => e.url)} />
        </p>
      )}
    </div>
  );
}

function LockedRest({ plan }: { plan: MergePlan }) {
  const rows = [
    [`${plan.steps.length - 1} more steps`, plan.steps.slice(1).map((s) => s.title.replace(/`/g, "")).join(" · ")],
    [`What gets merged`, `${plan.merged.length} patterns counted from ${plan.sample.merged} merged pull requests`],
    [`What gets closed`, `${plan.closed.length} reasons, with what the maintainers wrote`],
    [`Who reviews`, `${plan.reviewers.people.length} reviewers and what they review`],
  ];
  return (
    <section aria-label="The rest of the plan" className="mt-6 border border-ink bg-panel">
      <ul>
        {rows.map(([title, body]) => (
          <li key={title} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 border-b border-line px-5 py-4 last:border-b-0">
            <svg viewBox="0 0 16 16" className="mt-1 size-4 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" />
              <path d="M5 7V5a3 3 0 0 1 6 0v2" />
            </svg>
            <div className="min-w-0">
              <p className="font-semibold text-ink">{title}</p>
              <p className="mt-0.5 font-sans text-[0.92rem] leading-snug text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-ink bg-bg px-5 py-4">
        <p className="font-sans text-[0.92rem] text-muted">1 credit for this repository. Keep it for good. A plan that fails costs nothing.</p>
        <button type="button" className="btn-primary min-h-12 bg-ink px-5 text-bg">
          unlock the merge plan →
        </button>
      </div>
    </section>
  );
}
