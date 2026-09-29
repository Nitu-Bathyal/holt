// PROTOTYPE, don't merge. The pages of /lab/dashboard: home in its four
// states, your pull requests, find a project and your repos.
import Link from "next/link";
import { useState } from "react";
import { RepoAvatar } from "@/components/repo-card/repo-avatar";
import { VerdictPill } from "@/components/report/verdict-pill";
import { TONE } from "@/components/report/tone";
import { LANGUAGES, MINE, PICKS, PRS, REPOS, span, type LabPR } from "./data";
import { Empty, Loop, PageHead, PickCard, RepoName, Row, SectionHead, WaitBar } from "./ui";

export type HomeState = "first" | "issue" | "waiting" | "merged";
export type View = `home-${HomeState}` | "prs" | "find" | "repos";

export interface Lab {
  go: (v: View, focus?: string) => void;
  saved: Set<string>;
  toggleSave: (repo: string) => void;
  langs: string[];
  setLangs: (l: string[]) => void;
}

const RULE = { needs: "var(--orange)", waiting: "var(--blue)", merged: "var(--green)", closed: "var(--line-strong)" };
const issuesHref = (repo: string) => `https://github.com/${repo}/issues?q=is%3Aopen+label%3A%22good+first+issue%22`;
const prHref = (p: LabPR) => `https://github.com/${p.repo}/pull/${p.number}`;
const late = (p: LabPR) => p.state === "open" && p.hours > REPOS[p.repo].replyHours * 1.5;

function PrRow({ p, action }: { p: LabPR; action?: React.ReactNode }) {
  const r = REPOS[p.repo];
  const rule = p.state === "open" ? (late(p) ? RULE.needs : RULE.waiting) : RULE[p.state];
  return (
    <Row rule={rule} action={action}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-[0.92rem]">
        <RepoName repo={p.repo} />
        <span className="font-mono text-[0.8rem] text-faint">#{p.number}</span>
        {p.foundViaHolt && <span className="border border-blue/40 px-1.5 font-mono text-[0.72rem] text-blue">found via Holt</span>}
      </p>
      <a href={prHref(p)} className="mt-0.5 block truncate font-sans text-[0.95rem] hover:underline">{p.title}</a>
      {p.state === "open" && r ? (
        <WaitBar hours={p.hours} typical={r.replyHours} />
      ) : (
        <p className="mt-1 font-mono text-[0.78rem] text-faint">
          {p.state === "merged" ? "merged" : "closed, not merged"} {span(p.hours)} ago
          {r && <> · <span className={TONE[r.tone].text}>{r.headline.toLowerCase()}</span></>}
        </p>
      )}
    </Row>
  );
}

function YourRepos({ lab, limit }: { lab: Lab; limit?: number }) {
  const rows = MINE.filter((m) => m.how === "checked" || lab.saved.has(m.repo)).slice(0, limit);
  return (
    <ul>
      {rows.map((m) => {
        const r = REPOS[m.repo];
        return (
          <Row key={m.repo} rule="transparent" action={<VerdictPill headline={r.headline} tone={r.tone} className="px-1.5 py-0.5 text-[0.74rem]" />}>
            <div className="flex items-center gap-3">
              <RepoAvatar repo={m.repo} size={28} />
              <div className="min-w-0">
                <a href={`/${m.repo}`} className="block truncate text-[0.92rem] hover:text-blue"><RepoName repo={m.repo} /></a>
                <p className="font-mono text-[0.76rem] text-faint">{m.how} {span(m.hours)} ago</p>
              </div>
            </div>
          </Row>
        );
      })}
    </ul>
  );
}

function Picks({ lab, repos, i0 = 0 }: { lab: Lab; repos: string[]; i0?: number }) {
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {repos.map((repo, i) => (
        <PickCard key={repo} r={REPOS[repo]} i={i0 + i} saved={lab.saved.has(repo)} onSave={() => lab.toggleSave(repo)} />
      ))}
    </div>
  );
}

