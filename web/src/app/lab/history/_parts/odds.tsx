"use client";
// PROTOTYPE, don't merge. Concept C, "you got in": each repo's usual odds for
// an outside PR (from Holt's report on it) beside how yours went, and how long
// yours took beside how long a merge usually takes there. Only repos Holt has
// a current report on get a comparison; the rest say so.
import Link from "next/link";
import type { Pr, Repo } from "./data";
import { duration, faster, gotIn, inTen, plural, rate, repoList, since, tookDays } from "./facts";
import { Head, type ConceptProps } from "./ui";

const TONE: Record<string, string> = { "Worth your time": "text-green", "Not worth your time": "text-orange", "Not enough evidence": "text-amber" };

export function Odds({ persona, prs }: ConceptProps) {
  const repos = repoList(prs).sort((a, b) => (rate(persona.repos[a.repo]) ?? 2) - (rate(persona.repos[b.repo]) ?? 2));
  const got = gotIn(prs, persona.repos);
  const fast = faster(prs, persona.repos);

  let title: string;
  if (got.length === 1) title = `You got into ${got[0].repo}, where most outside PRs don't.`;
  else if (got.length > 1) title = `You got into ${got.length} repos where most outside PRs don't.`;
  else if (fast.length) {
    const f = fast[0];
    title = `${f.repo} merged your PR in ${duration(tookDays(f))}. It usually takes ${duration(persona.repos[f.repo].typicalMergeDays!)}.`;
  } else title = `Your PRs landed in ${plural(repos.filter((r) => r.merged).length, "repo")}.`;

  return (
    <section>
      <Head title={title} sub={`since ${since()}`} />
      <ul className="hx-odds">
        {repos.map((r, i) => <Row key={r.repo} repo={r.repo} info={persona.repos[r.repo]} prs={r.prs} index={i} />)}
      </ul>
    </section>
  );
}

function Row({ repo, info, prs, index }: { repo: string; info: Repo; prs: Pr[]; index: number }) {
  const m = prs.filter((x) => x.state === "merged");
  const answered = prs.filter((x) => x.state !== "open").length;
  const theirs = info.outsideTried ? inTen(info) : undefined;
  const yoursInTen = answered ? Math.round((m.length / answered) * 10) : undefined;
  const cells = answered <= 12;

  return (
    <li className="hx-odd" style={{ "--row": index } as React.CSSProperties}>
      <div className="hx-odd-name">
        <a href={`https://github.com/${repo}`} className="hx-repo">{repo}</a>
        <p className="mt-1 text-[0.8rem]">
          {info.team ? <span className="hx-tag">team</span> : info.verdict ? <span className={TONE[info.verdict]}>{info.verdict}</span> : null}
          {prs.length > 1 && <span className="ml-2 text-faint">{plural(prs.length, "PR")}</span>}
        </p>
      </div>

      <div className="hx-odd-strips">
        {theirs !== undefined ? (
          <div className="hx-strip-row">
            <span className="hx-strip-label">outside PRs</span>
            <Cells filled={theirs} total={10} tone="muted" />
            <span className="hx-strip-note">{theirs} in 10 merged</span>
          </div>
        ) : (
          <div className="hx-strip-row">
            <span className="hx-strip-label">outside PRs</span>
            {info.team ? <span className="text-faint">your team&apos;s repo</span> : <Link href={`/${repo}`} className="hx-link">check this repo →</Link>}
          </div>
        )}
        <div className="hx-strip-row">
          <span className="hx-strip-label">yours</span>
          {cells ? <Yours prs={prs} /> : <Cells filled={yoursInTen ?? 0} total={10} tone="green" />}
          <span className="hx-strip-note">
            {cells ? `${m.length} of ${answered || prs.length} merged` : `${yoursInTen} in 10 merged`}
            {prs.length - answered > 0 && <span className="text-blue">, {prs.length - answered} waiting</span>}
          </span>
        </div>
      </div>

      {info.typicalMergeDays && m.length > 0 && <Speed prs={m} typical={info.typicalMergeDays} />}
    </li>
  );
}

function Cells({ filled, total, tone }: { filled: number; total: number; tone: "muted" | "green" }) {
  return (
    <span className="hx-cells" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < filled ? `hx-cell hx-cell-${tone}` : "hx-cell"} style={{ "--c": i } as React.CSSProperties} />
      ))}
    </span>
  );
}

function Yours({ prs }: { prs: Pr[] }) {
  const order = { merged: 0, closed: 1, open: 2 } as const;
  const sorted = [...prs].sort((a, b) => order[a.state] - order[b.state]);
  return (
    <span className="hx-cells" aria-hidden="true">
      {sorted.map((x, i) => (
        <span key={x.number} title={`#${x.number} ${x.title}`} className={`hx-cell ${x.state === "merged" ? "hx-cell-green" : x.state === "open" ? "hx-cell-open" : ""}`} style={{ "--c": i } as React.CSSProperties} />
      ))}
    </span>
  );
}

/** Each of your merges on a line, against the repo's typical wait. */
function Speed({ prs, typical }: { prs: Pr[]; typical: number }) {
  const took = prs.map(tookDays).sort((a, b) => a - b);
  const yours = took[Math.floor((took.length - 1) / 2)];
  const max = Math.max(typical * 2, took[took.length - 1]);
  const at = (d: number) => `${Math.min(100, (d / max) * 100)}%`;
  return (
    <div className="hx-speed">
      <div className="hx-track" aria-hidden="true">
        <span className="hx-usual" style={{ left: at(typical) }} />
        {took.map((d, i) => <span key={i} className="hx-dot" style={{ left: at(d), "--c": i } as React.CSSProperties} />)}
      </div>
      <p className="hx-speed-note">
        <span className="text-green">{prs.length === 1 ? "yours" : "yours, typically"}: {duration(yours)}</span>
        <span className="ml-3 text-faint">outside PRs: {duration(typical)}</span>
      </p>
    </div>
  );
}
