// DEV ONLY, temporary: the free report and the paid merge plan for the same
// repository, row by row, to settle what each one is for. Not linked from
// anywhere and not indexed. Delete this folder before #144 merges.
import type { Metadata } from "next";
import Link from "next/link";
import { getReport, starterIssues } from "@/lib/api";
import type { MergePlan } from "@/lib/merge-plan";
import data from "@/lib/example-merge-plan.json";
import { caller } from "@/lib/session";
import type { Report, StarterIssue } from "@/lib/types";

export const metadata: Metadata = { title: "Free vs pro (dev)", robots: { index: false, follow: false } };

const plan = data as MergePlan;

type Cell = React.ReactNode | null; // null: this report doesn't have it

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "?";

export default async function FreeVsProPage() {
  const [r, i] = await Promise.all([getReport(plan.repo), caller().then((c) => starterIssues(plan.repo, 3, c))]);
  const report = r.ok ? r.data : null;
  const issues = i.ok ? i.data.issues : [];
  const rows = compare(report, issues);

  return (
    <div className="wrap py-8 sm:py-12">
      <p className="mb-6 border border-dashed border-orange px-4 py-2 text-[0.85rem] text-orange">
        Dev only · temporary · delete <code>web/src/app/free-vs-pro/</code> before #144 merges
      </p>
      <h1 className="text-[1.6rem] font-semibold tracking-tight sm:text-[2rem]">Free report vs paid report</h1>
      <p className="mt-2 max-w-3xl font-sans text-muted">
        The same repository, <strong className="text-ink">{plan.repo}</strong>, topic by topic. The free report is today&apos;s live one
        {report ? "" : " (not available right now)"}; the paid report is the merge plan example from #144.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[0.9rem]">
        <Link href={`/${plan.repo}`} className="text-link">open the free report</Link>
        <Link href="/example-ai-report" className="text-link">open the merge plan</Link>
        <Link href="/example-ai-report?view=locked" className="text-link">merge plan, locked</Link>
      </div>

      <div className="mt-8 border-t border-ink">
        <div className="hidden grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-6 border-b border-line py-3 text-[0.8rem] uppercase tracking-[0.08em] text-faint md:grid">
          <span>topic</span>
          <span>free report · rules, no model</span>
          <span className="text-ink">paid · merge plan</span>
        </div>
        {rows.map(([topic, free, pro]) => (
          <section key={topic} className="grid gap-x-6 gap-y-2 border-b border-line py-4 md:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)]">
            <h2 className="text-[0.95rem] font-semibold text-ink">{topic}</h2>
            <Side label="free" cell={free} />
            <Side label="paid" cell={pro} pro />
          </section>
        ))}
      </div>
    </div>
  );
}

function Side({ label, cell, pro = false }: { label: string; cell: Cell; pro?: boolean }) {
  return (
    <div className={`min-w-0 font-sans text-[0.95rem] leading-relaxed ${pro ? "text-ink" : "text-muted"}`}>
      <span className="mr-2 font-mono text-[0.75rem] uppercase tracking-[0.08em] text-faint md:hidden">{label}</span>
      {cell ?? <span className="text-faint">not in this report</span>}
    </div>
  );
}

const list = (items: React.ReactNode[]) => (
  <ul className="space-y-1">
    {items.map((x, i) => (
      <li key={i}>· {x}</li>
    ))}
  </ul>
);

function compare(r: Report | null, issues: StarterIssue[]): [string, Cell, Cell][] {
  const s = plan.sample;
  const steps = plan.steps;
  const since = new Date(plan.window.since).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  return [
    ["Question it answers", "Is this repo worth my time?", "How do I get my first pull request merged here?"],
    [
      "Verdict",
      r && (<><strong className="text-ink">{r.headline}.</strong> {r.verdict_line}</>),
      <>The same verdict, shown at the top. The rules pick it; the model never does.</>,
    ],
    ["What to do", r?.next_step ?? null, <strong key="c">{plan.call.text}</strong>],
    [
      "The numbers",
      r && (<>{r.numbers_line} {r.first_timer_line}</>),
      <>The free report&apos;s three key numbers, plus counts from {s.merged} merged and {s.closed} closed pull requests since {since}.</>,
    ],
    [
      "Where to start",
      r && list([
        ...issues.slice(0, 3).map((x) => <>starter issue <a className="text-link" href={x.url}>#{x.number}</a> {x.title}</>),
        ...r.landing.slice(0, 3).map((l) => <>{l.path}/: {l.merged} of {l.attempted} outside PRs merged</>),
      ]),
      list([steps[0].title.replace(/`/g, ""), steps[1].title + ", with the comment to post"]),
    ],
    [
      "The project's rules",
      r ? (r.asks.length ? list(r.asks.map((a) => a.code)) : <>Only CLA, DCO or issue-first requirements when found (none here).</>) : null,
      <>{steps[2].title}: {steps[2].detail}</>,
    ],
    ["Size to aim for", null, <>{steps[3].title.replace(/`/g, "")}. {steps[3].detail}</>],
    ["Checks that must pass", null, <>{steps[4].title.replace(/`/g, "")}. {steps[4].detail}</>],
    [
      "Who reviews",
      r ? <>Only the typical first reply: {r.stats.median_first_response_hours ?? "?"} hours.</> : null,
      list(plan.reviewers.people.map((p) => <>@{p.login}: {p.reviewed} of {p.of} merged PRs{p.areas.length ? ` (${p.areas.join(", ")})` : ""}</>)),
    ],
    [
      "Why PRs get closed",
      r ? <>Only counts: {r.stats.closed_silently} closed without a word, {r.stats.no_reply} with no reply.</> : null,
      list(plan.closed.map((c) => <>{c.reason}: {c.seen} of {c.of}, with the maintainer&apos;s words and links</>)),
    ],
    [
      "Evidence",
      r ? <>{r.evidence.length} linked pull requests behind the verdict, in a list at the bottom.</> : null,
      <>Every claim opens to its count and the pull requests it came from.</>,
    ],
    [
      "Time window",
      r?.sample ? <>The newest {r.sample.pull_requests} pull requests ({day(r.sample.first_opened)} – {day(r.sample.last_opened)}).</> : null,
      <>The last {plan.window.days} days: {s.merged} merged and {s.closed} closed pull requests read.</>,
    ],
    ["Written by", "Rules only. No model, no AI.", <>{plan.model}, every sentence checked against the counts; unmatched ones are cut.</>],
    ["You can act on it by", "Reading it.", "Ticking off steps, copying the comment, opening the linked PRs and issue."],
    ["Price", "Free, no account.", "Paid: 1 credit per repository (draft), kept for good; a failed plan costs nothing."],
  ];
}
