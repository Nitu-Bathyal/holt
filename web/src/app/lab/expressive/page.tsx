// PROTOTYPE, don't merge. /lab/expressive shows the "expressive Holt"
// direction (docs/design/EXPRESSIVE.md) on real Holt content, so it can be
// felt on staging before any page changes. Throwaway: the patterns get
// rebuilt properly, page by page, once a direction is chosen.
import type { Metadata } from "next";
import { connection } from "next/server";
import { discover, listReports } from "@/lib/api";
import { EXAMPLE_REPORT } from "@/lib/example-report";
import { humanHours, pct, timeAgo } from "@/lib/format";
import { fromDiscover, type CardRepo } from "@/lib/repo-card";
import { TONE_MOOD } from "@/components/report/tone";
import { MotionRoot } from "./_parts/motion";
import { SwapUrl } from "./_parts/swap-url";
import { TerminalReplay, type ReplayLine } from "./_parts/terminal-replay";
import { VerdictStamp, type StampStat } from "./_parts/verdict-stamp";
import { LiveCards } from "./_parts/live-cards";
import { EvidenceMarker } from "./_parts/evidence-marker";
import { LabFooter } from "./_parts/lab-footer";
import { ScaledAnswers, ScaledHero } from "./_parts/scaled-panes";
import "./expressive.css";

export const metadata: Metadata = {
  title: "Lab: expressive Holt",
  robots: { index: false, follow: false },
};

const R = EXAMPLE_REPORT;

function replayLines(): ReplayLine[] {
  const s = R.stats;
  const sample = R.sample;
  const lines: ReplayLine[] = [];
  if (sample) {
    lines.push({ text: "reading the newest {n} pull requests…", counts: [sample.pull_requests] });
    lines.push({ text: "{n} from the team, {n} from bots. set aside.", counts: [sample.team_pull_requests, sample.bot_pull_requests ?? 0], tone: "faint" });
  }
  lines.push({ text: "{n} from outsiders. following each one…", counts: [s.outsider_attempts] });
  lines.push({ text: "  ✓ {n} merged", counts: [s.outsider_merged], tone: "good" });
  if (s.no_reply != null) lines.push({ text: "  · {n} got no reply", counts: [s.no_reply], tone: "bad" });
  if (s.median_first_response_hours != null) lines.push({ text: `  · a first reply typically took ${humanHours(s.median_first_response_hours)}` });
  lines.push({ text: "applying the written rules…", tone: "faint" });
  return lines;
}

function stampStats(): StampStat[] {
  const s = R.stats;
  const out: StampStat[] = [
    { big: "{n} of {n}", values: [s.outsider_merged, s.outsider_attempts], label: `outside PRs merged (${pct(s.outsider_merged, s.outsider_attempts)}%)`, tone: "good", meter: s.outsider_merged / s.outsider_attempts },
  ];
  const wait = humanHours(s.median_first_response_hours);
  const m = /^(\d+) (.+)$/.exec(wait);
  if (m) out.push({ big: `{n} ${m[2]}`, values: [Number(m[1])], label: "is the typical wait for a first reply", tone: "good" });
  if (s.first_time_merged_authors != null) out.push({ big: "{n}", values: [s.first_time_merged_authors], label: "people got their first PR merged here", tone: "good" });
  return out;
}

/** The example report as a card, for when the API has no boards (local mock, outages). */
function exampleCard(): CardRepo {
  const s = R.stats;
  return {
    repo: R.repo, description: null, language: null, stars: null, headline: R.headline, tone: R.tone,
    stats: { attempts: s.outsider_attempts, merged: s.outsider_merged, noReply: s.no_reply, closedSilently: s.closed_silently, stillOpen: s.still_open, firstTimers: s.first_time_merged_authors, replyHours: s.median_first_response_hours },
    issues: [], topics: [], why: [], reason: R.verdict_line, numbersLine: null, odds: null, checkedThisWeek: null,
  };
}

function Pattern({ n, title, where, why, children, id }: { n: string; title: string; where: string; why: string; children: React.ReactNode; id: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="border-t border-line py-14 md:py-24">
      <div className="wrap grid grid-cols-1 gap-6 md:grid-cols-[148px_minmax(0,1fr)] md:gap-10">
        <aside className="rail">
          <strong>{n}</strong>
          <span>pattern</span>
        </aside>
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="h2 mb-3 max-w-[770px]">{title}</h2>
          <p className="prose-sans max-w-[680px]">{why}</p>
          <p className="mb-10 mt-2 text-[0.82rem] text-faint">goes on: {where}</p>
          {children}
        </div>
      </div>
    </section>
  );
}