function LanguageChips({ lab, value = lab.langs }: { lab: Lab; value?: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {LANGUAGES.map((l) => {
        const on = value.includes(l);
        return (
          <button key={l} type="button" aria-pressed={on} className="dl-chip" onClick={() => lab.setLangs(on ? value.filter((x) => x !== l) : [...value, l])}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

const CANDIDATES = [...PICKS, "home-assistant/core", "NixOS/nixpkgs"];
const picksFor = (langs: string[], not: string[] = []) =>
  CANDIDATES.filter((r) => (langs.length === 0 || langs.includes(REPOS[r].language)) && !not.includes(r)).slice(0, 3);

// ---------------------------------------------------------------- home

export function Home({ state, lab, focus }: { state: HomeState; lab: Lab; focus?: string }) {
  if (state === "first") return <HomeFirst lab={lab} />;
  if (state === "issue") return <HomeIssue lab={lab} repo={focus && REPOS[focus]?.issues.length ? focus : "pallets/click"} />;
  return <HomeReturning lab={lab} merged={state === "merged"} />;
}

function HomeFirst({ lab }: { lab: Lab }) {
  const picks = lab.langs.length ? picksFor(lab.langs) : [];
  return (
    <>
      <PageHead title="Let's find your *first repo.*" mood={lab.langs.length ? "adoring" : "ready"}>
        <Loop at={0} />
      </PageHead>
      <section className="dl-section" aria-labelledby="langs-h">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="langs-h" className="font-mono text-[1.05rem] font-semibold">Which languages do you read?</h2>
          <Link href="/connect" className="dl-quiet">or connect GitHub</Link>
        </div>
        <LanguageChips lab={lab} />
        {lab.langs.length === 0 && (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className={`dl-ghost ${i ? "hidden md:block" : ""} ${i === 2 ? "md:hidden xl:block" : ""}`} />)}
          </div>
        )}
        {lab.langs.length > 0 &&
          (picks.length ? (
            <Picks lab={lab} repos={picks} />
          ) : (
            <Empty mood="thinking" text={`No picks in ${lab.langs.join(" or ")} yet.`} action={<button type="button" className="dl-quiet" onClick={() => lab.go("find")}>see the most welcoming repos</button>} />
          ))}
      </section>
    </>
  );
}

function HomeIssue({ lab, repo }: { lab: Lab; repo: string }) {
  const r = REPOS[repo];
  const [owner, name] = repo.split("/");
  return (
    <>
      <PageHead title={`Next: pick an issue in *${name}.*`} lead={<>{owner}/{name} replies to outsiders within {span(r.replyHours)}, and {r.firstTimers} first-timers got merged recently.</>} mood="determined">
        <Loop at={1} />
      </PageHead>
      <section className="dl-section" aria-labelledby="issues-h">
        <SectionHead title="Starter issues" count={r.issues.length} more={{ label: "all on GitHub ↗", href: issuesHref(repo) }} />
        <ul>
          {r.issues.map((iss, i) => (
            <Row
              key={iss.number}
              rule={RULE.waiting}
              action={
                i === 0 ? <a href={issuesHref(repo)} className="btn-primary min-h-10 px-4 text-[0.84rem]">take this one ↗</a> : <a href={issuesHref(repo)} className="dl-quiet">open ↗</a>
              }
            >
              <p className="font-sans text-[0.95rem]"><span className="font-mono text-blue">#{iss.number}</span> {iss.title}</p>
              <p className="mt-1 font-mono text-[0.76rem] text-faint">{iss.labels.join(" · ")} · opened {span(iss.daysAgo * 24)} ago</p>
            </Row>
          ))}
        </ul>
      </section>
      <section className="dl-section" aria-labelledby="picks-h">
        <SectionHead title="Or another repo" more={{ label: "find a project", onClick: () => lab.go("find") }} />
        <Picks lab={lab} repos={picksFor(["Python", "Rust"], [repo]).slice(0, 3)} />
      </section>
    </>
  );
}

function HomeReturning({ lab, merged }: { lab: Lab; merged: boolean }) {
  const open = PRS.filter((p) => p.state === "open");
  const lead = PRS.find((p) => (merged ? p.state === "merged" : late(p)))!;
  const r = REPOS[lead.repo];
  const inFlight = merged ? open.filter((p) => !late(p)) : open.filter((p) => p !== lead);
  const also: { key: string; rule: string; text: React.ReactNode; action: React.ReactNode }[] = [];
  if (merged)
    for (const p of open.filter(late))
      also.push({
        key: `late-${p.number}`, rule: RULE.needs,
        text: <>Your PR to <RepoName repo={p.repo} /> has waited {span(p.hours)}. Replies there usually take {span(REPOS[p.repo].replyHours)}.</>,
        action: <Link href="/preflight" className="dl-quiet">check it with pre-flight →</Link>,
      });
  if (lab.saved.has("pallets/flask"))
    also.push({
      key: "flask", rule: RULE.needs,
      text: <>You saved <RepoName repo="pallets/flask" />. Holt now says <span className="text-orange">not worth your time</span>: 5 of 171 outside PRs merged.</>,
      action: <button type="button" className="dl-quiet" onClick={() => lab.toggleSave("pallets/flask")}>remove it</button>,
    });
  also.push({
    key: "click", rule: RULE.waiting,
    text: <>2 new starter issues in <RepoName repo="pallets/click" />, a repo you checked.</>,
    action: <button type="button" className="dl-quiet" onClick={() => lab.go("home-issue", "pallets/click")}>see them</button>,
  });

  return (
    <>
      {merged ? (
        <PageHead title={`${lead.repo} *merged your PR.*`} lead={<>{lead.title}. That&apos;s your 2nd merged PR this year.</>} mood="celebrating">
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            <button type="button" className="btn-primary" onClick={() => lab.go("home-issue", lead.repo)}>find your next issue there →</button>
            <button type="button" className="dl-quiet" onClick={() => document.getElementById("picks-h")?.scrollIntoView({ behavior: "smooth" })}>or a new repo</button>
          </div>
          <Loop at={4} />
        </PageHead>
      ) : (
        <PageHead title={`Your PR to ${lead.repo} has *waited ${span(lead.hours)}.*`} lead={<>Replies there usually come within {span(r.replyHours)}.</>} mood="thinking">
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link href="/preflight" className="btn-primary">check it with pre-flight →</Link>
            <a href={prHref(lead)} className="dl-quiet">open it on GitHub ↗</a>
          </div>
          <Loop at={3} />
        </PageHead>
      )}

      {also.length > 0 && (
        <section className="dl-section" aria-labelledby="also-h">
          <SectionHead title="Also for you" count={also.length} />
          <ul>
            {also.map((a) => (
              <Row key={a.key} rule={a.rule} action={a.action}>
                <p className="font-sans text-[0.95rem]">{a.text}</p>
              </Row>
            ))}
          </ul>
        </section>
      )}

      {inFlight.length > 0 && (
        <section className="dl-section" aria-labelledby="flight-h">
          <SectionHead title="In flight" count={inFlight.length} more={{ label: "all your PRs", onClick: () => lab.go("prs") }} />
          <ul>{inFlight.map((p) => <PrRow key={p.number} p={p} />)}</ul>
        </section>
      )}

      <section className="dl-section" aria-labelledby="picks-h">
        <SectionHead title="Next repos for you" more={{ label: "find a project", onClick: () => lab.go("find") }} />
        <Picks lab={lab} repos={PICKS} />
      </section>

      <section className="dl-section" aria-labelledby="mine-h">
        <SectionHead title="Your repos" more={{ label: "all of them", onClick: () => lab.go("repos") }} />
        <YourRepos lab={lab} limit={4} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------- your pull requests

export function Prs({ lab }: { lab: Lab }) {
  const needs = PRS.filter(late);
  const waiting = PRS.filter((p) => p.state === "open" && !late(p));
  const groups: { title: string; prs: LabPR[]; action?: (p: LabPR) => React.ReactNode }[] = [
    { title: "Needs you", prs: needs, action: () => <Link href="/preflight" className="btn-primary min-h-10 px-4 text-[0.84rem]">pre-flight →</Link> },
    { title: "Waiting", prs: waiting },
    { title: "Merged", prs: PRS.filter((p) => p.state === "merged") },
    { title: "Closed", prs: PRS.filter((p) => p.state === "closed") },
  ];
  return (
    <>
      <PageHead title={needs.length ? `${needs.length} PR is *waiting longer than usual.*` : "Nothing needs you."} mood={needs.length ? "thinking" : "celebrating"}>
        <p className="mt-5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[0.84rem] text-muted">
          <span><b className="text-ink">5</b> opened this year</span>
          <span><b className="text-green">2</b> merged</span>
          <span><b className="text-ink">1</b> closed</span>
          <span><b className="text-blue">2</b> found via Holt</span>
          <span className="text-faint">updated 20 minutes ago · <button type="button" className="text-blue hover:underline">refresh</button></span>
        </p>
      </PageHead>
      {groups.map((g) =>
        g.prs.length ? (
          <section key={g.title} className="dl-section" aria-label={g.title}>
            <SectionHead title={g.title} count={g.prs.length} />
            <ul>{g.prs.map((p) => <PrRow key={p.number} p={p} action={g.action?.(p)} />)}</ul>
          </section>
        ) : null,
      )}
      <p className="mt-10 font-sans text-[0.92rem] text-muted">
        Next one? <button type="button" className="dl-quiet" onClick={() => lab.go("find")}>find a project</button>
      </p>
    </>
  );
}

// ---------------------------------------------------------------- find a project

const TABS = ["for you", "most welcoming", "trending", "Hacktoberfest"] as const;

export function Find({ lab }: { lab: Lab }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("for you");
  const [time, setTime] = useState("a weekend");
  const all = [...CANDIDATES, "psf/requests"];
  // The account's languages until you change them.
  const langs = lab.langs.length ? lab.langs : ["Python", "Rust"];
  const list =
    tab === "for you" ? picksFor(langs)
    : tab === "most welcoming" ? [...all].sort((a, b) => REPOS[b].merged / REPOS[b].attempts - REPOS[a].merged / REPOS[a].attempts)
    : tab === "trending" ? [...all].sort((a, b) => REPOS[b].firstTimers - REPOS[a].firstTimers)
    : ["home-assistant/core", "Textualize/rich", "astral-sh/ruff"];
  return (
    <>
      <PageHead title="Repos that will *merge your work.*" mood="ready" />
      <div role="tablist" aria-label="Lists" className="dl-tabs mt-8">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className="dl-tab" onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "for you" && (
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <LanguageChips lab={lab} value={langs} />
          <div className="flex flex-wrap gap-2" aria-label="Time you have">
            {["an evening", "a weekend", "a week"].map((t) => (
              <button key={t} type="button" aria-pressed={time === t} className="dl-chip" onClick={() => setTime(t)}>{t}</button>
            ))}
          </div>
        </div>
      )}
      {tab === "Hacktoberfest" && <p className="mt-5 font-sans text-muted">Starts 1 October.</p>}
      <div key={tab}>
        {list.length ? <Picks lab={lab} repos={list} /> : <Empty mood="thinking" text={`No picks in ${langs.join(" or ")} yet.`} action={<button type="button" className="dl-quiet" onClick={() => setTab("most welcoming")}>see the most welcoming</button>} />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- your repos

export function Repos({ lab }: { lab: Lab }) {
  const [show, setShow] = useState<"all" | "saved" | "checked">("all");
  const [pick, setPick] = useState<string[]>([]);
  const rows = MINE.filter((m) => (m.how === "checked" || lab.saved.has(m.repo)) && (show === "all" || m.how === show));
  const total = MINE.filter((m) => m.how === "checked" || lab.saved.has(m.repo)).length;
  return (
    <>
      <PageHead title={`${total} repos you *saved or checked.*`} mood="ready" />
      <div role="tablist" aria-label="Show" className="dl-tabs mt-8">
        {(["all", "saved", "checked"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={show === t} className="dl-tab" onClick={() => setShow(t)}>{t}</button>
        ))}
      </div>
      <ul key={show}>
        {rows.map((m, i) => {
          const r = REPOS[m.repo];
          const on = pick.includes(m.repo);
          return (
            <li key={m.repo} className="dl-row dl-appear" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto", "--i": i } as React.CSSProperties}>
              <input
                type="checkbox"
                aria-label={`Compare ${m.repo}`}
                checked={on}
                onChange={() => setPick(on ? pick.filter((x) => x !== m.repo) : [...pick, m.repo].slice(-4))}
                className="ml-2 size-4 accent-blue"
              />
              <div className="flex min-w-0 items-center gap-3">
                <RepoAvatar repo={m.repo} size={32} />
                <div className="min-w-0">
                  <a href={`/${m.repo}`} className="block truncate hover:text-blue"><RepoName repo={m.repo} /></a>
                  <p className="font-mono text-[0.76rem] text-faint">{m.how} {span(m.hours)} ago · {r.merged} of {r.attempts} merged · replies in {span(r.replyHours)}</p>
                </div>
              </div>
              <VerdictPill headline={r.headline} tone={r.tone} className="px-1.5 py-0.5 text-[0.74rem]" />
            </li>
          );
        })}
      </ul>
      {pick.length >= 2 && (
        <div className="dl-appear sticky bottom-20 mt-6 flex justify-end">
          <a href={`/compare?repos=${pick.join(",")}`} className="btn-primary shadow-soft">compare {pick.length} →</a>
        </div>
      )}
    </>
  );
}
