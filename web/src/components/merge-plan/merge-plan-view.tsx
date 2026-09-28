// The merge plan: the paid AI report. One plan per repository, read top to
// bottom as what to do: the call, a first-PR plan you can tick off, then the
// counted patterns behind it (what gets merged, what gets closed, who
// reviews). Every claim shows its count and the pull requests it came from.
// Set in the report type (ReportDoc): Plex Sans to read, Plex Serif to lead.
import Link from "next/link";
import { VerdictPill } from "@/components/report/verdict-pill";
import { citedLinks, type MergePlan, type PlanClosing } from "@/lib/merge-plan";
import { AiFindings } from "./ai-findings";
import { Meter, PlanText, PrLinks, Sources } from "./plan-bits";
import { PlanSteps } from "./plan-steps";

const SECTIONS = [
  ["ai", "What the AI found"],
  ["first-pr", "Your first pull request"],
  ["merged", "What gets merged"],
  ["closed", "What gets closed"],
  ["reviewers", "Who reviews"],
  ["how", "How this was made"],
] as const;

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const card = "rounded-2xl border border-line bg-panel shadow-soft";

export function MergePlanView({ plan, locked = false }: { plan: MergePlan; locked?: boolean }) {
  const cited = citedLinks(plan).length;
  return (
    <article className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-16" data-merge-plan>
      <div className="min-w-0">
        <PlanHeader plan={plan} />
        <VerdictStrip plan={plan} />

        <section aria-labelledby="the-call" className="mt-12">
          <h2 id="the-call" className="text-[0.95rem] font-medium text-muted">
            The call
          </h2>
          <p className="mt-2 max-w-[36ch] font-serif text-[1.75rem] font-semibold leading-[1.25] tracking-[-0.015em] text-ink [text-wrap:balance] sm:text-[2.15rem]">
            <PlanText text={plan.call.text} />
          </p>
          <Sources sources={plan.call.sources} className="mt-4" />
        </section>

        {plan.ai && !locked && (
          <PlanSection id="ai" title="What the AI found" note={`reading ${plan.ai.threads} outside pull request threads`}>
            <AiFindings ai={plan.ai} />
          </PlanSection>
        )}

        <PlanSection id="first-pr" title="Your first pull request">
          <PlanSteps repo={plan.repo} steps={plan.steps} show={locked ? 1 : plan.steps.length} />
        </PlanSection>

        {locked ? (
          <LockedRest plan={plan} />
        ) : (
          <>
            <PlanSection id="merged" title="What gets merged" note={`from ${plan.sample.merged} merged pull requests`}>
              <ul className="grid gap-4 sm:grid-cols-3">
                {plan.merged.map((f) => (
                  <li key={f.label} className={`flex flex-col p-5 ${card}`}>
                    <p className="flex items-baseline gap-1.5">
                      <span className="text-[2.2rem] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">{f.value}</span>
                      <span className="text-[0.95rem] text-muted">{f.unit}</span>
                    </p>
                    <p className="mt-2.5 flex-1 text-[0.98rem] leading-snug text-muted">
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

            <PlanSection id="closed" title="What gets closed" note={`${plan.sample.closed_outside} closed outside pull requests`}>
              <ul className="space-y-4">
                {plan.closed.map((c) => (
                  <li key={c.reason} className={`p-5 sm:p-6 ${card}`}>
                    <ClosingReason c={c} />
                  </li>
                ))}
              </ul>
            </PlanSection>

            <PlanSection id="reviewers" title="Who reviews" note="share of merged pull requests each reviewed">
              <div className={`p-5 sm:p-6 ${card}`}>
                <ul className="space-y-4">
                  {plan.reviewers.people.map((p) => (
                    <li key={p.login} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[12rem_minmax(0,1fr)_4.5rem]">
                      <div className="col-span-2 min-w-0 sm:col-span-1">
                        <a href={`https://github.com/${p.login}`} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold text-ink hover:text-blue">
                          @{p.login}
                        </a>
                        {p.areas.length > 0 && <p className="truncate text-[0.88rem] text-faint">{p.areas.join(", ")}</p>}
                      </div>
                      <Meter seen={p.reviewed} of={p.of} tone="blue" label={`reviewed ${p.reviewed} of ${p.of}`} />
                      <p className="text-right text-[0.92rem] tabular-nums text-muted">
                        {p.reviewed} of {p.of}
                      </p>
                    </li>
                  ))}
                </ul>
                <Sources sources={plan.reviewers.sources} className="mt-5 border-t border-line pt-4" />
              </div>
            </PlanSection>

            <PlanSection id="how" title="How this was made">
              <div className="max-w-[68ch] space-y-3 text-[0.98rem] leading-relaxed text-muted">
                <p>
                  Counted from {plan.sample.merged} merged and {plan.sample.closed} closed pull requests since {dateLabel(plan.window.since)}, plus
                  Holt&apos;s free report.{plan.ai && <> The AI read {plan.ai.threads} outside pull request threads on {dateLabel(plan.ai.read_on)}.</>} Written by <code className="rounded bg-panel-2 px-1 text-[0.9em]">{plan.model}</code>, then every sentence was
                  checked against those counts and anything that didn&apos;t match was cut. The rules picked the verdict, not the model.
                </p>
                {plan.note && <p className="rounded-xl bg-panel-2/60 px-4 py-3">{plan.note}</p>}
                <p className="text-[0.9rem] text-faint">
                  Cites {cited} pull requests · written {dateLabel(plan.generated_at)}
                </p>
              </div>
            </PlanSection>
          </>
        )}
      </div>

      <aside className="hidden lg:block">
        <nav aria-label="Merge plan" className="sticky top-24">
          <p className="text-[0.9rem] font-medium text-ink">In this plan</p>
          <ol className="mt-3 space-y-0.5 border-l border-line text-[0.92rem]">
            {SECTIONS.filter(([id]) => !locked || id === "first-pr").map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="-ml-px block border-l border-transparent py-1.5 pl-4 text-muted transition-colors hover:border-ink hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[0.88rem] leading-relaxed text-faint">
            {plan.steps.length} steps · {plan.closed.length} closing reasons · {plan.reviewers.people.length} reviewers
            {!locked && <> · cites {cited} pull requests</>}
          </p>
        </nav>
      </aside>
    </article>
  );
}

function PlanHeader({ plan }: { plan: MergePlan }) {
  const [owner, name] = plan.repo.split("/");
  return (
    <header>
      <p className="flex items-center gap-2 text-[0.92rem] text-muted">
        <span className="rounded-md bg-ink px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-bg">Pro</span>
        Merge plan
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h1 className="font-serif text-[2.1rem] font-semibold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[2.6rem]">
          <span className="text-muted">{owner}/</span>
          {name}
        </h1>
        <a href={`https://github.com/${plan.repo}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center text-[0.92rem] text-faint hover:text-blue">
          github.com/{plan.repo} ↗
        </a>
      </div>
      <p className="mt-2 text-[0.98rem] text-muted">
        Built from {plan.sample.merged} merged and {plan.sample.closed} closed pull requests since {dateLabel(plan.window.since)} · written {dateLabel(plan.generated_at)}
      </p>
    </header>
  );
}

function VerdictStrip({ plan }: { plan: MergePlan }) {
  const v = plan.verdict;
  return (
    <div className={`mt-7 grid gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-8 sm:p-6 ${card}`}>
      <VerdictPill headline={v.headline} tone={v.tone} className="justify-self-start rounded-full px-3" />
      <dl className="grid grid-cols-3 gap-4 sm:gap-8">
        {v.numbers.map((n) => (
          <div key={n.label} className="flex min-w-0 flex-col-reverse justify-end">
            <dt className="mt-1 text-[0.88rem] leading-snug text-muted">{n.label}</dt>
            <dd className="text-[1.35rem] font-semibold leading-none tabular-nums text-ink">{n.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[0.98rem] leading-relaxed text-muted sm:col-span-2">
        {v.line}{" "}
        <Link href={`/${plan.repo}`} className="text-link whitespace-nowrap">
          See the free report
        </Link>
      </p>
    </div>
  );
}

function PlanSection({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-16 scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="font-serif text-[1.55rem] font-semibold tracking-[-0.01em] sm:text-[1.75rem]">
          {title}
        </h2>
        {note && <p className="text-[0.92rem] text-faint">{note}</p>}
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
        <p className="text-[1.12rem] font-semibold text-ink">{c.reason}</p>
        <p className="shrink-0 text-[0.98rem] tabular-nums text-orange">
          {c.seen} <span className="text-faint">of {c.of}</span>
        </p>
      </div>
      <div className="mt-3">
        <Meter seen={c.seen} of={c.of} tone="orange" label={`${c.seen} of ${c.of} closed outside pull requests`} />
      </div>
      {c.quote && (
        <figure className="mt-5">
          {isUrl(c.quote.text) ? (
            <blockquote className="text-[1.02rem] leading-relaxed text-ink">
              Closed with a link to the project&apos;s policy:{" "}
              <a href={c.quote.text} target="_blank" rel="noopener noreferrer" className="text-link [overflow-wrap:anywhere]">
                {c.quote.text.replace(/^https?:\/\//, "")}
              </a>
            </blockquote>
          ) : (
            <blockquote className="font-serif text-[1.2rem] leading-relaxed text-ink">&ldquo;{c.quote.text}&rdquo;</blockquote>
          )}
          <figcaption className="mt-2 text-[0.9rem] text-faint">
            @{c.quote.who}, a maintainer, on{" "}
            <a href={c.quote.url} target="_blank" rel="noopener noreferrer" className="text-link">
              #{c.quote.number}
            </a>
          </figcaption>
        </figure>
      )}
      {c.examples.length > 1 && (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[0.9rem] text-faint">
          <span>Also</span>
          <PrLinks links={c.examples.filter((e) => e.url !== c.quote?.url).map((e) => e.url)} />
        </p>
      )}
    </div>
  );
}

function LockedRest({ plan }: { plan: MergePlan }) {
  const rows = [
    [`${plan.steps.length - 1} more steps`, plan.steps.slice(1).map((s) => s.title.replace(/`/g, "")).join(" · ")],
    ...(plan.ai ? [[`What the AI found`, `How maintainers treat newcomers, whether the guide is usable, and how ${plan.ai.threads} threads ended`]] : []),
    [`What gets merged`, `${plan.merged.length} patterns counted from ${plan.sample.merged} merged pull requests`],
    [`What gets closed`, `${plan.closed.length} reasons, with what the maintainers wrote`],
    [`Who reviews`, `${plan.reviewers.people.length} reviewers and what they review`],
  ];
  return (
    <section aria-label="The rest of the plan" className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
      <ul>
        {rows.map(([title, body]) => (
          <li key={title} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 border-b border-line px-6 py-4 last:border-b-0">
            <svg viewBox="0 0 16 16" className="mt-1 size-4 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" rx="1.5" />
              <path d="M5 7V5a3 3 0 0 1 6 0v2" />
            </svg>
            <div className="min-w-0">
              <p className="font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-[0.95rem] leading-snug text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-bg/60 px-6 py-5">
        <p className="text-[0.95rem] text-muted">1 credit for this repository. Yours to keep. A plan that fails costs nothing.</p>
        <button type="button" className="btn-primary min-h-12 rounded-xl bg-ink px-5 text-bg">
          Unlock the merge plan →
        </button>
      </div>
    </section>
  );
}