export default async function ExpressiveLab() {
  await connection();
  const [board, reports] = await Promise.all([discover("welcoming", null, null, 12), listReports(500)]);
  const cards = board.ok ? board.data.repos.map(fromDiscover).filter((c) => c.stats.attempts) : [];
  const shown = cards.length >= 3 ? cards.slice(0, 3) : [exampleCard(), ...cards].slice(0, 3);
  const recent = reports.slice(0, 14).map((r) => ({ repo: r.repo, ago: timeAgo(r.generated_at) }));

  return (
    <MotionRoot>
      {/* The page's own footer stands in for the site's (lab only). */}
      <style>{"body:has([data-lab-expressive]) > footer:not(.xp-footer){display:none}"}</style>

      {/* Pattern 1: the landing hero at full scale, as the page opens. */}
      <ScaledHero />

      <section className="border-b border-line py-14 md:py-20">
        <div className="wrap">
          <p className="text-[0.85rem] text-faint">lab / prototype / not a real page</p>
          <h2 className="display mt-4 max-w-[900px] text-[clamp(2.2rem,6vw,4rem)]">Holt, with a pulse.</h2>
          <p className="prose-sans mt-5 max-w-[680px] text-[1.05rem]">
            Seven ways the site could feel alive, each on real Holt content. Every one reads fine with motion off: use
            the switch at the bottom to see the reduced-motion version.
          </p>
          <ol className="mt-6 space-y-1 text-[0.88rem] text-muted">
            <li><span className="text-blue">1</span> panes at full scale: the hero above, and &ldquo;three answers&rdquo; further down</li>
            <li><span className="text-blue">2</span> hub flips to holt</li>
            <li><span className="text-blue">3</span> watch Holt check a repo</li>
            <li><span className="text-blue">4</span> the answer lands</li>
            <li><span className="text-blue">5</span> cards that answer the pointer</li>
            <li><span className="text-blue">6</span> read the receipts as you scroll</li>
            <li><span className="text-blue">7</span> a footer that signs off (the page&apos;s own footer)</li>
          </ol>
          <p className="mt-4 text-[0.85rem] text-faint">
            the plan: <code className="text-muted">docs/design/EXPRESSIVE.md</code>
          </p>
        </div>
      </section>

      <Pattern
        n="02"
        id="swap"
        title="Swap hub for holt, acted out."
        why="The hook is a trick with a URL, so show the URL doing it: hub flips to holt, then back, while it's on screen. Tap it to flip it yourself. The hero above uses the small version inline."
        where="the landing hero line, the URL-trick section, the 404 page"
      >
        <div className="max-w-[760px]">
          <SwapUrl />
        </div>
      </Pattern>

      <Pattern
        n="03"
        id="replay"
        title="Watch Holt check a repo."
        why="Instead of describing what Holt reads, show a real check running: the command, each step, the counts, then the answer. The cat thinks while it runs."
        where="landing section 02, above the sample report; the same log style for the live progress screen while a report runs"
      >
        <div className="max-w-[760px]">
          <TerminalReplay command={`holt analyze ${R.repo}`} lines={replayLines()} verdict={R.headline} tone={R.tone} mood={TONE_MOOD[R.tone]} />
        </div>
      </Pattern>

      <Pattern
        n="04"
        id="stamp"
        title="The answer lands."
        why="When a report finishes on the page, the verdict arrives like an answer: the bar draws, the headline stamps down, the cat reacts, and the numbers count to their values. A cached report shows up still, so nobody waits twice."
        where="the report page (fresh reports only), the landing's sample report"
      >
        <VerdictStamp repo={R.repo} headline={R.headline} line={R.verdict_line} tone={R.tone} mood={TONE_MOOD[R.tone]} stats={stampStats()} />
      </Pattern>

      <Pattern
        n="05"
        id="cards"
        title="Cards that answer the pointer."
        why="Each odds bar fills in the legend's order, merged first, as it scrolls in. Point at a card and the bar thickens, the short numbers turn into the full count behind each colour, and the cat shows the verdict's mood."
        where="/find, /discover, the signed-in home, saved repos"
      >
        <LiveCards cards={shown} />
      </Pattern>

      <Pattern
        n="06"
        id="receipts"
        title="Read the receipts as you scroll."
        why="Both threads say “closed” on GitHub. The highlighter runs under the words that decide it as you scroll past, so the point of the section lands without a paragraph explaining it."
        where="landing section 05; the evidence list on the report page"
      >
        <EvidenceMarker />
      </Pattern>

      {/* Pattern 1, again: a middle pane at full scale. */}
      <ScaledAnswers />

      <section className="border-t border-line py-14 md:py-20">
        <div className="wrap grid grid-cols-1 gap-6 md:grid-cols-[148px_minmax(0,1fr)] md:gap-10">
          <aside className="rail">
            <strong>07</strong>
            <span>pattern</span>
          </aside>
          <div>
            <h2 className="h2 mb-3 max-w-[770px]">A footer that signs off.</h2>
            <p className="prose-sans max-w-[680px]">
              Below is the proposed site footer, in place of the current one. Move your pointer over it, type a repo
              into the address bar, point at the open-source links, pet the cat.
            </p>
            <p className="mt-2 text-[0.82rem] text-faint">goes on: every page (the first rollout PR)</p>
          </div>
        </div>
      </section>

      <LabFooter recent={recent} checked={reports.length} />
    </MotionRoot>
  );
}
